---
title: "We Made Our Indexer Use Its Own RPC Network (And It Worked)"
date: "2026-05-05"
author: "cargopete"
tags: ["dispatch", "rpc", "data-services", "horizon", "infrastructure", "indexers", "dogfooding"]
category: "Infrastructure"
excerpt: "We run a Graph Protocol indexer. We also built Dispatch — a decentralised JSON-RPC gateway paid in GRT via TAP receipts. So we pointed our indexer at our own network. Here's what broke, and what it proved."
---

At Lodestar we run a Graph Protocol indexer. We also built a thing called Dispatch — a decentralised JSON-RPC gateway where providers stake GRT, register Ethereum nodes, and get paid per request via on-chain TAP receipts. It's a community implementation of the [Experimental JSON-RPC Data Service](https://thegraph.com/blog/graph-protocol-2026-technical-roadmap/) direction in The Graph's 2026 roadmap.

We had an idea. What if we made our own indexer use our own RPC network?

The indexer (graph-node) needs JSON-RPC endpoints to index subgraphs. It currently calls Chainstack directly for Arbitrum One and Base — archive nodes, traces, the works. Dispatch is a gateway that routes those same calls to providers (one of which is us, with Chainstack as the backend). Could we just point graph-node at dispatch instead?

Proper dogfooding. Eating the whole dog, not just a nibble.

---

## The Architecture

Dispatch works like this:

```
Consumer → dispatch-gateway → dispatch-service → Chainstack → response
```

The consumer pays per-request in GRT via signed TAP receipts. The gateway routes to the best available provider using QoS scoring (latency, availability, block freshness). The provider validates receipts, forwards to Chainstack, and collects GRT hourly via an on-chain `collect()` call.

Our indexer would be both sides simultaneously: **provider** (Chainstack nodes serving Arb and Base) and **consumer** (graph-node making RPC calls through the gateway). The GRT would loop: operator funds escrow → graph-node uses dispatch → receipts collect hourly → GRT returns to provider wallet, minus ~2% in protocol fees.

The net economic cost is negligible. The value is something else: production validation of the full payment loop under real indexing load, plus automatic Chainstack failover for free.

---

## The Problem We Didn't Anticipate

graph-node has a clean provider config:

```toml
[chains.arbitrum-one]
shard = "primary"
provider = [
  { label = "my-provider", url = "https://...", features = ["archive", "traces"] }
]
```

Dispatch's gateway requires a `X-Consumer-Address` HTTP header on every request — it encodes the consumer's Ethereum address into the TAP receipt metadata so GRT gets drawn from the right escrow. Without it, the gateway returns `402 Payment Required`.

graph-node sends vanilla JSON-RPC. No custom headers. No way to add them.

Our first instinct was a local proxy — a small Caddy route that injects the header before forwarding. Functional but inelegant. An extra hop, an extra service to maintain, and a slightly embarrassing thing to have to explain in a blog post.

---

## The Actual Fix

The gateway already had a `POST /rpc/{chain_id}` route. We added:

```
POST /rpc/{chain_id}/{consumer_address}
```

Consumer address in the URL path. The gateway extracts it, validates it as an Ethereum address, and encodes it into the TAP receipt exactly as the header path does. No proxy. No sidecar.

The Rust is about 12 lines:

```rust
async fn rpc_handler_with_consumer(
    State(state): State<AppState>,
    Path((chain_id, consumer_str)): Path<(u64, String)>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Json(body): Json<Value>,
) -> Result<Response, GatewayError> {
    let consumer = consumer_str
        .parse::<Address>()
        .map_err(|_| GatewayError::InvalidConsumerAddress(consumer_str))?;
    dispatch_rpc(state, chain_id, peer, consumer, body).await
}
```

graph-node config becomes:

