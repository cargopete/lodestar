# April 2026 — Roadmap

Tracking community-requested features, gap analysis items, and enhancements.

---

## Community Feature Requests (v1.5.9 — all shipped)

### Andrew Clews (via EthCC, 30 Mar 2026)

| # | Feature | Status |
|---|---------|--------|
| 1 | Delegation inflows/outflows chart (`/delegators`) | Done (v1.5.9) |
| 2 | Token issuance/burn chart (`/delegators`) | Done (v1.5.9) |

### IroqouisPliskin (via GRT chat, 30 Mar 2026)

| # | Feature | Status |
|---|---------|--------|
| 3 | Subgraph name/network header (`/subgraphs/[hash]`) | Done (v1.5.9) |
| 4 | Filter state persistence (`/subgraphs`) | Done (v1.5.9) |

---

## Gap Analysis — What's Already in Lodestar

Features from the community needs report that are already built:

| Feature | Status | Where |
|---------|--------|-------|
| Provision management dashboard | Done | ProvisionsPanel, `/api/provisions` |
| GraphTally payment flow tracker | Done | `/payments` — escrow, redemptions, collection |
| POI tracking | Partial | `/poi` explorer + detail pages (no countdown timers or alerts) |
| Multi-data-service comparison | Partial | `/services` page, per-service breakdown |
| Indexer trust/risk score | Done | 10-dimension composite (A–F), `risk-score.ts` |
| Effective commission display | Done | Indexer profiles + `/compare` |
| Network health dashboard | Done | Home page — staked, delegated, fees, TVL, epochs |
| Overdelegation detection | Partial | Scored in risk model, no simulator |
| Tax-ready CSV export | Done | ExportButton on delegator portfolio |
| Governance tracker | Done | `/governance` — GIP status, impact, forum links |
| Subgraph health monitor | Done | Sync status, block lag, errors on detail pages |
| Allocation tracker per subgraph | Partial | Visible on detail pages, no dedicated trend view |
| Community voting | Done | EIP-712, weighted votes (delegators 5x) |
| REO eligibility | Done | Oracle-sourced, shown on indexer pages |
| Indexer trends chart | Done | Daily rewards & query fees (v1.5.8) |
| Leaderboard + IOTM | Done | Monthly scoring, badge holder, trophy icon |
| Delegation flows chart | Done | v1.5.9 |
| Token issuance & burn chart | Done | v1.5.9 |
| Mobile responsive | Done | Throughout |
| Blog | Done | Three posts live |

---

## Gap Analysis — What's NOT Built Yet

### Tier 2 — Analytics & Charting

| # | Feature | Effort | Impact | Status |
|---|---------|--------|--------|--------|
| 9 | **Parameter change timeline** — timestamped log of every indexer reward/fee cut change. Stake Machine did this but is dead. | Medium | High | Done |
| 10 | **Revenue decomposition per subgraph** — net profitability per allocation after gas costs | High | High (indexers) | Not started |
| 11 | **APR transparency breakdown** — show every variable in the APR formula with conservative/optimistic projections | Low-Med | Medium | Not started |

### Tier 1 — Horizon-Native (remaining gaps)

| # | Feature | Effort | Impact | Status |
|---|---------|--------|--------|--------|
| 5 | **Stake-to-fees collateral monitor** — real-time view of provisioned stake locked as fee collection collateral | Medium | High (indexers) | Not started |
| 6 | **Legacy → Horizon migration status** — which allocations/delegations have migrated | Medium | Diminishing | Not started |

### Tier 3 — Community & Social

| # | Feature | Effort | Impact | Status |
|---|---------|--------|--------|--------|
| 13 | **"What-if" delegation simulator** — model moving GRT between indexers, break-even analysis | Medium | High (delegators) | Not started |
| 15 | **Parameter change alerts** — push notifications when a delegated indexer modifies cuts | Medium | High | Not started |

### Tier 4 — Developer Tooling

| # | Feature | Effort | Impact | Status |
|---|---------|--------|--------|--------|
| 19 | **Signal adequacy indicator** — is curation signal sufficient to attract quality indexers? | Low | Medium | Not started |
| 20 | **Version migration dashboard** — track signal migration, indexer adoption across subgraph versions | Medium | Niche | Not started |

### Enhancements to Existing Features

| Feature | Effort | Impact | Status |
|---------|--------|--------|--------|
| **POI staleness countdown timers** — days since last POI per allocation, alerts before 28-day force-close | Low-Med | High (indexers) | Not started |
| **Allocation trend view per subgraph** — time-series of indexer count + total stake per deployment | Medium | Medium | Not started |
| **Multi-service delegation comparison** — cross-indexer comparison across data services | Medium | High (when more services launch) | Not started |

---

## Data Integration Opportunities

Potential external data sources to enrich Lodestar:

- **Dune Analytics** — historical L1→L2 bridge data, whale tracking, gas cost analysis, cross-protocol comparisons. No Graph Spellbook spell exists yet — building one would be a competitive edge.
- **Messari API** — macro context (price, market cap, DePIN sector comparisons, quarterly KPIs). Free tier: 20 req/min.
- **Horizon contract events on Dune** — HorizonStaking, GraphPayments, PaymentsEscrow, SubgraphService. First dashboard to decode these wins.

---

## Pre-deploy: Database Migration

Run this on the production database before deploying:

```sql
ALTER TABLE network_snapshots ADD COLUMN IF NOT EXISTS total_supply_grt NUMERIC;
```

This enables future snapshots to capture GRT total supply. Historical issuance/burn data
uses epoch-level data which is already in the database.
