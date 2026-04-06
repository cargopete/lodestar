---
title: "The Smaller Arbitrum Archive Node: PathDB + PebbleDB Setup Guide"
date: "2026-04-06"
author: "cargopete"
tags: ["infrastructure", "arbitrum", "indexers", "guide", "archive-node"]
excerpt: "The old Arbitrum archive snapshot stopped being updated in May 2024 because nodes were ballooning to 38TB. The new archive-path approach cuts that to ~4TB with continuous online pruning. Here's exactly how to set one up."
---

Marc-André (Ellipfra) flagged it in the indexer Discord: there's a new Arbitrum archive snapshot format that's "ridiculously smaller." He's right — and it's worth understanding what changed, because the improvement is substantial and the setup is non-obvious.

## What changed

The old Arbitrum archive approach used LevelDB with a hash-based state scheme (HashDB). Nodes grew aggressively — ~850GB per month — and required offline pruning with large amounts of temporary free disk to do it. By mid-2024, archive nodes had ballooned past 9.7TB at setup and were heading toward 38TB after a year of operation. Offchain Labs stopped updating the official archive snapshot in May 2024 because it had become unmanageable.

The new approach uses two things together:

- **PebbleDB** — a newer key-value store (developed by CockroachDB) that replaces LevelDB. Faster write performance, better compaction. Default for all new Nitro databases since v3.1.0.
- **PathDB** — a path-based state trie scheme that replaces HashDB. The key property: PathDB supports continuous online pruning. Your node prunes state as it runs, with no offline maintenance windows.

Combined (archive-path mode), the disk footprint for a full Arbitrum One archive node is approximately **4TB** — versus the old approach's 9.7TB-at-start-and-climbing. And it stays there, rather than growing indefinitely.

This is what Marc-André meant by "ridiculously smaller." It's not a marginal improvement.

## Before you start

- **Nitro >= v3.9.x** is required. Earlier versions had PathDB performance issues on fast chains. As of v3.9.x these are resolved and archive-path is the official recommendation.
- PathDB and HashDB snapshots are not cross-compatible. If you have an existing HashDB archive node, you cannot hot-swap a PathDB snapshot into it.
- Converting an existing node (LevelDB/HashDB → PebbleDB/PathDB) requires a full resync. It's usually faster to start fresh from the new snapshot.

## Snapshot

Official snapshots are available at the [Arbitrum Snapshot Explorer](https://snapshot-explorer.arbitrum.io/). The archive-path snapshot for Arbitrum One is listed there.

To have Nitro download and initialise from the latest archive snapshot automatically, use `--init.latest=archive`. This is the simplest option and pulls the current official snapshot on first run without you having to find the URL manually.

For a specific URL, use `--init.url=<url>` instead.

## Setup

Minimum viable Docker command for an Arbitrum One archive-path node:

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
| `--execution.caching.archive` | Retains all historical state (makes this an archive node, not a full/pruned node) |
| `--execution.caching.state-scheme=path` | Switches from HashDB to PathDB — enables continuous online pruning |
| `--init.latest=archive` | Downloads the current official archive snapshot on first boot |

PebbleDB is now the default for new databases — you don't need to set `--persistent.db-engine=pebble` explicitly unless you want to be deliberate about it.

For graph-node's `/status` endpoint, you'll also want `--http.api=net,web3,eth,debug` to cover all the RPC methods graph-node calls.

## Disk requirements

| Config | Approx. size |
|---|---|
| Old archive (HashDB/LevelDB) | ~9.7TB at setup, growing ~850GB/month |
| New archive-path (PathDB/PebbleDB) | ~4TB, stable with continuous pruning |
| Full node / pruned (PathDB/PebbleDB) | ~1.4TB |

For graph-node indexing you need the archive node. Full/pruned nodes will fail on historical `eth_call` requests.

## Converting an existing node

If you have a running HashDB node you want to migrate, Offchain Labs provides a `dbconv` tool and a `convert-databases.bash` script inside the Docker image. However, for archive nodes the honest advice is: it's usually less painful to provision a new volume, start fresh from the PathDB snapshot, and cut over once synced. The conversion tooling is designed primarily for full/pruned nodes where the database is smaller.

Full migration docs: [docs.arbitrum.io/run-arbitrum-node/nitro/how-to-convert-databases-from-leveldb-to-pebble](https://docs.arbitrum.io/run-arbitrum-node/nitro/how-to-convert-databases-from-leveldb-to-pebble)

## The Erigon Nitro option (not yet for mainnet)

There's a second effort worth knowing about: Erigon Nitro, a port of the Erigon client to the Arbitrum Nitro stack. On Arbitrum Sepolia testnet it achieves archive storage of ~713GB — a 94% reduction versus the old 12TB+ archive. If that holds for mainnet it would be transformative.

However, Erigon Nitro is currently **alpha and Sepolia testnet only**. It is not yet available for Arbitrum One mainnet. Watch [github.com/erigontech/nitro-erigon](https://github.com/erigontech/nitro-erigon) for mainnet readiness.

For now, archive-path with PathDB/PebbleDB is the practical choice for mainnet Arbitrum archive nodes.

## What this means for subgraph sync lag

Running an archive-path node doesn't directly change your subgraph's proximity to chain head — that's a graph-node config question (`reorg_threshold`, `polling_interval` — see [the sync lag post](/blog/subgraph-sync-lag-debugging)). But it does mean:

1. You can actually run a sustainable Arbitrum archive node without it eating your disk alive
2. Online pruning means no maintenance windows where your node is offline and your subgraphs fall behind

The two posts together cover the full picture: get the node running cheaply, then tune graph-node to keep subgraphs at head.

## References

- [How to run an archive node — Arbitrum Docs](https://docs.arbitrum.io/run-arbitrum-node/more-types/run-archive-node)
- [Nitro database snapshots — Arbitrum Docs](https://docs.arbitrum.io/run-arbitrum-node/nitro/nitro-database-snapshots)
- [How to convert databases from LevelDB to PebbleDB — Arbitrum Docs](https://docs.arbitrum.io/run-arbitrum-node/nitro/how-to-convert-databases-from-leveldb-to-pebble)
- [Arbitrum Snapshot Explorer](https://snapshot-explorer.arbitrum.io/)
- [Introducing Erigon Nitro for Arbitrum Sepolia — HackMD](https://hackmd.io/@erigon/HJXJ0lkqgx)

---

*Thanks to Marc-André (Ellipfra) for flagging this in the indexer channel. The old archive node situation had become genuinely untenable — good that there's now a sane path forward.*
