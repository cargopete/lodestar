---
title: "How Much RAM Does It Actually Take to Index 1,000 Subgraphs?"
date: "2026-04-07"
author: "cargopete"
tags: ["infrastructure", "graph-node", "indexers", "memory", "guide"]
category: "Guides"
excerpt: "The Graph's 184 GB 'Large' tier was written four years ago for a few hundred subgraphs. Here's what the memory math actually looks like for 1,000 — and what it would take to index all 15,500."
---

The Graph's official hardware documentation lists a "Large" tier with 184 GB of VM RAM, described as sufficient for "all currently used subgraphs." Indexers planning to run at scale often treat this as their north star. They shouldn't — that spec is roughly four years old, written when the network had a fraction of today's subgraphs, and it was never designed for the kind of targeted, high-count deployments operators are building today.

Here's what the memory math actually looks like for 1,000 subgraphs in 2026.

---

## The 184 GB Figure Is a Relic

The official hardware tier table looks like this:

| Tier | VM RAM | PostgreSQL RAM | Target workload |
|------|--------|----------------|-----------------|
| Small | 16 GB | 8 GB | Several subgraphs |
| Standard | 48 GB | 30 GB | Default/reference |
| Medium | 64 GB | 64 GB | 100 subgraphs, 200–500 req/s |
| Large | **184 GB** | **468 GB** | "All currently used subgraphs" |

The Graph Academy notes the table was "last updated 4 years ago." When it was written, the network had somewhere in the low hundreds of active subgraphs. By Q4 2025, that number had grown to **15,539** — roughly 50–100× the original frame of reference. The "all currently used subgraphs" claim is nonsense by any current reading.

The jump from Medium (64 GB, 100 subgraphs) to Large (184 GB, "all") is only a **2.9× increase**. If that scaling were linear, the Large tier was written for somewhere around 300–400 subgraphs at most. For 15,000+, you'd need an entirely different conversation.

For a **targeted 1,000-subgraph deployment**, however, the 184 GB figure happens to be in the right ballpark — just overly generous. The real answer is 64–128 GB of VM RAM, with 184 GB providing comfortable headroom for spiky workloads.

---

## Where the Memory Actually Goes

The indexer stack has four main components running on the VM (PostgreSQL lives separately): **graph-node**, **indexer-agent**, **indexer-service-rs**, and **TAP agent**. Of these, graph-node dominates — everything else is nearly a rounding error.

### Graph-Node: The Memory Hog

Graph-node's footprint is built from several distinct pools:

**Entity cache** — The default is 10 MB per subgraph (`GRAPH_ENTITY_CACHE_SIZE=10000` KB). Multiply by 1,000 subgraphs and you're at **~10 GB before anything else loads**. This is the single biggest tunable lever at scale.

**WASM runtimes** — Each subgraph instantiates a WASM runtime with a 512 KiB max stack, plus the module's linear memory. Call it **0.5–2 MB per subgraph**, or ~0.5–2 GB across 1,000.

**Write batch buffers** — Actively syncing subgraphs accumulate up to 10 MB of changes before flushing to the database. If 100 of your 1,000 subgraphs are catching up simultaneously, that's another ~1 GB.

**Query cache** — Shared across all subgraphs, defaulting to ~2 GB allocated (2× `GRAPH_QUERY_CACHE_MAX_MEM`). Production operators report actual consumption reaching **3× the configured value**. Set it to 2 GB, expect up to 6 GB in practice.

**Block cache** — Recently processed blocks near chain head: ~1–2 GB shared.

**Connection pool** — Each database connection costs ~5–10 MB on both graph-node and PostgreSQL sides. Default is 10 connections; production setups commonly run 50–100+.

**Base overhead** — Process baseline, internal data structures, and Rust allocator fragmentation in a long-running process: ~2–4 GB. The fragmentation piece is real — RSS can run 20–40% above theoretical allocation after extended uptime.

Summed for 1,000 subgraphs under typical conditions:

| Memory consumer | Estimated usage |
|----------------|----------------|
| Entity caches (10 MB × 1,000) | ~10 GB |
| WASM runtimes (~1 MB × 1,000) | ~1 GB |
| Write batch buffers (~100 active) | ~1 GB |
| Query cache (shared) | 2–6 GB |
| Block cache (shared) | 1–2 GB |
| Connection pool | 0.5–1 GB |
| Base process + allocator overhead | 2–4 GB |
| **Graph-node total** | **~18–26 GB baseline** |

