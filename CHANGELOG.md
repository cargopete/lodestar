# Changelog

All notable changes to Lodestar are documented here. Versions follow `MAJOR.MINOR.PATCH`.

## [4.14.0] — 2026-06-11

Subgraph Disassembly grows up: compare versions, weight risk by stake, and share a
report as a link that unfurls. Plus native push notifications land on iOS.

### Added
- **Cross-version diff** (`/disassembly` → "Compare versions") — paste two deployment
  IDs and see exactly what changed between versions: handlers added/removed, handlers
  that gained or lost an `eth_call`/IPFS reach, scorecard grade and risk movement,
  manifest/apiVersion/graft changes, and recovered-string deltas. New
  `/api/disassembly/diff?a=…&b=…` endpoint backed by a pure, unit-tested `diffReports`.
- **Signal-weighted risk** — the disassembly scorecard now overlays the deployment's
  current curation signal. A new "Signal-weighted exposure" card turns *(worst flag
  severity × GRT signalled)* into a single priority (low → critical), so a flag on a
  heavily-signalled subgraph outranks the same flag on a near-empty one. Flags are
  sorted by severity. Signal is fetched fresh (5-min cache) while the immutable static
  analysis stays cached for 7 days; degrades gracefully when the gateway is unavailable.
- **Shareable report URLs** — canonical `/disassembly/<deploymentId>` route with rich
  OpenGraph metadata (grade, risk, host APIs, signal) and a generated 1200×630 OG card,
  so a shared link unfurls in Discord/Slack/Twitter. A "Copy share link" button is in
  the Inspect view; the existing `?id=` and `?a=&b=` deep-links keep working.
- **Native push notifications (iOS)** — APNs transport + device registration and the
  matching iOS capability, building on the Capacitor shell.

### Internal
- **RFC-005** documents the Subgraph Disassembly roadmap (Phases 1.5 / 2 / 3); the
  entire Phase 1.5 static-enrichment tier (diff + signal + shareable URLs) is now shipped.

## [4.13.0] — 2026-06-11

Lodestar goes mobile: an installable PWA and a native iOS shell, so the dashboard
lives on the home screen and survives a dropped connection.

### Added
- **Progressive Web App** — Lodestar is now installable to the home screen on any
  platform. A web manifest (`src/app/manifest.ts`) declares the app name, theme, and
  maskable icons (192 / 512); a service worker (`public/sw.js`) caches the shell and
  serves an `offline.html` fallback when the network drops; a client-side
  `ServiceWorkerRegister` registers it on load.
- **iOS app** — a Capacitor native shell wrapping the production site, with its own
  Xcode project, app icon, and launch/splash assets. Lays the groundwork for an
  App Store build without forking the web codebase.

### Changed
- **Night's Watch CTA dismissal now persists** — closing the Night's Watch banner is
  remembered across reloads and future visits via `localStorage`, matching the camp
  banner's behaviour (previously it returned every new browser session).

## [4.12.0] — 2026-06-11

### Added
- **Subgraph Disassembly** (`/disassembly`) — Phase 1 of a subgraph transparency tool. Paste a
  deployment ID (Qm…) and it fetches the compiled mapping WASM + manifest straight from IPFS
  (no build, no sandbox, no execution) and statically disassembles each module:
  - **Per-handler host-API reachability** — builds each module's call graph and maps every handler
    to the host imports it can reach (`store`, `ethereum.call`, `ipfs`, `json`, `crypto`, `bigInt`,
    `bigDecimal`, `typeConversion`, `dataSource`, `log`), so you can see exactly which handlers do
    eth_calls or touch IPFS.
  - **Transparency scorecard** — grade + Determinism/Performance/Transparency scores and risk flags
    (eth_call hotspots, IPFS non-determinism, fulltext, grafting, wildcard indexing, dynamic data
    sources), grounded in real graph-node cost/failure modes.
  - **Recovered names & strings** — handler/function names from the WASM name section and entity
    types, event signatures and abort messages from the data segments.
  - Graceful degradation: the WASM parser flags `incomplete` rather than silently mis-reporting when
    it meets opcodes outside the modelled set. Nav link added under Developers (sidebar + mobile).

## [4.11.0] — 2026-06-11

### Changed
- **Renamed "Network Live" → "Horizon Live"** across the UI: desktop sidebar + mobile bottom-nav
  labels, the page heading, and the Data Services note that references it.
- **Route renamed** `/network` → `/horizon-live`, with a permanent redirect preserving old
  bookmarks and links. The internal `/api/network/snapshot` endpoint is unchanged.

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
