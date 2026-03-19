# Lodestar Roadmap

## Vision
Build the first unified, Horizon-native dashboard that solves the fragmentation problem plaguing Graph Protocol participants. Replace the need to cross-reference 6+ broken or dormant tools.

---

## Phase 1: Horizon Schema Foundation
**Goal:** Update data layer for Horizon-era entities and prepare wallet connection infrastructure.

### 1.1 Schema Updates
- [ ] Add `Provision` entity queries (stake per data service)
- [ ] Add Indexer Horizon fields: `isLegacyIndexer`, `tokensProvisioned`, `ownStakeRatio`
- [ ] Add Allocation `isLegacy` flag support
- [ ] Update `GraphNetwork` to use `maxSlashingPercentage`
- [ ] Add thawing period per-service tracking
- [ ] Add TAP/RAV redemption data support

### 1.2 Wallet Connection
- [ ] Integrate wallet connection (wagmi + viem for Arbitrum One)
- [ ] Display connected wallet address in Topbar
- [ ] Store wallet preference in localStorage
- [ ] Add network switching (Arbitrum One primary)

### 1.3 User Profile Infrastructure
- [ ] Create `/profile` page (wallet-gated)
- [ ] Query delegator data by connected address
- [ ] Query indexer data if address is indexer
- [ ] Query curator data if address is curator

**Deliverables:**
- Wallet connect button functional
- Profile page showing role detection
- All Horizon schema fields available in queries

---

## Phase 2: Portfolio View
**Goal:** Answer "how much have I earned?" — the #1 broken feature since December 2025.

### 2.1 Delegation Portfolio
- [ ] List all active delegations with current values
- [ ] Show delegation per (indexer, data service) pair
- [ ] Calculate unrealized rewards per delegation
- [ ] Show pending undelegation requests with thaw countdown
- [ ] Total portfolio value in GRT and USD

### 2.2 Rewards Tracking
- [ ] Pending rewards (claimable now)
- [ ] Unrealized rewards (accruing)
- [ ] Realized rewards (historical, claimed)
- [ ] Rewards by epoch breakdown

### 2.3 Historical Performance
- [ ] Portfolio value over time chart
- [ ] Cumulative rewards chart
- [ ] Per-indexer performance comparison
- [ ] CSV export for tax reporting

### 2.4 Multi-Wallet Support
- [ ] Add/remove multiple wallet addresses
- [ ] Aggregate portfolio view across wallets
- [ ] Per-wallet breakdown toggle

**Deliverables:**
- Functional portfolio dashboard
- Working reward calculations
- Historical charts
- CSV export

---

## Phase 3: Indexer Intelligence
**Goal:** Make indexer selection data-driven, not guesswork.

### 3.1 Effective Cut Calculator
- [ ] Calculate effective cut from protocol cut + stake ratio
- [ ] Show how new delegation changes effective cut
- [ ] "If I delegate X GRT" simulator
- [ ] Visual comparison: advertised vs effective cut
- [ ] Flag indexers with misleading cuts

### 3.2 Indexer Comparison Tool
- [ ] Side-by-side comparison (2-4 indexers)
- [ ] Metrics: stake, delegation, capacity, cuts, APR
- [ ] Parameter change history timeline
- [ ] Cooldown status indicator
- [ ] "Locked parameters" badge for marketing analysis

### 3.3 QoS Metrics Integration
- [ ] Average query latency (if data available)
- [ ] Query success rate
- [ ] Blocks behind chain head
- [ ] Uptime/reliability score
- [ ] Data source: explore GraphSeer's approach or gateway metrics

### 3.4 Indexer Score
- [ ] Composite score algorithm (inspired by Graphtronauts)
- [ ] Allocation Efficiency component
- [ ] Query Fee Ratio component
- [ ] Reliability component
- [ ] Configurable weighting

### 3.5 Indexer Directory Enhancements
- [ ] "Recommended for you" section based on portfolio
- [ ] Filter by: capacity available, low cut, high reliability
- [ ] Sort by: effective APR, score, capacity
- [ ] Bookmark/watchlist functionality

**Deliverables:**
- Effective cut calculator on each indexer
- Side-by-side comparison tool
- Enhanced indexer directory with scoring
- QoS integration (data permitting)

---

## Phase 4: Decision Support
**Goal:** Answer "should I switch indexers?" with hard numbers.

