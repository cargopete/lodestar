# Lodestar

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
