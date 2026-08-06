---
title: "How to Build and Deploy a Data Service on The Graph's Horizon Framework"
date: "2026-04-23"
author: "cargopete"
tags: ["horizon", "data-services", "solidity", "rust", "tap", "payments", "indexers"]
category: "Guides"
excerpt: "A complete technical walkthrough of building a production Horizon data service — from Solidity contract to off-chain payment collection — drawn from two real implementations: Dispatch and SubstreamsDataService."
---

The Graph's Horizon upgrade (GIP-0066, live December 2025) turned the protocol into a permissionless data marketplace. Before Horizon, The Graph had one type of data service: subgraphs. After Horizon, anyone can build a new type of data service — JSON-RPC endpoints, streaming data pipelines, oracle feeds, ZK proofs — and plug directly into the existing economic infrastructure. Same staking layer. Same payment layer. Brand new service.

We've spent the last several weeks building **Dispatch**, a JSON-RPC data service on Horizon, live on Arbitrum One. Along the way we also studied **SubstreamsDataService**, the second data service being built on the network — the core payment loop is working end-to-end in development, though the collection CLI and production operator tooling are still in progress. Between the two implementations we now have a fairly complete picture of what it actually takes to ship a Horizon data service end-to-end. This post is that picture.

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

One thing this diagram doesn't show: when fees flow through `GraphPayments`, a slice goes to **your contract** as the data service creator — the `dataServiceCut`. Every query served by every provider on your network earns you a percentage. More on this in the [dataServiceCut section](#the-dataservicecut--creator-revenue) below.

The off-chain architecture mirrors this:

```
Consumer / Gateway
    │  (1) signed TAP receipt per request (TAP-Receipt HTTP header)
    ▼
Provider's Off-Chain Service
    │  validates receipt, persists to DB
    │
    │  (2) every ~60s: send receipts to Gateway RAV Aggregation Service
    │      → receive gateway-signed RAV back, store in DB
    │  (3) every ~60m: submit signed RAV → DataService.collect()
    ▼
Arbitrum One — GRT settles on-chain
```

## The on-chain contract

Your Solidity contract must implement `IDataService`. The interface is simple — seven functions — but getting the implementation right takes some care.

### Inheriting the base contracts

First, install the Horizon contracts package into your Forge project:

```bash
forge install graphprotocol/contracts
```

Add the remappings to `remappings.txt`. The Horizon package splits interfaces into a separate `packages/interfaces` tree, so you need granular entries — a single wildcard won't cover everything:

```
@graphprotocol/horizon/data-service/=lib/contracts/packages/horizon/contracts/data-service/
@graphprotocol/horizon/payments/=lib/contracts/packages/horizon/contracts/payments/
@graphprotocol/horizon/libraries/=lib/contracts/packages/horizon/contracts/libraries/
@graphprotocol/horizon/utilities/=lib/contracts/packages/horizon/contracts/utilities/
@graphprotocol/horizon/mocks/=lib/contracts/packages/horizon/contracts/mocks/
@graphprotocol/horizon/interfaces/=lib/contracts/packages/interfaces/contracts/horizon/
@graphprotocol/interfaces/=lib/contracts/packages/interfaces/
@graphprotocol/contracts/=lib/contracts/packages/contracts/
@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/
@openzeppelin/contracts-upgradeable/=lib/openzeppelin-contracts-upgradeable/contracts/
forge-std/=lib/forge-std/src/
```

Also add `via_ir = true` to `foundry.toml` — deploy scripts that instantiate several contracts in one function will hit "stack too deep" without it:

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc = "0.8.27"
via_ir = true
optimizer = true
optimizer_runs = 200
```

The package ships base contracts that handle the boilerplate:

```solidity
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {DataService} from "@graphprotocol/horizon/data-service/DataService.sol";
import {DataServiceFees} from "@graphprotocol/horizon/data-service/extensions/DataServiceFees.sol";
import {DataServicePausableUpgradeable} from "@graphprotocol/horizon/data-service/extensions/DataServicePausableUpgradeable.sol";
// Payment interfaces live in the interfaces package, not horizon/payments/
import {IGraphTallyCollector} from "@graphprotocol/horizon/interfaces/IGraphTallyCollector.sol";
import {IGraphPayments} from "@graphprotocol/horizon/interfaces/IGraphPayments.sol";

contract MyDataService is OwnableUpgradeable, UUPSUpgradeable, DataService, DataServiceFees, DataServicePausableUpgradeable, IMyDataService {
    // ...
}
```

**`DataService`** gives you `GraphDirectory` (resolves all Horizon contract addresses from the controller — so you're upgrade-proof), `_checkProvisionTokens()`, `_checkProvisionParameters()`, and the `onlyAuthorizedForProvision` modifier. **`DataServiceFees`** gives you `_lockStake()` / `_releaseStake()`. **`DataServicePausableUpgradeable`** gives you an emergency stop. The UUPS pattern means you can upgrade the logic contract without requiring providers to re-stake — essential when you expect to iterate on your service.

The constructor sets immutables and locks the implementation; `initialize()` handles all mutable setup:

```solidity
uint256 public constant MIN_PROVISION = 555e18;        // 555 GRT
uint64  public constant MIN_THAWING_PERIOD = 14 days;
uint256 public constant STAKE_TO_FEES_RATIO = 5;       // matches SubgraphService

// UUPS upgradeable: immutables live in implementation bytecode, accessible via delegatecall.
constructor(address controller, address graphTallyCollector) DataService(controller) {
    GRAPH_TALLY_COLLECTOR = IGraphTallyCollector(graphTallyCollector);
    _disableInitializers();
}

