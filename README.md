# Lodestar 🌟
_Stay oriented_

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
- **Subgraph Dock** — Developer studio for subgraph publishers: connect with your Studio account, view published subgraphs and sync status, manage metadata (name, description, image, website), generate deploy keys, query live deployments, and interact with the Sync Bounty Board. Full on-chain lifecycle for published subgraphs — update metadata (`GNS.updateSubgraphMetadata`), transfer ownership and deprecate, each behind a typed irreversibility confirmation
- **Subgraph Directory** — Browsable subgraph list with signal/stake ratio highlighting, IPFS manifest complexity scoring (Light→Extreme), category filter (DeFi/NFT/DAO), contract-address search (find subgraphs indexing a given contract), and sorting by signal/stake/query fees or recently created
- **Subgraph Detail** — Embedded GraphiQL playground (schema browser, autocomplete) with the real copyable gateway query URL, deployment version history (semver labels + IPFS hashes), and an activity timeline (version publishes + curator signal events)
- **Horizon Activity Feed** — Live on-chain events from the Horizon staking contract — delegations, self-stakes, provisions, slashing, and withdrawals. Refreshes every 30 seconds. Powered by a self-hosted Amp node querying raw Arbitrum One logs. Gracefully degrades if the node is unreachable.
- **QoS Performance Charts** — Query count, success rate, latency, and blocks-behind timeseries on indexer profiles, sourced from the E&N QoS oracle subgraph
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
- **Feedback welcome** — if the weights or thresholds feel off, [open an issue](https://github.com/lodestar-team/lodestar/issues)

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
- Self-hosted Postgres 16 (postgres.js) + Upstash Redis
- CoinGecko + DefiLlama (price/TVL data)
- The Graph Network subgraph (Arbitrum, inline fetch)
- Alchemy — Arbitrum One RPC for on-chain contract reads
- Amp (`ampd`) — optional self-hosted on-chain event indexer for Horizon event history
- Push Protocol — opt-in delegator notifications via on-chain channel

## Getting Started

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment Variables

| Variable | Description | Required |
|---|---|---|
| `GRAPH_API_KEY` | API key from [The Graph Studio](https://thegraph.com/studio/apikeys/) | Yes |
| `DATABASE_URL` | Postgres connection string (`postgresql://user:pass@host:port/db`) | Yes |
| `KV_REST_API_URL` | Upstash Redis REST URL | Yes |
| `KV_REST_API_TOKEN` | Upstash Redis REST token | Yes |
| `KV_REST_API_READ_ONLY_TOKEN` | Upstash Redis read-only token | Yes |
| `CRON_SECRET` | Random string to protect cron endpoints | Yes |
| `ARBITRUM_RPC_URL` | Arbitrum One RPC URL (Alchemy, Infura, etc.) | Yes |
| `GITHUB_TOKEN` | GitHub PAT for the Intel Feed (forum/GIP data) | Yes |
| `NEXT_PUBLIC_SITE_URL` | Production URL e.g. `https://lodestar-dashboard.com` | Yes |
| `GRAPH_NODE_FREE_QUERY_KEY` | Graph Node API key for free-tier queries | No |
| `TOKEN_API_KEY` | Token metadata API key | No |
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

Horizon event history (`/api/horizon/*`), Push notifications, and Seahorn all degrade gracefully when their env vars are absent.

## Project Structure

```
src/
  app/           # Next.js pages and API routes
    api/         # Price, subgraph proxy, TVL, feed, cron, Horizon, Push, studio endpoints
    activity/    # Live Horizon on-chain event feed (Amp-powered)
    ai/          # AI / MCP tool directory
    blog/        # Technical blog (Markdown posts)
    calculator/  # Redelegation calculator
    compare/     # Indexer comparison tool
    curate/      # Wallet-connected curation tool (signal/unsignal)
    curators/    # Curator directory
    delegators/  # Delegator portfolio
    dock/        # Subgraph developer studio (publish, metadata, deploy keys, bounties)
    indexers/    # Indexer directory + profiles
    indexing/    # Chain health and subgraph indexing status
    payments/    # GraphTally / TAP payment pipeline
    poi/         # POI consensus dashboard
    profile/     # Connected wallet portfolio
    protocols/   # Protocol list and details
    subgraphs/   # Subgraph directory
    tokens/      # Token analytics
  components/    # UI components, layout, charts, tables, feed
  content/       # Blog posts (Markdown)
  hooks/         # React Query hooks
  lib/           # API clients, queries, utilities, wallet config
    ingest/      # Postgres ingestion pipeline (indexers, allocations, epochs)
```

## Contributing

Issues and feedback welcome at [github.com/lodestar-team/lodestar/issues](https://github.com/lodestar-team/lodestar/issues).

## License

MIT
