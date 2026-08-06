---
title: "Solana has entered the chat"
date: "2026-05-13"
author: "cargopete"
tags: ["solana", "data-services", "horizon", "tap", "indexing", "jupiter", "rust", "yellowstone"]
category: "Data Services"
excerpt: "We built a Horizon data service that indexes Solana — specifically Jupiter v6 swaps, streamed in real time from a Yellowstone gRPC node and served with TAP receipts via PostgREST. Here is what we built, how it works, and how to run or query it."
---

The Graph's Horizon framework is deliberately agnostic about what a data service serves. The Solidity interface says: provision stake, register, and collect fees. It doesn't say anything about Ethereum. It doesn't say anything about EVM at all.

So we asked the obvious question. What happens if you point it at Solana?

The result is **Seahorn** — a Horizon data service that streams, decodes, and serves Solana on-chain data, paid in GRT via TAP receipts, queryable through a standard REST API. The first dataset is Jupiter v6 swaps: every confirmed swap routed through Jupiter's aggregator on Solana Mainnet, indexed in real time.

The contract is live on Arbitrum One. The indexer is running. The dashboard page is up. Here is how it all works.

---

## How it works

Five steps, one data flow:

**1. Stream**: The indexer subscribes to Solana Mainnet via Yellowstone gRPC (Dragon's Mouth). It receives every confirmed transaction matching the Jupiter v6 program ID in real time, as a continuous stream.

**2. Decode**: For each transaction, it looks at the instruction data. The first 8 bytes are the discriminator — an Anchor convention, it's the first 8 bytes of `SHA256("global:instruction_name")`. That tells you which instruction it is (`shared_accounts_route`, `exact_out_route`, etc.). The rest of the bytes are Borsh-encoded arguments: amounts, slippage, hop count. Account indices in the instruction get resolved to actual public keys using the transaction's full account list — including Address Lookup Tables, which is where mint addresses typically live in Jupiter transactions.

**3. Write**: Each decoded swap becomes a row in `entity_changes` in Postgres, with a `fields` JSONB column containing all the decoded swap data. Rows start as `NEW`. A background sweeper polls the Solana RPC every 10 seconds for the current finalized slot and promotes eligible rows to `FINAL`.

**4. Serve**: PostgREST sits in front of Postgres and exposes the table as a REST API with no custom code. Filtering, ordering, pagination — all just query parameters.

**5. Gate**: seahorn-gateway (Axum) sits in front of PostgREST. Every inbound request must carry a valid TAP receipt — an EIP-712 signed payment struct. Invalid or missing receipt: 402. Valid: proxied through to PostgREST and the receipt is stored for later aggregation and on-chain GRT collection.

The whole thing reconnects automatically if the gRPC stream drops, resumes from the last persisted cursor slot so nothing is double-written, and the payment loop runs entirely in the background.

---

## Who pays?

No free lunch, but the accounting depends on who's asking.

**Dashboard visitors** pay nothing. Every time someone loads the Seahorn page, the Next.js API routes hit Lodestar's dispatch-gateway, which signs TAP receipts on behalf of the query. GRT is drawn from Lodestar's escrow on `PaymentsEscrow` on Arbitrum One.

**Lodestar** absorbs that cost — but since Lodestar is also the provider, the GRT cycles straight back to the provider wallet via `collect()`. The net cost is only the protocol fee baked into `collect()` (a small percentage) plus gas for the on-chain settlement transactions. It's not zero, but it's close.

**External consumers** pay properly. They deposit GRT into `PaymentsEscrow`, their gateway signs a TAP receipt per query, and GRT flows from their escrow to whichever provider served the request. Pay per query, settled on-chain. The per-query cost is set by the provider and denominated in GRT wei per request.

The dashboard is, in economic terms, a subsidised demo. Lodestar pays the protocol fee in exchange for proving the full payment loop works under real traffic — same logic as [pointing our own indexer at our own Dispatch network](/blog/dispatch-dogfooding). The circular payment is cheap. The production validation it provides is not.

---

## The architecture

Five components, one data flow:

```
Solana Mainnet
    │
    │  Yellowstone gRPC (Dragon's Mouth)
    ▼
seahorn-indexer  ──────────────────▶  Postgres (entity_changes)
                                              │
                                              │  PostgREST
                                              ▼
                                       seahorn-gateway  (TAP receipt validation, Axum)
                                              │
                                              │  HTTP
                                              ▼
                                       dispatch-gateway  (TAP receipt signing)
                                              │
                                              │
                                              ▼
                                          Consumer
```

**seahorn-indexer** is a Rust binary. It subscribes to Solana Mainnet via a Yellowstone gRPC (Dragon's Mouth) endpoint and receives every confirmed transaction matching specified program IDs. For each transaction, it decodes the instruction data against known program interfaces, assembles a `ChangeSet`, and writes parsed entity rows to Postgres.

**Postgres + PostgREST** form the query layer. PostgREST turns the `entity_changes` table into a full REST API (filtering, ordering, pagination) with zero custom backend code. Queries like `entity_type=eq.JupiterSwap&order=slot.desc&limit=25` work out of the box.

**seahorn-gateway** (Axum) sits in front of PostgREST. It validates inbound TAP receipts against the Lodestar dispatch gateway's signing key. Invalid or missing receipts get a 402. Valid ones get proxied through to PostgREST. It also handles rate limiting per IP via tower-governor.

**dispatch-gateway** is Lodestar's existing RPC gateway. It signs TAP receipts on behalf of consumers and proxies queries to seahorn-gateway. From the consumer's perspective, you talk to one endpoint and payment is handled automatically.

**The on-chain piece** is the `SolanaDataService` contract on Arbitrum One — a standard Horizon data service that handles provider registration, stake provisioning, and GRT collection via `GraphTallyCollector`.

---

## The on-chain contract

```
SolanaDataService (proxy): 0xdDE3F913cb6D1332Bc018Eb63647020a87dD7B37
Network: Arbitrum One
Min provision: 555 GRT
Min thawing period: 14 days
Stake-to-fees ratio: 5:1
```

The contract follows the standard Horizon pattern: inherit `DataService`, `DataServiceFees`, `DataServicePausableUpgradeable`, deployed behind a UUPS proxy. Provider registration requires a prior `HorizonStaking.provision()` call with at least 555 GRT.

One thing specific to Seahorn: we don't track chains or tiers in the contract. There's one service and one endpoint per provider. Registration just stores the provider's endpoint URL:

```solidity
function register(address serviceProvider, bytes calldata data)
    external override whenNotPaused onlyAuthorizedForProvision(serviceProvider)
{
    (string memory endpoint) = abi.decode(data, (string));
    registeredProviders[serviceProvider] = true;
    endpoints[serviceProvider] = endpoint;
    emit ProviderRegistered(serviceProvider, endpoint);
}
```

When a provider calls `collect()` with a signed RAV, GRT flows from the consumer's escrow through `GraphTallyCollector` to the provider's wallet. Stake is locked for the dispute window proportional to the fees collected.

---

## What data Seahorn indexes

Currently: **Jupiter v6 swaps** on Solana Mainnet.

Jupiter is the dominant swap aggregator on Solana — the vast majority of DEX volume flows through it. Jupiter v6 supports four instruction variants:

- `shared_accounts_route`: most common; uses shared token accounts to reduce per-swap overhead
- `route`: classic route variant
- `exact_out_route`: user specifies exact output amount
- `shared_accounts_exact_out_route`: shared accounts + exact out

Each decoded swap produces one row in `entity_changes` with these fields:

| Field | Type | Description |
|---|---|---|
| `user` | string | Wallet address of the swapper (base58) |
| `source_mint` | string | Input token mint address |
| `destination_mint` | string | Output token mint address |
| `in_amount` | u64 | Input token amount (raw, pre-decimals) |
| `out_amount` | u64 | Output token amount (raw, pre-decimals) |
| `hops` | u8 | Number of AMM hops in the route |
| `slippage_bps` | u16 | Slippage tolerance in basis points |
| `platform_fee_bps` | u8 | Platform fee in basis points |
| `exact_out` | bool | Whether this was an exact-out instruction |

And from the outer `entity_changes` table:

| Column | Description |
|---|---|
| `slot` | Solana slot number |
| `tx_signature` | Transaction signature (base58) |
| `commitment_status` | `NEW` or `FINAL` |

Rows start as `NEW` (confirmed) and are promoted to `FINAL` by a background sweeper that polls the Solana RPC for the current finalized slot every 10 seconds.

---

## The indexer internals

The indexer is built around three traits from `seahorn-core`:

**`Substrate`**: a stream of raw blockchain events. The Yellowstone substrate connects to a Dragon's Mouth gRPC endpoint, subscribes to matching program IDs, and yields `SubstrateEvent` structs. Each event carries the slot, a 64-byte transaction signature, a commitment step, and the decoded instruction list.

One non-obvious piece: Jupiter v6 (like most modern Solana DeFi programs) uses Address Lookup Tables to compress transaction size. The token mint addresses are rarely in the static account list — they live in `tx_info.meta.loaded_writable_addresses` and `tx_info.meta.loaded_readonly_addresses`. The substrate appends these to the static account keys before passing instructions downstream, which is what makes mint resolution work:

```rust
let account_keys: Vec<Vec<u8>> = {
    let mut keys = msg.account_keys.clone();
    if let Some(meta) = &tx_info.meta {
        keys.extend_from_slice(&meta.loaded_writable_addresses);
        keys.extend_from_slice(&meta.loaded_readonly_addresses);
    }
    keys
};
```

Miss this step and every swap comes through with empty mint addresses. Ask us how we found out.

**`Handler`**: receives a `SubstrateEvent` and returns a `ChangeSet`. `JupiterV6Handler` matches instruction discriminators (Anchor-style SHA256 hashes of `"global:instruction_name"`) and decodes the binary instruction data into typed structs. Each matching instruction becomes one `EntityChange::Upsert` in the changeset.

**`Sink`**: receives a `ChangeSet` and applies it. `PostgresSink` writes each entity change as a row in `entity_changes`, updates the cursor, and commits atomically. On reconnect after a crash, the substrate filters out any slots at or below the persisted cursor slot — so you resume exactly where you left off without double-writing.

The runtime loop is about ten lines:

```rust
async fn run<S, H, K>(substrate: S, handler: H, sink: K, from: Option<Cursor>) -> Result<()>
where S: Substrate, H: Handler, K: Sink
{
    let mut stream = std::pin::pin!(substrate.stream(from));
    while let Some(result) = stream.next().await {
        let event = result?;
        let changeset = handler.handle(&event);
        if !changeset.is_empty() {
            sink.apply(&changeset).await?;
        }
    }
    Ok(())
}
```

The Yellowstone substrate wraps this in an exponential backoff reconnect loop — gRPC streams drop occasionally; this is fine and expected.

---

## Running a Seahorn node (provider guide)

To become a Seahorn provider you need four things running: a Yellowstone gRPC subscription, the seahorn-indexer, seahorn-gateway, and Postgres with PostgREST in front of it. The steps:

### 1. Provision stake and register

First, provision at least 555 GRT to the SolanaDataService contract on Arbitrum One:

```bash
# Provision 555 GRT
cast send 0x00669A4CF01450B64E8A2A20E9b1FCB71E61eF03 \
  "provision(address,address,uint256,uint32,uint64)" \
  YOUR_PROVIDER_ADDRESS \
  0xdDE3F913cb6D1332Bc018Eb63647020a87dD7B37 \
  555000000000000000000 \
  500000 1209600 \
  --private-key YOUR_OPERATOR_KEY \
  --rpc-url https://arb1.arbitrum.io/rpc

# Register your endpoint
cast send 0xdDE3F913cb6D1332Bc018Eb63647020a87dD7B37 \
  "register(address,bytes)" \
  YOUR_PROVIDER_ADDRESS \
  $(cast abi-encode "f(string)" "https://your-solana-endpoint.com") \
  --private-key YOUR_OPERATOR_KEY \
  --rpc-url https://arb1.arbitrum.io/rpc
```

### 2. Get a Yellowstone gRPC subscription

You need a Dragon's Mouth gRPC endpoint with Solana Mainnet access. Options:

- **Chainstack**: has a Yellowstone gRPC add-on on their Solana Mainnet plans
- **Triton**: original Dragon's Mouth operators, specialist Solana infrastructure
- **Helius**: also offers gRPC access

Set `YELLOWSTONE_ENDPOINT` and `YELLOWSTONE_TOKEN` (if your provider requires one) in your environment.

### 3. Set up Postgres and PostgREST

Run a standard Postgres 16 instance. The seahorn-sink-postgres crate handles migrations automatically on first run — it creates the `entity_changes` and `cursors` tables.

PostgREST sits in front of Postgres. A minimal config:

```ini
db-uri = "postgres://seahorn:password@localhost/seahorn"
db-schema = "public"
db-anon-role = "seahorn_reader"
server-port = 3000
```

### 4. Run the indexer

```bash
cargo build --release -p seahorn

# Index Jupiter v6 swaps, write to Postgres, connect to live Yellowstone
YELLOWSTONE_ENDPOINT=your-endpoint \
YELLOWSTONE_TOKEN=your-token \
DATABASE_URL=postgres://... \
SOLANA_RPC_URL=https://... \
./target/release/seahorn --postgres --jupiter
```

The `--all` flag indexes Pump.fun, Raydium CLMM, and Jupiter v6 simultaneously. `--mock` uses synthetic test data — useful for verifying your stack before connecting to live data.

### 5. Run seahorn-gateway

seahorn-gateway is an Axum service that validates TAP receipts and proxies queries to PostgREST:

```bash
DATA_SERVICE_ADDRESS=0xdDE3F913cb6D1332Bc018Eb63647020a87dD7B37 \
SERVICE_PROVIDER=YOUR_PROVIDER_ADDRESS \
AUTHORIZED_SENDERS=0xGATEWAY_SIGNING_KEY \
POSTGREST_URL=http://localhost:3000 \
./target/release/seahorn-gateway
```

The gateway rejects requests without a valid TAP receipt signed by a key in `AUTHORIZED_SENDERS`. In production this should be locked to the signing keys of whichever gateways you want to accept traffic from.

### 6. Handle fee collection

The TAP aggregation and on-chain collection loop needs to run against a gateway aggregation service. For Lodestar's authorised sender (`0x88e8F78d8992206496d3561919B29420E9acf08B`), the aggregation endpoint is `https://rpc.cargopete.com/rav/aggregate`.

Receipts from Lodestar's dispatch-gateway will accumulate in your `tap_receipts` table. The gateway's aggregation service converts these to signed RAVs. You then call `SolanaDataService.collect()` with each signed RAV to move GRT from the consumer's escrow to your wallet.

---

## Querying Seahorn (consumer guide)

Seahorn exposes data through a standard REST API backed by PostgREST. You can query it like any Postgres-backed REST endpoint, with one requirement: every request must carry a valid TAP receipt signed by your gateway key.

### Direct querying (with TAP receipts)

```
GET https://solana.lodestar-indexer.com/entity_changes
    ?entity_type=eq.JupiterSwap
    &order=slot.desc
    &limit=25
TAP-Receipt: {...}
```

The receipt must be an EIP-712 signed struct with your data service address (`0xdDE3F913cb6D1332Bc018Eb63647020a87dD7B37`) and Lodestar's provider address as the service provider.

### Via Lodestar's dispatch-gateway (recommended)

If you route queries through Lodestar's dispatch gateway at `https://gateway.lodestar-dashboard.com`, TAP receipt signing is handled automatically. Fund your escrow on `PaymentsEscrow` (Arbitrum One: `0xf6Fcc27aAf1fcD8B254498c9794451d82afC673E`), register your gateway signing key as an authorised sender, and point at:

```
GET https://gateway.lodestar-dashboard.com/solana/entity_changes
    ?entity_type=eq.JupiterSwap
    &commitment_status=eq.FINAL
    &order=slot.desc
    &limit=100
```

The gateway signs the receipt, routes to seahorn-gateway, which validates and proxies to PostgREST.

### Useful query patterns

**Recent swaps:**
```
/entity_changes?entity_type=eq.JupiterSwap&order=slot.desc&limit=25
```

**Finalized only:**
```
/entity_changes?entity_type=eq.JupiterSwap&commitment_status=eq.FINAL&order=slot.desc&limit=100
```

**Swaps by wallet:**
```
/entity_changes?entity_type=eq.JupiterSwap&fields->>'user'=eq.YOUR_WALLET&order=slot.desc
```

**Swaps involving a specific mint:**
```
/entity_changes?entity_type=eq.JupiterSwap&fields->>'source_mint'=eq.MINT_ADDRESS&order=slot.desc
```

The `fields` column is JSONB — PostgREST's `->>` operator lets you filter on any swap field directly.

---

## What Lodestar surfaces on the dashboard

The [Seahorn page on lodestar-dashboard.com](https://www.lodestar-dashboard.com/seahorn) displays live data from our own Seahorn node, routed through our own dispatch-gateway. Proper dogfooding, again.

**Stats across the top:**
- Total indexed swaps (approximated via max row ID)
- Finalized swaps (commitment_status = FINAL)
- Latest Solana slot seen
- Unique wallets in the most recent 200 swaps

**Live swap feed**: the 25 most recent confirmed swaps, refreshing every 5 seconds. Each row shows the wallet, the pair (with colour coding per token), the input amount, hop count, and a Solscan link to the transaction. New rows flash briefly on arrival. Rows where Jupiter's instruction variant doesn't encode mint addresses (the `route` and `exact_out_route` variants don't carry mints at fixed account positions) show dashes rather than question marks — the data isn't available at the instruction level for those variants.

**Top pairs**: bar chart of the most frequent token pair routes in the current 25-swap window.

**Provider info**: the on-chain contract address, provider address, indexed program, network, and payment rail, all in one table.

The page connects through the `/api/seahorn/swaps` and `/api/seahorn/stats` Next.js API routes, which proxy to the dispatch-gateway server-side. The TAP receipt dance happens on the server and is invisible to the browser.

---

## What's next

Jupiter v6 is the first dataset but not the last. The indexer already has handlers for **Pump.fun** (token creates, buys, and sells) and **Raydium CLMM** (swaps, open positions, add/remove liquidity). The architecture makes adding a new program a matter of writing a handler crate and wiring it into the `--all` flag.

A few things on the roadmap:

**Multi-provider.** Right now only Lodestar runs a Seahorn node. The on-chain contract is live and open — any indexer can provision stake and register. Multiple providers means routing, redundancy, and competitive pricing.

**More datasets.** Orca, Meteora, Drift protocol, and SPL token transfers are all plausible additions. The substrate and sink are program-agnostic; the work is in writing accurate decoders.

**Streaming.** PostgREST works well for polling but there's an argument for a WebSocket stream of new swap events. Potentially via PostgREST's built-in realtime support, or a custom endpoint in seahorn-gateway.

---

## The broader point

The graph's Horizon framework says: here are the payment rails and staking primitives — build your service on top. We took that literally and aimed it at a completely different chain. The contract is EVM (Arbitrum One, same as everything else on Horizon). The data is Solana. The payment flows in GRT.

It works.

The pattern is generic: any chain with a decent RPC or gRPC streaming interface can be indexed this way. The crate structure — `seahorn-core` traits, per-program handler crates, the Yellowstone substrate, the Postgres sink — was designed to make adding new chains or programs cheap. Ethereum would be a different substrate implementation. Cosmos, Sui, Aptos — same.

We don't think Solana data is special. We think the scaffolding for serving any indexed data through Graph Protocol's payment rails is now reasonably well understood. Seahorn is the proof of concept.

If you want to run a node, query the data, or build a handler for a new Solana program, reach out on the forum or on X.

---

*Lodestar is an independent Graph Protocol indexer and data service provider. Indexer address: `0xb43B2CCCceadA5292732a8C58ae134AdEFcE09Bb`. Dashboard: [lodestar-dashboard.com](https://www.lodestar-dashboard.com). Seahorn endpoint: [solana.lodestar-indexer.com](https://solana.lodestar-indexer.com).*