```toml
[chains.arbitrum-one]
shard = "primary"
provider = [
  { label = "dispatch-arb",
    url   = "https://gateway.lodestar-dashboard.com/rpc/42161/0xB70781305939A39e74Aa918416Df1b893e1Bd904",
    features = ["archive", "traces"] },
  { label = "chainstack-arb",
    url   = "https://arbitrum-mainnet.core.chainstack.com/YOUR_KEY",
    features = ["archive", "traces"] }
]
```

Dispatch goes first. If it fails for any reason, graph-node retries automatically on Chainstack. Two providers, zero proxies, zero code changes to graph-node.

The consumer address embedded in the URL is our operator wallet — the one that pre-funds `PaymentsEscrow` on Arbitrum One. Same address, whether it comes from the header or the path.

---

## What Goes Over the Wire

graph-node makes a lot of RPC calls. For a subgraph that's actively syncing on Base, the typical pattern is:

- `eth_getLogs` (lots of these, historical ranges → Archive tier): 20 CU each
- `eth_getBlockByNumber` (latest and historical): 5 CU each
- `eth_call` (state reads, quorum dispatched to top-3 providers for determinism): 10 CU each
- `trace_block` or `trace_transaction` (traces-enabled subgraphs) → Debug tier — 10 CU default

The dispatch-gateway detects the tier automatically from the method and parameters:

- `trace_*` / `debug_*` → Debug tier (needs archive + trace-capable provider)
- Historical block number in params → Archive tier
- `eth_blockNumber`, `eth_chainId` etc. → Standard tier

Since our Chainstack endpoints are archive+traces, we register with Debug tier — the superset. All three tiers route correctly.

---

## Why It Matters Beyond the Economics

The circular payment loop is, frankly, a bit silly in pure economic terms. You're paying 2% to route your own traffic through your own nodes. Not a financial masterstroke.

But that's not the point.

The point is that every `eth_getLogs` graph-node fires is a real production request going through the full TAP payment loop. Receipt signed. Provider validates escrow balance. PostgreSQL insert. RAV aggregation every 60 seconds. On-chain `collect()` every hour. If anything in that chain is subtly broken, graph-node will find it — because it runs thousands of these calls a day, with real data, under real timing pressure.

No amount of smoke testing or local Anvil demos catches what a live indexer will catch.

There's also a second, less obvious benefit: **the existing second provider in the dispatch network**. When graph-node uses dispatch, it gets QoS-based routing across both registered providers. If one goes down, the gateway switches automatically. Chainstack is still there as a final fallback in the graph-node provider list. Suddenly our previously single-provider RPC setup has three layers of redundancy, and we didn't have to set up a single additional monitoring rule.

And if external consumers start using `gateway.lodestar-dashboard.com`, their requests also hit our Chainstack backends — nodes we're already paying $49/month for. Those requests generate GRT revenue against a sunk cost. The dogfooding makes the economics of the whole thing work better at scale.

---

## What We Had to Set Up

**On the dispatch side:**
1. Add Base (8453) backend to dispatch-service config
2. Register Base on-chain with Debug tier via `startService()` (tx `0x95b2417f...`)
3. Deploy the updated dispatch-service
4. The new `/rpc/{chain_id}/{consumer_address}` route in dispatch-gateway

**On the indexer side:**
1. Fund operator wallet in `PaymentsEscrow` on Arbitrum One
2. Update graph-node `config.toml` with dispatch URLs + Chainstack fallback for Arb and Base
3. Restart graph-node — confirmed using dispatch-arb and dispatch-base immediately

Gnosis stays on Chainstack directly — zero allocation signal, no dispatch coverage there.

---

## What We're Watching

The things that could make this subtly painful:

**Latency.** Dispatch adds ~60ms per request (Helsinki indexer → Nuremberg gateway → back to Helsinki dispatch-service → Chainstack). For indexing this is largely irrelevant — graph-node's bottleneck is Postgres, not RPC latency, and it parallelises calls aggressively. For live chain following (latest block queries) it's genuinely irrelevant. We're watching sync speed on the Base subgraph to see if it dips.

