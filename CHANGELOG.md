# Changelog

All notable changes to Lodestar are documented here. Versions follow `MAJOR.MINOR.PATCH`.

## [4.27.0] - 2026-08-29

Two histories had been running in parallel since 24 August. The 4.26.0 tag, carrying the
Nuthatch-only delegation panels, was published to GitHub and never merged into `main`, while
`main` accumulated thirty-eight commits of Project Catalyst work that knew nothing about it.
Neither branch was wrong; they simply had not met. This release merges them, which surfaced two
faults that only exist in the combination: `nuthatchEnabled` had been retired on one side while
the other built DIPS on top of it, and the delegation route tests still asserted a Graph fallback
that no longer exists. Both are fixed here rather than papered over.

The Tokens page is also gone, along with the whole subsystem behind it.

### Added

- **Project Catalyst delivery tracker** — a verified, zero-budget status board for all eight
  roadmap items, with the homepage scoring how much of it the community has already built.
  Positions are recorded against evidence rather than intent, so an item counts as delivered only
  where something answers.
- **DIPS observability** — `GET /api/dips` served from the dips-nest behind `NUTHATCH_DIPS`, a
  `check-dips` cron, and a homepage panel showing the live allocation. DIPS went live on Arbitrum
  One on 25 August with every step complete except moving the allocation off zero, and the panel
  says so plainly. An alert fires when the allocation moves, seeding silently on first run so the
  initial observation is not itself an event.
- **Provider liveness probing** — `GET /api/provider-liveness`, a `check-provider-liveness` cron,
  and `dispatch-liveness`. The registry panel now probes what it advertises: being registered is a
  promise, and only a response is evidence.
- **QoS publisher aggregation** and the **gib onboard pre-flight** (CAT-2).
- **Keyless x402 pay-per-query mode** in the subgraph playground, arriving via the 4.26.0 merge and
  still marked experimental until a payment is confirmed end to end.

### Changed

- **G-1 now requires liveness, not registration.** Three services were found not serving, not one.
  Dispatch, CAT-5, Seahorn and Camp all had their badges corrected against what actually answers,
  and Dispatch is recorded as retired by decision rather than broken, open to operators.
- **The operating model is written down**: we develop, we do not operate, with the Nuthatch data
  service as the standing exception.
- **Open Graph cards** for the disassembly and subgraph pages carry real figures — a scorecard and
  six live stats — instead of zeros over dead canvas.
- **`yatr.toml` matches CI**, using pnpm rather than npm, with the shadowed check task dropped.

### Removed

- **The Tokens page and everything behind it** — both page routes, the `/api/tokens` tree, the
  `warm-tokens` and `warm-token-details` crons, fourteen library modules with their tests, four
  components and the `useTokens` hook. Thirty-nine files, 10,986 lines. The `warm-tokens` entry is
  out of `vercel.json`; `warm-token-details` turned out never to have been scheduled there at all.
- **`NUTHATCH_DELEGATION_EVENTS` and `NUTHATCH_DEVELOPER_ACTIVITY`**, retired by the 4.26.0
  migration. `.env.example` had carried the latter twice.

### Fixed

- **`nuthatchEnabled` restored** for the dips-nest. It was removed when the migrated panels stopped
  needing a flag, but DIPS is still being staged in behind one, and the merged tree would not have
  compiled without it.
- **Delegation route tests updated to the fail-closed contract.** They asserted an empty 200 where
  the migrated routes now return 503, and the stale expectation was also poisoning an unrelated
  payments address-validation test through ordering.
