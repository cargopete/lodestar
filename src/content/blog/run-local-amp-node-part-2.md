---
title: "How to Run a Local Amp Node, Part 2: What You'll See After a Day"
date: "2026-04-17"
author: "cargopete"
tags: ["amp", "self-hosted", "infrastructure", "arbitrum", "parquet"]
excerpt: "Part 1 covered installing ampd and deploying a dataset. This post is about what happens next — what Amp actually writes to disk, what it costs in RAM, and the operational details the setup docs don't mention."
---

*This post is unaffiliated with Edge & Node or The Graph Foundation.*

[Part 1](/blog/run-local-amp-node) covered installing ampd, pointing it at an Arbitrum One RPC, and deploying a dataset. This post is about what happens next — what Amp actually writes to disk, what it costs in RAM, and the operational details the setup docs don't mention. Numbers in this post are from my node, running on a ThinkPad indexing Arbitrum One for the last 24 hours.

## What Amp actually stores

If you thought Amp only stores the events you care about, it doesn't. It stores the entire chain — every block, every transaction, every log from every contract. Your contract filter is a query-time concern, not an indexing-time one.

The data lives under `data_dir` (in Part 1's config, `/var/lib/ampd/data`) as three parquet-backed tables per dataset:

```
/var/lib/ampd/data/arbitrum_one/
├── blocks/<partition-uuid>/<start_block>-<hash>.parquet
├── transactions/<partition-uuid>/<start_block>-<hash>.parquet
└── logs/<partition-uuid>/<start_block>-<hash>.parquet
```

After one day of indexing Arbitrum One from block 453,055,204:

| Table | Size | What's in it |
|---|---|---|
| blocks | 1.2 GB | Every block header (hash, parent, miner, gas, roots, base fee, blob fields) |
| transactions | 1.6 GB | Every tx (calldata, gas, access list, auth list, from/to, status) |
| logs | 979 MB | Every event from every contract (4 topics + data) |
| **Total** | **3.7 GB** | |

Compression is `zstd(1)` (configured in `ampd.toml` under `[writer]`). Files are small — 5 to 15 KB each, one per ~5-block range. After 24 hours my node had 295,074 parquet files across the three tables.

On the file layout: each table has a single partition directory (a UUIDv7), and files inside it are named `<start_block>-<fragment-hash>.parquet`. This makes it trivial to tell at a glance what block range any file covers — useful later when we talk about retention.

## Storage projection

At 3.7 GB/day for Arbitrum One:

- ~110 GB/month
- ~1.3 TB/year
- ~240M blocks from HorizonStaking genesis (June 2024) would take weeks of wall-clock time and hundreds of GB on top of the tip-tracking growth

On picking a start block: unless you actually need pre-genesis history, start somewhere sensible. The `deploy/reindex-jan2026.sh` script in my repo uses block 416,000,000 (Jan 2026) and that covers the HorizonStaking launch period while keeping the initial sync to a few days.

## RAM: the VSZ number is lying to you

`htop` on my node shows ampd using 284 GB of virtual memory on a laptop that only has 62 GB. This is not a bug and not a leak — it's the parquet files being memory-mapped. Linux counts every mmapped page as part of the process's virtual address space, even though physical memory is only consumed for pages actually touched.

The number that matters is RSS:

```
$ ps -o pid,rss,vsz,pmem,comm -p $(pgrep ampd)
    PID    RSS     VSZ %MEM COMMAND
1195749 9077088 284121932 13.8 ampd
```

9 GB RSS, 13.8% of total RAM. RSS will grow slowly as more parquet pages are read (for queries) but the kernel evicts cold pages under pressure, so this isn't unbounded.

On minimum RAM: Part 1 said 16 GB and I still stand by that — you want headroom for Postgres, query bursts, and the page cache doing its job. Going below isn't worth the grief.

## Retention: there is none (and that's fine for now)

A natural question after one day of seeing 3.7 GB go by is: "can I keep only the last month?" The honest answer is no, not natively. I checked:

- `ampctl dataset/job/manifest` subcommands — `prune` exists but only for orphaned jobs and manifests, not partition data
- The admin API on `:1610` — no retention, ttl, delete-partition, or equivalent
- The upstream repo — no docs, no flags, no open issues proposing it

So your options are:

1. **Do nothing.** At 3.7 GB/day on a 2 TB disk, you have ~14 months of runway. For a hobby node this is fine; you can revisit when it becomes a real problem.
2. **Periodic stop + redeploy.** Cron a monthly job that runs `stop.sh` and redeploys with `start_block = tip - 21.6M` (30 days of Arbitrum blocks at ~4 blocks/s). Clean but creates a sync gap each cycle.
3. **Manual parquet deletion.** Files are named by start_block so you could `find … -name "N-*.parquet"` and delete them. The Postgres metadata still references those ranges though — queries against deleted blocks will behave unpredictably. Don't ship this.

If you do nothing and the project ships retention in the next 12 months, you've won for free.

## The admin API nobody documents

`ampd solo --admin-server` exposes a local HTTP API on `:1610`. It's not in the public docs but it's how you poke at live state without grepping journald. The useful endpoints I've found:

| Endpoint | Returns |
|---|---|
| `GET /jobs` | All jobs, status, dataset, manifest hash |
| `GET /datasets` | Registered datasets + versions |
| `GET /manifests` | All registered manifest hashes |
| `GET /manifests/<hash>` | Full manifest JSON — schema, start_block, network |
| `GET /workers` | Worker nodes (just one in solo mode) |

One-liner to see your current sync frontier without tailing logs:

```bash
journalctl -u ampd -n 1 --no-pager -g "Fetching blocks" \
  | grep -oP 'end_block=\K\d+'
```

Or the wall-clock-accurate version via the admin API + your RPC:

```bash
# Latest block we've indexed (read from the most recent log line)
# vs. chain tip (read from your RPC provider)
# delta / 4 = seconds behind tip
```

## Exposing to Vercel without a public IP

Part 1 had nginx with `listen 1604` and implied you'd put a public IP + domain + certbot in front of it. That's one way. The easier way for a laptop behind a home router is a Cloudflare tunnel — no port forwarding, no static IP, no certs to rotate.

```bash
# Install
yay -S cloudflared   # or apt install cloudflared

# Login (opens a browser, pick your Cloudflare domain)
cloudflared tunnel login

# Create + run a named tunnel pointing at local nginx
cloudflared tunnel create amp
cloudflared tunnel route dns amp amp.yourdomain.com
cloudflared tunnel --url http://127.0.0.1:1604 run amp
```

Run it as a systemd user service so it survives reboots. Set `AMP_ENDPOINT=https://amp.yourdomain.com` in your Vercel env and the `X-Amp-Token` auth from Part 1 works unchanged — the token travels end-to-end, the tunnel is just transport.

One gotcha: when the tunnel hostname changes (e.g. you recreated the tunnel), you need to update the Vercel env var and redeploy. I keep an `update-tunnel.sh` that does both via `vercel env` + `vercel --prod`.

## RPC is still the only bottleneck that matters

At tip, ampd keeps up with Arbitrum block production 1:1 — about 4 blocks/second, which is the chain's native rate. My 24-hour node indexed 337,091 blocks in 23.5 hours of wall-clock time. That's the steady state; you're paying RPC costs, not local compute.

What this means in practice:

- **At-tip indexing on Chainstack Growth**: free, you're nowhere near the 250 req/s ceiling.
- **Backfilling from weeks ago**: RPC-bound. A rough ceiling is a few hundred blocks/second if the RPC cooperates, much less if it throttles. Budget accordingly.
- **Adding a second provider file does nothing.** I confirmed this — ampd uses one provider at a time per dataset, there's no round-robin across files in the `providers_dir`.

If you need faster backfills, the only real lever is a local Arbitrum Nitro node. For tip-tracking, a paid RPC plan is plenty.

## Gotchas v2

New ones I hit in the first week that weren't in Part 1:

- **VSZ is not memory.** htop will show ampd using hundreds of GB. It's mmap. Look at RSS.
- **`ampctl job prune` does not delete partition data.** The name implies it might. It only removes finished job rows from Postgres. The parquet files are untouched.
- **100M+ inodes per year.** ext4 handles it, but `cp -r` on the data dir will take forever if you ever migrate. Use `rsync -a` or `mv` within the same filesystem.
- **File ownership is `ampd:ampd`, not root.** If you ran the install as root and chown'd things wrong, the daemon will silently fail to write parquets. Check `journalctl -u ampd` for permission errors first when things go sideways.
- **A running job survives `systemctl stop ampd`.** Jobs live in Postgres with their own checkpoint; restarting the daemon resumes them. To stop indexing, use `ampctl job stop <id>`.

## What you can build with a day of data

Even with just 24 hours of chain history, the queries from Part 1's HorizonStaking framing are already useful:

- **Live provision dashboard** — every `ProvisionCreated`/`ProvisionIncreased`/`ProvisionThawed` in the last day, refreshed on each page load
- **Delegation flow** — net `TokensDelegated` minus `TokensUndelegated` per indexer per hour
- **Slashing watch** — poll `ProvisionSlashed` + `DelegationSlashed` on a cron and alert
- **Event replay** — any transaction hash → its full log trail, without calling the RPC

The subgraph will still tell you the current state more cheaply. What Amp gives you is the shape of the state change — not "this indexer has X stake" but "this indexer got X stake from these addresses across these blocks." That's the whole pitch for running one of these.

---

*Next post: the query patterns themselves — the SQL tricks for topic-indexed address matching, working with `FixedSizeBinary(32)` columns without losing your mind, and how to cache expensive aggregations without giving up freshness.*