**Escrow runway.** At ~4×10⁻⁶ GRT per compute unit, graph-node's indexing traffic would need to be extraordinary to drain a few hundred GRT of escrow in a month. We'll top it up quarterly and automate a low-balance alert.

**The quorum thing.** For deterministic methods (`eth_call`, `eth_getLogs`), dispatch sends to top-k providers and takes the majority result. With two providers, k=2 and both need to agree — or one falls back to the other. Worth watching for any `quorum disagreement detected` log lines.

---

## On Building Infrastructure for Infrastructure

We built Dispatch partly to understand The Graph's Horizon data service layer from the inside. Running an indexer gives you one view. Building the data service layer gives you another. But actually making one use the other — that's where the interesting understanding comes from.

We had to understand why graph-node couldn't set headers (simple: it's an Ethereum client, not a web app). We had to understand what the TAP receipt metadata actually encodes (20 bytes of consumer address, then the method name — not immediately obvious from the spec). We had to understand that the gateway's quorum dispatch for `eth_call` means archive calls will always hit both registered providers in parallel, which changes the cost model slightly.

None of that understanding comes from reading specs. It comes from pointing real production traffic at the thing and watching what breaks.

So far: a few things have broken. Which is the expected result of actually running it.

---

## What Actually Broke (And How We Fixed It)

The upside of dogfooding is that the production load immediately surfaces bugs you'd never find in tests. Here's what graph-node found:

**The credit limit.** The dispatch-service has a per-consumer credit gate — if you accumulate more than 0.1 GRT in unconfirmed requests, all further requests are rejected until the next on-chain `collect()` runs. graph-node generates enough traffic to hit 0.1 GRT in under an hour. The gate existed to protect against non-paying consumers running up a large unpaid tab. For self-consumption it's counterproductive. Fix: raise the threshold to 1000 GRT for the operator wallet in config. Long-term: the bypass list that already skips the escrow check should also skip the credit gate.

**The TAP aggregator aborting on bad payers.** Historical receipts in the database had the wrong payer address (an artefact of an early bug where the gateway's own signing key was used as the payer rather than the consumer's wallet). The RAV aggregation task was grouping receipts by payer and calling `anyhow::bail!()` on the first failure — which killed the entire aggregation cycle, including the legitimate payer. Fix: extract per-payer logic into its own function, catch errors per-payer with `warn!()` + `continue`. One bad payer no longer takes down the whole cycle.

**413 Payload Too Large.** Axum's default request body limit is 2 MB. TAP receipts are small individually (a few hundred bytes each), but the aggregation protocol is cumulative — you must send *all* receipts for a given payer in each RAV request, not just the new ones, to maintain the monotonically-increasing `value_aggregate` invariant. Under graph-node load, receipts accumulate fast. 58,000 receipts × ~400 bytes each = ~23 MB. Fix: apply a 64 MB `DefaultBodyLimit` specifically to the `/rav/aggregate` route.

**Stale receipts with wrong payer address.** Receipts signed by old gateway keys (from early experimental runs) were stored with `signer_address` set correctly but with stale payer addresses that no longer corresponded to the current consumer/gateway relationship. They could never be aggregated because the EIP-712 signature verification at the gateway would recover the wrong signer. Fix: `DELETE FROM tap_receipts WHERE payer_address IN (...)` — wipe the irrecoverable rows, take the dust loss (~0.03 GRT), start clean.

Three of the four fixes were one-line config changes. One was a genuine code bug. All found within hours of pointing real production traffic at the system.

We'll report back.

---

*Lodestar is an independent Graph Protocol indexer and Dispatch RPC network provider. Indexer address: `0xb43B2CCCceadA5292732a8C58ae134AdEFcE09Bb`. Dashboard: [lodestar-dashboard.com](https://www.lodestar-dashboard.com). Dispatch gateway: [gateway.lodestar-dashboard.com](https://gateway.lodestar-dashboard.com).*
