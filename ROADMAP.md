# Lodestar Roadmap

## Vision
Build the first unified, Horizon-native dashboard that solves the fragmentation problem plaguing Graph Protocol participants. Replace the need to cross-reference 6+ broken or dormant tools.

---

## Phase 1: Horizon Schema Foundation ✅
**Goal:** Update data layer for Horizon-era entities and prepare wallet connection infrastructure.

### 1.1 Schema Updates
- [x] Add `Provision` entity queries (stake per data service)
- [x] Add Indexer Horizon fields: `isLegacyIndexer`, `tokensProvisioned`, `ownStakeRatio`
- [x] Add Allocation `isLegacy` flag support
- [ ] Update `GraphNetwork` to use `maxSlashingPercentage`
- [x] Add thawing period per-service tracking
- [ ] Add TAP/RAV redemption data support

### 1.2 Wallet Connection ✅
- [x] Integrate wallet connection (wagmi + viem for Arbitrum One)
- [x] Display connected wallet address in Topbar
- [x] Store wallet preference in localStorage
- [x] Add network switching (Arbitrum One primary)

### 1.3 User Profile Infrastructure ✅
- [x] Create `/profile` page (wallet-gated)
- [x] Query delegator data by connected address
- [x] Query indexer data if address is indexer
- [x] Query curator data if address is curator

---

## Phase 2: Portfolio View ✅
**Goal:** Answer "how much have I earned?" — the #1 broken feature since December 2025.

### 2.1 Delegation Portfolio ✅
- [x] List all active delegations with current values
- [x] Show delegation per (indexer, data service) pair
- [x] Calculate unrealized rewards per delegation
- [x] Show pending undelegation requests with thaw countdown
- [x] Total portfolio value in GRT and USD

### 2.2 Rewards Tracking
- [x] Pending rewards (claimable now)
- [x] Unrealized rewards (accruing)
- [x] Realized rewards (historical, claimed)
- [ ] Rewards by epoch breakdown

### 2.3 Historical Performance
- [x] Portfolio value over time chart
- [x] Cumulative rewards chart
- [ ] Per-indexer performance comparison
- [x] CSV export for tax reporting

### 2.4 Multi-Wallet Support ✅
- [x] Add/remove multiple wallet addresses
- [x] Aggregate portfolio view across wallets
- [x] Per-wallet breakdown toggle

---

## Phase 3: Indexer Intelligence ✅
**Goal:** Make indexer selection data-driven, not guesswork.

### 3.1 Effective Cut Calculator ✅
- [x] Calculate effective cut from protocol cut + stake ratio
- [x] Show how new delegation changes effective cut
- [x] "If I delegate X GRT" simulator
- [x] Visual comparison: advertised vs effective cut
- [ ] Flag indexers with misleading cuts

### 3.2 Indexer Comparison Tool ✅
- [x] Side-by-side comparison (2-4 indexers)
- [x] Metrics: stake, delegation, capacity, cuts, APR
- [ ] Parameter change history timeline
- [x] Cooldown status indicator (shows "Locked" badge when in cooldown)
- [ ] "Locked parameters" badge for marketing analysis

### 3.3 QoS Metrics Integration
- [ ] Average query latency (if data available)
- [ ] Query success rate
- [ ] Blocks behind chain head
- [ ] Uptime/reliability score
- [ ] Data source: explore GraphSeer's approach or gateway metrics

### 3.4 Indexer Score ✅
- [x] Composite score algorithm (7-dimension A–F grading) — used on indexer directory
- [x] Allocation Efficiency component
- [x] REO Compliance component (25% weight, oracle-sourced)
- [x] Cut Stability component
- [x] Self-Stake, Over-Delegation, Transparency, Delegation Trend components
- [x] **RFC-003 Leaderboard Scoring** — separate 12-dimension 0–100 scoring engine (see RFC-003 section below)

### 3.5 Indexer Directory Enhancements
- [ ] "Recommended for you" section based on portfolio
- [x] Filter by: capacity available, low cut, high reliability
- [x] Sort by: effective APR, score, capacity
- [ ] Bookmark/watchlist functionality

---

## Phase 4: Decision Support
**Goal:** Answer "should I switch indexers?" with hard numbers.

### 4.1 Redelegation Cost Model ✅
- [x] Calculate rewards lost during thawing period
- [x] Estimate gas costs (undelegate + delegate transactions)
- [x] Project returns from current vs alternative indexer
- [x] Break-even timeline calculation
- [x] Net benefit/loss over 30/90/180 days

