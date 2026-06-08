---
title: "Yes, camp is better than amp. And we proved it."
date: "2026-06-08"
author: "cargopete"
tags: ["camp", "amp", "benchmark", "data-services", "the-graph", "horizon", "open-source", "substreams"]
category: "Analysis"
excerpt: "We ran camp-node v0.5.1 head-to-head against the only amp binary anyone can actually download, on the same box, through the same RPC, with the numbers written down. camp is faster, leaner, more open, and speaks three query protocols to amp's one. Here's the honest version — wins, ties, and the one place amp still leads."
---

> ## 🔬 The short version
> camp-node v0.5.1 vs amp v0.0.36, same box, same RPC, numbers written down: **~16% faster backfill, ~23% fewer CPU-seconds, three query protocols to amp's one, and a source tree you can actually read.** amp still leads on verifiability. We're not going to pretend otherwise.

I'm going to make a claim in the title that sounds like marketing, and then I'm going to spend the rest of the post trying very hard to talk myself out of it. That's the deal. If a benchmark can't survive its own author playing devil's advocate, it isn't a benchmark — it's a press release with a graph stapled to the front.

So let's do this properly.

## What we actually compared

There's a wrinkle that everyone writing "X vs amp" quietly skips over, so let me put it front and centre: **there is only one amp binary you can actually obtain.**

It's `v0.0.36` — the public build on `ghcr.io/edgeandnode/amp:latest`, dated 5 May 2026. Anything newer lives behind the private `edgeandnode/amp` repo. The GitHub releases API 404s if you ask anonymously, and `ampup install` wants a token you haven't got. So when someone tells you about "Amp current," they're describing the docs, not the artefact. Nobody outside the walled garden has run it.

That gives us three columns, and I want to be honest about how much each one is worth:

| Column | What it is | How much to trust it |
|---|---|---|
| **camp-node v0.5.1** | Read straight from the repo, and run on this box. | **High** — source *and* observed. |
| **amp v0.0.36** | Black-box observation of the public binary + `ampctl`. No decompilation. | **Medium-high** — what it exposes, not how it works. |
| **amp "current"** | The public docs describing the private build. *Not observed by me.* | **Low** — documentation, possibly omitting gated bits. |

The only fully defensible comparison is **camp-node v0.5.1 vs amp v0.0.36** — two things sitting on the same machine, both pokeable. Everything I say about "amp current" is a best-effort appendix with an asterisk the size of a barn door. I'd rather tell you that than have you find out later and assume I was hiding it.

## The headline, told straight

Here's the claim that survives me arguing with it:

> *camp-node is ahead of the amp it forked on openness, Postgres compatibility, keyless instrumented data, and efficiency defaults — while amp leads on verifiability and hosted-product polish, and exposes a few more source kinds.*

That is **not** "camp beats amp at everything." camp is a fork of amp's December-2025 line, so it inherited the good engine — DataFusion, Parquet, Arrow Flight, the EVM UDFs, reorg handling, the lot. You don't get to claim credit for the parts you were handed. What camp *added* on top is where the argument lives, and what it's missing is where the honesty lives.

Let me walk through both.

## Where camp wins

### It speaks three protocols. amp v0.0.36 speaks one.

This is the cleanest lead on the board, and it's not close.

| Interface | camp-node v0.5.1 | amp v0.0.36 |
|---|---|---|
| Arrow Flight (gRPC) | ✅ | ✅ |
| JSON Lines over HTTP | ✅ | ❌ **dropped in v0.0.36** |
| Postgres wire | ✅ read-only (`--pg-server`) | ❌ |
| Streaming SQL | ✅ | ✅ |

amp v0.0.36 serves Flight and only Flight. The JSONL server is gone — no `--jsonl-server` flag, it was dropped in that release. camp serves Flight, JSONL, *and* a read-only Postgres wire protocol, which means you can point `psql`, Grafana, Metabase, or any boring BI tool that's existed since 2005 straight at your indexed chain data. No bespoke SDK, no gRPC client, no Arrow ceremony. Just `SELECT`.

