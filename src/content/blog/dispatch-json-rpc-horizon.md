---
title: "Dispatch: An Experimental Community JSON-RPC Service on Horizon"
date: "2026-04-16"
author: "cargopete"
tags: ["dispatch", "rpc", "data-services", "horizon", "infrastructure", "indexers"]
category: "News"
excerpt: "Every dApp on Earth relies on Alchemy or Infura for JSON-RPC. Dispatch is a community-built experiment exploring what a decentralised JSON-RPC data service on The Graph's Horizon protocol might look like — the first provider is live and serving real traffic on Arbitrum One."
---

> **This is an experimental, unofficial, community-led project.**
>
> Dispatch is not affiliated with, endorsed by, backed by, or supported in any way by The Graph Foundation or Edge & Node. It is an independent hobby project that exists to explore what a decentralised JSON-RPC data service on Horizon *might* look like — nothing more. It is not production-ready and should not be used for anything critical.
>
> Feedback, contributions, and wild ideas are very warmly welcome. If you want to help shape what this becomes, open an issue or PR on [GitHub](https://github.com/cargopete/dispatch).

Every dApp on Earth quietly depends on Alchemy or Infura. When you call `eth_getBalance` in your frontend, that request is almost certainly hitting a centralised API run by a handful of companies. They can go down, rate-limit you, change pricing overnight, or (in the extreme case) be compelled to censor specific addresses.

The Graph Protocol's entire thesis is that blockchain data infrastructure should be decentralised. It's done that for Subgraph data remarkably well. But the most fundamental piece of infrastructure (plain JSON-RPC) has stayed centralised.

**Dispatch** is a community attempt to explore what that might look like. It's a proof of concept for a decentralised JSON-RPC data service built on The Graph's Horizon framework. The first provider is live and serving real traffic — but "live" means "the experiment is running", not "production-ready". This is unofficial, unsupported, and very much a work in progress.

## What is Dispatch?

Dispatch is an experimental, community-built JSON-RPC data service on [The Graph's Horizon framework](https://thegraph.com/docs/en/horizon/). The idea: indexers stake GRT, register to serve specific chains, and get paid per request via [GraphTally](https://github.com/graphprotocol/graph-improvement-proposals/blob/main/gips/0054-timeline-aggregation-protocol.md) (TAP v2) micropayments — the same payment primitive that powers Subgraph queries on the network today.

From a consumer's perspective it's just an HTTP endpoint. Under the hood, every request carries a signed EIP-712 receipt. Providers validate receipts, forward requests to their Ethereum client, sign the response, and accumulate receipts for on-chain settlement.

The reference implementation is open source: [github.com/cargopete/dispatch](https://github.com/cargopete/dispatch)

## How it works

There are two ways to interact with the network as a consumer:

**Via the gateway**: the managed path. A `dispatch-gateway` instance selects providers using QoS scoring (latency EMA, availability, block freshness), signs TAP receipts on your behalf, dispatches requests concurrently, and returns the first valid response. It handles quorum consensus for `eth_call` and `eth_getLogs`, geographic routing, and per-IP rate limiting. You point your app at a gateway URL and it works like any other RPC endpoint.

**Via the consumer SDK**: the trustless path. `@graph-dispatch/consumer-sdk` discovers providers directly from the Subgraph, signs receipts locally with your own key, and manages QoS scoring in your application. No intermediary.

Either way, the request flow is:

```
Consumer
  │  POST /rpc/{chain_id}
  │  TAP-Receipt: { EIP-712 signed receipt }
  ▼
dispatch-gateway      ← QoS selection, TAP signing, quorum, routing
  │
  ▼
dispatch-service      ← TAP validation, RPC proxy, response attestation
  │
  ▼
Ethereum client       ← Geth / Erigon / Reth / Chainstack / etc.
```

Payment settlement happens off the critical path:

```
receipts (per request) → TAP agent aggregates → RAV → RPCDataService.collect()
                                                       → GraphTallyCollector
                                                       → PaymentsEscrow → GRT to indexer
```

## Capability tiers

Not all JSON-RPC requests are equal. An `eth_blockNumber` is cheap and can be answered by any full node. An `eth_getBalance` at a block from two years ago requires an archive node. A `debug_traceTransaction` needs debug APIs enabled.

Dispatch handles this with capability tiers:

| Tier | Capability | Example methods |
|---|---|---|
| 0 — Standard | Full node | `eth_blockNumber`, `eth_getBalance` (latest), `eth_sendRawTransaction` |
| 1 — Archive | Archive node | `eth_getBalance` (historical), `eth_getStorageAt` (historical) |
| 2 — Debug | Debug/trace APIs | `debug_traceTransaction`, `trace_block` |

Providers register per `(chainId, tier)` pair. The gateway routes requests to capable providers only.

## Verification

Three tiers of response verification match the three capability tiers:

**Tier 1 — Merkle-provable.** Methods like `eth_getBalance` and `eth_getStorageAt` can be verified with an EIP-1186 Merkle-Patricia proof against a trusted block header. The `dispatch-oracle` daemon feeds L1 state roots to the RPCDataService contract on Arbitrum every ~12 seconds, enabling on-chain `slash()` for provably wrong responses.

**Tier 2 — Quorum.** For `eth_call`, `eth_getLogs`, and similar non-provable methods, the gateway dispatches to multiple providers and takes a majority vote. Minority providers get penalised in QoS scoring.

**Tier 3 — Reputation.** Non-deterministic methods like `eth_estimateGas` are scored by reputation only.

## What's deployed

The on-chain infrastructure lives on Arbitrum One:

| Contract | Address |
|---|---|
| HorizonStaking | `0x00669A4CF01450B64E8A2A20E9b1FCB71E61eF03` |
| GraphTallyCollector | `0x8f69F5C07477Ac46FBc491B1E6D91E2be0111A9e` |
| RPCDataService | `0x7101D5C1A5c89C3647F5118da118E56C023bA0b9` |

Subgraph: `https://api.studio.thegraph.com/query/1747796/rpc-network/v0.1.1`

npm packages: `@graph-dispatch/consumer-sdk` and `@graph-dispatch/indexer-agent` — both published.

## The first provider

The first provider is serving Arbitrum One (chain ID 42161) with Standard and Archive tiers.

To validate the full consumer → provider → backend flow, the repo includes `dispatch-smoke` — a Rust binary that signs real EIP-712 TAP receipts and fires JSON-RPC requests at a live endpoint:

```
dispatch-smoke
  endpoint   : <provider-endpoint>
  chain_id   : 42161

  [PASS] GET /health → 200 OK
  [PASS] eth_blockNumber → "0x1b01312d" [196ms]
  [PASS] eth_chainId → "0xa4b1" [73ms]
  [PASS] eth_getBalance (latest/Standard) → "0x6f3a59e597c5342" [94ms]
  [PASS] eth_getBalance (historical/Archive) → "0x0" [649ms]
  [PASS] eth_getLogs (quorum) → [...] [83ms]

  5 passed, 0 failed
```

Archive tier (historical state) working on Arbitrum One in 649ms. That's a real archive query against a real Chainstack endpoint, routed through a real Dispatch provider, validated by a real TAP receipt.

## Become a provider

Requirements:
- ≥ 555 GRT staked and provisioned to `0x7101D5C1A5c89C3647F5118da118E56C023bA0b9` on Arbitrum One
- A running Ethereum node (full or archive, depending on which tiers you want to serve)
- `dispatch-service` running alongside your node

```bash
git clone https://github.com/cargopete/dispatch
cd dispatch

cp docker/config.example.toml docker/config.toml
# fill in: provider address, operator key, backend RPC URL, data service address

docker compose -f docker/docker-compose.yml up
```

The `@graph-dispatch/indexer-agent` npm package handles the on-chain lifecycle (`register`, `startService`, `stopService`) and reconciles automatically on a cron interval.

```typescript
import { IndexerAgent } from "@graph-dispatch/indexer-agent";

const agent = new IndexerAgent({
  arbitrumRpcUrl: "https://arb1.arbitrum.io/rpc",
  rpcDataServiceAddress: "0x7101D5C1A5c89C3647F5118da118E56C023bA0b9",
  operatorPrivateKey: process.env.OPERATOR_KEY,
  providerAddress: "0x...",
  endpoint: "https://rpc.your-indexer.com",
  geoHash: "u1hx",
  services: [
    { chainId: 1,     tier: 0 },
    { chainId: 42161, tier: 0 },
    { chainId: 42161, tier: 1 },
  ],
});

await agent.reconcile(); // call on a cron/interval
```

## Use it as a consumer

The simplest path is pointing your app at a gateway. Or, for the trustless path:

```bash
npm install @graph-dispatch/consumer-sdk
```

```typescript
import { DispatchClient } from "@graph-dispatch/consumer-sdk";

const client = new DispatchClient({
  chainId: 42161,
  dataServiceAddress: "0x7101D5C1A5c89C3647F5118da118E56C023bA0b9",
  graphTallyCollector: "0x8f69F5C07477Ac46FBc491B1E6D91E2be0111A9e",
  subgraphUrl: "https://api.studio.thegraph.com/query/1747796/rpc-network/v0.1.1",
  signerPrivateKey: process.env.CONSUMER_KEY,
  basePricePerCU: 4_000_000_000_000n,
});

const block = await client.request("eth_blockNumber", []);
```

The SDK discovers providers from the Subgraph, selects by QoS, signs a TAP receipt per request, and handles retries automatically.

## What's next

The network is live but early. What's needed to make it real:

- **More providers**: a single-provider network isn't decentralised. If you're an existing Graph indexer, you already have the GRT stake. You need a node and `dispatch-service`.
- **TAP aggregation**: the receipts are being signed; the aggregator that batches them into RAVs for on-chain collection needs wiring up
- **Oracle**: the `dispatch-oracle` daemon feeds L1 state roots for Tier 1 slash verification; it needs the contract owner key to start submitting
- **More chains**: the contract supports permissionless chain registration with a 100k GRT bond. Ethereum mainnet and other L2s are the obvious next additions

The code is all there. The contracts are deployed. The payment primitives are the same ones the Subgraph network has been using in production. The main thing needed is more providers — and more people poking at the edges to see where it breaks.

This is a community experiment. If you're curious about what decentralised RPC on Horizon could look like, come have a look.

## Further reading

- [Dispatch GitHub repository](https://github.com/cargopete/dispatch)
- [The Graph Horizon documentation](https://thegraph.com/docs/en/horizon/)
- [GraphTally / TAP v2 GIP](https://github.com/graphprotocol/graph-improvement-proposals/blob/main/gips/0054-timeline-aggregation-protocol.md)
- [RPCDataService on Arbiscan](https://arbiscan.io/address/0x7101D5C1A5c89C3647F5118da118E56C023bA0b9)
