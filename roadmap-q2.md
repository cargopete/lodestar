# Lodestar Q2 2026 Roadmap

Based on: "Lodestar dashboard: what The Graph community actually needs"

Status legend: ✅ Done | ⚠️ Partial | ❌ Not done

---

## Tier 1 — Horizon-native (highest priority, zero competition)

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 1 | Provision management dashboard — provisioned vs. idle stake per data service, utilisation rates, thawing requests, optimization suggestions | ⚠️ Partial | `/services` + `ProvisionsPanel` has stacked bars & allocation-by-service; missing utilisation %, thawing tracking, optimization suggestions |
| 2 | GraphTally payment flow tracker — receipt aggregation, RAV redemption pipeline, escrow balances, reconciliation health | ✅ Done | `/payments` + `/payments/[address]`, escrow balances, redemptions, top collectors, per-indexer detail |
| 3 | POI staleness alerting — countdown timers per allocation, configurable warning thresholds before 28-day force-close | ⚠️ Partial | POI consensus dashboard with divergence detection exists; no per-allocation countdown timers or configurable thresholds |
| 4 | Multi-data-service delegation comparison — compare returns, slashing risks, thawing periods across Substreams, Token API etc. | ❌ Not done | |
| 5 | Stake-to-fees collateral monitor — provisioned stake locked as collateral vs. available for new allocations | ❌ Not done | |
| 6 | Legacy → Horizon migration status — which allocations, delegations, registrations have migrated | ❌ Not done | |

---

## Tier 2 — Analytics & charting (high demand, competitive improvement)

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 7 | Indexer trust score — composite metric: allocation efficiency, parameter stability, dispute history, uptime, community reputation | ✅ Done | 7-dimension A–F composite risk score; greedy cut detection |
| 8 | Effective commission display — actual commission rate (not raw reward cut) front-and-centre on every indexer profile | ❌ Not done | Needs audit — may not be shown anywhere; biggest delegator confusion point per the doc |
| 9 | Historical parameter change timeline — timestamped log of every reward/fee cut change per indexer | ✅ Done | Added to indexer detail pages |
| 10 | Revenue decomposition for indexers — net profitability per subgraph allocation after gas costs | ❌ Not done | |
| 11 | APR transparency breakdown — every variable affecting delegation APR, conservative/optimistic projections | ⚠️ Partial | Rolling APY 30d/90d exists; no full variable breakdown panel |
| 12 | Network health dashboard — total stake, active indexers trend, query volume, protocol revenue, issuance rate, GRT supply dynamics | ❌ Not done | Supabase snapshot infra exists; no public dashboard surface yet |

---

## Tier 3 — Community & social tools

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 13 | Overdelegation alerts + what-if simulator — model delegation changes, break-even analysis, thawing opportunity cost | ⚠️ Partial | Redelegation Calculator covers switch-cost analysis; overdelegation warnings and full what-if not confirmed |
| 14 | Tax-ready CSV export — delegation events, reward accruals, thawing events with timestamps and USD values | ⚠️ Partial | Delegator Portfolio has CSV export; no fiat conversion |
| 15 | Indexer parameter change alerts — push notifications when a delegator's indexer modifies cuts | ⚠️ Partial | Parameter change timeline exists; push notifications not built |
| 16 | Governance tracker — GIP proposal status, voting, Graph Council decisions | ✅ Done | GIPs 0070/0079/0086/0087/0088 with live metrics |

---

## Tier 4 — Developer tooling

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 17 | Subgraph health monitor — sync status, block lag, error counts, webhook/Slack/Discord alerting | ⚠️ Partial | graph-node status integration shows sync progress, health, errors; no alerting |
| 18 | Indexer allocation tracker per subgraph — indexer count trend, total stake committed, alert on drops | ❌ Not done | |
| 19 | Signal adequacy indicator — is curation signal sufficient to attract quality indexers (3,000+ GRT threshold) | ❌ Not done | |
| 20 | Version migration dashboard — signal migration, indexer adoption of new versions, data continuity | ❌ Not done | |

---

## Priority recommendation

1. **Network health dashboard (#12)** — highest visibility, anchors the whole product, infra already in Supabase
2. **Complete provisions dashboard (#1)** — data already there, finishes the flagship Horizon-native story
3. **Effective commission display (#8)** — quick audit first; if missing, disproportionate delegator impact for relatively small lift

Developer tooling (Tier 4) deprioritised — smaller audience, no Horizon differentiation.