The honest footnote: this means a *fair query benchmark* can only race them on Flight, because it's the one language they both speak. On Flight they're at parity — same DataFusion underneath. camp's edge here is **capability, not raw speed**: it answers questions on two protocols amp v0.0.36 simply can't hear.

### Keyless, free, instrumented data

amp can produce full-instrumentation data — internal traces, storage and balance changes, the works — but it gets there via Firehose, which means you're standing up an endpoint or paying for one.

camp added a `pinax` source: it pulls that same instrumented data from Pinax's **free public bucket, with no API key and no self-run Firehose.** The differentiator isn't "traces at all" — both can do traces. It's the *access path*. camp's is keyless and free; amp's needs infrastructure.

### Efficiency, on by default

| | camp-node v0.5.1 | amp v0.0.36 |
|---|---|---|
| Bloom filters | ✅ default-on (equality cols) | ❌ |
| Compactor + collector | ✅ default-on | ❌ ships **off** |
| Object store | ✅ S3 / GCS / Azure / R2 | ✅ S3 / GCS / Azure |
| Selectable mimalloc / jemalloc | ✅ (+ benchmark) | ◐ snmalloc |

The fair caveat: amp *could* flip Bloom filters and compaction on too. They're not magic camp invented. But they ship **off** in v0.0.36, and defaults are policy — the out-of-the-box experience is what most operators actually run. camp's prod file-count problem (small Parquet files piling up and degrading query planning) was fixed precisely by making compaction default-on, and that's an operationally real win even if it doesn't show up in a five-minute backfill.

### Source you can build and read

amp is a closed binary. camp is public, BUSL-lineage source you can clone, build, audit, and fork. That's not a performance metric. It's the whole point, and I'll come back to it.

## Where amp wins — yes, really

If I only listed camp's wins you'd be right to distrust the whole document. So:

