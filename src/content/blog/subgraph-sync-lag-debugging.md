---
title: "Why Your Subgraphs Are Always 10–30 Blocks Behind (And How to Fix It)"
date: "2026-04-06"
author: "cargopete"
tags: ["infrastructure", "graph-node", "indexers", "guide", "bsc", "debugging"]
excerpt: "Your archive node is healthy, your RPC is fast — and your subgraphs still lag 10–30 blocks behind chain head. Here's exactly why it happens and what to tune."
---

Your archive node is at chain head. Your RPC latency is fine. Your Postgres isn't sweating. And yet every subgraph you run sits 10–30 blocks behind — stubborn, not catching up, not alerting. Just quietly lagging.

This is one of the more maddening things to debug as an indexer because the usual suspects all check out clean. The fix is almost always two config values you've never touched: `polling_interval` and `reorg_threshold`.

## How graph-node's sync engine actually works

Maks (Graph Protocol core) described this cleanly in the indexer Discord:

> *"You can try lowering the polling_interval and the reorg_threshold. When subgraph head is > reorg_threshold behind it will scan block ranges, when < reorg_threshold behind it will walk blocks one by one, and when at chain head it will idle until the ingestor stores new blocks."*

There are three distinct modes:

**1. Range scan mode** (far behind)

When your subgraph is more than `reorg_threshold` blocks behind chain head, graph-node batches block lookups. It fetches chunks of blocks at once, which is fast. This is how initial syncs go so quickly.

**2. Block-walk mode** (close but not at head)

Once your subgraph gets within `reorg_threshold` blocks of chain head, graph-node switches to walking blocks one at a time. This is slower by design — it's watching carefully for reorgs. This is also the mode that causes the chronic 10–30 block lag.

**3. Idle mode** (at head)

When caught up, the node simply waits for the ingestor to store the next block, then processes it immediately.

The problem: if your `reorg_threshold` is set too high — say 250 blocks — then for any chain with fast block times, you're stuck in block-walk mode almost permanently. You're never far enough behind to use range-scan, and never close enough to reach idle. You just... lag.

## Why BSC is particularly susceptible

BSC produces a block every ~3 seconds. With a default `reorg_threshold` of 250 blocks, that's 12.5 minutes of "close to head" window where graph-node is in slow block-walk mode.

If your polling interval is 500ms but your subgraph mappings take even 200ms each, you're burning time. And because BSC has high throughput — many blocks, many transactions, large logs — the per-block processing time compounds.

Tehn observed this exactly: archive node tracking chain head fine, subgraphs perpetually 10–30 blocks behind. Hau at Pinax confirmed they see the same on BSC. It's not a node problem. It's the sync engine's conservatism meeting a fast chain.

## The two settings to tune

In your `config.toml` (or environment variables), find or add:

```toml
[chains.bsc]
polling_interval = 500     # milliseconds between block polls
reorg_threshold = 50       # blocks; below this, walk one-by-one vs scan ranges
```

**polling_interval** controls how often the ingestor checks for a new block at chain head. The default is typically 500ms–1000ms. On fast chains like BSC, bringing this down to 200–300ms means new blocks hit the cache faster and the subgraph gets unblocked sooner.

**reorg_threshold** is the more impactful setting. BSC's reorg depth is very low — almost never more than 5–10 blocks. Running with a threshold of 250 is wildly conservative. Dropping it to 30–50 means:

- You exit block-walk mode when you're 30–50 blocks behind (not 250)
- You enter range-scan mode (fast) much sooner
- You reach chain head faster and stay there

For mainnet, where reorgs can occasionally be deeper, 100 is more reasonable. For BSC, Polygon, Avalanche — chains with fast finality — 30–50 is safe.

## Pruning vs archive: the separate question

inflex asked in the same thread about Arbitrum: fully pruned (128 blocks) vs full archive. This is a different decision entirely.

The `reorg_threshold` and pruning are related but not the same thing. Pruning limits how far back your node stores full state. If you prune to 128 blocks and your subgraph needs to re-process a block from 500 blocks ago (e.g. after a reorg or reassignment), you'll have a bad time.

mindstyle's guidance holds: keep enough history to survive outages and catch up after one. For most chains, that means:

- **Fully pruned (128 blocks)**: fine for stable, long-running subgraphs on chains with shallow reorgs. Risky if you frequently reassign or have deployment gaps.
- **Partial archive (a few thousand blocks)**: sweet spot for most indexers. Enough buffer to recover, without the storage cost of full archive.
- **Full archive**: required if you run subgraphs that start from genesis or index historical data. Marc-André's tip on pebbledb nitro archive snapshots for Arbitrum is worth investigating — the new format is dramatically smaller than a traditional full archive.

The rule of thumb: your pruning depth should be comfortably larger than your `reorg_threshold` plus however long you might be offline during an outage.

## Practical checklist

If your subgraphs are chronically lagging on a fast chain:

1. **Check your reorg_threshold** — if it's above 100 on BSC/Polygon/Avalanche, drop it to 30–50 and restart the indexer node.
2. **Check your polling_interval** — try halving it and observe whether the lag closes.
3. **Check your ingestor node** — confirm exactly one node has `DISABLE_BLOCK_INGESTOR=false` for the chain (see [Rule 1 from the stack architecture post](/blog/graph-node-stack-architecture)).
4. **Check per-block mapping time** — if individual subgraph mappings are slow (complex handlers, heavy eth_calls), no amount of polling tuning will help. Profile the handler, not the config.
5. **Check the block cache** — if your ingestor is behind chain head, fix that first. The subgraph sync engine can only be as fast as the blocks being stored.

## A note on graph-node's defaults

The defaults were designed for Ethereum mainnet, which has 12-second block times and occasional deep reorgs. They're conservative by necessity. But they haven't always been updated for every chain added since — especially the high-throughput EVM chains where a 250-block reorg threshold is comically overcautious.

There's no shame in tuning these. It's expected. The defaults are a starting point, not a recommendation.

---

*Thanks to Maks, Hau (Pinax), Marc-André (Ellipfra), and mindstyle for the technical detail that fed this post. Most of the insight here came from a single Discord thread — which is exactly why the indexer community is worth paying attention to.*