### 4.2 "Should I Switch?" Calculator ✅
- [x] Input: current indexer, target indexer, delegation amount
- [x] Output: recommendation with financial breakdown
- [ ] Sensitivity analysis (what if APR changes?)
- [ ] Factor in parameter cooldowns
- [ ] Consider multiple undelegation request strategy

### 4.3 Parameter Change Alerts (Partial)
- [x] Track indexer parameter changes (cut, cooldown) — stored in database
- [x] Visual indicators on indexer table (7d/30d change dots)
- [ ] In-app notification center
- [ ] Telegram bot integration
- [ ] Email alerts
- [ ] Threshold-based triggers (e.g., cut increased >5%)

### 4.4 Opportunity Scanner (Partial)
- [x] Rebalancing insights on delegator portfolio (flags positions >20% below median APR)
- [x] Recommends top alternative indexer with higher APR + available capacity
- [ ] Rank alternatives by net benefit after switch costs
- [ ] "Quick wins" — switches that pay off in <30 days

---

## Phase 5: Multi-Service Future ✅
**Goal:** First-mover tooling for Horizon's per-service delegation model.

### 5.1 Provisions Tracking ✅
- [x] Display indexer provisions per data service
- [x] Show provisioned vs allocated breakdown
- [x] Track provision changes over time (thaw requests)
- [x] Utilization rate per service

### 5.2 Service Directory ✅
- [x] List available data services (SubgraphService first)
- [x] Service-specific parameters (thawing, slashing)
- [x] Indexer coverage per service
- [x] Service health metrics (utilization, allocation count)

### 5.3 Cross-Service Strategy
- [ ] Portfolio allocation across services
- [ ] Risk/reward comparison by service
- [ ] Diversification recommendations
- [ ] "Rebalance" suggestions

### 5.4 Future Service Readiness
- [x] Substreams Data Service tracking (mock data ready)
- [x] Token API service tracking (mock data ready)
- [ ] SQL service tracking
- [x] Extensible service plugin architecture (query/type structure)

**Shipped:**
- [x] Provisions dashboard (`/services` page)
- [x] Service comparison tools (expandable cards)
- [x] Multi-service portfolio view (indexer detail page)
- [x] Architecture ready for new services

---

## Phase 6: Curator Analytics
**Goal:** Serve the completely ignored curator role.

### 6.1 Curation Portfolio (Partial)
- [x] List signal positions with performance ranking
- [x] Query-fees-to-signal ratio
- [ ] Unrealized P&L per subgraph (bonding curve valuation)
- [ ] Signal vs query fee correlation

### 6.2 Subgraph Analysis
- [ ] Query volume trends
- [ ] Fee generation potential
- [ ] Curation competition analysis
- [ ] "Signal here" recommendations

### 6.3 Bonding Curve Tools
- [ ] Entry/exit price simulator
- [ ] Slippage calculator
- [ ] Optimal signal sizing

---

## Standalone Features (Shipped)

### POI Consensus Dashboard ✅
- [x] `/poi` — overview of POI consensus across deployments
- [x] `/poi/[deployment]` — per-deployment divergence detection
- [x] Stake-weighted consensus rate calculation
- [x] Sort by divergent, consensus, recent, signal

### IPFS Manifest Analyzer ✅
- [x] `/subgraphs/[hash]` — YAML manifest parsing from IPFS
- [x] Complexity scoring: Light / Moderate / Heavy / Extreme
- [x] Data source breakdown (events, calls, blocks, templates)

### REO Compliance Tracking ✅
- [x] Oracle-sourced eligibility from GIP-0079 contract
- [x] Renewal countdown with badge on indexer pages
- [x] Heuristic fallback when oracle unavailable

### Governance Tracker ✅
- [x] `/governance` — GIP-0079, 0086, 0087, 0088, 0070 status
- [x] Live metrics: eligible indexer counts, issuance splits
- [x] Indexer & delegator impact summaries

### Network Snapshots ✅
- [x] Self-hosted Postgres ingestion pipeline (DigitalOcean droplet)
- [x] Tables: `network_snapshots`, `epochs`, `indexers`, `allocations`, `delegations`, `disputes`, `parameter_changes`, `indexer_scores`
- [x] Chunked upserts to avoid statement timeouts
- [x] Standalone cron runner (`scripts/cron-runner.ts`) for droplet execution