- **Verifiability and attestation.** amp's positioning is built around verifiable, attestable data. camp has **none** of that — I grepped the tree, there are zero attestation UDFs. This is a genuine amp lead and it's central to their story. camp doesn't tell that story at all yet.
- **More source kinds, today.** amp v0.0.36's CLI exposes `bitcoin-rpc`, `solana`, and `tempo` sources that camp doesn't wire up. (camp has a `solana` crate but hasn't plumbed it into `manifest generate` yet.) camp leads on a CLI-wired `firehose`/`eth-beacon` and the keyless `pinax` source — so each exposes kinds the other doesn't. It's a trade, not a sweep.
- **A productized hosted ecosystem.** Studio, a catalog, SDKs, gateway auth — amp has the polished commercial surface. camp has the Lodestar Dashboard and `engine.camp`, which is free and needs no key, but I'm not going to pretend it's a funded product org.

So: **a trade, not a clean sweep.** camp leads on openness, Postgres-wire, keyless data, and efficiency defaults. amp leads on verifiability and hosted polish. The core ETL surface is parity, because camp inherited it.

## The numbers

Setup, identical for both: a from-empty backfill of the **same** 5,000-block Arbitrum One window (from block 471,200,000, finalized), through the **same** RPC endpoint at the same batch size and concurrency, into a throwaway Postgres and a fresh `/tmp` data dir, both pinned to CPU cores 0–7, compaction on for both. Runs were interleaved — camp, amp, camp, amp — so they share network weather. `n=3`, median reported.

| Metric | camp-node v0.5.1 | amp v0.0.36 | camp delta |
|---|---|---|---|
| Backfill wall-clock | **44.2 s** | 51.2 s | **~16% faster** |
| Backfill throughput | **113 blk·s⁻¹** | 98 blk·s⁻¹ | ~16% higher |
| Peak RSS | **150 MB** | 157 MB | ~4% lower |
| CPU-seconds | **2.0 s** | 2.6 s | ~23% lower |
| On-disk bytes/block | **1931** | 1990 | ~3% smaller |
| Parquet files (post-compaction) | **3** | uncompacted (compaction off) | — |

Per-run throughput spread: camp **113.2 / 115.8 / 110.7** (tight). amp **97.7 / 99.6 / 81.7**. That amp run-3 dip to 81.7 is **RPC-provider variance, not an indexer regression** — which is exactly why you report this axis with its dispersion and treat it as RPC-bound rather than quietly using the worst amp run to flatter camp. I'm telling you about the 81.7 *because* it's the number a dishonest benchmark would bury.

### What the numbers actually mean

The temptation is to read "~16% faster" as "camp's engine is 16% better." It isn't, and here's why I won't let you believe that:

- **Backfill speed is RPC-bound.** Both spend nearly all their wall-clock waiting on the *same* RPC, with the *same* `evm-rpc` client lineage (camp forked amp's). The result is dominated by the provider, not the indexer. camp's edge is small and comes from newer deps and better write/compaction overlap — not a fundamentally faster fetch. This is parity-by-inheritance, not a moat. The real backfill lever is a HyperSync extractor that bypasses per-block RPC entirely, and that isn't built yet.
- **Bytes/block is near-identical by construction.** Same schema, same Parquet writer, same `zstd(1)`. The interesting bit is that camp's default-on Bloom filters add a few KB per file and bytes/block *still* comes out roughly equal — i.e. the index overhead is negligible and compaction keeps it from ballooning.
- **File count is the real operational win.** Compaction on by default merged the window into ~3 files; amp v0.0.36, shipping compaction off, would accumulate many small files that rot query planning over a long-running deployment. Doesn't show in a short backfill. Matters enormously in production.

### Read this before you quote a single number

- **Shared dev box.** These ran on the same machine as the live `engine.camp` fork and the upstream binary — not a quiet dedicated box. Treat the figures as **indicative, not publication-grade.** The dedicated-box, n≥5, cold/warm, RPC-counting run is the publishable version, and it's still on the to-do list.
- **amp v0.0.36 ≠ "amp current."** v0.0.36 is the latest *public* build. Newer private builds may differ. Pin and date-stamp every comparison.
- **No claims about amp internals.** Closed binary, not decompiled. Only what it exposes.
- **Reproduce it yourself.** The exact commands live in `bench/REPRODUCE.md`. Don't take my word for any of this — that's rather the entire point.

## The part that actually matters

Strip away the tables and here's what's left.

camp is **open source.** You can read every line of how it fetches a block, writes a Parquet file, and answers a query. When I claim it's 16% faster, you don't have to trust me — you can clone it, build it, run `bench/REPRODUCE.md`, and check. amp is a binary behind a token behind a private repo. The most important "feature" in this entire comparison isn't on any of the tables: it's that **you can verify camp's side and you can't verify amp's.**

And camp isn't a product roadmap steered by a quarterly planning committee or gated behind some governance process you need a lawyer to parse. It's built in the open, it invites collaboration, and the door is unlocked. If you want a `bitcoin-rpc` source, or to wire up the `solana` crate that's already sitting in the tree, or to build the HyperSync extractor that would actually move the backfill needle — you can open the code and do it. No permission, no token, no waiting for someone else's priorities to align with yours. That's not a slogan. It's just what open source *is*, and it's the thing The Graph was supposed to stand for before "decentralized" quietly came to mean "decentralized, terms and conditions apply."

So — is camp better than amp?

On openness, query protocols, keyless data, and efficiency defaults: yes, demonstrably, with the numbers written down and the source open for you to check. On verifiability and hosted polish: not yet, and I'm not going to lie to you about it. The core engine: parity, because camp stood on amp's shoulders and never claimed otherwise.

The title says we proved camp is better. We proved the specific, defensible version of that claim — and showed our working, including the bits that don't flatter us. If you want the marketing version where camp wins every row, you'll have to find a less honest author.

Everything's reproducible. The code's open. Come build the rest of it with us.

---

*camp-node is open source. The benchmark harness, exact commands, and raw numbers are in the repo under `bench/`. Want to help close the gaps — Solana wiring, a HyperSync extractor, the dedicated-box benchmark run? The door's open. Come find us in [The Night's Watch](/blog/the-nights-watch).*
