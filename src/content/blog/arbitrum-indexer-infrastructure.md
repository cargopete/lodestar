---
title: "Arbitrum Indexer Infrastructure: Smaller Archives & Fixing Sync Lag"
date: "2026-04-06"
author: "cargopete"
tags: ["infrastructure", "arbitrum", "graph-node", "indexers", "guide"]
category: "Guides"
excerpt: "Two problems, one post: the new PathDB/PebbleDB archive node that cuts disk from 38TB to 4TB, and the two graph-node settings that stop your subgraphs sitting 10–30 blocks behind chain head forever."
---

Two problems that came up in the indexer Discord this week, both worth a proper write-up.

First: the old Arbitrum archive node approach had become genuinely unmanageable — nodes ballooning to 38TB, official snapshots abandoned since May 2024. There's a new approach (PathDB + PebbleDB) that cuts the footprint to ~4TB with continuous online pruning.

Second: even with a healthy archive node, subgraphs on BSC and other fast chains tend to sit 10–30 blocks behind chain head indefinitely. The fix is two graph-node config values that almost nobody touches.

They're connected — a leaner node with less maintenance overhead makes the sync tuning matter more. So here's both.

---

## Part 1: The Smaller Arbitrum Archive Node

### What changed

The old archive approach used LevelDB with a hash-based state scheme (HashDB). Nodes grew ~850GB per month and required offline pruning with large amounts of temporary free disk. By mid-2024, archive nodes had blown past 9.7TB at setup and were heading toward 38TB after a year. Offchain Labs stopped updating the official archive snapshot in May 2024 because it had become unmanageable.

The new approach uses two things together:

- **PebbleDB** — a newer key-value store (developed by CockroachDB) replacing LevelDB. Faster write performance, better compaction. Default for all new Nitro databases since v3.1.0.
- **PathDB** — a path-based state trie scheme replacing HashDB. The key property: continuous online pruning with no offline maintenance windows.

Combined (archive-path mode), the disk footprint for Arbitrum One archive sits at approximately **4TB** — and stays there, rather than growing indefinitely.

### Disk comparison

| Config | Approx. size |
|---|---|
| Old archive (HashDB/LevelDB) | ~9.7TB at setup, growing ~850GB/month |
| New archive-path (PathDB/PebbleDB) | ~4TB, stable |
| Full node / pruned (PathDB/PebbleDB) | ~1.4TB |

For graph-node indexing you need the archive node — full/pruned nodes will fail on historical `eth_call` requests.

### Before you start

- **Nitro >= v3.9.x** required. Earlier versions had PathDB performance issues on fast chains that are resolved in v3.9.x.
- PathDB and HashDB snapshots are not cross-compatible. Existing HashDB nodes cannot hot-swap a PathDB snapshot.
- For archive nodes, converting an existing node (LevelDB/HashDB → PebbleDB/PathDB) is often more painful than starting fresh from the new snapshot. The `dbconv` tool exists but is primarily designed for full/pruned nodes.

### Setup

```bash
docker run --rm -it \
  -v /data/arbitrum:/home/user/.arbitrum \
  -p 0.0.0.0:8547:8547 \
  -p 0.0.0.0:8548:8548 \
  offchainlabs/nitro-node:v3.9.7-75e084e \
  --parent-chain.connection.url https://YOUR_L1_RPC:8545 \
  --chain.id=42161 \
  --http.api=net,web3,eth,debug \
  --http.corsdomain=* \
  --http.addr=0.0.0.0 \
  --http.vhosts=* \
  --execution.caching.archive \
  --execution.caching.state-scheme=path \
  --init.latest=archive
```

The three flags that matter:

| Flag | What it does |
|---|---|
| `--execution.caching.archive` | Retains all historical state (archive mode) |
| `--execution.caching.state-scheme=path` | Switches from HashDB to PathDB — enables continuous online pruning |
| `--init.latest=archive` | Downloads the current official archive snapshot on first boot |

PebbleDB is now the default for new databases — you don't need `--persistent.db-engine=pebble` unless you want to be explicit.

