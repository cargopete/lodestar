# Changelog

All notable changes to Lodestar are documented here. Versions follow `MAJOR.MINOR.PATCH`.

## [4.20.0] — 2026-06-17

A single, shareable answer to *"where do I see the state of the protocol?"* — plus a
show-your-working revamp of delegator APR.

### Added
- **State of the Network** (`/network`) — one page that answers the three questions newcomers
  actually ask: protocol **utilization** (stake/delegation/signal, active participants, query
  fees), **developer activity**, and **revenue** (query fees, indexing rewards, TAP collections).
  Built for a mod to paste into a chat and have it just make sense — no price speculation. Linked
  from both the desktop sidebar and the mobile bottom-nav.
- **Developer-activity timeseries** — subgraphs published per week over the last 12 months
  (weekly bars + cumulative line), derived purely from on-chain publish events. The in-progress
  week is flagged *partial*: its bar is muted and it's excluded from the headline and
  week-over-week figures, so a 2-day-old week never reads as a cliff. Also surfaced on the
  Protocol Overview.
- **APR provenance** — delegator APR now shows its working: a decomposition reconciled against
  the on-chain `getDelegationPool`, plus a merged event trail (delegations/undelegations and
  reward/query-fee cut changes) explaining *why* the figure is what it is. Surfaces the uncapped
  instant APR alongside the P95-clamped estimate for transparency across dashboards.

### Changed
- **Network revenue context on Payments** — the TAP escrow pipeline now sits beneath a
  lifetime-revenue band (protocol-wide query fees + indexing rewards), tying the modern
  collection rail to the bigger picture.
- **Relicensed to BUSL-1.1.**

### Fixed
- **Negative effective cut honoured** in APR — previously collapsed high-self-stake indexers
  ~10× (e.g. graphops 24% → 2.4%); now uses the subgraph's `delegatedStakeRatio` and only flags
  over-delegation when the cap actually bites.
- Ingest no longer writes no-op parameter changes (numeric-string compare), and no-ops are
  filtered from parameter history; suppressed the sentinel "unchanged for 20000d" cut note.

## [4.19.0] — 2026-06-11

### Fixed
- **GRT issuance rate corrected** — annual issuance is now divided by global supply
  (L1 + L2 − bridge escrow) rather than the L2-only `totalSupply`, which had overstated the
  rate ~3×.

## [4.18.0] — 2026-06-11

Servability & network integrity (RFC-006, first deltas): the dashboard now measures
whether the *paid query path* actually answers — not just whether an indexer is syncing.

### Added
- **Live serving probe + "effectively dead" verdict** — a subgraph's indexing health now
  reflects whether queries can actually be served, not just sync state. The subgraph page
  shows a clear warning — *"all allocated stake belongs to operators with no working serving
  path; queries will fail despite reported sync"* — when no allocated indexer can serve,
  catching the case where every indexer reports 100% synced yet the deployment is dead. A
  fragility warning also flags deployments whose serving stake sits with a single operator.
- **Split-invariant served-gap** feeding the indexer risk score — measures how much of the
  query volume an indexer's allocation implies it should serve versus what it actually serves.
  Replaces the old raw-fee "query volume" signal, so the score no longer rewards a
  high-volume leech.

### Internal
- Receipt-less and paid (TAP-receipt) serving probes, SSRF-guarded; pure, unit-tested
  classifiers and verdict logic. Foundation for the starved-subgraph feed and serving-collapse
  owner alerts (RFC-006 D5/D6).

## [4.17.0] — 2026-06-11

Subgraph Disassembly gets a much friendlier front door and a one-click verify.

### Added
- **Searchable subgraph picker** — type a subgraph name and pick it from a dropdown (ranked by
  signal) instead of hunting for and pasting a `Qm…` deployment hash. Pasting a hash still works.
- **Auto-resolved source repo** — when a subgraph records its `codeRepository` on-chain, the
  "Verify against source" box now pre-fills the repo URL automatically (green "repo auto-resolved"
  badge), turning verification into nearly one click.

### Changed
- **Source verification folded into Inspect.** The standalone "Verify source" tab is gone; since the
  deployed WASM is already fetched from the hash, verifying against a repo is now an optional
  disclosure beneath the Inspect report rather than a separate mode.

## [4.16.0] — 2026-06-11

### Removed
- **Horizon Live page** (`/horizon-live`) and its nav entries, the `/network` redirect, and the
  now-orphaned `/api/network/snapshot` endpoint that only it consumed.

### Changed
- **Subgraph Disassembly** now carries an "Experimental" banner — the feature is under active
  development and results may be incomplete or change.
- Respect the top safe-area inset (Dynamic Island) in the topbar, sidebar, and feed.

## [4.15.1] — 2026-06-11

### Changed
- **Source verification now handles templated manifests.** Many subgraphs don't commit
  `subgraph.yaml` — they generate it from a mustache template via a `prepare` script. The
  sandbox builder now detects and runs the repo's `prepare` / `prepare:<network>` scripts
  (and enables corepack so bare `yarn`/`pnpm` resolve) before building. For bespoke
  pipelines, an optional **prepare command** can be supplied. Build failures now list the
  repo's available scripts to make the next step obvious. Verification now works on the
  majority of real subgraphs, not just those with a committed manifest.

## [4.15.0] — 2026-06-11

Subgraph Disassembly Phase 2: prove a deployment actually corresponds to its
public source. Build the source in an isolated sandbox and compare it to the
deployed WASM — a trust primitive nothing else in the ecosystem offers.

### Added
- **Source-to-deployment verification** (`/disassembly` → "Verify source") — paste a
  deployment ID and its public git repo (github / gitlab / bitbucket). We clone and
  build the source in an **ephemeral Vercel Sandbox** (Firecracker microVM, so the
  untrusted build runs in isolation), then compare every produced WASM module against
  the deployed artifact:
  - **Verified — byte-identical**: the deployed WASM is byte-for-byte the source build.
  - **Verified — structural match**: bytes differ by build-toolchain noise, but every
    module exposes an identical reachable host-API surface.
  - **Diverged**: the deployed WASM can reach host APIs the source can't (or a module
    is missing on one side) — shown as a per-module host-API delta.
  - **Unbuildable**: the source couldn't be built; the full build log is surfaced.
- **Build-cost guard rails** — the verify endpoint is rate-limited per IP (8/hr) and
  globally (60/hr) with a cross-instance Redis-backed cap, plus a tighter per-instance
  middleware limit. Builds only run for allowlisted public git hosts.
- **Dispute notification dispatcher** — subscribed delegators are alerted via APNs when
  a dispute affecting their indexer is opened.

### Internal
- Pure, unit-tested verdict engine (`verify.ts`) reuses the Phase 1 WASM parser for the
  structural comparison. Completes Phase 2 of RFC-005; only the in-browser replay
  (Phase 3) remains.

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
