# Changelog

All notable changes to Lodestar are documented here. Versions follow `MAJOR.MINOR.PATCH`.

## [4.10.0] — 2026-06-11

### Changed
- **Renamed "Network Health" → "Indexer QoS"** across the UI: desktop sidebar + mobile bottom-nav
  labels, the page heading (now "Indexer QoS & Integrity"), the opengraph feature pill, and the
  QoS column tooltip in the indexer table.
- **Route renamed** `/network-health` → `/indexer-qos`, with a permanent redirect preserving old
  bookmarks and links. The internal `/api/network-health` endpoint is unchanged.

## [4.9.1] — 2026-06-11

### Fixed
- **Mobile nav parity** — the mobile bottom-nav "More" sheet was missing two destinations that the
  desktop sidebar had: **Network Live** (`/network`, Overview) and **Network Health**
  (`/network-health`, Indexers). Both are now present, matching the desktop sidebar's routes and icons.

## [4.9.0] — 2026-06-10

A new **GRT Issuance & Flow** page: a research-grade, live trace of GRT supply, issuance, and burns
across Ethereum mainnet and Arbitrum One.

### Added
- **`/grt-flow` page** — live supply / issuance / burn aggregates from the `graph-network-arbitrum`
  GraphNetwork entity (cached 30m): stat cards, a conceptual issuance → distribution → burn flow
  diagram, supply-composition bars, and an annualized issuance-rate history.
- **Reference explainers** — collapsible sections on how issuance works, canonical contract
  addresses (L1 / L2 / Horizon, linked to Etherscan / Arbiscan), the L2 migration timeline, key
  GIPs, and caveats on supply definitions.
- **GRT Flow nav link** in both the desktop sidebar and the mobile bottom-nav "More" sheet.

### Notes
- The page distinguishes the subgraph's **L2 net supply** (mint − burn, ~3.6B) from the global
  ~11.5B circulating supply external sources cite. The live issuance rate is computed against L2 net
  supply — consistent with the rest of the dashboard — with the differing denominators explained
  inline so the reported ~2.8% (vs circulating) isn't conflated with it.
- On Arbitrum, gross mint/burn is dominated by bridge flows; cumulative indexing rewards and the
  per-block rate are the honest issuance figures, and are labelled as such.

### Internal
- New route `/api/grt-flow`; new static reference module `grt-flow-data`; reuses the shared
  `annualIssuancePercent` / `L1_BLOCKS_PER_YEAR` helpers.

## [4.8.0] — 2026-06-10

Two major additions: **indexer revenue & P&L**, and a **Network Health / QoS quality suite**.

### Added — Indexer Revenue & P&L
- **Query-fee (RAV) redemption tracking.** New `rav_redemptions` time-series (sourced from
  `paymentsEscrowTransactions` redeem events), backfilled and refreshed hourly via an ingest cron.
- **Indexer revenue API** (`/api/indexer/[address]/revenue`) — query-fee revenue + indexing rewards
  combined, windowed (7/30/90/365d), with per-deployment breakdown.
- **Indexer P&L** (`/api/indexer/[address]/pnl`) — revenue net of a modeled, user-overridable
  per-chain archive-node infra cost: margin, break-even GRT price, per-deployment lines.
- **P&L panel** on indexer pages — daily revenue chart, chain-cost selector, CSV export.

### Added — Network Health & QoS Quality Scoring
- **QoS quality score** — selection-bias-aware composite (Wilson-reliability × latency-decay ×
  freshness, EWMA-decayed, normalised per-deployment cohort, weighted by served share). Replaces
  raw query volume as the quality signal. Daily ingest + scoring cron over the QoS Oracle.
- **ServedGap** — allocation-share minus served-query-share; surfaces indexers the gateway routes
  around despite holding allocations.
- **`/network-health` page** — quality leaderboard (Q-ranked, grade, served-gap flagged), a
  reward-distribution-by-quality chart, and concentration metrics (Gini, Nakamoto, top-6 share,
  counterfactual redistribution).
- **Behaviorally-correlated cluster detection** — allocation-overlap (Jaccard) + registration
  cohort + parameter mirroring, multi-signal to avoid optimizer false positives. Confidence-tiered,
  evidence-bearing, human-review-gated. Never punitive, never labelled "sybil".
- **QoS Quality panel** on indexer pages + a sortable **QoS column** in the indexer directory.

### Notes
- QoS uses the QoS Oracle **V1** schema (average latency, blocks-behind); p90/p99 and seconds-behind
  arrive with oracle V2. Scores are informational and selection-bias-aware — absence of routed data
  is not absence of problems.
- The QoS quality score is display-calibrated so the network's strongest operators read A/B; the
  underlying ranking is unchanged.
- Cluster detection is probabilistic, capped at Tier 2 (behavioral) until on-chain funding-graph
  analysis ships; correlation is not common control.

### Internal
- New migrations `010_rav_redemptions`, `011_qos_scoring`; ingest crons `ingest-rav`, `ingest-qos`.
- New pure, unit-tested libs: `rav`, `pnl`, `infra-cost`, `qos-score`, `qos-aggregate`,
  `concentration`, `clustering` (59 tests).
- Indexer Cockpit design captured and parked (`plans/indexer-cockpit-design.md`).