function initialize(address owner_, address pauseGuardian) external initializer {
    __Ownable_init(owner_);
    __DataService_init();
    __DataServicePausable_init();
    minThawingPeriod = MIN_THAWING_PERIOD;
    _setProvisionTokensRange(MIN_PROVISION, type(uint256).max);
    _setThawingPeriodRange(MIN_THAWING_PERIOD, type(uint64).max);
    _setVerifierCutRange(0, uint32(1_000_000));  // 0–100% in PPM
    _setPauseGuardian(pauseGuardian, true);
}
```

Pass `controller` instead of individual contract addresses. The controller is the registry — if Horizon contracts are upgraded, your service picks up the new addresses automatically. Deploy via an ERC1967 proxy: `new ERC1967Proxy(address(impl), abi.encodeCall(MyDataService.initialize, (owner, pauseGuardian)))`.

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

`startService()` / `stopService()` activate and deactivate specific service instances. For Dispatch, an instance is a `(chainId, tier)` pair — serving Ethereum mainnet at Standard tier, for example. For SubstreamsDataService, both functions are no-ops — activation is implicit on registration, deactivation is implicit on deregistration. Use explicit `startService` when providers can serve multiple distinct configurations that gateways need to discover individually.

One implementation detail worth noting: **reuse existing stopped entries rather than pushing new ones** when a provider restarts a service. Otherwise the internal array grows without bound across many start/stop cycles and `activeRegistrationCount()` becomes increasingly expensive to call.

`deregister()` is the mirror of `register()`. All active service instances must be stopped first, then the provider is removed:

```solidity
function deregister(address serviceProvider, bytes calldata)
    external onlyAuthorizedForProvision(serviceProvider)
{
    if (!registeredProviders[serviceProvider]) revert ProviderNotRegistered(serviceProvider);
    if (activeRegistrationCount(serviceProvider) > 0) revert ActiveRegistrationsExist(serviceProvider);

    registeredProviders[serviceProvider] = false;
    emit ProviderDeregistered(serviceProvider);
}
```

`acceptProvisionPendingParameters()` is a required function that completes the two-step process when a provider wants to change their thawing period or verifier cut. The provider first calls `HorizonStaking.setProvisionParameters`, which queues the change, then your contract must accept it:

```solidity
function acceptProvisionPendingParameters(address serviceProvider, bytes calldata)
    external onlyAuthorizedForProvision(serviceProvider)
{
    _acceptProvisionParameters(serviceProvider);
}
```

Without this, providers cannot update their provision parameters after the initial setup. `acceptProvisionPendingParameters` IS required by `IDataService` — omitting it causes a compile error. `deregister` is **not** in `IDataService` (it's a custom addition); implement it without the `override` keyword or the compiler will reject it.

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

    // Dispatch encodes (SignedRAV, tokensToCollect) — tokensToCollect=0 means collect the full delta.
    // SubstreamsDataService encodes (SignedRAV, dataServiceCut) instead — it lets the caller
    // pass the cut dynamically rather than hardcoding it in the contract. Either approach works;
    // what matters is that your off-chain service and your contract agree on the encoding.
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
            BURN_CUT_PPM + DATA_SERVICE_CUT_PPM,   // 2% total: 1% burned + 1% retained
            paymentsDestination[serviceProvider]    // where GRT lands
        ),
        tokensToCollect
    );

    if (fees > 0) {
        // Lock stake proportional to fees for the dispute window.
        _lockStake(serviceProvider, fees * STAKE_TO_FEES_RATIO, block.timestamp + minThawingPeriod);
    }
}
```

The payment distribution chain from `collect()` inward: **GraphTallyCollector** verifies the EIP-712 RAV signature and authorisation; **PaymentsEscrow** transfers `delta = valueAggregate - previouslyCollected` from the payer's deposit; **GraphPayments** routes the GRT in this exact order:

```
Total fees collected
  └─ Protocol tax            → DAO treasury       (fixed %)
  └─ Data service cut        → your contract      (you set this)
  └─ Delegator cut           → delegators         (set by provider)
  └─ Remainder               → paymentsDestination
```

Explicitly reject payment types other than `QueryFee`. SubstreamsDataService does this — it's a good pattern that prevents subtle misuse of your contract.

### The dataServiceCut — creator revenue

This is the most underappreciated part of Horizon. The `dataServiceCut` in the `collect()` call is expressed in PPM (parts per million, where `1_000_000` = 100%). Set it to anything other than zero and every provider on your service pays you a cut of their fees — automatically, on-chain, in perpetuity. Dispatch uses 20,000 PPM (2% total): half burned to reduce GRT supply, half retained as contract revenue.

```solidity
// Example: take a 2% creator cut on all fees
uint256 public constant DATA_SERVICE_CUT_PPM = 20_000; // 2% in PPM

fees = GRAPH_TALLY_COLLECTOR.collect(
    paymentType,
    abi.encode(
        signedRav,
        DATA_SERVICE_CUT_PPM,   // 2% of fees → your contract
        paymentsDestination[serviceProvider]
    ),
    tokensToCollect
);
```

The GRT arrives at your **contract address** — not a wallet. You need a withdrawal function to claim it:

```solidity
// In your data service contract
function withdrawCreatorFees(address to) external onlyOwner {
    uint256 balance = IERC20(GRT).balanceOf(address(this));
    require(balance > 0, "nothing to withdraw");
    IERC20(GRT).transfer(to, balance);
    emit CreatorFeesWithdrawn(to, balance);
}
```

