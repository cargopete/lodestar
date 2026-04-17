# Lodestar 🌟
_Stay oriented_

![Screen Recording 2026-03-20 at 13 49 40](https://github.com/user-attachments/assets/62f58f1f-55f4-4d32-a8df-8ee3f1c9632e)

Analytics dashboard for The Graph Protocol on Arbitrum One. Real-time network metrics, indexer intelligence, delegation tools, and portfolio tracking for the Horizon era.

**Live:** [lodestar-dashboard.com](https://lodestar-dashboard.com)

## Features

- **Protocol Overview** — Total stake, delegation, signalling, epoch progress, rewards-per-epoch chart, token distribution
- **Intel Feed** — Live protocol intelligence panel with governance proposals, GIP updates, epoch summaries, and announcements sourced from The Graph Forum, GitHub, and on-chain data
- **Indexer Directory** — Sortable/filterable table with stake, delegation capacity, reward cuts, REO eligibility indicators, recent delegation activity icons, and mobile card view
- **Indexer Profiles** — Detailed view with allocations, delegator breakdown, Horizon service provisions, REO eligibility assessment, recent delegation activity, and reward cut change alerts
- **Accurate APR & Effective Cut** — Per-allocation signal-weighted APR calculation and effective cut formula matching [grtinfo](https://github.com/ellipfra/grtinfo)
- **Delegator Portfolio** — Position tracking, rebalancing insights, underperforming position detection, CSV export
- **Curator Portfolio** — Signal positions and query-fee-to-signal ratio analysis
- **Subgraph Directory** — Browsable subgraph list with signal/stake ratio highlighting and IPFS manifest complexity scoring (Light→Extreme)
- **Horizon Activity Feed** — Live on-chain events from the Horizon staking contract — delegations, self-stakes, provisions, slashing, and withdrawals. Refreshes every 30 seconds. Powered by a self-hosted Amp node querying raw Arbitrum One logs. Gracefully degrades if the node is unreachable.
- **Data Services & Provisions** — Horizon-era service providers (Subgraph Service, Dispatch JSON-RPC) with provisioned stake, thawing status, verifier cuts, and ENS-resolved indexer names
- **QoS Performance Charts** — Query count, success rate, latency, and blocks-behind timeseries on indexer profiles, sourced from the E&N QoS oracle subgraph
- **Stake History Charts** — Self-stake and delegation history with cumulative rewards tab
- **Push Protocol Notifications** — Opt-in delegator alerts for reward cut changes and inactive indexer detection. EIP-191 signed subscription; notifications sent via Push Protocol channel
- **One-Click Delegation** — Algorithmically selected indexer with optional preference tuning; smart default with override. See [below](#one-click-delegation).
- **Delegation Calculator** — Model redelegation scenarios with thawing period cost analysis and net gain projections
- **Compare Indexers** — Side-by-side comparison of up to 3 indexers
- **POI Consensus Dashboard** — Divergence detection and stake-weighted consensus across active deployments
- **Governance Tracker** — Live status and impact summaries for active GIPs (0079, 0086, 0087, 0088, 0070) with live protocol metrics
- **GraphTally / TAP Payments** — Escrow balances, RAV redemptions, top collectors, and per-indexer payment detail
- **Indexing Health** — Chain-by-chain indexing lag monitoring, sync progress, and subgraph health across the network
- **AI / MCP Directory** — Curated directory of Graph-ecosystem MCP servers and AI tools at `/ai`
- **Lodie AI Assistant** — Conversational AI assistant with live protocol context, multi-turn memory, and page-aware suggestions. Runs qwen3:8b via self-hosted Ollama; degrades gracefully if unavailable
- **Monthly Leaderboard** — Community favourites leaderboard scored on network service, community votes, trust, and protocol health, with expandable score breakdowns and EIP-712 gasless voting
- **Blog** — Technical writeups on indexer infrastructure, Graph Node architecture, Amp self-hosting, and Horizon tooling
- **Wallet Connection** — Connect via MetaMask, WalletConnect, or Coinbase Wallet (Arbitrum only)
- **Mobile-First Layout** — Bottom tab navigation, table-to-card patterns, responsive grids, touch-friendly targets

## Roadmap

### Planned

- [ ] PWA support — installable to home screen for daily portfolio checking
- [ ] Retention controls for Amp parquet data
- [ ] Lodie: re-enable streaming — currently disabled as a workaround for tunnel buffering

### Shipped

- [x] Horizon Activity feed — live Amp-powered on-chain event stream (v2.6.0)
- [x] Push Protocol delegator notifications — opt-in alerts for cut changes and inactive indexers (v2.6.0)
- [x] QoS performance charts — query count, success rate, latency, blocks-behind (v2.6.0)
- [x] Stake history charts + cumulative rewards tab (v2.6.0)
- [x] AI / MCP directory at `/ai` (v2.6.0)
- [x] One-click delegation — algorithmic indexer selection with preference tuning, smart default with override
- [x] Lodie AI assistant — local Ollama inference with live protocol context
- [x] GraphTally / TAP payment pipeline — escrow balances, redemptions, per-indexer detail
- [x] Indexing health — chain lag monitoring, sync status across deployments
- [x] POI Consensus Dashboard — divergence detection, stake-weighted consensus
- [x] Governance Tracker — live GIP status and impact summaries
- [x] REO (Rewards Eligibility Oracle) heuristic — eligibility indicators in indexer table and detailed assessment on profiles (GIP-0079)
- [x] Recent delegation activity — delegation/undelegation events on indexer profiles, activity indicators in the directory
- [x] Reward cut change alerts — flagged in indexer table and profile when parameters changed within 30 days
- [x] Accurate APR and effective cut using per-allocation signal-weighted rewards (grtinfo method)
- [x] Protocol Intelligence Feed with forum governance, GIP commits, epoch summaries
- [x] Mobile-first responsive overhaul with bottom tab bar and card views
- [x] Horizon-era Data Services & Provisions pages
- [x] Delegation calculator with redelegation cost modelling
- [x] Indexer comparison tool (up to 3 side-by-side)
- [x] Real subgraph data throughout (no mock data in production)

## Indexer Scoring

Each indexer receives a composite score (0–100) across ten dimensions, combined with transparent weights. The score is designed for delegator decision-making — higher is better.

### Dimensions & Weights

| Dimension | Weight | What it measures |
|---|---|---|
| **REO Compliance** | 20% | Rewards Eligibility Oracle status (GIP-0079). Eligible with runway = 100, ineligible = 0. Oracle-sourced data gets full marks; heuristic fallback = partial credit. |
| **Allocation Efficiency** | 13% | Allocated tokens ÷ provisioned tokens. Higher utilisation = more operationally competent. 80%+ = 100, no allocations = 0. |
| **Self-Stake** | 12% | Absolute GRT staked by the indexer — skin in the game. Scored on raw amount, **not** as a ratio of total stake. Having more delegation does *not* reduce this score. Anchors: 100K (protocol minimum) = 35, 500K = 65, 1M = 80, 10M+ = 100, with linear interpolation between points. |
| **Delegator Cut** | 10% | How much of the earnings delegators actually keep. Uses **effective cut** (what delegators actually experience, accounting for indexer's own stake ratio) when available, falling back to raw cut. 0% cut = 100, 25% = 60, 50% = 35, 100% = 0. 100% query fee cut applies a further -15 penalty. |
| **Delegation Safety** | 10% | How close the indexer is to maximum delegation capacity (self-stake × 16). Lower utilisation = more room for new delegators without reward dilution. <50% used = 100, 100% full = 0. |
| **Transparency** | 9% | Has the indexer set an ENS name (+40), website URL (+30), and display name (+30)? Presence and accountability signals. |
| **Delegator APY** | 8% | Actual returns delivered to delegators. Uses 30-day rolling realised APY from closed allocations when available, falling back to estimated APR from current allocations. Anchors: 20%+ = 100, 10% = 75, 5% = 50, 1% = 20, 0% = 0. New indexers with strong returns benefit directly. |
| **Query Volume** | 7% | Cumulative query fees collected in GRT — proof the indexer serves real query traffic. Anchors: 100K+ GRT = 100, 50K = 90, 10K = 70, 1K = 50, >0 = 15, 0 = 0. Weight reduced from 12% to mitigate structural advantage for long-running indexers. |
| **Cut Stability** | 7% | How long since the indexer last changed reward/query fee parameters. Longer = more predictable. 180+ days = 100, <7 days = 30. Floor raised (was 10, now 30) so new indexers aren't punished for being new. Bonus +10 if a cooldown period is set. Hard cap for greedy cuts (100% reward cut → forced to 5). |
| **Delegation Trend** | 4% | 7-day net delegation flow as a percentage of total delegated stake. Positive inflow = crowd confidence; outflow = warning. Low weight because it's inherently noisy. No delegation = neutral 50. |

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
- **Feedback welcome** — if the weights or thresholds feel off, [open an issue](https://github.com/cargopete/lodestar/issues)

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

## Monthly Leaderboard

The community leaderboard at `/leaderboard` celebrates the indexers who contribute most to The Graph network — not just the most profitable ones. It's a "community favourites" ranking: indexers who serve more subgraphs, earn community votes, and maintain trust score highest.

Scores are computed on the 1st of each month via cron, using percentile normalisation (p10/p90) across all active indexers.

Delegator-focused metrics like APR and effective cut live on the **Indexer Directory** scoring (see above), not here.

### Scoring Dimensions

| Component | Dimension | Max Points | Method |
|---|---|---|---|
| **Network Service** | Subgraph Coverage | 20 | Distinct active deployments, percentile-normalised |
| | Query Fees Earned | 10 | Percentile-normalised |
| | Allocation Efficiency | 10 | Fees-to-allocated ratio, percentile-normalised |
| **Community Votes** | Community Votes | 10 | Proportional to highest-voted indexer. 1 vote/wallet/month; delegator votes count 5x. EIP-712 gasless signing. |
| **Trust & Stability** | Cut Stability | 12 | 12-month net change in reward cut |
| | Tenure | 5 | Months active: 24+ = 5, 12+ = 3, 6+ = 2, 3+ = 1 |
| | Delegation Retention | 3 | 30-day net delegation flow |
| **Protocol Health** | REO Eligibility | 6 | Oracle-sourced status |
| **Economics** | Delegation Capacity | 5 | Bucket: <70% = 5, 70-90% = 3, 90-99% = 1, 100% = 0 |

**Total: 81 points**, normalised to 0–100.

### Penalties

Multiplicative penalties stack and reduce the final score. Minimum multiplier: 0.10.

| Penalty | Multiplier |
|---|---|
| Active slashing dispute | ×0.50 |
| Accepted slashing (< 12 months) | ×0.60 |
| Accepted slashing (12–24 months) | ×0.85 |
| 3+ reward cut increases (12 months) | ×0.75 |
| Zero query fees (30 days, active allocs) | ×0.85 |
| Self-stake below 100K GRT | ×0.90 |
| POI consensus < 50% (30 days) | ×0.80 |

The #1 ranked indexer at month-end is named **Indexer of the Month**.

Code: [`src/lib/scoring/`](src/lib/scoring/)

## Tech Stack

- Next.js 16 (App Router, Turbopack)
- React 19, TypeScript, Tailwind CSS 4
- wagmi v3 + viem (Arbitrum One)
- @tanstack/react-query + @tanstack/react-table
- Recharts (area charts, donut charts)
- Self-hosted Postgres (postgres.js) + Upstash Redis
- CoinGecko + DefiLlama (price/TVL data)
- The Graph Network subgraph (Arbitrum, inline fetch)
- Amp (`ampd`) — self-hosted on-chain event indexer for Horizon event history, exposed via Tailscale Funnel
- Ollama (qwen3:8b) — self-hosted inference for the Lodie AI assistant
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
| `DATABASE_URL` | Postgres connection string | Yes |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL | Yes |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token | Yes |
| `CRON_SECRET` | Random string to protect cron endpoints | Yes |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | WalletConnect project ID | No (uses demo) |
| `AMP_ENDPOINT` | Self-hosted `ampd` endpoint for Horizon event history | No |
| `AMP_TOKEN` | Auth token for the `ampd` nginx proxy | No |
| `OLLAMA_URL` | Ollama server URL for Lodie AI assistant | No |
| `OLLAMA_SECRET` | Bearer token for Ollama server (if auth enabled) | No |
| `PUSH_CHANNEL_ADDRESS` | Push Protocol channel wallet address | No |
| `PUSH_CHANNEL_PRIVATE_KEY` | Push Protocol channel private key (for sending notifications) | No |
| `PUSH_ENV` | Push Protocol environment — `staging` or `prod` | No |

Horizon event history (`/api/horizon/*`), Lodie (`/api/lodie/*`), and Push notifications degrade gracefully when their env vars are absent.

## Project Structure

```
src/
  app/           # Next.js pages and API routes
    api/         # Price, subgraph proxy, TVL, feed, cron, Amp, Lodie, Push endpoints
    activity/    # Live Horizon on-chain event feed (Amp-powered)
    ai/          # AI / MCP tool directory
    blog/        # Technical blog (Markdown posts)
    calculator/  # Redelegation calculator
    compare/     # Indexer comparison tool
    curators/    # Curator portfolio
    delegators/  # Delegator portfolio
    governance/  # GIP tracker with live protocol metrics
    indexers/    # Indexer directory + profiles
    indexing/    # Chain health and subgraph indexing status
    leaderboard/ # Monthly indexer leaderboard
    payments/    # GraphTally / TAP payment pipeline
    poi/         # POI consensus dashboard
    profile/     # Connected wallet portfolio
    roadmap/     # Public roadmap
    services/    # Data services (Horizon)
    subgraphs/   # Subgraph directory
  components/    # UI components, layout, charts, tables, feed
  content/       # Blog posts (Markdown)
  hooks/         # React Query hooks
  lib/           # API clients, queries, utilities, wallet config
```

## Contributing

Issues and feedback welcome at [github.com/cargopete/lodestar/issues](https://github.com/cargopete/lodestar/issues).

## License

MIT
