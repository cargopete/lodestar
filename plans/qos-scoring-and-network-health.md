# QoS Quality Scoring + Network-Health (Sybil/Leech) — Roadmap

**Status:** Building (Phase 1 starting)
**Created:** 2026-06-10
**Relation:** New workstream after RAV (`plans/rav-and-cockpit-roadmap.md` A-series shipped). Cockpit (B-series) parked (`plans/indexer-cockpit-design.md`).

## Motivation (the harm picture)
A community estimate of where indexing-reward issuance actually goes:

| Slice | ~Share |
|---|---|
| Lost Rewards | ~4% |
| Indexers Providing 0 Value | ~15% |
| Very low uptime / narrow support | ~12% |
| Top 6 Indexers + their Delegators | ~48% |
| Other Delegators (est) | ~11% |
| Other Indexers (est) | ~10% |

**~31% of issuance goes to zero/low-value or lost; the top 6 take ~48%.** This is a hand-estimate. The job of this workstream is to make it a **live, defensible, per-deployment number** — and to give delegators/governance a quality score that doesn't reward the leech.

## The core problem this fixes
Lodestar's current 11-D risk score has a **`queryVolume` dimension (6%) scored off raw cumulative query fees** — which *rewards* a high-volume leech. The proposal's thesis: volume doesn't discriminate; the discriminating signals are selection-bias-corrected QoS, served-vs-eligible gap, and rewards-per-useful-query. We replace naive volume with rigorous quality.

## Data reality (verified live 2026-06-10)
QoS Oracle subgraph (`Dtr9rETvwokot4BSXaD5tECanXfqfJKcvHuaaEgPDD2D`) is **V1**, NOT V2:
- Available: `avg_indexer_latency_ms`, `stdev_indexer_latency_ms`, `max_indexer_latency_ms`, `avg/max_indexer_blocks_behind`, `proportion_indexer_200_responses`, `num_indexer_200_responses`, `query_count`, `avg/total_query_fees`, `gateway_id`, `chain_id`.
- **Missing (V2 only): `p90/p99_indexer_latency_ms`, `time_behind` seconds, `success_` rename.** → approximate tail as `avg + k·stdev`; downweight latency.
- **Three entities give the grain we need:**
  - `AllocationDailyDataPoint` — per (indexer, deployment, day): the scoring primitive + cohort source.
  - `QueryDailyDataPoint` — per (deployment, day) totals: the **served-share denominator**.
  - `IndexerDailyDataPoint` — per (indexer, day) aggregate.
