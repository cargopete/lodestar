# Lodestar 🌟
_Stay oriented_

> **Part of the Perimeter at [Edge & Edge](https://edgeandedgeandedge.com).** Voluntarily incorporated; see the [official statement](https://edgeandedgeandedge.com/blog/lodestar). This was not a hostile takeover. No electricity was threatened — in part or as a whole.

![Screen Recording 2026-03-20 at 13 49 40](https://github.com/user-attachments/assets/62f58f1f-55f4-4d32-a8df-8ee3f1c9632e)

Analytics dashboard for The Graph Protocol on Arbitrum One. Real-time network metrics, indexer intelligence, delegation tools, portfolio tracking, curation management, and subgraph developer tooling.

**Live:** [lodestar-dashboard.com](https://lodestar-dashboard.com)

## Features

- **Protocol Overview** — Total stake, delegation, signalling, total supply, estimated annual issuance, epoch progress, a per-epoch fees/rewards table with derived status (Active/Settling/Distributing/Finalized), rewards-per-epoch chart, token distribution. Delegation Flows chart shows inflow/outflow bar chart with current-vs-previous period comparison and net GRT summary.
- **Intel Feed** — Live protocol intelligence panel with governance proposals, GIP updates, epoch summaries, and announcements sourced from The Graph Forum, GitHub, and on-chain data
- **Indexer Directory** — Sortable/filterable table with stake, delegation capacity, reward cuts, delegation-parameter cooldown remaining, REO eligibility indicators, recent delegation activity icons, and mobile card view
- **Indexer Profiles** — Detailed view with active and historical/closed allocations, operator addresses, disputes & slashing history, delegator breakdown, Horizon service provisions, REO eligibility assessment, recent delegation activity, and reward cut change alerts
- **Accurate APR & Effective Cut** — Per-allocation signal-weighted APR calculation and effective cut formula matching [grtinfo](https://github.com/ellipfra/grtinfo)
- **Delegator Portfolio** — Position tracking with Active/Thawing/Withdrawable status badges, rebalancing insights, underperforming position detection, CSV export
- **Curator Portfolio** — Signal positions and query-fee-to-signal ratio analysis across all curators
- **Curate** — Wallet-connected curation tool: signal and unsignal on subgraphs, manage your own signal portfolio, search deployments by name or IPFS hash, and track per-position query-fee yield
- **Subgraph Dock** — Developer studio for subgraph publishers: connect with your Studio account, view published subgraphs and sync status, manage metadata (name, description, image, website), generate deploy keys, query live deployments, and interact with the Sync Bounty Board. Full on-chain lifecycle for published subgraphs — update metadata (`GNS.updateSubgraphMetadata`), transfer ownership and deprecate, each behind a typed irreversibility confirmation.
- **Subgraph Directory** — Browsable subgraph list with signal/stake ratio highlighting, IPFS manifest complexity scoring (Light→Extreme), category filter (DeFi/NFT/DAO), contract-address search (find subgraphs indexing a given contract), and sorting by signal/stake/query fees or recently created
- **Subgraph Detail** — Embedded GraphiQL playground (schema browser, autocomplete) with the real copyable gateway query URL, deployment version history (semver labels + IPFS hashes), and an activity timeline (version publishes + curator signal events)
- **Horizon Activity Feed** — Live on-chain events from the Horizon staking contract: delegations, self-stakes, provisions, slashing, and withdrawals. Refreshes every 30 seconds. Built from `graph-allocations-nest` (delegation events and provisions in one pass). Reports unavailable if the nest is unreachable.
- **Stake History Charts** — Self-stake and delegation history with cumulative rewards tab
- **Push Protocol Notifications** — Opt-in delegator alerts for reward cut changes and inactive indexer detection. EIP-191 signed subscription; notifications sent via Push Protocol channel
- **One-Click Delegation** — Algorithmically selected indexer with optional preference tuning; smart default with override. See [below](#one-click-delegation).
- **Delegation Calculator** — Model redelegation scenarios with thawing period cost analysis and net gain projections
- **Compare Indexers** — Side-by-side comparison of up to 3 indexers
- **POI Consensus Dashboard** — Divergence detection and stake-weighted consensus across active deployments
- **GraphTally / TAP Payments** — Escrow balances, RAV redemptions, top collectors, and per-indexer payment detail
- **Indexing Health** — Chain-by-chain indexing lag monitoring, sync progress, and subgraph health across the network
- **AI / MCP Directory** — Curated directory of Graph-ecosystem MCP servers and AI tools at `/ai`
- **Blog** — Technical writeups on indexer infrastructure, Graph Node architecture, Amp self-hosting, and Horizon tooling
- **Wallet Connection** — Connect via MetaMask, WalletConnect, or Coinbase Wallet (Arbitrum only)
- **Mobile-First Layout** — Bottom tab navigation, table-to-card patterns, responsive grids, touch-friendly targets

## Roadmap

### Planned

- [ ] PWA support — installable to home screen for daily portfolio checking
- [ ] Amp node reconnection — re-enable Horizon Activity live feed with persistent Amp connection

### Shipped

- [x] **v4.0.0 — Hardening campaign complete.** Logic-tier test coverage lifted 33% → **86%** (1,500+ tests across lib/API/hooks) with a ratcheting CI gate; full security audit (`SECURITY_AUDIT_V4.md`) with every actionable finding fixed — SSRF defence (shared guard + DNS-rebinding check), real per-instance rate limiting, gateway error redaction, an unhandled-rejection fix in the cache layer; plus the v3.4.0 infra/security work below.
- [x] Security & infra hardening (v3.4.0) — forced-TLS Postgres (`sslmode=require`) and TLS-only Redis (`rediss://`, plaintext port firewalled); fixed all high-severity `axios` CVEs; fail-closed timing-safe cron auth; GraphQL-injection + SSRF guards on the indexer-agent proxy; gateway deployment-id validation; timing-safe session HMAC; signature-gated push unsubscribe; offsite pull-model Postgres backups. Green CI gate (lint/type-check/tests/build) with ratcheting coverage. See `SECURITY_AUDIT_V4.md`
- [x] Subgraph health alerting — per-subgraph Discord/Slack webhook alerts, edge-triggered (lagging/failed/recovered), via a 15-min cron that queries each indexer's `/status` endpoint (see `GAP_ANALYSIS.md`)
- [x] Metered query gateway (RFC-004 Phase A) — non-custodial: mint `lod_live_` keys in the Dock, metered proxy at `/api/gateway/[key]`, free-tier caps (5k/user, 90k global kill-switch), per-key usage dashboard. No deposits/billing — the paid prepaid-GRT step is gated on a legal review (see `GAP_ANALYSIS.md`)
- [x] Studio replacement — on-chain subgraph lifecycle in the Dock (`GNS.updateSubgraphMetadata` / `safeTransferFrom` / `deprecateSubgraph`, each behind a typed irreversibility confirmation) plus a "Recently Created" sort on the subgraph directory (see `GAP_ANALYSIS.md`)
- [x] Explorer/Studio parity batch — GraphiQL playground, subgraph version history & activity log, real gateway URL, closed allocations, disputes/slashing + operator addresses, cooldown column, per-epoch status table, total-supply & issuance stats, category filter, contract-address search, Withdrawable badge (see `GAP_ANALYSIS.md`)
- [x] Delegation Flows period comparison — current vs previous window with net GRT and % change (v2.29.0+)
- [x] Horizon Activity feed — live Amp-powered on-chain event stream (v2.6.0)
- [x] Push Protocol delegator notifications — opt-in alerts for cut changes and inactive indexers (v2.6.0)
- [x] QoS performance charts — query count, success rate, latency, blocks-behind (v2.6.0)
- [x] Stake history charts + cumulative rewards tab (v2.6.0)
- [x] AI / MCP directory at `/ai` (v2.6.0)
- [x] One-click delegation — algorithmic indexer selection with preference tuning, smart default with override
- [x] GraphTally / TAP payment pipeline — escrow balances, redemptions, per-indexer detail
- [x] Indexing health — chain lag monitoring, sync status across deployments
- [x] POI Consensus Dashboard — divergence detection, stake-weighted consensus
- [x] REO (Rewards Eligibility Oracle) heuristic — eligibility indicators in indexer table and detailed assessment on profiles (GIP-0079)
- [x] Recent delegation activity — delegation/undelegation events on indexer profiles, activity indicators in the directory
- [x] Reward cut change alerts — flagged in indexer table and profile when parameters changed within 30 days
- [x] Accurate APR and effective cut using per-allocation signal-weighted rewards (grtinfo method)
- [x] Protocol Intelligence Feed with forum governance, GIP commits, epoch summaries
- [x] Mobile-first responsive overhaul with bottom tab bar and card views
- [x] Delegation calculator with redelegation cost modelling
- [x] Indexer comparison tool (up to 3 side-by-side)
- [x] Real subgraph data throughout (no mock data in production)

## Indexer Scoring

Each indexer receives a composite score (0–100) across eleven dimensions, combined with transparent weights. The score is designed for delegator decision-making — higher is better.

### Dimensions & Weights

| Dimension | Weight | What it measures |
|---|---|---|
| **REO Compliance** | 20% | Rewards Eligibility Oracle status (GIP-0079). Eligible with runway = 100, ineligible = 0. Oracle-sourced data gets full marks; heuristic fallback = partial credit. |
| **Allocation Efficiency** | 13% | Allocated tokens ÷ provisioned tokens. Higher utilisation = more operationally competent. 80%+ = 100, no allocations = 0. |
| **Self-Stake** | 12% | Absolute GRT staked by the indexer — skin in the game. Scored on raw amount, **not** as a ratio of total stake. Having more delegation does *not* reduce this score. Anchors: 100K (protocol minimum) = 35, 500K = 65, 1M = 80, 10M+ = 100, with linear interpolation between points. |
| **Delegator Cut** | 10% | How much of the earnings delegators actually keep. Uses **effective cut** (what delegators actually experience, accounting for indexer's own stake ratio) when available, falling back to raw cut. 0% cut = 100, 25% = 60, 50% = 35, 100% = 0. 100% query fee cut applies a further -15 penalty. |
| **Delegation Safety** | 9% | How close the indexer is to maximum delegation capacity (self-stake × 16). Lower utilisation = more room for new delegators without reward dilution. <50% used = 100, 100% full = 0. |
| **Transparency** | 8% | Has the indexer set an ENS name (+40), website URL (+30), and display name (+30)? Presence and accountability signals. |
| **Delegator APY** | 8% | Actual returns delivered to delegators. Uses 30-day rolling realised APY from closed allocations when available, falling back to estimated APR from current allocations. Anchors: 20%+ = 100, 10% = 75, 5% = 50, 1% = 20, 0% = 0. New indexers with strong returns benefit directly. |
| **Data Service Coverage** | 5% | Distinct Horizon data services provisioned to. Supporting multiple services (Subgraph Service, Dispatch JSON-RPC, etc.) signals broader protocol commitment. 1 service = 40, 2 = 75, 3+ = 100. |
| **Query Volume** | 6% | Cumulative query fees collected in GRT — proof the indexer serves real query traffic. Anchors: 100K+ GRT = 100, 50K = 90, 10K = 70, 1K = 50, >0 = 15, 0 = 0. |
| **Cut Stability** | 6% | How long since the indexer last changed reward/query fee parameters. Longer = more predictable. 180+ days = 100, <7 days = 30. Bonus +10 if a cooldown period is set. Hard cap for greedy cuts (100% reward cut → forced to 5). |
| **Delegation Trend** | 3% | 7-day net delegation flow as a percentage of total delegated stake. Positive inflow = crowd confidence; outflow = warning. Low weight because it's inherently noisy. No delegation = neutral 50. |

### Grades

| Score | Grade |
|---|---|
| 80–100 | A |
| 65–79 | B |
| 50–64 | C |
| 35–49 | D |
| 0–34 | F |

### Design Principles

- **No black boxes** — every dimension, weight, and threshold is visible in [`src/lib/risk-score.ts`](src/lib/risk-score.ts)
- **Zero extra API calls** — scores are computed from data the enrichment pipeline already fetches
- **Delegation-neutral self-stake** — attracting delegation is a sign of trust, not something to penalise
- **Delegator-first** — the score explicitly penalises high cuts; an operationally excellent indexer that takes 100% of rewards still scores poorly because delegators earn nothing
- **Feedback welcome** — if the weights or thresholds feel off, [open an issue](https://github.com/nightswatchhq/lodestar/issues)

## One-Click Delegation

`/delegate` is the simplest path to delegating GRT. Connect a wallet, enter an amount, confirm — we handle indexer selection. No research required.

### How it works

**1. Hard filters** — applied at request time, not cached:

- REO ineligible → excluded
- Delegation capacity ≥ 90% → excluded
- Reward cut ≥ 90% → excluded

**2. Preference-weighted scoring** — the existing per-indexer `scoreBreakdown` (computed nightly by the cron) is re-weighted based on four optional sliders:

| Preference | Boosts |
|---|---|
| Best returns | `delegatorAPY`, `delegatorCut` |
| Stability | `cutStability` |
| Safety | `overDelegation`, `selfStake` |
| Network contribution | `queryVolume`, `allocationEfficiency`, `reo` |

Each slider runs 0–10, default 5 (neutral = standard weights). At 10 the relevant dimension weights are doubled; at 0 they are zeroed. Weights are re-normalized to 100 after adjustment.

**3. Rank and pick** — dot product of adjusted weights × dimension scores across all eligible indexers. The top result is selected. The three highest-contributing dimensions become the "why we picked this" reasons shown in the card.

With default preferences this is effectively "highest overall risk score among REO-eligible, non-full indexers." Adjusting preferences shifts emphasis without changing the underlying scoring model.

### UX flow

1. Page loads → recommendation fetched automatically with default weights
2. Recommended indexer shown: name, grade, three reasons
3. Enter amount → approve (first time only) → delegate
4. Optional: expand "Customise selection" → adjust sliders → recommendation updates live

The approval step is skipped on subsequent delegations if the existing GRT allowance covers the amount. First-time delegators need two transactions; all others need one.

Code: [`src/app/delegate/`](src/app/delegate/) · API: [`src/app/api/delegate/recommend/`](src/app/api/delegate/recommend/)

## Tech Stack

- Next.js 16.2.6 (App Router, Turbopack)
- React 19.2.6, TypeScript 5, Tailwind CSS 4
- wagmi v3 + viem (Arbitrum One)
- @tanstack/react-query + @tanstack/react-table
- Recharts (area charts, donut charts)
- Self-hosted Postgres 16 (postgres.js, forced TLS) + self-hosted Redis (TLS / `rediss://`), with an in-memory cache fallback
- CoinGecko + DefiLlama (price/TVL data)
- [**nuthatch**](https://www.nuthatch-indexer.com) — our own self-hosted indexer, serving every piece of Graph Protocol data on the dashboard. No Graph API key, no gateway client, no fallback (see [Data from nuthatch](#data-from-nuthatch))
- Arbitrum One RPC for on-chain contract reads (`ARBITRUM_RPC_URL`, with public endpoints as fallback)
- Amp (`ampd`) — optional self-hosted on-chain event indexer, retained for `/api/horizon/*`
- Push Protocol — opt-in delegator notifications via on-chain channel

## Data from nuthatch

Every piece of Graph Protocol data on this dashboard comes from [**nuthatch**](https://www.nuthatch-indexer.com),
a self-hosted, single-binary indexer we run ourselves. It indexes the protocol contracts on Arbitrum One
directly and exposes them over SQL. There is no Graph API key in Lodestar, no gateway client and no
fallback path: an unavailable nest is reported as an error rather than silently changing the source.

Lodestar reads five nests. They sit behind one host and one basic-auth credential, selected by base path:

| Base path | Nest | What it holds | What it serves |
|---|---|---|---|
| `/alloc` | `graph-allocations-nest` | The whole protocol: staking, delegation, curation, allocations, epochs, disputes, RAVs, GRT supply | Network stats, indexers, curators, epochs, payments, portfolio, provisions, POI, rewards history, feed, token metrics, the subgraph routes, both OpenGraph images and every ingest cron |
| `/gns` | `graph-gns-nest` | L2GNS publish and metadata events | Subgraph names and versions, the Developer Activity chart |
| `/dips` | DIPS (Arbitrum One) | Indexing-agreement lifecycle | `/api/dips/agreements` |
| `/dips-sepolia` | DIPS (Arbitrum Sepolia) | The same lifecycle on testnet, where there are rows | `/api/dips/agreements` when `NUTHATCH_DIPS_BASE_PATH` selects it |
| `/legacy-flows` | `graph-staking-legacy-readonly` | Pre-Horizon and Horizon delegation together, which neither staking contract gives you alone | Delegation Flows |

`/legacy-flows` is archival by design. It answers from sealed segments and does not advance, so its head
never moves and nest-health alerting excludes it deliberately: a frozen archive reports `stalled` for
ever and is correct to.

All five are also exposed publicly and read-only at [`/sql`](https://www.lodestar-dashboard.com/sql),
where every answer carries its own provenance block.

### One nest carries almost everything

The horizon and staking nests were folded into `graph-allocations-nest`, so `/alloc` now fronts what used
to be three. Of the 34 files in `src/` that name a base path, 33 name `/alloc`. Two name `/gns` and one
names `/dips`, and both of the `/gns` readers also read `/alloc`.

That concentration matters operationally. A nest's `/sql` surface admits **two** concurrent queries and
refuses the rest with `503 server busy: too many concurrent SQL queries`, which is the node protecting
itself. `src/lib/nuthatch.ts` holds a one-slot gate and a short retry ladder so our own composition is
never the cause of a refusal, but that gate bounds one Node process and serverless runs many. When
`/alloc` saturates, every panel it feeds reports unavailable at the same moment while the other four
nests carry on answering perfectly well.

Connection configuration is `NUTHATCH_URL`, `NUTHATCH_USER` and `NUTHATCH_PASSWORD`, with optional
`NUTHATCH_*_BASE_PATH` overrides to point an individual surface at a different nest. The checked-in
[migration checklist](docs/nuthatch-migration.md) records the cutovers and the parity work behind them.

## Getting Started

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment Variables

| Variable | Description | Required |
|---|---|---|
| `DATABASE_URL` | Postgres connection string (`postgresql://user:pass@host:port/db?sslmode=require`) | Yes |
| `REDIS_URL` | Redis connection string (`rediss://` for TLS — self-hosted or managed). Falls back to a process-local in-memory cache when unset | No |
| `CRON_SECRET` | Random string to protect cron endpoints (auth fails closed if unset) | Yes |
| `ARBITRUM_RPC_URL` | Arbitrum One RPC URL (Alchemy, Infura, etc.) | Yes |
| `NUTHATCH_URL` | Base URL of the nuthatch host fronting every nest. Without it, every protocol route returns 503 | Yes |
| `NUTHATCH_USER` / `NUTHATCH_PASSWORD` | Basic-auth credential for that host | Yes |
| `NUTHATCH_*_BASE_PATH` | Per-surface overrides to point one route at a different nest. Defaults are `/alloc`, except `/gns` and `/dips` (see [Data from nuthatch](#data-from-nuthatch)) | No |
| `GITHUB_TOKEN` | GitHub PAT for the Intel Feed (forum/GIP data) | Yes |
| `NEXT_PUBLIC_SITE_URL` | Production URL e.g. `https://lodestar-dashboard.com` | Yes |
| `SESSION_SECRET` | Secret for Studio session HMAC | No |
| `TAP_SIGNER_PRIVATE_KEY` | Private key for TAP receipt signing | No |
| `NEXT_PUBLIC_BOUNTY_BOARD_ADDRESS` | Deployed BountyBoard contract address | No |
| `AMP_ENDPOINT` | Self-hosted `ampd` endpoint for Horizon event history | No |
| `AMP_TOKEN` | Auth token for the `ampd` nginx proxy | No |
| `PUSH_CHANNEL_ADDRESS` | Push Protocol channel wallet address | No |
| `PUSH_CHANNEL_PRIVATE_KEY` | Push Protocol channel private key | No |
| `PUSH_ENV` | Push Protocol environment — `staging` or `prod` | No |
| `DISPATCH_GATEWAY_URL` | PostgREST endpoint for Seahorn swap data | No |
| `INDEXER_AGENT_URL` | Indexer agent management API URL | No |
| `INDEXER_AGENT_TOKEN` | Basic auth credentials for indexer agent (`user:pass`) | No |
| `SCUTTLEBUTT_ADMIN_SECRET` | Admin login password for Scuttlebutt (moderation). Auth fails closed if unset | No |
| `SCUTTLEBUTT_TRIP_SALT` | HMAC salt for tripcodes — without it trips are guessable | No |
| `SCUTTLEBUTT_IP_PEPPER` | HMAC pepper for hashing poster IPs (raw IPs are never stored) | No |
| `SCUTTLEBUTT_EXTRA_BLOCKWORDS` | Comma-separated extra words for the profanity mask | No |

Horizon event history (`/api/horizon/*`), Push notifications, and Seahorn all degrade gracefully when their env vars are absent.

Scuttlebutt (`/scuttlebutt`) is the anonymous chat: persistent history in Postgres, live delivery via Redis pub/sub → SSE, old-school `Name#secret` tripcodes, a flood/profanity guard, and admin (cookie signed with `SESSION_SECRET`) moderation — soft-delete and ban by IP-hash or tripcode. With no `DATABASE_URL` the page reports unavailable; with no `REDIS_URL` it falls back to history reads only (no live push).

## Database Backups

The lodestar Postgres database (on the primary VPS) is backed up nightly to a separate offsite VPS using a **pull model**: the backup box reaches into the primary and pulls a compressed `pg_dump`, rather than the primary pushing out. If the primary is ever compromised, the attacker has no path to the backups.

```
PRIMARY (DB host)                          BACKUP (offsite)
  Postgres :5433        nightly 03:17 UTC    pull-lodestar-backup.sh (cron)
  lodestar-dump-stdout.sh  ◀──── SSH ────────  pulls + verifies + retains
        │                  forced-command key        ↓
        └── pg_dump -Fc ──────────────────▶  daily/ (7) · weekly/ (4) · monthly/ (6)
```

- **`scripts/lodestar-dump-stdout.sh`** — runs on the primary. Emits a compressed `pg_dump -Fc` of `lodestar` to stdout via local peer auth (no DB password on disk). This is the *only* thing the backup key is permitted to run — it's wired as a forced command in the primary's `authorized_keys`, locked down with `no-pty,no-port-forwarding,...`, so a stolen key can do nothing but request a dump.
- **`scripts/pull-lodestar-backup.sh`** — runs on the backup box via cron (daily 03:17 UTC). Pulls the dump, **verifies it before keeping it** (size, `PGDMP` magic, table count), files it into `daily/`, then hardlink-promotes to `weekly/` (Sundays) and `monthly/` (1st of month). Retention: **7 daily / 4 weekly / 6 monthly**.

Dumps are custom-format (`-Fc`). Restore with:

```bash
pg_restore -h <host> -p <port> -U postgres -d <db> --no-owner --no-acl lodestar-<ts>.dump
```

Restores are periodically test-verified against a throwaway Postgres container. These are nightly logical dumps (no point-in-time recovery) — appropriate for an analytics DB that re-ingests from chain.

## Project Structure

```
src/
  app/           # Next.js pages and API routes
    api/         # Nest-backed data routes, price, TVL, feed, cron, Push, studio endpoints
    activity/    # Live Horizon on-chain event feed
    ai/          # AI / MCP tool directory
    blog/        # Technical blog (Markdown posts)
    calculator/  # Redelegation calculator
    compare/     # Indexer comparison tool
    curate/      # Wallet-connected curation tool (signal/unsignal)
    curators/    # Curator directory
    delegators/  # Delegator portfolio
    dock/        # Subgraph developer studio (publish, metadata, deploy keys, bounties)
    grt-flow/    # GRT supply and flow views
    indexers/    # Indexer directory + profiles
    indexing/    # Chain health and subgraph indexing status
    network/     # State of the Network overview
    payments/    # GraphTally / TAP payment pipeline
    poi/         # POI consensus dashboard
    profile/     # Connected wallet portfolio
    sql/         # Public read-only SQL surface over the nests
    subgraphs/   # Subgraph directory
  components/    # UI components, layout, charts, tables, feed
  content/       # Blog posts (Markdown)
  hooks/         # React Query hooks
  lib/           # Nest clients, SQL builders, utilities, wallet config
    ingest/      # Postgres ingestion pipeline (indexers, allocations, epochs)
```

## Contributing

Issues and feedback welcome at [github.com/nightswatchhq/lodestar/issues](https://github.com/nightswatchhq/lodestar/issues).

## License

MIT
