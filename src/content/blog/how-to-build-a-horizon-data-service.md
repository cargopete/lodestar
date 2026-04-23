---
title: "How to Build and Deploy a Data Service on The Graph's Horizon Framework"
date: "2026-04-23"
author: "cargopete"
tags: ["horizon", "data-services", "solidity", "rust", "tap", "payments", "indexers"]
excerpt: "A complete technical walkthrough of building a production Horizon data service — from Solidity contract to off-chain payment collection — drawn from two real implementations: Dispatch and SubstreamsDataService."
---

The Graph's Horizon upgrade (GIP-0066, live December 2025) turned the protocol into a permissionless data marketplace. Before Horizon, The Graph had one type of data service: subgraphs. After Horizon, anyone can build a new type of data service — JSON-RPC endpoints, streaming data pipelines, oracle feeds, ZK proofs — and plug directly into the existing economic infrastructure. Same staking layer. Same payment layer. Brand new service.

We've spent the last several months building **Dispatch**, an experimental JSON-RPC data service on Horizon. Along the way we also studied **SubstreamsDataService**, the second data service on the network, which is about to launch. Between the two implementations we now have a fairly complete picture of what it actually takes to ship a Horizon data service end-to-end. This post is that picture.

It's long. That's the point. There's a lot to get right.

## The architecture in one diagram

Every Horizon data service has three independent layers:

```
┌──────────────────────────────────────────────────┐
│  Your Data Service Contract                       │
│  • Provider register / deregister lifecycle      │
│  • collect() — redeems RAVs, triggers GRT flow   │
│  • Service-specific state (chains, tiers, etc.)  │
└─────────────────────┬────────────────────────────┘
                      │ delegates to
┌─────────────────────▼────────────────────────────┐
│  GraphTally Payment Stack                         │
│  • PaymentsEscrow  — holds pre-funded GRT        │
│  • GraphPayments   — distributes GRT on collect  │
│  • GraphTallyCollector — validates EIP-712 RAVs  │
└─────────────────────┬────────────────────────────┘
                      │ reads stake from
┌─────────────────────▼────────────────────────────┐
│  HorizonStaking                                   │
│  • Provisions: (serviceProvider, dataService)    │
│  • Thawing periods, verifier cuts, delegation    │
└──────────────────────────────────────────────────┘
```

Horizon provides the bottom two layers for free. You build the top one. The economic machinery — staking, escrow, payment distribution, delegation — is already there. Your job is to define what providers are registering to do, what they charge for, and whether you can slash them if they misbehave.

The off-chain architecture mirrors this:

```
Consumer / Gateway
    │  (1) signed TAP receipt per request
    ▼
Provider's Off-Chain Service
    │  validates receipt, persists to DB
    │
    │  (2) every ~60s: aggregate receipts → RAV
    │  (3) every ~60m: submit RAV → collect()
    ▼
Arbitrum One — GRT settles on-chain
```

## The on-chain contract

Your Solidity contract must implement `IDataService`. The interface is simple — seven functions — but getting the implementation right takes some care.

### Inheriting the base contracts

The `@graphprotocol/horizon` package ships base contracts that handle the boilerplate:

```solidity
import {DataService} from "@graphprotocol/horizon/data-service/DataService.sol";
import {DataServiceFees} from "@graphprotocol/horizon/data-service/extensions/DataServiceFees.sol";
import {DataServicePausable} from "@graphprotocol/horizon/data-service/extensions/DataServicePausable.sol";

contract MyDataService is Ownable, DataService, DataServiceFees, DataServicePausable, IMyDataService {
    // ...
}
```