- **ServedShare is computable from V1 today** (indexer's query_count on a deployment ÷ deployment total). Phase 2 is not blocked.
- Caveats: oracle has selection bias (only routed queries seen — absence ≠ failure); HTTP-200 ≠ "successful" per gateway dev (V1 only has 200, accept the imprecision); no geo/ASN; gateway-conditional once gateways decentralize.

## Existing foundations (audit 2026-06-10)
- ✅ QoS oracle integrated live (`src/lib/subgraph.ts` `qosOracleQuery`, `/api/indexer-qos/[address]`, `IndexerQoSChart`) — V1 fields, fetched live + cached 1h, **not persisted**.
- ✅ Mature enrichment cron (`src/lib/refresh.ts`) computing the 11-D score, rolling APY, REO → Postgres + `indexer_snapshots`. **Home to extend.**
- ✅ Amp client (`src/lib/amp.ts`) + Arbitrum event topics (delegation/staking/provisions) — foundation for funding-graph; no funding-tracing yet.
- ✅ `allocations` table (closed_at, rewards, fees), `compare` page, `IndexerTable`, recommend engine.
- ❌ Greenfield: Wilson/Bayes/percentile/EWMA/cohort; ServedGap; rewards-per-query; clustering/funding-graph; crowding-out/Gini for indexers; daily QoS persistence.

## UX split
- **Per-indexer (Phases 1–2)** → extend existing surfaces: a **QoS Quality panel** on the indexer detail page (same pattern as the shipped P&L panel), a **Quality grade column** on `IndexerTable` + `/compare`.
- **Network-level (Phases 3–4)** → **new `/network-health` page** ("Network Health & Integrity"): Q-score leaderboard hero, behaviorally-correlated clusters (confidence-tiered, evidence dossiers), crowding-out per deployment, concentration (Gini/Nakamoto). This is the page that reproduces the motivation chart from live data.

---

## Phase 1 — QoS quality core (STARTING)
**Data layer**
- `qos_daily(indexer, deployment, day, n, success, avg_lat_ms, stdev_lat_ms, blocks_behind, fees, gateway_id, chain_id)` — from `AllocationDailyDataPoint`.
- `deployment_daily(deployment, day, total_query_count, gateway_success_rate, gateway_id, chain_id)` — from `QueryDailyDataPoint` (served-share denominator).
- `indexer_qos_score(indexer, day, reliability, lat_util, fresh_util, coverage, served_gap, efficiency, q_score)`.
- `ingestion_state` key `qos`.

**Ingest** — `src/lib/ingest/qos.ts` + `api/cron/ingest-qos`, dayNumber cursor (oracle uses Unix-day baseline 18613). Page both entities, upsert.

**Scoring lib** — `src/lib/qos-score.ts`, pure + unit-tested:
- `R = wilsonLowerBound(s, n, z=1.96)` — `[p̂ + z²/2n − z·√(p̂(1−p̂)/n + z²/4n²)] / (1 + z²/n)`.
- `U_lat = exp(−Lᵢ,d / τ)`, tail `Lᵢ,d = avg + k·stdev` (V1), τ = deployment-median.
- `U_fresh = exp(−time_behind / τ_f)`, time_behind = blocks_behind × chain blocktime.
- EWMA across days: `w_t = 0.5^(Δdays/H)`, H ≈ 7–14d.
- Cohort mix-adjust: per-deployment standardized residual vs indexers serving same deployment; aggregate weighting by served-query share.
- `Q = R^a · U_lat^b · U_fresh^c · Coverage` (weighted product; start a=b=1, c=0.5). Tune empirically — do NOT assume gateway's exact weights.

**Compute + API** — extend `refresh.ts` to compute `indexer_qos_score` daily; `api/indexer/[address]/qos-score`. Replace/augment naive `queryVolume` dimension.

**UI** — QoS Quality panel + table column.

## Phase 2 — selection-bias + efficiency (catches the leech)
- `ServedGap_i = mean over eligible deployments of (CuratorSignalShare_d − ServedShare_d)`. Flag top-decile stake-weighted ServedGap.
- `Efficiency_i = IndexingRewards_i / Σ successful_query_count` vs network median.
- Self-query gaming guard: down-weight low-external-signal self-curated deployments.

## Phase 3 — clustering (`/network-health`)
- Funding-graph (Amp first-inbound GRT/ETH to indexer+operator wallets; star/tree topology), registration cohorts, allocation-set Jaccard + allocation-timing correlation, parameter mirroring, QoS latency fingerprint (corroboration only).
- Co-operation graph + Louvain; confidence tiers (T1 internal / T2 behavioral / T3 high-conf incl. funding).
- **Liability discipline (non-negotiable):** NEVER the word "sybil"/"fraud" — use "behaviorally correlated cluster". Always show evidence + confidence tier. SaaS/infra allowlist FP guard (Pinax, StakeSquid, Launchpad). Require funding OR timing link (not infra) for T2+. Human-review gate. NEVER auto-punitive. Appeal/contact path + methodology page.

## Phase 4 — crowding-out + concentration
- Per-deployment cluster capture share (alloc + reward); counterfactual redistribution `ΔReward_j = reward_j·(1/(1−AllocShare_C,d) − 1)`; useful-query-per-allocated-GRT deficit.
- Network Gini/Nakamoto concentration (cf. Lido 1% soft cap). Reproduces the motivation chart from live data.

## Caveats / triggers
- V2 not live → V1 tail approximation; revisit when p90/p99 ship.
- Gateways decentralize → make scores gateway-conditional (multiple `gateway_id`).
- Clustering is probabilistic → human-reviewed, never automated punitive action.
- Verify oracle entity/field names against the live schema before coding ingest (done: V1 confirmed).
