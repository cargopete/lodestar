---
title: "Lodestar now serves two panels from its own indexer, not The Graph"
date: "2026-07-18"
author: "cargopete"
tags: ["nuthatch", "the-graph", "indexing", "self-hosting", "arbitrum", "horizon", "gns", "duckdb", "parquet", "rust", "lodestar"]
category: "Infrastructure"
excerpt: "Two of Lodestar's panels — the delegation-activity feed and the developer-activity chart — no longer read from The Graph. They read from nuthatch: a single self-hosted Rust binary indexing the Graph Protocol contracts on Arbitrum directly, serving SQL over content-addressed Parquet, on one small VPS. Here's how it works, how we proved it's correct, and the runtime deadlock we had to root-cause to get there."
---

*Two of Lodestar's panels — the **delegation-activity feed** and the **developer-activity chart** — no longer read from The Graph gateway. They read from **nuthatch**: a single self-hosted Rust binary that indexes the Graph Protocol contracts on Arbitrum One directly and serves the data as SQL over content-addressed Parquet, running on one small VPS. This is the story of the migration — the architecture, the parity methodology, a genuinely nasty runtime deadlock we had to root-cause, and the honest limitations.*

---

## The thing worth owning

A dashboard like Lodestar has two kinds of dependency. There are the ones that are genuinely someone else's job — price feeds, RPC to read chain state, IPFS for metadata. And there's the **event-derived data**: who delegated to whom, which subgraphs got published, how allocations closed. That second category is exactly what an indexer produces, and for most of the ecosystem it means paying a gateway to query a subgraph, or running your own `graph-node` and the Postgres/IPFS/firehose scaffolding around it.

nuthatch's pitch is a third option, and it fits on a bumper sticker: **be your own indexer.** One Rust binary, one command, a live indexed SQL API in under two minutes, with no mandatory third-party data API in the path — ever. No Postgres, no Docker, no IPFS in the default mode. You point it at a contract, it fetches the ABI, generates the decoders, backfills history straight to Parquet past finality, and hands you a read-only SQL endpoint over the result.

The question this post answers is: does that actually work for a real product with users, wrong numbers get noticed within hours, and a maintainer who has better things to do than babysit an indexer? We migrated two panels to find out.

## How a nest works, briefly

A nuthatch **nest** is just config plus vendored ABIs. `nuthatch init 0xAddr --chain arbitrum-one` resolves the ABI (Sourcify first, then Etherscan-class), writes a `nuthatch.toml`, and scaffolds the decoded schema. Every event in the ABI becomes a queryable table named `<alias>__<event>`. From there:

- **Ingestion** pulls logs with aggressive `eth_getLogs` batching.
- **Decode** is deterministic Rust, keyed by `topic0` — no LLM anywhere near the data path.
- **The hot store** (embedded `redb`) holds the near-tip, un-finalized window for point reads and reorg rollback.
- **Past finality**, blocks are sealed into **content-addressed Parquet segments** — immutable, append-only, named by the hash of their contents.
- **DuckDB** attaches those segments read-only and gives you an analytical SQL surface at `GET /sql?q=...`.

That last endpoint is the whole integration surface. Lodestar's server-side routes call it exactly the way they'd call Postgres.

One feature earned its keep on day one. Indexing the whole Graph token contract would mean millions of irrelevant `Transfer` rows, so nuthatch grew a per-contract **event allowlist** (`events = ["TokensDelegated", ...]`) that filters both the decode *and* the `getLogs` topic set. Our staking nest indexes four delegation events instead of HorizonStaking's twenty-eight tables.

## Panel one: delegation activity

The delegation feed shows recent delegations across the network. On-chain, these come from **HorizonStaking** (`0x00669A…eF03`). We allowlisted four events — `TokensDelegated`, `TokensUndelegated`, `DelegatedTokensWithdrawn`, and the legacy `StakeDelegatedWithdrawn` — and reconstructed the exact shape the old community subgraph returned with a single SQL `UNION`, mapping each event to the subgraph's `eventType` vocabulary (`delegation`, `undelegation`, `withdrawal`) and `serviceProvider → indexer`.

The parity bar here was the strict one: **byte-for-byte**. We backfilled the recent window locally, then diffed nuthatch's newest rows against the live subgraph:

- The newest rows matched exactly — same indexer, delegator, token amount to the wei, timestamp, transaction hash.
- Over the full window, the counts matched per type: 17 delegation + 2 undelegation + 3 withdrawal on both sides.

No aggregation, no time-travel snapshots, no exchange-rate math — the subgraph's `delegationEvents` entity *is* a decoded event row, which is precisely what a nuthatch table is. This was the clean one.

## Panel two: developer activity

