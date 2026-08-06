---
title: "camp: A Free Decoded Arbitrum API Built on a Self-Hosted Amp Node"
date: "2026-05-27"
author: "cargopete"
tags: ["amp", "camp", "arbitrum", "data-services", "horizon", "infrastructure"]
category: "Infrastructure"
excerpt: "camp is a free, tip-fresh REST API for decoded Arbitrum One data — ERC-20 transfers, gas analytics, whale feeds, raw SQL — backed by a self-hosted Amp node running on a ThinkPad. Here's what it is, how it works, and what comes next."
---

Getting useful data out of Arbitrum One takes more effort than it should. Raw RPC gives you encoded logs and hex everything. Dune gives you clean SQL but you're querying a shared cache that can be hours behind. The Graph gives you subgraphs, but writing a subgraph to answer a one-off question is like hiring a contractor to change a lightbulb.

**camp** takes a different path. It's a free, tip-fresh REST API for decoded Arbitrum One data — ERC-20 transfers, protocol events, gas analytics, block-level data — built on top of a self-hosted [Amp](https://amp.thegraph.com) node running on a ThinkPad in a home lab.

No signup. No API key. No dashboard. Just HTTP.

---

## What is Amp?

Before camp makes sense, Amp needs a quick introduction. (There's a [longer writeup here](/blog/intro-to-amp) if you want the full picture.)

**Amp** is a blockchain-native database built by Edge & Node, the core development team behind The Graph Protocol. It runs a daemon called `ampd` that ingests raw blockchain data — blocks, transactions, logs, events — and stores it in a columnar format (Apache Arrow / Parquet) on local disk. Once the data is there, you query it with SQL.

The key thing Amp does that a regular database doesn't: it decodes smart contract events automatically. Give it an ABI, and it turns raw encoded log data into typed SQL tables. An ERC-20 Transfer event becomes a row in a `transfer` table with `from`, `to`, `value`, and `token` columns — not `0x000000000000000000000000...` blobs you have to decode yourself.

`ampd` exposes a **JSON Lines over HTTP** interface on port 1603. Send it a SQL query, get back newline-delimited JSON. That's the foundation everything else sits on.

Amp is licensed BUSL-1.1. The node software, the query engine, the storage layer — Edge & Node built all of it. camp is one deployment of that infrastructure, run independently.

---

## What is camp?

camp is a public-facing REST gateway that wraps an Amp node and translates clean HTTP requests into SQL against Amp's internal tables.

Live at **[engine.camp](https://engine.camp)**.

The pitch: same query shape Dune offers (decoded protocol tables, SQL semantics), but updated at chain tip, free, and with a predictable REST interface instead of a query editor.

### Endpoints

| Method | Path | What you get |
|---|---|---|
| GET | `/v1/status` | Latest indexed block + total indexed count |
| GET | `/v1/signatures` | Reference table of well-known event topic0s |
| GET | `/v1/transfers` | Decoded ERC-20 / ERC-721 Transfer events |
| GET | `/v1/events` | Generic decoded log filter by address + topic |
| GET | `/v1/block/{n}` | Full block: header, every tx, every log |
| GET | `/v1/tx/{hash}` | Transaction + its logs |
| GET | `/v1/address/{a}/tx` | All transactions from or to an address |
| GET | `/v1/address/{a}/transfers` | Token movements in and out of an address |
| GET | `/v1/gas/blocks` | Time-bucketed gas / base-fee / throughput stats |
| GET | `/v1/contract/{a}/activity` | Time-bucketed log count for a contract |

Query parameters follow a consistent pattern: `from_block`, `to_block`, `limit`, `bucket` (minute/hour/day), `direction` (in/out/all). Block span is capped at 100,000 blocks. Rows are capped at 1,000. Query timeout is 8 seconds. Rate limit: 30 requests/minute, 500/hour per IP.

### A real example

```bash
# ERC-20 transfers for USDC on Arbitrum One, last 1000 blocks
curl "https://engine.camp/v1/transfers?token=0xaf88d065e77c8cC2239327C5EDb3A432268e5831&from_block=300000000&limit=20"
```

Response is JSON — decoded, typed, human-readable. No hex decoding, no ABI parsing in your client.

```json
[
  {
    "block_number": 300012345,
    "tx_hash": "0xabc...",
    "token": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    "from": "0x1234...",
    "to": "0x5678...",
    "value": "1000000"
  }
]
```

---

## How it's built

The full stack, from bottom to top:

```
ampd :1603                      Amp node — Parquet on local SSD (ThinkPad)
  ↑ JSON Lines / SQL
nginx :1604                     Shared-secret gate + Redis rate limiting
  ↑ HTTP
Cloudflare Quick Tunnel          Private origin link (URL auto-rotates)
  ↑ HTTPS
camp (Next.js on Vercel)        REST API — translates HTTP → SQL → JSON
  ↑ HTTP
client                          You
```

The Amp node indexes Arbitrum One directly — blocks, logs, decoded events, the lot — storing everything in Parquet on local SSD. The node runs continuously, staying at chain tip.

nginx sits in front of `ampd`, checking a shared secret header and enforcing Redis-backed rate limits. The Cloudflare tunnel gives `ampd` a public HTTPS endpoint without port-forwarding or exposing the home IP. When the tunnel URL rotates, the ops automation updates the Vercel environment variable and redeploys.

The Next.js app on Vercel is thin: parse query params, build a SQL query, POST it to `ampd` via the tunnel, stream the JSON Lines response back as a JSON array. Edge cache handles the rest — 1 hour for finalized block ranges, 5 seconds near tip.

The ThinkPad handles everything from the Amp layer down. Vercel handles the public HTTPS API layer. Total infrastructure cost at rest: electricity.

---

## Why bother?

Three reasons.

**Freshness.** Dune's public datasets can be minutes to hours behind chain tip. camp is 5 seconds behind at worst (edge cache at tip). For anything involving recent transactions or live monitoring, that matters.

**No account required.** Dune's SQL interface needs an account. Flipside needs an account. camp is just a URL.

**It's a real Amp node.** Not a wrapper around someone else's API. The data comes straight from `ampd` indexing Arbitrum One directly. What you get is what the node has — no middlemen, no re-encoding.

It's not trying to replace Dune. Dune has community queries, visualisations, a dashboard builder, multi-chain coverage, years of historical data going back further than any single node. camp is for the cases where you need fresh data, you want a simple HTTP endpoint, and you don't want to sign up for anything.

---

## Roadmap

camp is actively developed. A few things in progress:

**Decoded protocol data (Phase A)**: Amp's `evm_decode_log` and `evm_topic` UDFs enable typed responses for specific protocol events. The goal is endpoints for Uniswap V3 (pool liquidity, swaps, fees), GMX, and other major Arbitrum protocols — decoded, strongly typed, not just raw logs.

**Explore UI (Phase B)**: Server-rendered dashboard pages that demonstrate what the data looks like: live gas charts, whale activity feeds, slashing history. The data is already there; it just needs a frontend.

**Raw SQL (Phase C)**: `POST /v1/sql` for arbitrary SELECT queries against the Amp tables. Already implemented in camp-data-service (see below). Rate-limited and read-only.

---

## camp-data-service: The Paid Horizon Version

camp is free, which is great for exploration but unsustainable at scale. Running `ampd` takes real hardware. The ThinkPad indexing Arbitrum One is doing real work.

**camp-data-service** is an experimental extension that turns the same Amp node into a paid provider on The Graph Protocol's [Horizon](https://thegraph.com/docs/en/horizon/) payment network.

The idea: instead of free requests, consumers deposit GRT into `PaymentsEscrow` and each request carries a signed TAP (GraphTally) receipt. The camp-data-service gateway validates the receipt, proxies the request upstream to the camp REST API, and the provider earns GRT. Settlement happens on-chain via `CampDataService.collect()`, aggregating receipts into RAVs every 60 seconds and collecting on-chain every hour.

```
Consumer (signed TAP receipt)
  ↓
camp-gateway (Rust/Axum)        receipt validation, proxy, RAV aggregation
  ↓
camp REST API (Next.js)         translates HTTP → SQL
  ↓
nginx + ampd (ThinkPad)         Amp node on Arbitrum One
```

Payment settlement:

```
receipts (per request)
  → aggregator (60s) → RAV
  → collector (1h)   → CampDataService.collect()
                     → GraphTallyCollector
                     → PaymentsEscrow → GRT to provider
```

The pricing is tiered by query cost:

| Tier | Endpoints | CU cost | Per-request fee |
|---|---|---|---|
| BASIC | `/v1/status`, `/v1/block/{n}`, `/v1/tx/{hash}`, `/v1/signatures` | 1 CU | 0.000004 GRT |
| STANDARD | `/v1/transfers`, `/v1/events`, `/v1/address/*` | 5 CU | 0.00002 GRT |
| AGGREGATE | `/v1/gas/*`, contract activity, volume | 10 CU | 0.00004 GRT |
| SQL | `POST /v1/sql` | 20 CU | 0.00008 GRT |

The contract is written in Solidity, inherits from The Graph's `DataService` base contract, and is fully tested with Foundry (27 tests covering the complete provider lifecycle). The gateway is Rust/Axum. Everything is on Arbitrum Sepolia for now — testnet only, not mainnet.

> camp-data-service is experimental and community-built. It is not affiliated with The Graph Foundation or Edge & Node.

The full code is on GitHub: [nightswatchhq/camp-data-service](https://github.com/nightswatchhq/camp-data-service).

---

## What this demonstrates

camp is a concrete answer to "what does a self-hosted Amp node actually look like in the wild?" It's not a proof of concept — it's a running service indexing a live chain, serving real requests, with a public endpoint.

camp-data-service extends that into "what does it look like when that Amp node becomes a Horizon provider?" The ThinkPad that was quietly serving free queries can, with the Horizon payment layer on top, become a GRT-earning data provider — the same economic model that Graph indexers use for subgraphs, applied to a home Amp node.

Both projects are open source. The pattern is replicable: run `ampd` against any supported chain, drop the camp gateway in front of it, add camp-data-service if you want Horizon payments. One ThinkPad, one Amp node, one deployment — and you're a provider.

---

## Try it

- **camp API:** [engine.camp](https://engine.camp)
- **camp source:** [github.com/nightswatchhq/camp](https://github.com/nightswatchhq/camp)
- **camp-data-service:** [github.com/nightswatchhq/camp-data-service](https://github.com/nightswatchhq/camp-data-service)
- **Amp:** [amp.thegraph.com](https://amp.thegraph.com)
- **Intro to Amp:** [Full writeup on this blog](/blog/intro-to-amp)