The economic implication is significant: building a data service is not just a contribution to the protocol — it is a revenue-generating business in itself. Every provider who uses your service, every query they serve, every RAV they collect: you take a cut. You build it once. Providers run it. Gateways route to it. You earn.

This creates a direct alignment between the data service creator and the growth of the network around their service. A creator who sets a 1% cut and then actively grows their provider set from 5 to 50 operators has increased their passive income tenfold without touching the contract. The incentive to market your service, write good documentation, support integrations, and make your service easy to run is baked into the economics.

**Setting the right cut.** There is no canonical answer, but some practical considerations:

- Too high and you disincentivise providers from running your service — they'll look for alternatives
- Too low and you leave revenue on the table that could fund ongoing development
- SubgraphService uses a governance-controlled parameter; for a new service, starting at 1–3% and adjusting via an upgradeable parameter is reasonable
- The cut compounds: a 2% cut on a service doing 10,000 GRT/day in fees is 200 GRT/day to the creator

You can also make `dataServiceCut` a governance parameter rather than a constant:

```solidity
uint256 public dataServiceCutPPM;  // owner-adjustable

function setDataServiceCut(uint256 cutPPM) external onlyOwner {
    require(cutPPM <= 100_000, "max 10%");  // sensible cap
    dataServiceCutPPM = cutPPM;
    emit DataServiceCutUpdated(cutPPM);
}
```

This lets you adjust the cut as the service matures without redeploying the contract.

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

Dispatch does this. SubstreamsDataService takes the alternative approach of a silent no-op — the function compiles, succeeds, and does nothing. Both patterns work for "no slashing supported." The revert is preferable: it fails loudly if something accidentally calls `slash()`, rather than silently succeeding and giving the caller false confidence.

SubgraphService has real slashing because allocation-based dispute proofs are possible. If your service's outputs aren't verifiable on-chain with high confidence, omit slashing entirely. A broken slashing mechanism is worse than none — you either never slash (useless) or slash incorrectly (catastrophic).

## TAP / GraphTally — the payment protocol

**GraphTally (TAP v2)** is a micropayment protocol for high-throughput query payments. Settling each request on-chain would cost more in gas than the query is worth. TAP batches payments off-chain and settles periodically.

### Three phases

**Phase 1 — Per-request (off-chain).** The gateway creates a signed TAP Receipt per query and sends it to the provider in the `TAP-Receipt` HTTP header. The provider validates and stores it. No on-chain interaction. No latency overhead.

**Phase 2 — Aggregation (~every 60 seconds).** The provider accumulates receipts and sends them to the **gateway's RAV aggregation service** — a gateway-operated endpoint that verifies the receipts, computes the new `valueAggregate`, and returns a freshly signed RAV. The RAV is signed by the **gateway (the payer)**, not the provider. The provider cannot sign its own RAV; the on-chain `GraphTallyCollector` verifies the signature against the payer's authorised key.

```
Provider Off-Chain Service            Gateway Aggregation Service
         │                                        │
         │  POST /aggregate                       │
         │  { receipts: [...] }  ──────────────▶  │
         │                                        │  verify receipt sigs
         │                                        │  compute new valueAggregate
         │                                        │  sign RAV with gateway key
         │  { signed_rav: ... }  ◀──────────────  │
         │                                        │
         │  store signed_rav in DB                │
         │  (submit in next collect() call)       │
```

The `valueAggregate` is the monotonically-increasing cumulative total — it never decreases. The gateway aggregation service is the authoritative keeper of this value.

**Phase 3 — Settlement (~every 60 minutes).** The provider calls `DataService.collect()` with the signed RAV. GRT moves from the consumer's escrow to the provider's wallet. The provider's stake is locked for the dispute window proportional to the fees.

### tap-agent — consider it before rolling your own

