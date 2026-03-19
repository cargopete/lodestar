# Lodestar

Analytics dashboard for The Graph Protocol on Arbitrum One. Real-time network metrics, indexer comparison, delegation tools, and portfolio tracking for the Horizon era.

**Live:** [lodestar-dashboard.com](https://lodestar-dashboard.com)

## Features

- **Protocol Overview** — Total stake, delegation, signalling, epoch progress (live from chain), rewards-per-epoch chart, token distribution
- **Indexer Directory** — Sortable table of all active indexers with stake, delegation capacity, reward cuts, and estimated APR
- **Indexer Profiles** — Detailed view with allocations, delegator breakdown, and provisions
- **Delegator Portfolio** — Position tracking, rebalancing insights, underperforming position detection
- **Curator Portfolio** — Signal positions and query-fee-to-signal ratio analysis
- **Subgraph Directory** — Browsable subgraph list with signal/stake ratio highlighting
- **Delegation Calculator** — Model redelegation scenarios with thawing period cost analysis
- **Compare Indexers** — Side-by-side comparison of up to 3 indexers
- **Horizon Parameters** — Explainers for Horizon-era protocol changes (maxPOIStaleness, deprecated delegation tax, legacy allocation epochs)
- **Wallet Connection** — Connect via MetaMask, WalletConnect, or Coinbase Wallet (Arbitrum only)

## Tech Stack

- Next.js 16 (App Router, Turbopack)
- React 19, TypeScript, Tailwind CSS 4
- wagmi v3 + viem (Arbitrum One)
- @tanstack/react-query + @tanstack/react-table
- Recharts (area charts, donut charts)
- graphql-request (Graph Network subgraph)
- CoinGecko + DefiLlama (price/TVL data)

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
    api/         # Price, subgraph proxy, TVL endpoints
    calculator/  # Redelegation calculator
    compare/     # Indexer comparison tool
    curators/    # Curator portfolio
    delegators/  # Delegator portfolio
    indexers/    # Indexer directory + profiles
    profile/     # Connected wallet portfolio
    services/    # Data services (Horizon)
    subgraphs/   # Subgraph directory
  components/    # UI components, layout, charts, tables
  hooks/         # React Query hooks
  lib/           # API clients, queries, utilities, wallet config
```

## License

MIT
