---
title: "Arbitrum Indexer Infrastructure: Smaller Archives & Fixing Sync Lag"
date: "2026-04-06"
author: "cargopete"
tags: ["infrastructure", "arbitrum", "graph-node", "indexers", "guide"]
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

### On the horizon: Erigon Nitro

There's a second effort worth watching: Erigon Nitro, a port of the Erigon client to the Arbitrum Nitro stack. On Arbitrum Sepolia testnet it achieves archive storage of ~713GB — a 94% reduction versus the old 12TB+ archive. If that holds for mainnet it would be transformative. But it's **alpha and Sepolia-only** for now. Watch [github.com/erigontech/nitro-erigon](https://github.com/erigontech/nitro-erigon).

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

### Why BSC in particular

BSC produces a block every ~3 seconds. With a default `reorg_threshold` of 250 blocks, that's 12.5 minutes of "close to head" window where graph-node is walking blocks one by one. If your polling interval is 500ms but subgraph mappings take 200ms each, you're burning time. High throughput (many transactions, large logs) compounds this.

### The fix

In your `config.toml`:

```toml
[chains.bsc]
polling_interval = 300     # milliseconds between block polls (default ~500-1000)
reorg_threshold = 50       # blocks; below this, walk one-by-one vs scan ranges
```

**polling_interval**: controls how often the ingestor checks for a new block. On fast chains, bring this down to 200–300ms so new blocks hit the cache sooner.

**reorg_threshold**: the more impactful setting. BSC's reorg depth is almost never more than 5–10 blocks. Running 250 is wildly conservative. Dropping to 30–50 means you exit block-walk mode when 30–50 blocks behind (not 250), and reach chain head faster.

Sensible values by chain:

| Chain | Reorg depth | Suggested threshold |
|---|---|---|
| BSC | Very shallow (< 10) | 30–50 |
| Polygon | Very shallow | 30–50 |
| Avalanche | Shallow | 50 |
| Arbitrum | Near-instant finality | 20–30 |
| Ethereum mainnet | Occasional deep reorgs | 100 |

### Debugging checklist

1. **Check reorg_threshold** — if it's above 100 on BSC/Polygon/Avalanche, drop it to 30–50.
2. **Check polling_interval** — try halving it and watch whether the lag closes.
3. **Check your ingestor node** — confirm exactly one node has block ingestion enabled for the chain. See [Rule 1 in the stack architecture post](/blog/graph-node-stack-architecture).
4. **Check per-block mapping time** — if individual subgraph handlers are slow (complex logic, heavy eth_calls), no config tuning will help. Profile the handler.
5. **Check the block cache** — if your ingestor is itself behind chain head, fix that first.

### Why the defaults don't fit

The defaults were designed for Ethereum mainnet (12-second blocks, occasional deep reorgs). They haven't always been updated for the high-throughput EVM chains added since. Tuning these is expected. The defaults are a starting point.

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