Official snapshots: [snapshot-explorer.arbitrum.io](https://snapshot-explorer.arbitrum.io/). Or use `--init.latest=archive` to pull the current one automatically.

### The pruning question

inflex asked in the same thread: fully pruned (128 blocks) vs full archive — is there anything in between?

Yes. The short version:

- **Fully pruned (128 blocks)**: fine for stable long-running subgraphs on chains with shallow reorgs. Risky if you frequently reassign deployments or have node downtime gaps.
- **Partial archive (a few thousand blocks)**: sweet spot for most indexers. Enough buffer to recover from outages without full archive storage costs.
- **Full archive**: required for subgraphs indexing from genesis or making historical `eth_call`s.

The rule of thumb (courtesy of mindstyle): keep enough history to survive outages and catch up after one. Your pruning depth should be comfortably larger than your `reorg_threshold` (more on that below) plus however long you might be offline.

### On the horizon: Erigon Nitro (likely abandoned)

Erigon Nitro was a port of the Erigon client to the Arbitrum Nitro stack that showed impressive numbers on Sepolia testnet — ~713GB archive, a 94% reduction. However, as of April 2026 the Arbitrum team appears to have stopped work on it (per Johnathan at Pinax). It never reached Arbitrum One mainnet and at this point probably won't. Archive-path with PathDB/PebbleDB is the practical choice for the foreseeable future.

---

## Part 2: Why Your Subgraphs Are Always 10–30 Blocks Behind

### The symptom

Your archive node is at chain head. Your RPC latency is fine. Your Postgres isn't sweating. And yet every subgraph you run sits 10–30 blocks behind — stubborn, not catching up, not alerting. Just quietly lagging.

Tehn observed this exactly on BSC: archive node tracking chain head fine, subgraphs perpetually behind. Hau at Pinax confirmed they see the same. It's not a node problem. It's the sync engine's conservatism meeting a fast chain.

### How graph-node's sync engine actually works

Maks (Graph Protocol core) explained it cleanly:

> *"You can try lowering the polling_interval and the reorg_threshold. When subgraph head is > reorg_threshold behind it will scan block ranges, when < reorg_threshold behind it will walk blocks one by one, and when at chain head it will idle until the ingestor stores new blocks."*

Three modes:

**Range scan** (far behind): graph-node batches block lookups, fetches chunks at once. Fast. This is how initial syncs go quickly.

**Block-walk** (close but not at head): once within `reorg_threshold` blocks of chain head, graph-node switches to walking blocks one at a time. Slower by design — it's watching carefully for reorgs.

**Idle** (at head): waits for the ingestor to store the next block, then processes it immediately.

The problem: if `reorg_threshold` is set too high — say 250 blocks — you're stuck in block-walk mode on fast chains almost permanently. Never far enough behind to use range-scan, never close enough to reach idle. You just lag.

**Important caveat**: lowering the threshold only helps if your lag is *greater than* the threshold. If you're already sitting 10–30 blocks behind with `reorg_threshold=50`, you're already in block-walk mode — lowering to 50 won't change anything because 10–30 < 50. In that case the bottleneck is block-walk throughput itself, not the threshold (more on this below).

### Why BSC in particular

BSC produces a block every ~3 seconds. Even in block-walk mode, your subgraph needs to process each block in under ~3 seconds to keep up. If your mappings are doing `eth_call`s, writing lots of entities, or your Postgres is under load, you'll accumulate lag faster than you can drain it. High throughput (many transactions per block, large event logs) compounds this.

Tehn tested `polling_interval=300ms` and `ETHEREUM_REORG_THRESHOLD=50` on BSC — neither closed the lag because his subgraphs were already within the threshold. The sync engine was already in block-walk mode. The bottleneck was elsewhere.

### The threshold fix (when it applies)

In your `config.toml`:

```toml
[chains.bsc]
polling_interval = 300     # milliseconds between block polls (default ~500-1000)
reorg_threshold = 50       # blocks; below this, walk one-by-one vs scan ranges
```

This helps when you're lagging *more than* `reorg_threshold` blocks and stuck in range-scan/block-walk transition. BSC's actual reorg depth is almost never more than 5–10 blocks, so 250 is wildly conservative.

Sensible values by chain:

| Chain | Reorg depth | Suggested threshold |
|---|---|---|
| BSC | Very shallow (< 10) | 30–50 |
| Polygon | Very shallow | 30–50 |
| Avalanche | Shallow | 50 |
| Arbitrum | Near-instant finality | 20–30 |
| Ethereum mainnet | Occasional deep reorgs | 100 |

### When you're already in block-walk and still lagging

If your lag is 10–30 blocks and threshold changes do nothing, the problem is that block-walk itself is too slow to keep pace. Things to investigate:

**`eth_call`s in mappings** — every `eth_call` in a subgraph handler is a synchronous RPC call made during indexing. On BSC with 3s blocks, a handful of slow `eth_call`s per block will guarantee lag. Check whether the subgraphs you're running make heavy use of `eth_call` in their handlers. This is the most common culprit.

**RPC provider latency** — `eth_call` performance is entirely dependent on your RPC node's response time. A slow or overloaded provider adds directly to per-block processing time. If you're on a shared public endpoint, this is likely the issue.

**eth_call cache** — graph-node has a built-in `eth_call` cache. Verify it's enabled and sized appropriately:
```toml
[store.primary]
# ... your DB config

[general]
query_store_connection_pool_size = 10

[deployment]
# Increase if indexing many subgraphs simultaneously
```
The relevant env var is `GRAPH_ETHEREUM_CALL_CACHE_FULL_TRIES`. Check the graph-node docs for current defaults.

**Firehose** — the proper long-term solution for fast chains. Firehose streams pre-decoded block data via gRPC, eliminating the polling loop and JSON-RPC overhead entirely. Providers: Pinax, StreamingFast. If you're running high-value subgraphs on BSC at scale, Firehose is worth the setup cost.

**Profiling graph-node** — Tehn noted that graph-node's profiling tooling is hard to activate in practice. The most useful observable signal is the `subgraph_query_execution_time` and indexing metrics in Prometheus if you have it configured. Failing that, debug-level logs will show per-block timing.

### Debugging checklist

1. **Is your lag > reorg_threshold?** — If yes, lower the threshold. If no (lag < threshold), skip to step 3.
2. **Check polling_interval** — halve it, observe whether lag closes.
3. **Check your ingestor node** — confirm exactly one node ingests the chain. See [Rule 1 in the stack architecture post](/blog/graph-node-stack-architecture).
4. **Count eth_calls in your subgraph handlers** — open the subgraph manifest and look for `eth_call`s in mappings. Each one is a synchronous RPC roundtrip per occurrence per block.
5. **Benchmark your RPC** — a simple `eth_call` latency test against your provider. If you're getting > 200ms responses, that's your lag multiplied by every block.
6. **Consider Firehose** — if the subgraphs are long-running and mission-critical, the polling approach has a ceiling on fast chains.

### Why the defaults don't fit

The defaults were designed for Ethereum mainnet (12-second blocks, occasional deep reorgs). They haven't always been updated for the high-throughput EVM chains added since. Tuning these is expected — but config tuning has limits. On a chain with 3s blocks, the real ceiling is mapping execution time, not polling frequency.

---

## Putting it together

The two parts connect:

- PathDB/PebbleDB gives you a sustainable Arbitrum archive node that won't eat your disk and doesn't need offline maintenance windows that would push your subgraphs further behind.
- Tuned `reorg_threshold` and `polling_interval` means your subgraphs actually stay at chain head once the node is healthy.

Neither fix is glamorous. Both are genuinely useful.

---

*Thanks to Marc-André (Ellipfra) for flagging the new archive snapshot format, and to Maks, Hau (Pinax), and mindstyle for the graph-node insight. Most of this came out of a single Discord thread.*

**Further reading:**
- [How to run an archive node — Arbitrum Docs](https://docs.arbitrum.io/run-arbitrum-node/more-types/run-archive-node)
- [Nitro database snapshots — Arbitrum Docs](https://docs.arbitrum.io/run-arbitrum-node/nitro/nitro-database-snapshots)
- [LevelDB to PebbleDB migration — Arbitrum Docs](https://docs.arbitrum.io/run-arbitrum-node/nitro/how-to-convert-databases-from-leveldb-to-pebble)