---

## RFC-003: Indexer Leaderboard & Indexer of the Month

Monthly leaderboard scoring engine with percentile-normalised scores across 10 dimensions, multiplicative penalties, and Indexer of the Month.

### Scoring Engine ✅
- [x] 10-dimension scoring formula (4 components: Network 35pts, Economics 25pts, Trust 20pts, Health 6pts)
- [x] Percentile normalization (p10/p90 bounds, linear interpolation)
- [x] Multiplicative penalty system (7 penalty types, stacking, 0.1 floor)
- [x] Monthly computation pipeline (`computeMonthlyScores`)
- [x] `indexer_scores` table with full component breakdown
- [x] Cron runner integration (`compute-scores` step)
- [x] Unit tests covering all components, normalization, and penalties
- [x] Indexer of the Month badge (#1 ranked indexer each month)

### Leaderboard Page
- [ ] `/leaderboard` route with monthly rankings
- [ ] Period selector (month/year toggle)
- [ ] Expandable score breakdown per indexer (all 12 sub-dimensions)
- [ ] Badge indicator for eligible indexers
- [ ] Wire leaderboard data into Redis for Vercel reads

### Community Voting (Phase 3 — deferred)
- [ ] Wallet-signature voting mechanism (10pts max, reserved in formula)
- [ ] Vote tallying and integration into final score
- [ ] Anti-gaming measures

### Indexer of the Month (Partial)
- [x] Monthly badge assignment (#1 ranked scorer)
- [ ] Intel Feed integration
- [ ] Historical badge display on indexer profile

---

## Community Requests

### Delegation Activity (Matthew Darwin / Pinax — 2026-03-25)
- [x] Filter delegation activity feed by indexer on the Delegators page
- [x] Add delegation activity section to individual indexer detail pages
- [x] Historical delegation data via backend ingestion pipeline (605K+ events backfilled)

### Indexer Logs (Matthew Darwin / Pinax — 2026-03-25)
- [ ] Integrate indexer subgraph indexing status logs via upcoming API (pending upstream availability)

### Delegator Protection & APY (PaulieB14 — GitHub issue #1, 2026-03-20)
- [x] Highlight 100% reward cut indexers with greedy indexer warnings on the Indexer Directory
- [x] Add educational tooltips at top of indexer table explaining reward cut, effective cut, and warning signs
- [x] 30/90-day rolling APY alongside current APR for longer-term performance view
- Reference: https://github.com/PaulieB14/delegator-apy-dashboard

### Indexer Operations (Gemma / LunaNova — 2026-03-25)
- [ ] Indexing status at indexer level — show all allocated subgraphs and how close to chainhead each is
- [ ] Query traffic over recent windows (1d / 2d / 7d) per indexer
- [x] Subgraph indexer count on `/subgraphs` should only count active allocations (not historical)

---

## Blog

Content platform for operational knowledge that's currently scattered across Discord and lost to history.

### Infrastructure
- [x] Blog platform (Markdown in repo, SSG via remark — shipped v1.4.0)
- [x] Blog restyle — hero section, gradient accents, sidebar metadata, GFM table support, Graph-inspired design

### Initial Topics
- [ ] **Graph-node memory leak investigation** — idle proxy nodes reaching 12GB over 6-8h with no block ingestion or subgraph sync (sourced from Tehn's report, 2026-03-25)
- [ ] **Ingestor architecture guide** — single ingestor vs per-chain nodes, the `[chains]` top-level config pattern, E&N's approach of one ingestor for all chains
- [ ] **Graph-node config best practices** — single shared config vs per-node configs, PG connection sprawl, common misconfigurations (duplicate node names bypassing ingestor settings)
- [ ] **Per-chain tuning options** — what's coming in graph-node config (Maks exploring per-chain settings to replace global ENVs)
- [x] **Graph-node stack architecture patterns** — the 3 golden rules, advanced patterns, common misconfigs, Horizon-era stack changes (sourced from Marc-André / Ellipfra, 2026-03-25)

---

## Technical Architecture

### Data Sources
| Source | Purpose | Update Frequency |
|--------|---------|------------------|
| Graph Network Subgraph | Core protocol data | 5 min |
| graph-network-analytics-horizon | Historical analytics | 5 min |
| CoinGecko API | GRT price | 30 sec |
| DefiLlama API | TVL data | 5 min |
| Self-hosted Postgres (DigitalOcean) | Persistent snapshots, ingestion, scoring | Cron-driven |
| GIP-0079 REO Oracle | Rewards eligibility | On-demand |
| Gateway metrics (TBD) | QoS data | 1 min |

### Stack
```
Next.js 16          # App router, API routes
wagmi + viem        # Wallet connection (Arbitrum One)
RainbowKit          # Wallet UI
React Query         # Server state management
postgres.js         # Direct Postgres (self-hosted on DigitalOcean droplet)
Upstash Redis       # Edge-friendly cache layer for Vercel
Tailwind CSS        # Styling (mobile-first responsive)
```

### Data Pipeline (DigitalOcean Droplet)
```
# Standalone cron runner — scripts/cron-runner.ts
npx tsx scripts/cron-runner.ts refresh        # Full enrichment → Redis + Postgres
npx tsx scripts/cron-runner.ts epochs         # Ingest epochs
npx tsx scripts/cron-runner.ts allocations    # Ingest allocations (delta)
npx tsx scripts/cron-runner.ts delegations    # Ingest delegation events
npx tsx scripts/cron-runner.ts disputes       # Ingest disputes
npx tsx scripts/cron-runner.ts snapshot       # Network snapshot
npx tsx scripts/cron-runner.ts compute-scores # Monthly leaderboard scoring
```

### API Routes (Live)
```
# Data Ingestion (legacy Vercel cron wrappers — pipeline runs on droplet)
GET  /api/cron/snapshot-network     # Network state snapshot
GET  /api/cron/ingest-allocations   # Closed allocations (POI)
GET  /api/cron/ingest-delegations   # Delegation events
GET  /api/cron/ingest-disputes      # Disputes
GET  /api/cron/ingest-epochs        # Epoch data
GET  /api/cron/refresh              # Orchestrate full refresh

# Data Queries
GET  /api/indexers                  # Paginated indexer directory
GET  /api/indexers-enriched         # Indexers with pre-computed scores
GET  /api/indexer/[address]         # Single indexer detail
GET  /api/epochs                    # Historical epoch data
GET  /api/network-stats             # Current network aggregates
GET  /api/price                     # GRT price (CoinGecko)
GET  /api/tvl                       # Network TVL

# Features
GET  /api/poi                       # POI consensus data
GET  /api/reo                       # REO eligibility status
GET  /api/manifest                  # IPFS manifest parse
GET  /api/feed                      # Activity feed
GET  /api/delegation-events         # Raw delegation events

# Subgraph / Search
POST /api/subgraph                  # Raw subgraph query proxy
GET  /api/subgraph-search           # Search subgraphs by name
GET  /api/subgraph-deployments      # Top deployments by stake
GET  /api/indexing-status/[hash]    # Sync status across indexers

# Other
GET  /api/ens                       # ENS name resolution
```

---

## Success Metrics

| Metric | Target | Status |
|--------|--------|--------|
| Portfolio load time | <2s | ✅ Achieved |
| Reward calculation accuracy | 99.9% vs on-chain | ✅ Achieved |
| Daily active users | 500+ (Month 3) | TBD |
| Tool consolidation | Replace 4+ external tools | ✅ Achieved |
| Horizon feature coverage | 100% of new primitives | ~80% |

---

## Competitive Moat

| Capability | Status | Competition |
|------------|--------|-------------|
| Working portfolio tracker | ✅ Live | Explorer still broken |
| Effective cut calculator | ✅ Live | Graphscan dormant |
| Composite risk scoring | ✅ Live | Nobody else has this |
| Multi-service provisions | ✅ Live | Zero competition |
| Redelegation modeler | ✅ Live | Novel feature |
| POI consensus dashboard | ✅ Live | Novel feature |
| IPFS manifest analyzer | ✅ Live | Novel feature |
| REO compliance tracking | ✅ Live | Novel feature |
| Governance impact tracker | ✅ Live | Novel feature |
| Curator tools | 🔨 Basic | Greenfield |
| QoS + economics combined | ❌ Blocked | GraphSeer stalled, no economics |
| Rolling APY (30/90d) | ✅ Live | PaulieB14's dashboard is standalone |
| Greedy indexer warnings | ✅ Live | Novel feature |
| Delegation activity feed | ✅ Live | Novel feature |
| Indexer leaderboard scoring | ✅ Engine live | Novel feature (RFC-003) |

The window is open. Let's build.