That baseline assumes average-complexity subgraphs — moderate data sources, no IPFS heavy lifting. **Heavy subgraphs** (Uniswap V2/V3, active NFT marketplaces, DeFi protocols with thousands of dynamic data sources) can consume **100–500+ MB each**. A realistic production mix where 10–20% of your 1,000 subgraphs are heavyweight pushes graph-node to **40–80 GB**.

### Everything Else Is Quiet by Comparison

- **Indexer-agent** (Node.js): 500 MB–2 GB
- **Indexer-service-rs** (Rust, rewritten from TypeScript): 100–500 MB
- **TAP agent** (Rust): 100–300 MB

Combined: roughly **1–3 GB**. Negligible relative to graph-node and entirely irrelevant relative to PostgreSQL.

---

## What Real Operators Actually Report

No public case study documents a single indexer running 1,000+ subgraphs on one machine. The largest community-documented deployment is a **~30-subgraph setup on AWS** that used **96 GB across three VM nodes** (3 × r6g.xlarge at 32 GB each) plus **64 GB for Aurora PostgreSQL** — ~160 GB total for 30 subgraphs, at ~$7,130/month.

A production Kubernetes deployment documented by Vinta allocated 1 GB per index node container and 8 GB per query node container, with a key observation: *"indexing subgraphs doesn't require too much CPU and memory resources, but serving queries does, especially when you enable GraphQL caching."* Query serving — not indexing — is the primary memory driver above the entity-cache baseline.

The StakeSquid mainnet guide summarises the scaling reality plainly: *"More CPUs, more RAM, faster disks. There is never enough."*

---

## The Configuration Levers That Matter Most

Graph-node exposes dozens of environment variables. For a 1,000-subgraph deployment, these have the highest impact:

**`GRAPH_ENTITY_CACHE_SIZE`** — The single most impactful variable. Default is 10,000 KB (10 MB) per subgraph. Halving it to 5,000 KB saves ~5 GB across 1,000 subgraphs at the cost of slightly more frequent database writes. Worth tuning first.

Production operators indexing heavy subgraphs commonly run `GRAPH_ENTITY_CACHE_SIZE=100000` (100 MB) — 10× the default. At that setting, entity caches alone account for ~170 GB at 1,700 subgraphs. Two independent real-world data points from active indexers confirm this: one operator reported 500 GB of index-node RAM for 1,700 subgraphs (~294 MB/subgraph); another reported 240 GB for 700 subgraphs (~343 MB/subgraph). Both are consistent with 100 MB entity caches plus runtime overhead. The estimates in this post assume default cache settings; if you're targeting performance on heavy subgraphs, budget ~300–350 MB per subgraph instead.

**`GRAPH_QUERY_CACHE_MAX_MEM`** — Default 1,000 MB, but actual memory is 2× this by design and can reach 3× in practice. Set conservatively on index nodes (or disable entirely), more aggressively on dedicated query nodes.

**`GRAPH_GRAPHQL_ERROR_RESULT_SIZE`** — Not set by default, meaning a single badly-formed query can trigger an OOM. Set this. It costs nothing.

**`GRAPH_MAX_IPFS_MAP_FILE_SIZE`** — Default 256 MB. Controls in-memory accumulation during `ipfs.map` calls. Lower this to reduce spike risk on IPFS-heavy subgraphs.

**`STORE_CONNECTION_POOL_SIZE`** — Keep small (2–5) on index nodes, larger (50–100) on query nodes. Each connection costs memory on both sides of the wire.

**`GRAPH_ETHEREUM_TARGET_TRIGGERS_PER_BLOCK_RANGE`** — Default 100. Values too high cause "excessive memory usage" per the official documentation. Worth watching if you're indexing high-density chains.

**`GRAPH_CACHED_SUBGRAPH_IDS`** — Defaults to `*` (everything). On a 1,000-subgraph deployment, restricting this to high-traffic subgraphs prevents the query cache from wasting space on rarely-queried deployments.

---

## The Architecture That Makes 1,000 Subgraphs Viable

One monolithic graph-node instance handling 1,000 subgraphs is the wrong shape. The practical architecture for this scale:

- **5–10 dedicated index nodes**, each handling 100–200 subgraphs, at 16–32 GB RAM each. Distributes entity caches and processing load, eliminates single points of failure.
- **2–3 dedicated query nodes** with aggressive query caching, tuned connection pools, and `GRAPH_CACHED_SUBGRAPH_IDS` restricted to high-traffic deployments.
- **`config.toml` deployment rules** assigning subgraphs to specific node IDs via regex patterns, with database sharding (`[store.vip]`, `[store.general]`) to keep hot subgraph data in PostgreSQL's buffer cache.