- **`ProgressBar` renders 58%, not 57.99999999999999%.**
- **"Back to Subgraphs" goes to `/subgraphs`** rather than wherever you happened to come from (#24).
- **The public card is rescored to match the tracker**, with a test pinning the two together so
  they cannot drift apart again.

### Notes

- `src/lib/tokens/total-supply.ts` was doing honest work for GRT global supply and survives as
  `src/lib/erc20-supply.ts`. `/api/token-metrics` is unrelated to the Tokens page despite the name
  and is untouched — it still feeds per-epoch issuance and burn to the network stats.

## [4.26.0] - 2026-08-24

Backfilled on 2026-08-29. This version was tagged and published on 24 August but never merged into
`main`, so it left no trace in this file or in `package.json` at the time. It is recorded here for
completeness; its contents reach the mainline in 4.27.0.

### Changed

- **Delegation Flows and Delegation Events are served only from Nuthatch.** Legacy history is read
  from a read-only nest and stitched to the live Horizon tail. There is deliberately no Graph
  fallback: the routes fail closed with a 503 rather than quietly serving a different source, so
  provenance is never ambiguous.
- **The per-panel staging flags are gone.** A migrated panel needs a configured Nuthatch origin and
  says so when it does not have one.

### Added

- **Keyless x402 pay-per-query mode** in the subgraph playground, marked experimental until a
  payment is confirmed.

## [4.25.0] - 2026-08-16

### Changed

- **Delegation Activity now reads from the self-hosted Nuthatch Staking nest in production.** The
  panel remains independently flag-gated and falls back to The Graph on any Nuthatch failure.
- **Developer Activity is enabled for the self-hosted L2GNS nest.** Its cache generation advances to
  v4 so a previously cached subgraph response cannot conceal the staged cutover for an hour.

### Notes

- The two Nuthatch panels are the first step in Lodestar's long-term zero-hosted-subgraph plan.
  They remain staged until independent source comparisons and ongoing production observation are
  complete.

## [4.24.0] — 2026-08-15

An indexer wrote in asking why Lodestar showed him a failing QoS score when his own metrics
read 99.9% successful. He was right and we were wrong, in four separate places. The score
weighted each deployment by the indexer's *share* of that deployment's traffic rather than by
how many queries he actually answered, so a backwater where he served three of three queries
outvoted the deployment carrying his real load. A subgraph that fatals identically for every
indexer serving it was scored as his failure. Chains missing from a hardcoded table were
assumed to have twelve-second blocks, which turned a fast-chain deployment a few thousand
blocks behind into "hours stale". And the endpoint he checked answered 404s as 502s, so his
first conclusion was that our pipeline was down.

### Added
- **Cohort-relative grading** — reliability is graded against the best any credible peer
  achieves on that deployment, but only where the cohort is demonstrably degraded (best peer
  below 0.9, at least three peers with credible volume). A subgraph broken for everyone stops
  reading as one operator's fault, while an indexer that is the worst of a bad bunch still
  scores badly. Shared chainhead lag is subtracted the same way, which is the chain-liveness
  principle from 4.23.0 applied per deployment.
- **`GET /api/indexer/[address]/qos-deployments`** — the working behind a score: every
  deployment in the window with its volume, blend weight, Wilson bound, cohort best, lag net
  of the cohort floor, and how much of the composite it is holding down.
- **Deployment breakdown on the QoS panel** — the five deployments dragging a score, each
  naming the axis actually costing it (`~69 min behind`, `slow vs peers`, `serving errors`)
  and coloured by that axis, so a deployment answering perfectly never renders as an error.
  Deployments failing for their whole cohort are marked.
- **`scripts/recompute-qos.ts`** — re-scores history from `qos_daily` day by day, each with
  the window that day actually had, and a `--dry` mode that sweeps calibration constants and
  writes nothing.

### Fixed
- **Deployments are weighted by queries served, not by share of them.** The old weight let
  three queries outvote a hundred thousand. This was the main cause of the report.
- **An absent success figure is no longer read as total failure.** `Number(null)` is 0, so
  "the oracle published nothing for this day" and "every query failed" landed in the database
  as the same value. Ingest now reads the published `num_indexer_200_responses` and yields
  null only when the field is genuinely missing; unmeasured deployments are excluded from the
  blend and counted separately. Needs `migrations/015_qos_success_nullable.sql`.
- **Unknown chains no longer default to twelve-second blocks.** The block-time table now
  covers every chain the oracle actually emits (`xdai` was a plain alias miss for gnosis), and
  a chain we do not know omits the freshness factor rather than guessing at it.
- **The Foghorn proxy returns the upstream status.** An unknown path answered with a bodyless
  404 threw on JSON parse and fell into the catch labelled "Foghorn API unreachable", telling
  operators our pipeline was down when it was a wrong URL.

### Changed
- **Freshness decay constant 600s → 1800s.** Ten minutes is defensible on a twelve-second
  chain and punishing everywhere else.
- **Display divisor 0.65 → 1.** It existed to compensate for the weighting bug. With the cause
  removed it inflated the whole field: 35 of 51 indexers at an A, 19 pinned at exactly 100.
  Re-derived against the live distribution — at 1.0 the median sits on the B/C line, the top
  decile reads A, and nothing clips.

### Notes
- Ninety days of `indexer_qos_score` were recomputed, so sparklines step where the arithmetic
  changed rather than where anyone's service did.
- Freshness is now the axis most in need of the same scepticism: the oracle publishes
  blocks-behind figures that are not measurements (one deployment reported 22.5 million blocks
  behind on Base, more than that chain has ever produced). An implausible lag should read as
  unmeasured rather than as maximal staleness. Not yet fixed.

## [4.23.0] — 2026-08-11

Every staleness signal in the stack is measured against chain head, so when a chain stops
producing blocks the distance to head goes to zero and everything reports perfect health.
Lodestar did this too. Moonbeam halted around 10 August and every subgraph on it kept
rendering green; two Celo subgraphs sat behind an indexer reporting itself 99.98% synced
against a head that had not moved in 85 hours. This release adds the one signal that
survives a frozen head, which is wall-clock time.

### Added
- **Chain liveness** — the chain-health cron now remembers the highest block it has ever
  seen per chain and when that head last advanced, so a chain that has stopped producing
  blocks is detectable at all. Classified `live`, `stalled` (90 minutes without an advance),
  `halted` (6 hours) or `unknown`. Head history is persisted for 30 days so a chain that has
  been dead for days cannot reset to healthy when a cache expires.
- **Frozen-chain banner on the deployment page** — a subgraph on a halted chain is *frozen,
  not broken*. The banner names the block it will keep answering with indefinitely and says
  plainly that historical queries remain correct, which is the part people get wrong when
  they see stale data and assume the subgraph has failed.

### Fixed
- **A halted chain no longer scores a green tick.** Chain Sync Health awarded `✓` to any
  chain with zero median blocks-behind, which is exactly what a dead chain looks like.
  Frozen chains now sort above every lagging chain and show how long the head has been stuck
  along with the block it is stuck at.

### Notes
- Liveness never claims *why* a head stopped. A halted chain and a chain where every sampled
  indexer has stalled are indistinguishable from here, so the wording says so rather than
  guessing.
- Stall is measured across the window actually observed, not against the current time. If the
  cron itself stops, the verdict is `unknown` rather than `stalled` — the whole point is to
  stop treating absent information as a healthy reading.

## [4.22.1] — 2026-06-25

### Changed
- **Needs-attention cards** — deployment hashes are now clickable chips that link through to
  each subgraph and stay inside the card (no more overflow). Indexer-wide rollups show the
  first six, with a **"+N more"** that expands the card downward to reveal *every* erroring
  deployment (and a "Show less" to collapse it again).
- **Grades now reflect broad serving failure** — an indexer erroring across many of the
  deployments it actually receives traffic on is penalised out of A, rather than hiding behind
  a query-weighted success rate (e.g. datanexus/pinax → F, ellipfra → C). The broadly-dead hit
  F via the fraction of failing deployments; a big-but-mostly-healthy operator is capped at
  C/D via an absolute-count floor. Mirrors how sybil membership already bites the grade.

### Fixed
- Discord alerts now post the **full** current failure roster on any change (and a daily
  liveness repost), instead of a delta that read as "everyone else recovered".

## [4.22.0] — 2026-06-25

Foghorn grows a voice. Serving failures, outages and sybil swarms now reach Discord the
moment they're detected, and the synced-but-erroring case is surfaced everywhere it matters.

### Added
- **Discord alerting (`#foghorn-alerts`)** — new serving failures, indexer outages, sybil
  swarms and genuine chainhead/deployment lag are pushed to Discord, **grouped by indexer**
  (one line apiece, nothing truncated). Quiet by default; a **daily heartbeat** proves the
  watch is still live even when the network's clean. A promo banner linking to the channel
  was added to the Foghorn hub, indexer and subgraph pages.
- **Query Success surfacing** — a *Query Success* column on both the subgraph page and an
  indexer's *Active Allocations* table, fed by Foghorn's QoS read. Catches the
  synced-but-serving-errors (400s) case the community kept hitting: an indexer reports 100%
  synced yet fails real queries.

### Changed
- **Clearer attention labels** — indexer-wide serving-error and multi-deployment lag rollups
  now name the trigger and count ("serving errors across N deployments", "behind on N
  deployments"); per-deployment verdicts name the offending deployment.
- **Unambiguous sub-score legend** — explicit Co/Av/Fr/Cv/Va labels on the leaderboard kill
  the earlier duplicate-"C" confusion.

### Fixed
- Subgraph *Query Success* now shows for any measured allocation, not only those above the
  query-volume floor.
- Missing space in the alerting-banner copy.

## [4.21.2] — 2026-06-24

### Added
- **Non-deterministic subgraph detection** — Foghorn flags deployments whose indexers
  legitimately disagree (non-deterministic data) and stops faulting indexers for them; the
  hub gains a non-deterministic-subgraphs section.

## [4.21.1] — 2026-06-24

### Changed
- **Judging calibration** — sybil membership now bites the composite grade; REO-ineligible
  evidence names the failing condition; staggered-creation swarms are caught; and a
  behind-chainhead grey zone avoids over-penalising indexers only marginally behind.

## [4.21.0] — 2026-06-24

### Added
- **Foghorn — network-quality judge on Lodestar** — composite A–F grades per indexer, fusing
  Foghorn's own correctness probing with The Graph's QoS oracle, on-chain stake and REO
  eligibility; actionable verdicts; a live needs-attention triage; and sybil-swarm
  clustering. New `/foghorn` hub (leaderboard, verdicts, sybil clusters), a scorecard on
  indexer profiles, a Foghorn grade column in the indexer table, and nav entries.

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
