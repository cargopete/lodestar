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
- **Delegator Portfolio** — Position tracking, rebalancing insights, underperforming position detection
- **Curator Portfolio** — Signal positions and query-fee-to-signal ratio analysis
- **Subgraph Directory** — Browsable subgraph list with signal/stake ratio highlighting
- **Data Services & Provisions** — Horizon-era service providers, provisioned stake, thawing status, verifier cuts
- **Delegation Calculator** — Model redelegation scenarios with thawing period cost analysis and net gain projections
- **Compare Indexers** — Side-by-side comparison of up to 3 indexers
- **Wallet Connection** — Connect via MetaMask, WalletConnect, or Coinbase Wallet (Arbitrum only)
- **Mobile-First Layout** — Bottom tab navigation, table-to-card patterns, responsive grids, touch-friendly targets

## Roadmap

### In Progress

- [ ] Historical Trend Charts — query fee distribution, staking/signal trends, epoch sparklines, reward cut history (1,200+ epochs of data available)

### Planned

- [ ] PWA support — installable to home screen for daily portfolio checking

### Shipped

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

Each indexer receives a composite score (0–100) across nine dimensions, combined with transparent weights. The score is designed for delegator decision-making — higher is better.

### Dimensions & Weights

| Dimension | Weight | What it measures |
|---|---|---|
| **REO Compliance** | 20% | Rewards Eligibility Oracle status (GIP-0079). Eligible with runway = 100, ineligible = 0. Oracle-sourced data gets full marks; heuristic fallback = partial credit. |
| **Self-Stake** | 13% | Absolute GRT staked by the indexer — skin in the game. Scored on raw amount, **not** as a ratio of total stake. Having more delegation does *not* reduce this score. Anchors: 100K (protocol minimum) = 35, 500K = 65, 1M = 80, 10M+ = 100, with linear interpolation between points. |
| **Query Volume** | 12% | Cumulative query fees collected in GRT — proof the indexer serves real query traffic. Anchors: 100K+ GRT = 100, 50K = 90, 10K = 70, 1K = 50, >0 = 15, 0 = 0. |
| **Allocation Efficiency** | 13% | Allocated tokens ÷ provisioned tokens. Higher utilisation = more operationally competent. 80%+ = 100, no allocations = 0. |
| **Delegator Cut** | 10% | How much of the earnings delegators actually keep. Scores the indexing reward cut (primary, where most earnings come from) with a secondary penalty for high query fee cut. 0% reward cut = 100, 25% = 60, 50% = 35, 100% = 0. 100% query fee cut applies a further -15 penalty. |
| **Cut Stability** | 8% | How long since the indexer last changed reward/query fee parameters. Longer = more predictable. 180+ days = 100, <7 days = 10. Bonus +10 if a cooldown period is set. Hard cap for greedy cuts (100% reward cut → forced to 5). |
| **Delegation Safety** | 10% | How close the indexer is to maximum delegation capacity (self-stake × 16). Lower utilisation = more room for new delegators without reward dilution. <50% used = 100, 100% full = 0. |
| **Transparency** | 9% | Has the indexer set an ENS name (+40), website URL (+30), and display name (+30)? Presence and accountability signals. |
| **Delegation Trend** | 5% | 7-day net delegation flow as a percentage of total delegated stake. Positive inflow = crowd confidence; outflow = warning. Low weight because it's inherently noisy. No delegation = neutral 50. |

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

## Tech Stack

- Next.js 16 (App Router, Turbopack)
- React 19, TypeScript, Tailwind CSS 4
- wagmi v3 + viem (Arbitrum One)
- @tanstack/react-query + @tanstack/react-table
- Recharts (area charts, donut charts)
- CoinGecko + DefiLlama (price/TVL data)
- The Graph Network subgraph (Arbitrum, inline fetch)

## Getting Started

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment Variables

| Variable | Description | Required |
|---|---|---|
| `GRAPH_API_KEY` | API key from [The Graph Studio](https://thegraph.com/studio/apikeys/) | No (falls back to mock data) |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | WalletConnect project ID | No (uses demo) |

Without `GRAPH_API_KEY`, the dashboard runs with mock data for development.

## Project Structure

```
src/
  app/           # Next.js pages and API routes
    api/         # Price, subgraph proxy, TVL, feed endpoints
    calculator/  # Redelegation calculator
    compare/     # Indexer comparison tool
    curators/    # Curator portfolio
    delegators/  # Delegator portfolio
    indexers/    # Indexer directory + profiles
    profile/     # Connected wallet portfolio
    services/    # Data services (Horizon)
    subgraphs/   # Subgraph directory
  components/    # UI components, layout, charts, tables, feed
  hooks/         # React Query hooks
  lib/           # API clients, queries, utilities, wallet config
```

## Contributing

Issues and feedback welcome at [github.com/cargopete/lodestar/issues](https://github.com/cargopete/lodestar/issues).

## License

MIT