**`DataService`** gives you `GraphDirectory` (resolves all Horizon contract addresses from the controller — so you're upgrade-proof), `_checkProvisionTokens()`, `_checkProvisionParameters()`, and the `onlyAuthorizedForProvision` modifier. **`DataServiceFees`** gives you `_lockStake()` / `_releaseStake()`. **`DataServicePausable`** gives you an emergency stop.

The constructor wires up the provision parameter ranges:

```solidity
uint256 public constant MIN_PROVISION = 10_000e18;     // 10,000 GRT
uint64  public constant MIN_THAWING_PERIOD = 14 days;
uint256 public constant STAKE_TO_FEES_RATIO = 5;       // matches SubgraphService

constructor(address owner_, address controller, address graphTallyCollector, address pauseGuardian)
    Ownable(owner_) DataService(controller)
{
    GRAPH_TALLY_COLLECTOR = IGraphTallyCollector(graphTallyCollector);
    minThawingPeriod = MIN_THAWING_PERIOD;
    _setProvisionTokensRange(MIN_PROVISION, type(uint256).max);
    _setThawingPeriodRange(MIN_THAWING_PERIOD, type(uint64).max);
    _setVerifierCutRange(0, uint32(1_000_000));  // 0–100% in PPM
    _setPauseGuardian(pauseGuardian, true);
}
```

Pass `controller` instead of individual contract addresses. The controller is the registry — if Horizon contracts are upgraded, your service picks up the new addresses automatically.

### Provider lifecycle

Before a provider can register, they must call `HorizonStaking.provision(provider, address(this), tokens, maxVerifierCut, thawingPeriod)`. Your `register()` validates this and stores whatever metadata your service needs:

```solidity
function register(address serviceProvider, bytes calldata data)
    external override whenNotPaused onlyAuthorizedForProvision(serviceProvider)
{
    if (registeredProviders[serviceProvider]) revert ProviderAlreadyRegistered(serviceProvider);

    _checkProvisionTokens(serviceProvider);       // reverts if below MIN_PROVISION
    _checkProvisionParameters(serviceProvider, false);  // reverts if thawing/cut out of range

    // Decode whatever registration metadata your service needs.
    // Example: endpoint URL, geographic hash, optional payment wallet.
    (string memory endpoint, string memory geoHash, address dest) =
        abi.decode(data, (string, string, address));

    registeredProviders[serviceProvider] = true;
    paymentsDestination[serviceProvider] = dest == address(0) ? serviceProvider : dest;

    emit ProviderRegistered(serviceProvider, endpoint, geoHash);
}
```

`startService()` / `stopService()` activate and deactivate specific service instances. For Dispatch, an instance is a `(chainId, tier)` pair — serving Ethereum mainnet at Standard tier, for example. For SubstreamsDataService, activation is implicit (any provisioned provider can serve). Use explicit `startService` when providers can serve multiple distinct configurations that gateways need to discover individually.

One implementation detail worth noting: **reuse existing stopped entries rather than pushing new ones** when a provider restarts a service. Otherwise the internal array grows without bound across many start/stop cycles and `activeRegistrationCount()` becomes increasingly expensive to call.

### collect() — where GRT actually moves

This is the most important function. When the provider calls it with a signed RAV, GRT flows from the consumer's escrow to the provider's wallet:

```solidity
function collect(
    address serviceProvider,
    IGraphPayments.PaymentTypes paymentType,
    bytes calldata data
)
    external override whenNotPaused returns (uint256 fees)
{
    if (paymentType != IGraphPayments.PaymentTypes.QueryFee) revert InvalidPaymentType();
    if (!registeredProviders[serviceProvider]) revert ProviderNotRegistered(serviceProvider);

    (IGraphTallyCollector.SignedRAV memory signedRav, uint256 tokensToCollect) =
        abi.decode(data, (IGraphTallyCollector.SignedRAV, uint256));

    if (signedRav.rav.serviceProvider != serviceProvider) {
        revert InvalidServiceProvider(serviceProvider, signedRav.rav.serviceProvider);
    }

    _releaseStake(serviceProvider, 0);  // release expired locks from previous collections

    fees = GRAPH_TALLY_COLLECTOR.collect(
        paymentType,
        abi.encode(
            signedRav,
            uint256(0),                            // dataServiceCut (0 for simple services)
            paymentsDestination[serviceProvider]   // where GRT lands
        ),
        tokensToCollect
    );

    if (fees > 0) {
        // Lock stake proportional to fees for the dispute window.
        _lockStake(serviceProvider, fees * STAKE_TO_FEES_RATIO, block.timestamp + minThawingPeriod);
    }
}
```

The payment distribution chain from `collect()` inward: **GraphTallyCollector** verifies the EIP-712 RAV signature and authorisation; **PaymentsEscrow** transfers `delta = valueAggregate - previouslyCollected` from the payer's deposit; **GraphPayments** routes the GRT — protocol tax, data service cut (zero for simple services), delegator cut, then remainder to `paymentsDestination`.

Explicitly reject payment types other than `QueryFee`. SubstreamsDataService does this — it's a good pattern that prevents subtle misuse of your contract.

### The paymentsDestination pattern

Both Dispatch and SubstreamsDataService implement this: providers use a hot **operator key** for signing attestations and sending transactions, but want GRT to land in cold storage.

```solidity
mapping(address => address) public paymentsDestination;

// Provider-callable setter (no owner restriction — it's their own funds)
function setPaymentsDestination(address destination) external {
    if (!registeredProviders[msg.sender]) revert ProviderNotRegistered(msg.sender);
    paymentsDestination[msg.sender] = destination == address(0) ? msg.sender : destination;
    emit PaymentsDestinationSet(msg.sender, paymentsDestination[msg.sender]);
}
```

Set the initial `paymentsDestination` in `register()` from the `data` parameter. It defaults to `serviceProvider` if not specified.

### On slashing

If you cannot produce cryptographic proof that a provider lied — proof that can be verified on-chain — implement `slash()` as a revert:

```solidity
function slash(address, bytes calldata) external pure override {
    revert("slashing not supported");
}
```

This is what Dispatch does. SubgraphService has slashing because allocation-based dispute proofs are possible. If your service's outputs aren't verifiable on-chain with high confidence, omit slashing entirely. A broken slashing mechanism is worse than none — you either never slash (useless) or slash incorrectly (catastrophic).

## TAP / GraphTally — the payment protocol

**GraphTally (TAP v2)** is a micropayment protocol for high-throughput query payments. Settling each request on-chain would cost more in gas than the query is worth. TAP batches payments off-chain and settles periodically.

### Three phases

**Phase 1 — Per-request (off-chain).** The gateway creates a signed TAP Receipt per query and sends it to the provider in the `TAP-Receipt` HTTP header. The provider validates and stores it. No on-chain interaction. No latency overhead.

**Phase 2 — Aggregation (~every 60 seconds).** The provider accumulates receipts and aggregates them into a RAV (Receipt Aggregate Voucher). The `valueAggregate` is the monotonically-increasing cumulative total — it never decreases.

**Phase 3 — Settlement (~every 60 minutes).** The provider calls `DataService.collect()` with the signed RAV. GRT moves from the consumer's escrow to the provider's wallet. The provider's stake is locked for the dispute window proportional to the fees.

### EIP-712 receipts

Every TAP Receipt is an EIP-712 signed struct. The domain must match the deployed `GraphTallyCollector` exactly — any mismatch causes signature recovery to return the wrong address rather than throwing an error.

**Domain (Arbitrum One mainnet):**
```
name:              "GraphTallyCollector"
version:           "1"
chainId:           42161
verifyingContract: 0x8f69F5C07477Ac46FBc491B1E6D91E2be0111A9e
```

Compute the domain separator **once at startup** and cache it. The type string is:

```
Receipt(address data_service,address service_provider,uint64 timestamp_ns,uint64 nonce,uint128 value,bytes metadata)
```

The `metadata` bytes field is where you embed service-specific data without changing the EIP-712 struct. Dispatch encodes `consumer_address (20 bytes) || method_name (UTF-8)` — so every receipt carries who paid and for what, enabling per-consumer credit tracking and per-method billing analytics.

### The monotonic invariant

The most important property of TAP: `valueAggregate` only ever increases. The on-chain `GraphTallyCollector` tracks `tokensCollected[dataService][collectionId][receiver][payer]`. When you call `collect()`, it transfers `valueAggregate - tokensCollected` (the delta). If you somehow submit an older RAV with a lower `valueAggregate`, the delta is zero or negative and the transaction reverts.

Practical implication: **build RAVs incrementally from the previous value**, and **never lose your latest signed RAV**. If your database goes down and you lose the latest RAV, you lose the ability to collect the fees in it. Back it up.

### The abi_encode_sequence gotcha

When calling `DataService.collect()`, the `data` parameter is ABI-encoded as two top-level Solidity parameters. In Rust/Alloy, you must use `abi_encode_sequence`, not `abi_encode`:

```rust
// CORRECT: matches Solidity's abi.encode(signedRav, tokensToCollect)
let encoded = (signed_rav_data, U256::ZERO).abi_encode_sequence();

// WRONG: wraps in an extra tuple layer — causes abi.decode to revert with empty data
// let encoded = (signed_rav_data, U256::ZERO).abi_encode();
```

This cost us an afternoon. `abi_encode()` in Alloy wraps the whole thing in a tuple. The Solidity `abi.decode(data, (SignedRAV, uint256))` sees a different layout and reverts. The error message is just "empty data" which gives you nothing to go on. Use `abi_encode_sequence` for all multi-param `collect()` data blobs.

## The off-chain service

### Receipt validation

Every incoming request must include a valid TAP receipt. Validate in this order — reject immediately if any check fails:

1. **Deserialize** the JSON from the `TAP-Receipt` header
2. **Check `data_service`** matches your contract address
3. **Check `service_provider`** matches this provider's address
4. **Check staleness** — reject receipts older than 30 seconds (prevents replay across restarts)
5. **Recover signer** from EIP-712 signature
6. **Check authorization** — signer must be in the `authorized_senders` list (the gateway's signing key)
7. **Extract metadata** — consumer address (first 20 bytes), method name (bytes 20+)

Return **HTTP 402 Payment Required** for any failure. Do not serve the data — you'd be working for free.

### Database schema

Two tables in PostgreSQL:

```sql
-- One row per validated receipt
CREATE TABLE tap_receipts (
    id               BIGSERIAL PRIMARY KEY,
    collection_id    TEXT NOT NULL,
    payer_address    TEXT NOT NULL,
    service_provider TEXT NOT NULL,
    data_service     TEXT NOT NULL,
    timestamp_ns     BIGINT NOT NULL,
    nonce            BIGINT NOT NULL,
    value            NUMERIC NOT NULL,  -- GRT wei
    signature        TEXT NOT NULL,
    aggregated       BOOLEAN NOT NULL DEFAULT FALSE
);

-- One row per (payer, provider) pair — replaced on each aggregation cycle
CREATE TABLE tap_ravs (
    collection_id    TEXT PRIMARY KEY,
    payer_address    TEXT NOT NULL,
    value_aggregate  NUMERIC NOT NULL,  -- cumulative, never decreasing
    signature        TEXT NOT NULL,
    redeemed         BOOLEAN NOT NULL DEFAULT FALSE
);
```

The database is your safety net. If the service restarts, receipts are not lost. If a RAV collection fails, the RAV is still there for the next cycle.

### Consumer credit limits

Between RAV collections (up to an hour apart), consumers can accumulate unbounded debt. Track in-flight receipt value per consumer in memory:

```rust
pub struct CreditTracker {
    credits: Arc<RwLock<HashMap<Address, u128>>>,
    threshold: u128,  // e.g. 0.1 GRT = 100_000_000_000_000_000 wei
}

impl CreditTracker {
    pub fn check_and_debit(&self, consumer: Address, value: u128) -> bool {
        let mut credits = self.credits.write().unwrap();
        let current = credits.entry(consumer).or_insert(0);
        if *current + value > self.threshold {
            return false;  // reject — consumer owes too much
        }
        *current += value;
        true
    }
}
```

For additional safety, query `PaymentsEscrow.getBalance(consumer, tallyCollector, provider)` on-chain before serving consumers with no recent receipts.

## Provider discovery

Gateways need to discover which providers are active and what they serve. Build a subgraph that indexes your contract's events into a queryable GraphQL API. The key entities:

```graphql
type Indexer @entity {
  id: ID!
  address: Bytes!
  endpoint: String!
  geoHash: String!
  registered: Boolean!
  chains: [ChainRegistration!]! @derivedFrom(field: "indexer")
}

type ChainRegistration @entity {
  id: ID!  # "{provider}-{chainId}-{tier}"
  indexer: Indexer!
  chainId: BigInt!
  tier: Int!
  endpoint: String!
  active: Boolean!
}
```

Map every lifecycle event: `ProviderRegistered`, `ProviderDeregistered`, `ServiceStarted`, `ServiceStopped`, `PaymentsDestinationSet`, and your governance events. A gateway can then poll a single GraphQL query to get all active providers for a chain:

```graphql
{
  chainRegistrations(where: { chainId: 1, tier: 0, active: true }) {
    endpoint
    indexer { address geoHash paymentsDestination }
  }
}
```

## Two architectural patterns

We've built the **HTTP receipt model** (Dispatch) and studied the **sidecar/session model** (SubstreamsDataService). They suit different workloads.

**HTTP receipt model** — one receipt per request, sent in an HTTP header. Near-zero latency overhead. Consumer complexity is zero if a gateway handles everything. Suited to request/response APIs (JSON-RPC, GraphQL).

**Sidecar/session model** — consumer runs a local sidecar process that manages a persistent bidirectional gRPC payment session with the provider. Usage is measured in blocks or bytes processed, not per-call. Provider plugins integrate directly with Firehose/Substreams for auth, session management, and metering. Suited to long-lived streaming connections where per-call receipts would generate unnecessary overhead.

For a new data service, start with the HTTP receipt model unless your service is fundamentally streaming.

## Testing — the key insight

Test each lifecycle function in unit tests using a full mock of `HorizonStaking`. But for integration tests, **use the real `GraphPayments`, `PaymentsEscrow`, and `GraphTallyCollector`** — only mock the staking contract.

Why? The EIP-712 signing chain runs across three contracts. Off-by-one errors in field ordering, wrong field types in the type string, wrong domain separator parameters — none of these are caught by unit tests or full-mock integration tests. They're only caught when your Rust or Go signature hits the real Solidity verifier and fails. We've seen this happen. Use real payment contracts from your first integration test.

```solidity
// Good integration test setup:
MockHorizonStaking staking = new MockHorizonStaking();  // mock
GraphTallyCollector tallyCollector = new GraphTallyCollector(...);  // real
PaymentsEscrow escrow = new PaymentsEscrow(...);  // real
GraphPayments payments = new GraphPayments(...);   // real
```

The mock staking just needs `getProvision()`, `isAuthorized()`, and `getTokensAvailable()`. Everything else can be real.

For the full E2E test, write a Foundry script that deploys the entire Horizon stack to a local Anvil node, provisions the provider, funds the escrow, and authorises the gateway signer. Then spin up the actual service binary against this local stack and run real HTTP requests through the full payment loop. The test should: send N requests → wait for aggregation → wait for on-chain collection → verify GRT transferred.

Also write a **cross-language EIP-712 golden-value test**. If you implement EIP-712 hashing in both Solidity and Rust (or Go), compute the hash for a fixed set of inputs in both and assert they're equal. This is the single test most likely to catch a catastrophic encoding bug before it ships.

## Deployment steps

1. Deploy your contract to Arbitrum Sepolia first, using testnet Horizon addresses
2. Verify on Arbiscan (`forge verify-contract ...`)
3. Call `addChain()` for each supported configuration
4. Transfer ownership to a multisig
5. Have a provider call `HorizonStaking.provision()` then `register()` then `startService()`
6. Deploy your subgraph pointing to the contract's deployment block
7. Test the full payment loop on testnet
8. Repeat on Arbitrum One mainnet

**Key Horizon addresses — Arbitrum One:**

| Contract | Address |
|---|---|
| HorizonStaking | `0x00669A4CF01450B64E8A2A20E9b1FCB71E61eF03` |
| GraphTallyCollector | `0x8f69F5C07477Ac46FBc491B1E6D91E2be0111A9e` |
| PaymentsEscrow | `0xf6Fcc27aAf1fcD8B254498c9794451d82afC673E` |
| GRT Token | `0x9623063377AD1B27544C965cCd7342f7EA7e88C7` |

**Arbitrum Sepolia testnet:**

| Contract | Address |
|---|---|
| HorizonStaking | `0xFf2Ee30de92F276018642A59Fb7Be95b3F9088Af` |
| GraphTallyCollector | `0xacC71844EF6beEF70106ABe6E51013189A1f3738` |
| PaymentsEscrow | `0x09B985a2042848A08bA59060EaF0f07c6F5D4d54` |

## Production checklist

A few things that bite people:

- **Operator key ≠ staking key.** The operator key signs receipts and sends `collect()` transactions. It needs ETH for gas. The staking key manages the GRT provision. Keep them separate.
- **Back up your RAVs.** Losing a signed RAV before on-chain collection = losing those fees. PostgreSQL with automated backups is not optional.
- **Set `authorized_senders`.** An empty allowlist means accepting receipts from any signer. In production, this must be the specific gateway operator keys you trust.
- **Set `min_collect_value`.** Don't collect tiny RAVs — the gas cost exceeds the fees. Set a floor in your collector config.
- **Monitor operator ETH.** The collector loop sends transactions. If the operator wallet runs out of ETH, collection silently stops.
- **Set `startBlock` in your subgraph** to your contract's deployment block, not zero. Starting from block 0 means syncing the entire chain history for no reason.

## What we built

Dispatch's `RPCDataService.sol` is about 320 lines of Solidity. The off-chain `dispatch-service` (Rust, using Alloy) is roughly 1,500 lines covering: receipt validation, PostgreSQL persistence, a 60-second aggregation loop, an hourly on-chain collector, consumer credit tracking, and an Axum HTTP server proxying requests to backend Ethereum nodes.

The full stack — contract, off-chain service, gateway, consumer SDK, subgraph, indexer agent — took about three months from blank slate to testnet. The contracts were the easy part. The tricky bits were: getting EIP-712 encoding identical between Rust and Solidity, the `abi_encode_sequence` vs `abi_encode` distinction for `collect()` data, and getting the E2E test infrastructure stable enough to trust.

The Horizon framework genuinely delivers on the promise of "70% for free." You provision, register, collect. Everything in between — escrow management, payment routing, delegation, protocol tax — you don't touch.

## Further reading

- [The Graph Horizon documentation](https://thegraph.com/docs/horizon)
- [SubgraphService reference implementation](https://github.com/graphprotocol/contracts/tree/main/packages/subgraph-service)
- [SubstreamsDataService](https://github.com/graphprotocol/substreams-data-service) — the second data service on the network, reference for the sidecar pattern and `paymentsDestination`
- [GIP-0066: Horizon](https://forum.thegraph.com/t/gip-0066-the-graph-horizon/5924)
- [Full developer reference guide](https://github.com/lodestar-dispatch/drpc-service/blob/main/HORIZON_DATA_SERVICE_GUIDE.md) — the complete version of everything above, with full code examples for every function
