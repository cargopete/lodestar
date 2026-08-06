---
title: "Intro to Tycho and the Tycho Data Service"
date: "2026-03-26"
author: "cargopete"
tags: ["tycho", "substreams", "data-services", "defi", "horizon"]
category: "Ecosystem"
excerpt: "Tycho indexes DEX liquidity in real time so solvers, market makers, and searchers don't have to. Here's what it is, how it works, and why it's coming to The Graph Network."
---

Every block, thousands of trades happen across dozens of DEX protocols — Uniswap, Curve, Balancer, PancakeSwap, and many more. Each stores liquidity differently, uses different smart contract structures, and updates state in different ways.

If you're a solver figuring out the best route for a trade, a market maker, or an MEV searcher looking for arbitrage, you need to know the state of all this liquidity in real time. Ideally within milliseconds of each new block.

Today, most of these players build their own proprietary indexing pipelines. That's expensive, fragile, and duplicated across the industry. Everyone's solving the same problem independently.

**Tycho is the answer.** Built by [PropellerHeads](https://www.propellerheads.xyz/), Tycho is an open-source system that gives you a unified, real-time view of DEX liquidity across all major protocols. One stream, all venues, sub-150 millisecond latency. Think of it as the Bloomberg terminal for on-chain liquidity.

## Who uses Tycho?

These aren't hobbyist developers. The target users are:

- **Intent solvers** (CoW Protocol and others): routing trades across fragmented liquidity
- **DEX aggregator backends** (Matcha, Paraswap): finding optimal swap paths
- **Market makers** (Wintermute, Jump): maintaining accurate pricing models
- **MEV searchers**: running sub-block simulations to find arbitrage
- **DEX protocol teams**: monitoring their own liquidity in real time

These are billion-dollar operations that pay real money for data infrastructure.

## How Tycho works

Tycho has four layers:

**Tycho Indexer**: the core engine. It consumes blockchain data and tracks the state of every supported DEX pool in real time. It materialises a unified view of all liquidity into a PostgreSQL database.

**Tycho SDK**: the developer toolkit. Applications subscribe to liquidity updates via WebSocket. You get real-time deltas — just the changes, block by block. No polling, no redundant data.

**Simulation layer**: lets you simulate swaps against current pool state without executing on-chain. Critical for solvers who need to evaluate thousands of routes per block.

**Execution layer**: via the Tycho Router smart contracts, actually executes trades on-chain once a route is chosen.

### Two ways to solve

Tycho supports both analytical and numerical solving:

- **Native solving**: access raw state attributes to analytically solve (e.g. every Uniswap v3 tick). Maximum speed, full control.
- **VM solving**: use any DEX through a unified interface without diving into protocol internals. Based on REVM, it handles both state and computation. This is how you integrate complex protocols like Curve without understanding their pool math.

Tycho also comes with executor contracts and encoders to execute the resulting swaps.

### Chain support

Tycho currently supports **Ethereum**, **Base**, and **Unichain**. Arbitrum support is a known gap — there's a Substreams limitation where it only supports Nitro onwards, not Arbitrum Classic.

Both Tycho and Substreams are chain-agnostic by design and will be available for both EVM and non-EVM chains.

## The Substreams connection

This is where it gets interesting for The Graph ecosystem.

Under the hood, Tycho is built on top of **Substreams** — StreamingFast's real-time blockchain data transformation engine. Raw blocks flow through Firehose into Substreams modules. Each DEX protocol gets its own module — one for Uniswap, one for Curve, one for Balancer, and so on. The Tycho Indexer consumes all of these feeds and builds the unified view.

Substreams syncs protocols in hours instead of months, handles re-orgs seamlessly, and provides extremely reliable data processing. It runs geographically distributed nodes that race to provide state updates. Tycho saves these updates in Postgres and streams them directly to clients.

**The catch?** Today, Tycho operators pay StreamingFast directly for Substreams data — completely off-protocol. Tycho is already a real, working Substreams consumer, but it's not going through The Graph Network.

That's exactly what the **Substreams Data Service** aims to change.

## Coming to The Graph Network

The Graph currently serves blockchain data through Subgraphs — structured, queryable data via GraphQL. But there's an entire class of workloads that subgraphs can't serve well: real-time, high-throughput streaming data. The difference between querying a database and drinking from a firehose.

The **Substreams Data Service** — the second data service on The Graph after Subgraphs, built on the Horizon protocol upgrade — brings Substreams onto the network as a first-class, decentralised service. On-chain settlement, decentralised provider discovery, trust-minimised payments.

### Where things stand

- **GraphOps** has developed an open-source version of the Tycho Indexer and has been running the full stack independently for several months — this is real infrastructure, not a demo
- **Private beta** is imminent, with first external users being onboarded with white-glove support
- **Broader go-to-market** is planned for end of Q2 2026 with self-service sign-up
- **Longer term**, the ambition is to bring Tycho onto The Graph Network proper, where Indexers can serve Tycho data and earn from it

GraphOps has a fascinating dual role in this picture: they'd be both a **consumer** — paying for Substreams data from StreamingFast — and a **provider** — serving processed Tycho data to solvers. Two revenue streams on one data pipeline.

## Why this matters

**For The Graph:** Tycho is the flagship proof point for the Substreams Data Service. If Tycho can consume Substreams via the network and pay for it on-chain, the entire multi-service vision of Horizon is validated.

**For indexers:** This opens a new revenue stream. Serving Tycho data to professional trading operations — organisations that pay real money for data infrastructure.

**For DeFi:** A single, open-source liquidity index means better price execution for end users. Less fragmentation, more competition among solvers, and cheaper trades.

**Historical data opportunity:** Tycho currently only keeps one to two weeks of state. There's an identified workstream to stream Tycho data into an OLAP database for historical analytics — think "Dune for DEX liquidity." Historical pool states, liquidity trends, trading volume analysis. An entirely separate product.

## Getting started with Tycho

Tycho is live today. If you're a solver or searcher looking to integrate more DEXs:

- **Docs & quickstart:** check the [Tycho documentation](https://docs.propellerheads.xyz/tycho/) to set up your stream
- **DEX integrations:** submit a PR to [Tycho Protocol Integrations](https://github.com/propeller-heads/tycho-protocol-sdk) on GitHub to get your protocol supported
- **Follow development:** [@PropellerSwap](https://x.com/PropellerSwap) on X

## FAQ

**How does Tycho compare to parsing logs yourself?**
Tycho provides parsed, structured data with a unified interface across protocols, manages reorgs automatically, can handle protocols that don't emit logs (shadow logs), and saves you the infrastructure cost of running a node.

**How are reorgs handled?**
Automatically through the delta system. The client maintains the correct state without you having to worry about block reorganisations.

**What about latency?**
Tycho processes updates in under 100ms (plus network latency). Geographically distributed nodes race to provide data, which can actually be faster than relying on a single node.

**Can I keep my own UniV2/V3 implementations?**
Yes. Many teams use Tycho VM solving for newer or complex protocols while keeping their analytical implementations for simpler pools.

**What about UniV4 hooks?**
The VM implementation aims to support as many hook variants as possible.