### 4.1 Redelegation Cost Model
- [ ] Calculate rewards lost during thawing period
- [ ] Estimate gas costs (undelegate + delegate transactions)
- [ ] Project returns from current vs alternative indexer
- [ ] Break-even timeline calculation
- [ ] Net benefit/loss over 30/90/180 days

### 4.2 "Should I Switch?" Calculator
- [ ] Input: current indexer, target indexer, delegation amount
- [ ] Output: recommendation with financial breakdown
- [ ] Sensitivity analysis (what if APR changes?)
- [ ] Factor in parameter cooldowns
- [ ] Consider multiple undelegation request strategy

### 4.3 Parameter Change Alerts
- [ ] Track indexer parameter changes (cut, cooldown)
- [ ] In-app notification center
- [ ] Telegram bot integration (optional)
- [ ] Email alerts (optional)
- [ ] Threshold-based triggers (e.g., cut increased >5%)

### 4.4 Opportunity Scanner
- [ ] Scan for indexers with better effective APR
- [ ] Factor in capacity constraints
- [ ] Rank alternatives by net benefit after switch costs
- [ ] "Quick wins" — switches that pay off in <30 days

**Deliverables:**
- Redelegation calculator
- Recommendation engine
- Alert system foundation
- Opportunity scanner

---

## Phase 5: Multi-Service Future
**Goal:** First-mover tooling for Horizon's per-service delegation model.

### 5.1 Provisions Tracking
- [x] Display indexer provisions per data service
- [x] Show provisioned vs allocated breakdown
- [x] Track provision changes over time (thaw requests)
- [x] Utilization rate per service

### 5.2 Service Directory
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

**Deliverables:**
- [x] Provisions dashboard (/services page)
- [x] Service comparison tools (expandable cards)
- [x] Multi-service portfolio view (indexer detail page)
- [x] Architecture ready for new services

---

## Phase 6: Curator Analytics (Stretch)
**Goal:** Serve the completely ignored curator role.

### 6.1 Curation Portfolio
- [ ] List signal positions with bonding curve values
- [ ] Unrealized P&L per subgraph
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

**Deliverables:**
- Curator portfolio view
- Subgraph analysis tools
- Bonding curve calculators

---

## Technical Architecture

### Data Sources
| Source | Purpose | Update Frequency |
|--------|---------|------------------|
| Graph Network Subgraph | Core protocol data | 5 min |
| graph-network-analytics-horizon | Historical analytics | 5 min |
| CoinGecko API | GRT price | 30 sec |
| DefiLlama API | TVL data | 5 min |
| Gateway metrics (TBD) | QoS data | 1 min |

### Key Dependencies to Add
```
wagmi          # Wallet connection
viem           # Ethereum interactions
@rainbow-me/rainbowkit  # Wallet UI (optional)
zustand        # Client state management
```

### New API Routes Needed
```
POST /api/subgraph          # Existing - enhance queries
GET  /api/delegator/[address]  # Delegator portfolio
GET  /api/indexer/[address]    # Indexer details
GET  /api/rewards/[address]    # Rewards calculation
POST /api/simulate/redelegate  # Redelegation cost model
```

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Portfolio load time | <2s |
| Reward calculation accuracy | 99.9% vs on-chain |
| Daily active users | 500+ (Month 3) |
| Tool consolidation | Replace 4+ external tools |
| Horizon feature coverage | 100% of new primitives |

---

## Timeline Estimate

| Phase | Scope | Duration |
|-------|-------|----------|
| Phase 1 | Foundation | 1 week |
| Phase 2 | Portfolio | 2 weeks |
| Phase 3 | Indexer Intelligence | 2 weeks |
| Phase 4 | Decision Support | 2 weeks |
| Phase 5 | Multi-Service | 1 week |
| Phase 6 | Curator (stretch) | 1 week |

**Total: ~9 weeks to full feature parity + differentiation**

---

## Competitive Moat

Once built, this dashboard will be:
1. **Only working portfolio tracker** — Explorer still broken
2. **Only effective cut calculator** — Graphscan dormant
3. **Only QoS + economics combined** — GraphSeer stalled, no economics
4. **Only multi-service ready** — Zero competition
5. **Only redelegation modeler** — Novel feature, nobody has it
6. **Only curator tools** — Greenfield

The window is open. Let's build.