The developer-activity chart is "subgraphs published per week over the last 12 months," derived from **L2GNS** `SubgraphPublished` events. (Aside, if you're wiring the same thing: the real L2GNS on Arbitrum is `0xec9A7fb6…33Bec` — a couple of code bases float a similar-looking but stale address that emits nothing.)

This one needed a year of history, which on Arbitrum's ~4-blocks-per-second cadence is roughly 125 million blocks. At the default 2,000-block `getLogs` window that's ~62,000 requests — glacial. So nuthatch grew a `--window` override: for a *sparse* contract like GNS, a 50,000-block window turns that into ~2,500 requests and the backfill finishes in about four minutes instead of an hour and a half.

Parity here is looser by nature — it's a weekly time series, not individual rows — so we held it to "documented divergence within tolerance." We reconstructed the same weekly buckets from `SubgraphPublished` timestamps and compared them week by week against the subgraph. Short windows matched exactly; over the full year the totals landed within about one percent, and as of writing they've converged to **3,375 vs 3,376** — a single subgraph apart, well inside the noise. We wrote the reason down rather than papering over it: a handful of L1-origin subgraphs enter the network subgraph's entity count via a transfer path that never emits a native-L2 `SubgraphPublished`. The *trend* — the thing the chart actually communicates — is identical.

## The integration is one file with a fallback

On the Lodestar side, the whole thing is a small adapter (`src/lib/nuthatch.ts`) that does an authenticated `GET /sql`, plus two route handlers that call it. Both are **flag-gated and fall back to The Graph on any error**:

```ts
if (nuthatchEnabled('NUTHATCH_DELEGATION_EVENTS')) {
  try {
    rows = await nuthatchSql(delegationSql());
    source = 'nuthatch';
  } catch (err) {
    log.error({ err }, 'nuthatch failed — falling back to subgraph');
    rows = await subgraphRows();   // The Graph, unchanged
  }
}
```

So nuthatch being up is never a hard dependency. If the box hiccups, the panel silently reverts to the gateway and nobody notices. Each panel also renders a small **"⚡ Indexed by nuthatch"** badge — but only when the response's `source` is actually `nuthatch`, never on the fallback, so the badge can't lie about where a number came from.

Both nests run as two services on a single VPS behind one Caddy vhost with TLS and basic-auth, path-routed so Lodestar talks to a single URL. Total resident memory for both: **86 MB.** The 2 GB footprint budget is not, it turns out, in any danger.

## The deadlock we had to earn our way out of

It wouldn't be a real migration without one genuinely horrible bug, and this one was a beauty. Midway through, a backfill simply *hung* — process alive, zero CPU, zero progress, forever. The per-request 20-second timeout never even fired.

The temptation is to guess. We didn't; we reproduced it deterministically (it turned out to reproduce under a shrunk tokio worker pool), then sampled the stalled process. Every worker thread was parked, one sitting idle on the I/O driver, **zero in-flight network connections**, and not a single application frame anywhere. That's not slow I/O — that's a lost wakeup. The whole runtime had gone to sleep with a pending task nobody would ever poll.

Two attractive theories died on contact with evidence. HTTP/2 multiplexing? We forced HTTP/1.1; it still hung. The DBSP incremental-view runtimes? They ran identically in the passing cases, so logically they couldn't be the cause. The real variable was hiding in plain sight: **every failing run pointed at a single RPC endpoint; every passing run had several.** High concurrency to *one host* was stalling the entire tokio runtime — a lost wakeup so total it froze the timers too.

The fix ships in `v0.2.2`: when only one endpoint is configured, the seal-direct backfill caps itself to sequential (with a loud warning to add endpoints for parallelism); two or more keep full concurrency. Single-endpoint backfills are now slower but they *finish* instead of hanging.

## Then we went looking for its siblings

A hang that silently freezes your indexer is exactly the kind of failure that shouldn't be a one-off, so we ran a critical review of the core paths asking "what else fails without announcing itself?" It found a family of the same disease, and we fixed seven of them (all in `v0.3.0`):

- **Resumable, fail-fast indexing.** The backfill now persists its sealed watermark after every segment and *resumes* from it instead of restarting from scratch on any blip — which, on the adaptive code path, could otherwise re-seal overlapping ranges under fresh hashes and permanently double-count. And the process now dies loudly if ingestion dies, instead of continuing to serve stale data while looking healthy.
- **Timestamps don't get zeroed.** A transient whole-batch timestamp fetch failure used to collapse into `block_timestamp = 0` and get sealed forever. Now it retries, and a hard failure refuses to seal rather than baking zeros into the immutable layer.
- **No infinite shrink loops.** A single block whose logs exceed a provider's result cap now fails with a clear message instead of retrying the same block forever.
- **Reorgs below finality halt loudly** rather than silently letting the sealed layer disagree with the canonical chain; the manifest is written atomically so a `kill -9` can't orphan your segments; and nests don't spin up incremental-view circuits they'll never feed.

None of these were on fire (the live nests are small and sealed), but they're the difference between an indexer you trust with a big cold backfill against a flaky endpoint and one you don't. One performance finding (batching the hot-store writes) we deliberately deferred to its own benchmarked slice, because doing it blind on the storage path would be silly.

## How to check it yourself

Load [the dashboard](https://www.lodestar-dashboard.com) and look for the "⚡ Indexed by nuthatch" badge on the Delegation Activity feed and the Developer Activity chart. Or hit the routes directly and read the `source` field:

```sh
curl -s https://www.lodestar-dashboard.com/api/delegation-events | jq .source
# "nuthatch"
curl -s https://www.lodestar-dashboard.com/api/developer-activity | jq .data.source
# "nuthatch"
```

## What this proves, and what it doesn't

It proves the wedge works: a real product with real users can take a panel off a third-party data API and serve it from an indexer you run yourself, one panel at a time, gated on parity, with an automatic fallback so nothing is bet on the switch. Two panels down, on 86 MB of RAM and one small box.

What it doesn't prove: everything. The QoS-oracle data still lives on The Graph's free tier (it needs calldata and IPFS ingestion nuthatch doesn't have yet). The developer-activity divergence is real, if tiny, and documented rather than hidden. And "the whole dashboard" is a long road of panels (indexers, allocations, epochs, payments) each with its own aggregation quirks to reproduce faithfully.

But the read path for two of them now belongs to us. That's the point of "be your own indexer": not a flag day, but a migration you can do on your own terms, with your own eyes on the parity, one honest step at a time.

nuthatch is [github.com/nightswatchhq/nuthatch](https://github.com/nightswatchhq/nuthatch) (AGPL-3.0) — [www.nuthatch-indexer.com](https://www.nuthatch-indexer.com).