Before writing your own receipt storage, aggregation request loop, and collection scheduler: check **[tap-agent](https://github.com/graphprotocol/indexer-rs/tree/main/crates/tap-agent)**, part of The Graph's open-source indexer stack.

`tap-agent` is a standalone Rust service that handles:
- Receipt ingestion and PostgreSQL storage
- The ~60-second aggregation loop (requests signed RAVs from the gateway aggregation service)
- The ~60-minute on-chain collection loop (`DataService.collect()`)
- Retry logic, RAV backup, and operator monitoring

It is already used in production by indexers running SubgraphService. Note that `tap-agent` is a Rust binary — Go-based services cannot embed it and must implement the aggregation and collection loops independently.

**Dispatch ships its own built-in aggregation and collection loop** rather than using `tap-agent` — the custom loop is tightly integrated with the service's per-consumer credit tracking and the JSON-RPC proxy, making the separation impractical. If your service is similarly tightly coupled, you may find the same. If your service is cleanly separable from its payment handling, `tap-agent` can save several weeks of work.

Either way: read its source before you start. The tricky invariants around monotonic RAVs, `min_collect_value`, and operator ETH monitoring are all handled there, and understanding them is worthwhile regardless of whether you use the library.

### EIP-712 receipts

Every TAP Receipt is an EIP-712 signed struct. The domain must match the deployed `GraphTallyCollector` exactly — any mismatch causes signature recovery to return the wrong address rather than throwing an error.

**Domain (Arbitrum One mainnet):**
```
name:              "GraphTallyCollector"
version:           "1"
chainId:           42161
verifyingContract: 0x8f69F5C07477Ac46FBc491B1E6D91E2bb0111A9e
```

Compute the domain separator **once at startup** and cache it. There are two EIP-712 type strings you need — one for per-request Receipts, one for the RAVs the gateway signs.

**Important caveat on Receipt types:** The RAV type string is fixed by the on-chain `GraphTallyCollector` — every data service must use it verbatim. The Receipt type string is **not fixed by the protocol**. It is a convention between your gateway and your provider, validated entirely off-chain. You can define it however suits your service. Our two reference implementations make different choices:

**Receipt — Dispatch (HTTP receipt model):**
```
Receipt(address data_service,address service_provider,uint64 timestamp_ns,uint64 nonce,uint128 value,bytes metadata)
```
The `metadata` bytes field carries service-specific data — Dispatch encodes `consumer_address (20 bytes) || method_name (UTF-8)`, enabling per-consumer credit tracking and per-method billing analytics without changing the type string.

**Receipt — SubstreamsDataService (sidecar/session model):**
```
Receipt(bytes32 collection_id,address payer,address data_service,address service_provider,uint64 timestamp_ns,uint64 nonce,uint128 value)
```
The payer and collection context are explicit top-level fields rather than packed into metadata. There is no `metadata` field. This is a cleaner design for services where those fields are always known at receipt creation time.

Pick one approach and be consistent across your gateway and provider. The only hard constraint is that whatever you define here, the on-chain contract never sees it — so mismatches manifest as receipt validation failures on the provider side, not on-chain reverts.

**ReceiptAggregateVoucher** (signed by the gateway during aggregation, submitted on-chain by the provider — this one IS fixed by the protocol):
```
ReceiptAggregateVoucher(bytes32 collectionId,address payer,address serviceProvider,address dataService,uint64 timestampNs,uint128 valueAggregate,bytes metadata)
```

Note the field name convention in the RAV: `camelCase` throughout. A single off-by-one in field order or type causes silent signer mismatch — the recovered address will be wrong rather than the verification throwing.

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

## The gateway aggregation service

This is the component the post has been dancing around: the service that receives receipts from providers, signs the RAV, and returns it. It runs on the **gateway's** infrastructure, not the provider's. Understanding it is critical because your data service can't collect fees unless a gateway aggregation service is running and configured to support your contract.

### What it does

The aggregation service exposes a single endpoint that tap-agent calls every ~60 seconds:

```
POST /aggregate
Content-Type: application/json

{
  "sender":   "0xGATEWAY_ADDRESS",
  "receipts": [
    {
      "receipt": {
        "data_service":     "0xYOUR_CONTRACT",
        "service_provider": "0xPROVIDER",
        "timestamp_ns":     1745000000000000000,
        "nonce":            42,
        "value":            "1000000000000000",
        "metadata":         "0x..."
      },
      "signature": { "v": 28, "r": "0x...", "s": "0x..." }
    }
  ]
}
```

It returns:

```json
{
  "signed_rav": {
    "rav": {
      "collection_id":   "0x...",
      "data_service":    "0xYOUR_CONTRACT",
      "service_provider":"0xPROVIDER",
      "timestamp_ns":    1745000000999999999,
      "value_aggregate": "5000000000000000"
    },
    "signature": { "v": 27, "r": "0x...", "s": "0x..." }
  }
}
```

The gateway's private key signs this RAV. The provider stores it and submits it in `collect()`.

### Your options for a new data service

**Option A — Run your own gateway (development and early production)**

For development and testnet, run a minimal self-hosted aggregation service. The open-source reference is **[timeline-aggregation-protocol](https://github.com/graphprotocol/timeline-aggregation-protocol)** which includes a reference aggregator implementation. Alternatively, `tap-agent` includes a `--gateway` mode for self-aggregation in single-operator setups.

Configure tap-agent to point at it:

```toml
# tap-agent.toml
[[tap.sender_aggregator_endpoints]]
sender = "0xYOUR_GATEWAY_ADDRESS"
url    = "http://localhost:3001/aggregate"
```

This is the right path for local development and testnet. You control both sides of the payment loop.

**Option B — Integrate with Edge & Node or Semiotic**

Edge & Node and Semiotic both operate gateways on The Graph mainnet. To have their gateways support your data service, you need to:

1. Register your data service contract on the network (deployed + providers active)
2. Reach out via The Graph's Discord (#data-services channel) or the forum
3. Provide your contract address, EIP-712 domain separator, and TAP receipt metadata format
4. Gateway operators add your contract to their aggregator's allowlist and update their signing config

This is a coordination step, not a technical one. Build on testnet first, demonstrate a working service, then approach gateway operators.

**Option C — Gateway-as-a-service (future)**

There is active work in The Graph ecosystem toward a standardised gateway-as-a-service offering. Watch GIP discussions for updates. For now, assume you need to either self-host (Option A) or negotiate with an existing gateway operator (Option B).

### Minimal self-hosted aggregator in Rust

If you need to stand up your own aggregator quickly:

```rust
use axum::{routing::post, Json, Router};
use alloy::signers::local::PrivateKeySigner;
use alloy::signers::Signer;  // provides sign_typed_data

#[tokio::main]
async fn main() {
    let wallet: PrivateKeySigner = std::env::var("GATEWAY_PRIVATE_KEY")
        .unwrap().parse().unwrap();

    let app = Router::new().route("/aggregate", post(|Json(req): Json<AggregateRequest>| async move {
        // 1. Verify all receipt signatures (reuse your provider-side EIP-712 code)
        let total: u128 = req.receipts.iter()
            .filter(|r| verify_receipt_sig(r).is_ok())
            .map(|r| r.receipt.value.parse::<u128>().unwrap_or(0))
            .sum();

        // 2. Build RAV (valueAggregate is cumulative — load previous from DB and add total)
        //
        // collectionId is the stable key for this (payer, serviceProvider, dataService) stream.
        // Formula: keccak256(abi.encode(payer, serviceProvider, dataService))
        // This is identical every aggregation cycle for the same triplet, linking off-chain
        // receipts to the on-chain tokensCollected[dataService][collectionId][receiver][payer] slot.
        let payer    = req.sender.parse::<Address>().unwrap();
        let provider = req.receipts[0].receipt.service_provider.parse::<Address>().unwrap();
        let ds       = req.receipts[0].receipt.data_service.parse::<Address>().unwrap();
        let collection_id = keccak256((payer, provider, ds).abi_encode());

        let prev = load_previous_aggregate(collection_id).await;
        let rav = Rav {
            collection_id,
            data_service:     req.receipts[0].receipt.data_service.clone(),
            service_provider: req.receipts[0].receipt.service_provider.clone(),
            timestamp_ns:     latest_timestamp(&req.receipts),
            value_aggregate:  prev + total,
        };

        // 3. Sign with gateway key — Rav must implement SolStruct (define it via alloy::sol!)
        let sig = wallet.sign_typed_data(&rav).await.unwrap();

        Json(AggregateResponse { signed_rav: SignedRav { rav, signature: sig.into() } })
    }));

    // axum 0.7+: use TcpListener + axum::serve, not the removed axum::Server
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3001").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
```

The critical detail: **`value_aggregate` must be loaded from a persistent store and incremented**, never recomputed from scratch. If you lose your aggregator's state, you lose the ability to produce valid RAVs (the on-chain contract would see a lower `valueAggregate` and the delta would be zero or cause a revert).

One thing to note on `collectionId`: the computation above (`keccak256(abi.encode(payer, provider, dataService))`) is what you use when the receipt does **not** carry the collection ID — i.e., the HTTP receipt model where only signer and chain are known at receipt time. In the sidecar/session model (SubstreamsDataService), `collection_id` is an explicit field in every receipt, so the aggregator simply reads it directly from the receipt struct rather than deriving it. Make sure your receipt type and aggregator agree on which approach you're using.

## The gateway / consumer side

Building a data service means understanding what consumers must do to pay you. Here is the complete consumer setup sequence — useful both for writing your own gateway integration and for explaining the setup to third-party gateways.

### 1. Fund escrow

Before sending any requests, the consumer deposits GRT into `PaymentsEscrow`:

```solidity
// Consumer (payer) calls — not the provider
IGRT(grtToken).approve(address(escrow), depositAmount);
IPaymentsEscrow(escrow).deposit(
    address(graphTallyCollector),  // the verifier
    providerAddress,               // the receiver
    depositAmount                  // in GRT wei
);
```

The `deposit()` call is per-`(collector, provider)` pair. A consumer paying multiple providers must call it once per provider. There is no minimum enforced by the contract; the practical minimum is whatever you expect to spend between top-up cycles — typically one to four hours of request volume.

### 2. Configure authorized_senders on the provider side

On your off-chain service, `authorized_senders` is the set of Ethereum addresses whose TAP-Receipt signatures are accepted — in practice, the gateway operator's signing keys. Configure this before going live:

```toml
# tap.toml (or equivalent service config)
[tap]
authorized_senders = [
  "0xGATEWAY_SIGNING_KEY_1",
  "0xGATEWAY_SIGNING_KEY_2",
]
```

An empty list is fine in development (accepts any signer). In production it must be locked to the specific gateway keys you trust. A compromised gateway key that remains in `authorized_senders` can generate receipts you will collect — and the contracts will honour them, draining the consumer's escrow.

### 3. Send receipts per request

For every query, the gateway creates and signs a TAP receipt and attaches it as an HTTP header:

```
TAP-Receipt: {"receipt":{"data_service":"0xYOUR_CONTRACT","service_provider":"0xPROVIDER","timestamp_ns":1745000000000000000,"nonce":42,"value":"1000000000000000","metadata":"0x..."},"signature":{"v":28,"r":"0x...","s":"0x..."}}
```

The `value` field is the fee for this single request, in GRT wei. It is not cumulative — the gateway's aggregation service builds the monotonically-increasing `valueAggregate` across all receipts.

### 4. Top up before escrow runs dry

The consumer is responsible for monitoring their escrow balance and topping up before it hits zero. There is no on-chain event for "balance low" — consumers must poll `PaymentsEscrow.getBalance(consumer, tallyCollector, provider)` and top up proactively.

On the provider side, query this balance for new or unknown consumers before serving them. You can implement a circuit breaker that rejects requests from consumers whose escrow is below a safe threshold (e.g., one hour of expected spend).

## The off-chain service

### Receipt validation

Every incoming request must include a valid TAP receipt. Validate in this order — reject immediately if any check fails:

1. **Deserialize** the JSON from the `TAP-Receipt` header
2. **Check `data_service`** matches your contract address
3. **Check `service_provider`** matches this provider's address
4. **Check staleness**: reject receipts older than 30 seconds (prevents replay across restarts)
5. **Check nonce uniqueness**: reject if this (signer, nonce) pair has been seen before. Nonces are single-use; the 30-second staleness window bounds the deduplication set. Track in a bounded in-memory LRU or a DB table keyed on `(signer_address, nonce)`.
6. **Recover signer** from EIP-712 signature
7. **Check authorization**: signer must be in the `authorized_senders` list (the gateway's signing key)
8. **Extract metadata**: consumer address (first 20 bytes), method name (bytes 20+) — Dispatch-specific; adapt to your receipt format

Return **HTTP 402 Payment Required** for any failure. Do not serve the data — you'd be working for free.

### Database schema

A note on `collection_id` before reading the schema: it identifies a **payment stream** — a unique `(payer, provider, dataService)` triplet for a given service instance. Every receipt and every RAV belongs to exactly one collection. The on-chain `GraphTallyCollector` tracks `tokensCollected[dataService][collectionId][receiver][payer]`; the `collectionId` links your off-chain receipt records to their on-chain settlement slot. In practice, `collection_id` is `keccak256(abi.encode(payer_address, provider_address, data_service_address))` — a stable 32-byte key that is identical across every aggregation cycle for the same payer/provider pair.

Two tables in PostgreSQL. The schema below is a canonical starting point — the key invariants are that receipts are append-only and RAVs are upserted (replaced with the latest value on each aggregation cycle):

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

Note: Dispatch's actual migration uses `signer_address` and `chain_id` as the primary receipt keys (deriving `collection_id` at aggregation time rather than storing it per-receipt), and tracks `method` per receipt for billing analytics. Both layouts satisfy the invariants — `collection_id`-per-receipt is a cleaner normalised design; `signer_address + chain_id` is a valid alternative if your service keys payment streams on gateway signer rather than collection identity. Pick whichever suits your service's query patterns.

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

### Error recovery in the collection loop

`collect()` can revert. When it does, your collection loop must handle it gracefully — a panic or unhandled error here means fees don't move.

**Common revert reasons and their fixes:**

| Revert | Cause | Fix |
|---|---|---|
| Zero delta / `EscrowNotFound` | Consumer's escrow is empty or RAV `valueAggregate` ≤ `tokensCollected` | Skip collection; log warning; check escrow balance |
| `InvalidSignature` | RAV signature doesn't match the gateway key | Don't retry; this RAV is corrupt. Alert immediately |
| `ProviderNotRegistered` | Provider deregistered while a RAV was in flight | Re-register or discard; don't retry blind |
| Out-of-gas | `_lockStake` loop is expensive from accumulated locks | Increase gas limit; call `_releaseStake` more frequently |
| Apparent success, no state change | Transaction included but inner call reverted silently | Verify `tokensCollected` on-chain before marking redeemed |

**Retry strategy:**

```rust
async fn collect_with_retry(rav: &SignedRav, max_attempts: u32) -> Result<()> {
    for attempt in 1..=max_attempts {
        match submit_collect_transaction(rav).await {
            Ok(_receipt) => {
                // Confirm on-chain state actually advanced
                let on_chain = query_tokens_collected(rav).await?;
                if on_chain >= rav.value_aggregate {
                    mark_rav_redeemed(rav).await?;
                    return Ok(());
                }
                log::error!("collect() tx succeeded but tokensCollected did not advance");
                return Err(anyhow!("collection state inconsistency — alert required"));
            }
            Err(e) if is_revert(&e) => {
                log::warn!("collect() reverted (attempt {attempt}): {e}");
                if is_permanent_revert(&e) {
                    return Err(e); // don't retry InvalidSignature, ProviderNotRegistered, etc.
                }
                tokio::time::sleep(Duration::from_secs(2u64.pow(attempt))).await;
            }
            Err(e) => return Err(e), // network error — let the caller handle retry
        }
    }
    Err(anyhow!("collect() failed after {max_attempts} attempts"))
}
```

The critical invariant: **always verify on-chain state after a successful transaction receipt**. A transaction can land in a block with `status: 1` but the inner call can still revert (if caught in Solidity). Read `tokensCollected` directly and compare to `valueAggregate` before marking the RAV as redeemed.

When collection genuinely fails permanently: do not delete the RAV. Keep it in the DB, alert, and wait — the next aggregation cycle produces a new RAV with a higher `valueAggregate` that supersedes the old one. That new RAV can be collected independently, as long as the consumer's escrow covers the delta.

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

Here is the minimal `subgraph.yaml` to index a data service contract:

```yaml
specVersion: 0.0.5
schema:
  file: ./schema.graphql
dataSources:
  - kind: ethereum
    name: MyDataService
    network: arbitrum-one
    source:
      address: "0xYOUR_CONTRACT_ADDRESS"
      abi: MyDataService
      startBlock: 123456789   # your deployment block — not zero
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.7
      language: wasm/assemblyscript
      entities:
        - Indexer
        - ChainRegistration
      abis:
        - name: MyDataService
          file: ./abis/MyDataService.json
      eventHandlers:
        - event: ProviderRegistered(indexed address,string,string)
          handler: handleProviderRegistered
        - event: ProviderDeregistered(indexed address)
          handler: handleProviderDeregistered
        - event: ServiceStarted(indexed address,uint256,uint8)
          handler: handleServiceStarted
        - event: ServiceStopped(indexed address,uint256,uint8)
          handler: handleServiceStopped
        - event: PaymentsDestinationSet(indexed address,indexed address)
          handler: handlePaymentsDestinationSet
      file: ./src/mapping.ts
```

And the AssemblyScript handlers:

```typescript
import { ProviderRegistered, ServiceStarted, ServiceStopped } from "../generated/MyDataService/MyDataService";
import { Indexer, ChainRegistration } from "../generated/schema";

export function handleProviderRegistered(event: ProviderRegistered): void {
  let id = event.params.provider.toHex();
  let indexer = new Indexer(id);
  indexer.address = event.params.provider;
  indexer.endpoint = event.params.endpoint;
  indexer.geoHash = event.params.geoHash;
  indexer.registered = true;
  indexer.save();
}

export function handleServiceStarted(event: ServiceStarted): void {
  let id = event.params.provider.toHex()
    + "-" + event.params.chainId.toString()
    + "-" + event.params.tier.toString();
  let reg = ChainRegistration.load(id);
  if (reg == null) {
    reg = new ChainRegistration(id);
    reg.indexer = event.params.provider.toHex();
    reg.chainId = event.params.chainId;
    reg.tier = event.params.tier.toI32();
    reg.endpoint = "";
  }
  reg.active = true;
  reg.save();
}

export function handleServiceStopped(event: ServiceStopped): void {
  let id = event.params.provider.toHex()
    + "-" + event.params.chainId.toString()
    + "-" + event.params.tier.toString();
  let reg = ChainRegistration.load(id);
  if (reg != null) {
    reg.active = false;
    reg.save();
  }
}
```

Map every lifecycle event: `ProviderRegistered`, `ProviderDeregistered`, `ServiceStarted`, `ServiceStopped`, `PaymentsDestinationSet`, and your governance events.

### Deploying the subgraph

```bash
# Install the Graph CLI
npm install -g @graphprotocol/graph-cli

# Authenticate with Subgraph Studio
graph auth --studio YOUR_DEPLOY_KEY

# Generate AssemblyScript types from your ABI and schema
graph codegen

# Build the WASM binary
graph build

# Deploy to Subgraph Studio (testnet first)
graph deploy --studio my-data-service-arbitrum-sepolia

# Once promoted to the decentralised network, deploy mainnet version
graph deploy --studio my-data-service-arbitrum-one
```

Get your deploy key from [Subgraph Studio](https://thegraph.com/studio). Create two subgraphs — one for Arbitrum Sepolia, one for mainnet — and deploy to each after the corresponding contract deployment.

A gateway can then poll a single GraphQL query to get all active providers for a chain:

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

**HTTP receipt model**: one receipt per request, sent in an HTTP header. Near-zero latency overhead. Consumer complexity is zero if a gateway handles everything. Suited to request/response APIs (JSON-RPC, GraphQL).

**Sidecar/session model**: consumer runs a local sidecar process that manages a persistent bidirectional gRPC payment session with the provider. Usage is measured in blocks or bytes processed, not per-call. Provider plugins integrate directly with Firehose/Substreams for auth, session management, and metering. Suited to long-lived streaming connections where per-call receipts would generate unnecessary overhead.

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

## Local development environment

Before you touch testnet, get the full stack running locally. This lets you iterate on contract logic, EIP-712 encoding, and the payment loop in seconds rather than minutes.

### 1. Start Anvil

```bash
# Install Foundry (if not already installed)
curl -L https://foundry.paradigm.xyz | bash && foundryup

# Start a local chain — chain ID 412346 avoids collisions with real networks
anvil --chain-id 412346 --block-time 1 --accounts 10
```

Anvil pre-funds 10 accounts with 10,000 ETH each. Account 0 (`0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`) is your default deployer.

### 2. Deploy Horizon contracts locally

```bash
git clone https://github.com/graphprotocol/contracts
cd contracts && npm install

# Deploy the full Horizon stack (staking, payments, escrow, tally collector)
forge script packages/horizon/script/DeployHorizon.s.sol \
  --rpc-url http://localhost:8545 \
  --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

# Note the addresses printed — you'll need Controller, HorizonStaking,
# GraphTallyCollector, PaymentsEscrow, and GRT token addresses
```

### 3. Deploy your data service contract

```bash
# From your project root
forge script script/Deploy.s.sol \
  --rpc-url http://localhost:8545 \
  --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --sig "run(address,address,address)" \
  $CONTROLLER $GRAPH_TALLY_COLLECTOR $PAUSE_GUARDIAN
```

### 4. Environment variables for the off-chain service

```env
# Chain
RPC_URL=http://localhost:8545
CHAIN_ID=412346

# Contracts (from deploy output)
DATA_SERVICE_CONTRACT=0x...
GRAPH_TALLY_COLLECTOR=0x...
PAYMENTS_ESCROW=0x...
GRT_TOKEN=0x...

# Keys (use Anvil account 1 as operator — never reuse account 0/deployer)
PROVIDER_ADDRESS=0x70997970C51812dc3A010C7d01b50e0d17dc79C8
OPERATOR_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d

# Database
DATABASE_URL=postgresql://localhost/myservice_dev

# TAP / Gateway (your local self-hosted aggregator)
AUTHORIZED_SENDERS=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
GATEWAY_AGGREGATOR_URL=http://localhost:3001/aggregate
RAV_REQUEST_TRIGGER_VALUE=100000000000000000   # 0.1 GRT
MIN_COLLECT_VALUE=1000000000000000000          # 1 GRT
```

### 5. Seed the local environment

```bash
# Mint GRT to your test consumer (local GRT has a public mint on testnet deployments)
cast send $GRT_TOKEN "mint(address,uint256)" $CONSUMER_ADDRESS 1000000000000000000000 \
  --rpc-url http://localhost:8545 \
  --private-key $DEPLOYER_KEY

# Consumer approves and deposits into escrow
cast send $GRT_TOKEN "approve(address,uint256)" $PAYMENTS_ESCROW 500000000000000000000 \
  --rpc-url http://localhost:8545 --private-key $CONSUMER_KEY

cast send $PAYMENTS_ESCROW "deposit(address,address,uint256)" \
  $GRAPH_TALLY_COLLECTOR $PROVIDER_ADDRESS 500000000000000000000 \
  --rpc-url http://localhost:8545 --private-key $CONSUMER_KEY

# Provider provisions stake and registers
cast send $HORIZON_STAKING "provision(address,address,uint256,uint32,uint64)" \
  $PROVIDER_ADDRESS $DATA_SERVICE_CONTRACT 10000000000000000000000 500000 1209600 \
  --rpc-url http://localhost:8545 --private-key $PROVIDER_KEY

cast send $DATA_SERVICE_CONTRACT "register(address,bytes)" \
  $PROVIDER_ADDRESS $(cast abi-encode "f(string,string,address)" "http://localhost:8080" "u4pruydqqvff" $PROVIDER_ADDRESS) \
  --rpc-url http://localhost:8545 --private-key $PROVIDER_KEY
```

At this point you have a fully functional local Horizon environment with funded escrow and a registered provider. Start your off-chain service and your self-hosted aggregator, then run requests through the full loop.

## Deployment steps

### Getting testnet GRT

Before deploying to Arbitrum Sepolia, you need testnet GRT:

1. **Testnet ETH first**: get Arbitrum Sepolia ETH from the [Alchemy faucet](https://www.alchemy.com/faucets/arbitrum-sepolia). You'll need a small mainnet balance to qualify.
2. **Testnet GRT**: The Graph's testnet GRT contract on Arbitrum Sepolia (`0x1A1af8B44fD59dd2bbEb456D1b7604c7bd340702`) has a public `mint()` function (unlike mainnet GRT). Call it directly:

```bash
cast send 0x1A1af8B44fD59dd2bbEb456D1b7604c7bd340702 "mint(address,uint256)" \
  $YOUR_ADDRESS 10000000000000000000000 \
  --rpc-url https://sepolia-rollup.arbitrum.io/rpc \
  --private-key $YOUR_KEY
```

Alternatively, ask in The Graph's Discord (`#developers` channel) — the community regularly helps with testnet token requests.

### Deployment checklist

1. Deploy your contract to Arbitrum Sepolia first, using testnet Horizon addresses. If your local testing (Anvil + full payment loop) is thorough, deploying directly to mainnet is viable — Dispatch did exactly this. Sepolia is the safer default if you have any uncertainty.
2. Verify on Arbiscan:
```bash
forge verify-contract $CONTRACT_ADDRESS src/MyDataService.sol:MyDataService \
  --chain arbitrum-sepolia \
  --etherscan-api-key $ARBISCAN_KEY \
  --constructor-args $(cast abi-encode "constructor(address,address,address,address)" \
      $OWNER $CONTROLLER $GRAPH_TALLY_COLLECTOR $PAUSE_GUARDIAN)
```
3. Call any service-specific initialisation functions your contract requires (e.g. `addChain()` for a multi-chain RPC service, or equivalent setup for your service type)
4. Transfer ownership to a multisig
5. Have a provider call `HorizonStaking.provision()` then `register()` then `startService()`
6. Deploy your subgraph pointing to the contract's deployment block
7. Run the full payment loop on testnet: send receipts → aggregate → collect → verify GRT moved
8. Repeat on Arbitrum One mainnet

**Key Horizon addresses — Arbitrum One (42161):**

| Contract | Address |
|---|---|
| Controller | `0x0a8491544221dd212964fbb96487467291b2C97e` |
| HorizonStaking | `0x00669A4CF01450B64E8A2A20E9b1FCB71E61eF03` |
| GraphTallyCollector | `0x8f69F5C07477Ac46FBc491B1E6D91E2bb0111A9e` |
| PaymentsEscrow | `0xf6Fcc27aAf1fcD8B254498c9794451d82afC673E` |
| GRT Token | `0x9623063377AD1B27544C965cCd7342f7EA7e88C7` |

**Arbitrum Sepolia (421614) testnet:**

| Contract | Address |
|---|---|
| Controller | `0x9DB3ee191681f092607035d9BDA6e59FbEaCa695` |
| GraphTallyCollector | `0xacC71844EF6beEF70106ABe6E51013189A1f3738` |
| GRT Token | `0x1A1af8B44fD59dd2bbEb456D1b7604c7bd340702` |

HorizonStaking and PaymentsEscrow are resolved from the Controller at runtime via `GraphDirectory` — you don't need to hardcode them. To find them manually: `cast call $CONTROLLER "getContractProxy(bytes32)(address)" $(cast keccak "HorizonStaking")`.

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

The full stack — contract, off-chain service, gateway, consumer SDK, subgraph, indexer agent — took about three weeks from blank slate to testnet. The contracts were the easy part. The tricky bits were: getting EIP-712 encoding identical between Rust and Solidity, the `abi_encode_sequence` vs `abi_encode` distinction for `collect()` data, and getting the E2E test infrastructure stable enough to trust.

The Horizon framework genuinely delivers on the promise of "70% for free." You provision, register, collect. Everything in between — escrow management, payment routing, delegation, protocol tax — you don't touch.

## Further reading

- [hello-data-service](https://github.com/cargopete/hello-data-service) — minimal working Horizon data service built alongside this guide; use it as a starting point
- [vince-data-service](https://github.com/cargopete/vince-data-service) — a real Horizon data service for locating individuals named Vince, worldwide
- [The Graph Horizon documentation](https://thegraph.com/docs/horizon)
- [SubgraphService reference implementation](https://github.com/graphprotocol/contracts/tree/main/packages/subgraph-service)
- [SubstreamsDataService](https://github.com/graphprotocol/substreams-data-service) — the second data service on the network, reference for the sidecar pattern and `paymentsDestination`
- [GIP-0066: Horizon](https://forum.thegraph.com/t/gip-0066-introducing-graph-horizon-a-data-services-protocol/5989)