With this layout, each graph-node instance handles a manageable entity cache footprint (1,000–3,000 MB for 100–200 subgraphs at default settings) and query memory is concentrated where it matters.

---

## The Real Constraint: PostgreSQL

The 184 GB VM figure gets all the attention, but the Large tier also specifies **468 GB of PostgreSQL RAM**. For 1,000 subgraphs, that number is actually the binding constraint — not the VMs.

A reasonable PostgreSQL allocation for 1,000 subgraphs starts at **128–256 GB**, with the actual requirement driven by how many subgraphs are actively queried, how large their entity sets are, and how much of the working set you want to keep in `shared_buffers` and the OS page cache.

If you're capacity planning for 1,000 subgraphs, spend as much time on your PostgreSQL sizing and shard design as you do on your VM RAM. The VMs are the easier problem.

---

## So How Much RAM to Index *All* Subgraphs?

Nobody knows exactly — and that's the honest answer. "All currently used subgraphs" isn't a fixed target, and no public operator data exists for anything close to 15,500 subgraphs on a single stack. But the math from first principles is instructive.

**Not all 15,500 subgraphs are equally alive.** Industry estimates put the active-to-dormant split at roughly 20–30% meaningfully active, with the rest deployed but cold. That's approximately 4,000 subgraphs serving real query traffic and ~11,500 that are kept current but rarely touched. Cold subgraphs still need to be indexed — you can't skip them — but their entity cache can be tuned down aggressively without meaningfully harming latency for the handful of queries they do receive.

Working through the entity cache math with two pools:

| Pool | Count | Per-subgraph cache | Total |
|------|-------|--------------------|-------|
| Active (full cache) | 4,000 | 30 MB | ~120 GB |
| Dormant (minimal cache) | 11,500 | 5 MB | ~58 GB |
| Shared caches, runtimes, overhead | — | — | ~20 GB |
| **VM RAM total** | | | **~200 GB** |

That puts the VM RAM estimate at roughly **200–400 GB**, distributed across **10–20 graph-node instances**. The wide range accounts for subgraph complexity variance — a network skewed toward heavy DeFi subgraphs lands at the top end; a mix of simpler subgraphs sits closer to 200 GB.

Here's the irony: **184 GB is not an unreasonable VM RAM floor for a well-tuned cluster indexing the full network.** The original spec isn't wildly off on that single dimension. What it gets catastrophically wrong is the framing — treating it as a single-machine spec, and burying the real problem.

**The Postgres side is where it truly falls apart.** Keeping the working set of 15,500 subgraphs reasonably hot requires somewhere in the range of **2–4 TB of database RAM**. The official 468 GB PostgreSQL figure, which already dwarfs the VM allocation, is itself badly undersized for the current network. Two terabytes of Postgres memory isn't a server upgrade. It's a cluster design conversation.

In practice, **nobody runs all subgraphs**. The realistic architecture at this scale shards graph-node across dozens of instances, each handling a manageable slice, with no individual box expected to hold the whole network. The docs framing it as a single hardware tier is the fiction — useful as a rough cluster aggregate, misleading as anything else.

---

## Summary

| Question | Answer |
|----------|--------|
| Is the 184 GB Large tier designed for 1,000 subgraphs? | No — it was written for ~300–400 subgraphs circa 2021 |
| Is 184 GB sufficient for 1,000 subgraphs? | Yes, with comfortable headroom |
| What's the realistic range for 1,000 subgraphs? | 64–128 GB VM RAM under typical conditions |
| What does graph-node actually use per subgraph? | ~30–50 MB amortised (entity cache dominates) |
| What's the actual binding constraint? | PostgreSQL — 128–256 GB is a grounded starting point |
| What's the most impactful config to tune? | `GRAPH_ENTITY_CACHE_SIZE` — saves ~1 GB per 100 subgraphs at half the default |
| How much to index *all* 15,500 subgraphs? | ~200–400 GB VM RAM across 10–20 instances; 2–4 TB Postgres — not one machine |
| Is the 184 GB figure salvageable at all? | As a cluster aggregate VM floor for the full network, roughly. As a single-node spec, no. |

The 184 GB figure isn't wrong for 1,000 subgraphs — it's just stale, misleadingly labelled, and guaranteed to give you the wrong intuition about where the money and memory should actually go.
