# RFC-006 — Servability & Network Integrity

**Live serving truth, split-invariant service accounting, and the demotion of clustering to narrative.**

| | |
|---|---|
| Status | Draft |
| Created | 2026-06-11 |
| Author | petko / Lodestar |
| Relation | Revises and extends `plans/qos-scoring-and-network-health.md`. Reuses `RFC-005` (disassembly) infra patterns. |
| Trigger | iExec PoCo (`QmV3d9dWDQR39YWX76TiNPH12frex2rTs9AmShFWnUTSEc`) returning `BadResponse(400)` from all five allocated indexers while reporting 100% sync. |

---

## 0. What changed since the QoS roadmap

`qos-scoring-and-network-health.md` made clustering (Phase 3) a centerpiece and had **no live serving probe anywhere**. Two arguments from E&N (tmigone) collapse that emphasis:

1. **The harm is non-service, not multi-identity.** One operator running N identities is fine *if they serve*. So the thing to measure is service, per identity — not "who controls whom."
2. **Common control is ~undetectable.** Against an operator who wants to hide, every clustering signal is individually defeatable (domain-per-identity, CEX-funded wallets so the shared funder is just an exchange hot wallet, separate ASNs, staggered registration, varied cuts/allocations). Clustering catches the *lazy* operator and nothing else.

The synthesis this RFC adopts:

- **The live serving probe is the keystone primitive.** Everything Lodestar currently measures is *indexing health* (`/status`) or *oracle-derived QoS* (selection-biased, blind to deployments the gateway routes around). Neither sees whether the paid query path answers *right now*. That is the exact gap iExec fell through.
- **The enforcement-relevant metric is split-invariant** — per-identity served-share vs the identity's own allocation share — which needs **zero attribution**. A non-serving identity fails individually whether it is a solo or one head of a hydra.
- **Clustering is demoted from trigger to narrative.** It never decides "dead" or "ineligible." It explains *why* a dead subgraph is dead and lets honest indexers and governance see the shape ("these five deadweight identities are probably one actor; here are the other thirty subgraphs they starve"). Evidence and confidence tiers only.

## 1. Scope — what Lodestar can and cannot do

**Cannot** (and this RFC must not pretend otherwise):
- Change protocol eligibility, slash, or gate rewards — that is REO / governance.
- Reliably detect hidden common control — see §0.2. The approach **must not depend on it**.
- Take any punitive action. Lodestar observes and evidences.

**Can:**
- Measure **live servability** of the paid path, per identity, as ground truth.
- Compute a **split-invariant served-gap** that is meaningful per identity with no attribution.
- Render a per-deployment **"effectively dead"** verdict keyed on service.
- **Alert subgraph owners** when their serving set collapses (they currently have no signal and no contact path).
- Give honest indexers a **starved / rescue feed** (an unserved-signal BD list).
- Produce a confidence-tiered **evidence dossier** that lets governance set a split-invariant criterion.

## 2. Existing foundations (repo audit 2026-06-11)

Most of the substrate is already built:

- ✅ `src/lib/indexing-status.ts` — per-indexer `/status` probing: `health`, `fatalError.deterministic`, sync, `blocksBehind`, `unreachable`; aggregates to `DeploymentIndexingStatus`.
- ✅ `src/lib/ssrf.ts` — fail-closed SSRF guard (`isSafeUrlString` + DNS-resolving `isSafeUrlResolved`).
- ✅ `src/lib/clustering.ts` — behavioral union-find (Jaccard + cohort + cut-mirroring), Tier-2 ceiling, `SAAS_ALLOWLIST`, liability discipline. **No domain signal; `url` ingested but unused here.**
- ✅ `src/lib/concentration.ts` — Gini / Nakamoto / tier-capture / crowding-out / `productiveUpliftFactor`.
- ✅ `src/lib/risk-score.ts` — 10-D composite. Its `queryVolume` dimension (6%) is scored off raw cumulative fees, which **rewards a high-volume leech** (flagged in the prior plan).
- ✅ `src/lib/qos-score.ts` / `qos-aggregate.ts` / `ingest/qos.ts` — V1-oracle QoS (Wilson etc.), oracle `Dtr9rETvwokot4BSXaD5tECanXfqfJKcvHuaaEgPDD2D`, `AllocationDailyDataPoint` (per indexer×deployment×day) + `QueryDailyDataPoint` (served-share denominator).
- ✅ `check-subgraph-health` cron — edge-triggered webhooks; resolves deployment → active allocations → per-indexer `/status` → `DeploymentHealth` → `detectStatus` (`src/lib/studio/alerts.ts`).
- ✅ Notification stack — `notifications/dispatch.ts`, `push.ts`, `apns.ts`, `device_tokens` (012), `dispatch-notifications` cron.
- ✅ `ingest/indexers.ts` stores `url` + `created_at_epoch`. `amp.ts` + Arbitrum topics — funding-graph foundation, no tracing yet. `reo-contract.ts` + `/api/reo`.

❌ **Missing:** live serving probe; per-deployment servability verdict; allocation-anchored served-gap; domain clustering signal; servability persistence + starved feed; serving-collapse alert.

## 3. The two service primitives (and why both)

The oracle and the probe cover **different regimes** — they are not redundant:

- **Served-gap (oracle-derived)** catches *partial* leeching: an identity serving less than its allocation implies while other indexers pick up the slack. Computable from V1 today.
- **Live probe** catches *total* non-service: the dead-everywhere deployment the oracle **cannot see**, because the gateway routes nothing there, so served-share denominators go to zero exactly when the whole deployment is dead. iExec is this regime.

Use both. The probe is ground truth at the extreme; the served-gap is the continuous, split-invariant signal across the middle.

---

## 4. Deltas (file-level, priority order)

### D1 — Live serving probe **(keystone)**
**`src/lib/indexing-status.ts`**, guarded by `ssrf.ts`.
- Add `servable: boolean` (+ `serveProbe: 'alive_paid' | 'broken' | 'unreachable'`) to `IndexerStatusResult`.
- New `probeServing(url, ipfsHash)`: `isSafeUrlResolved(url)` → receipt-less `GET {url}/subgraphs/id/{ipfsHash}` (or POST `{__typename}`). Classify:
  - **alive_paid** — the TAP missing-receipt / payment-required shape (a *specific* 4xx). Serving stack is up; correct, not a fault.
  - **broken** — connection refused, timeout, 5xx, HTML, or a bare 400.
- **Calibration is required before trust:** characterize the healthy-but-unpaid body against a known-good indexer (Ellipfra, GraphOps) **and** the leech; commit fixtures to `indexing-status` `__tests__`. `indexer-service-rs` versions differ in that error body.
- **Persistence:** never flag off a single probe. Require N consecutive `broken` (or an EWMA over the cron cadence). "Not serving" is a sustained state; the liability discipline demands it.

### D2 — Per-deployment servability verdict + badge
New **`src/lib/servability.ts`** (pure, unit-tested); wired through **`/api/indexing-status/[hash]`**.
- Inputs already on hand: per-indexer `servable` (D1), `detectClusters` (operators), `allocatedTokens`.
- Outputs added to `DeploymentIndexingStatus`:
  - `effectiveServingOperators` = clusters with ≥1 `servable` member.
  - `effectivelyDead = effectiveServingOperators === 0`. **Service alone. Clustering is not in this condition.**
  - `dominantClusterShare` — surfaced **only** as a *fragility / single-point-of-failure* warning, never as `dead`. A subgraph served by even one honest indexer works; flagging it dead would flag concentration, which is the conflation tmigone warns against.
  - `recovering` — `effectivelyDead` but a `servable`-syncing operator is catching up (e.g. a temp allo at 60%). The feed reads *recovering*, not *dead*.
- Subgraph detail page: `health = min(syncProgress, servable)` and the one-liner — *"All allocated stake belongs to operators with no working serving path; queries will fail despite 100% sync."* Retires the green-pill lie.

### D3 — Split-invariant served-gap **(the enforcement-relevant number)**
Extend the QoS scoring (the prior plan's Phase 2 `ServedGap`), re-anchored:
- `servedShare_{i,d}` = indexer *i*'s `query_count` on *d* ÷ deployment total (`AllocationDailyDataPoint` ÷ `QueryDailyDataPoint`).
- `allocShare_{i,d}` = *i*'s allocated stake on *d* ÷ total allocated on *d* (existing `allocations` table).
- **`servedGap_{i,d} = allocShare_{i,d} − servedShare_{i,d}`**, aggregated per identity (stake-weighted across its deployments).
- **Why allocation-anchored (not signal-share):** splitting one operator's stake across N identities splits both shares proportionally, so each fragment carries a service obligation it meets or doesn't — splitting neither helps nor hides. The metric is meaningful per identity **with no knowledge of who controls it**. This is the rigorous form of mindstyle's "more stake ⇒ more queries."
- In `risk-score.ts`: replace/augment the naive `queryVolume` dimension with `servedGap` so the score stops rewarding the high-volume leech.

### D4 — Domain edge in clustering (**narrative only**)
**`src/lib/clustering.ts`** + `tldts` (don't hand-roll the public-suffix list); `url` already ingested.
- Add `domain: string | null` (eTLD+1) to `ClusterInput`; shared registrable domain becomes an edge, pushed into `Cluster.signals`.
- It is the strongest signal reachable pre-funding-graph and Marc-André's actual heuristic — but it **lifts confidence within Tier 2 only** (could be a shared reverse proxy / SaaS), and per §0/§1 it **never triggers a verdict**. Attribution color for the dossier, nothing more.

### D5 — Persist + starved / rescue feed
- Migration **`014_deployment_servability.sql`**: `deployment_servability(deployment, day, effective_operators, dominant_cluster_share, dead, recovering, signalled, fees_30d, probed_at)`.
- Extend **`check-subgraph-health`** (already q15m, already resolving deployment → allocations → status) to also run D1's probe and write the D2 verdict. Don't probe on page load — the cron owns probing; pages and the feed read the table.
- **`/api/starved-subgraphs`** + a section on the planned **`/network-health`** page: `dead = true` ranked by signal + 30d fees (`/api/subgraph-fees-30d` exists). Doubles as a BD list (each row is unserved signal + fees awaiting any honest indexer) and shows *recovering* rows when a rescue is in flight.

### D6 — Serving-collapse owner alert (near-free)
**`src/lib/studio/alerts.ts`** — add a `serving-collapsed` outcome to `detectStatus` (fires when `effectivelyDead` flips true), with a `formatMessage` line, through the existing edge-triggered `sendWebhook` + push dispatch. The email iExec never got.

### D7 — Funding graph → Tier 3 (deferred; prior Phase 3)
**`amp.ts`** + Arbitrum staking/delegation topics → first-inbound-transfer tracer per operator wallet; cluster on shared funder; lift D4 clusters to Tier 3. **Hard ceiling, stated plainly:** CEX-funded wallets resolve to an exchange hot wallet and yield nothing. Heaviest, lowest urgency, narrative confidence only, and the only delta the incident does not need.

---

## 5. Suggested order

`D1 → D2 → D6` (the live-truth path — what actually catches this) → `D3` (the split-invariant enforcement metric for the score + governance) → `D5` (the feed) → `D4` (defensibility color) → `D7` (last).

`D1` reframes the whole network-health surface from *"is it indexing, and what does the oracle remember"* to *"does it answer a paid query right now"* — the only question that was ever wrong on the iExec page.

## 6. Liability & scope discipline (extends `clustering.ts`)

- **Service is the only flag.** Clustering never decides `dead` or eligibility; it is narrative + the structure-dependent residuals (§7).
- **Never "sybil" / "fraud."** "Behaviorally correlated cluster," always with shown evidence and a confidence tier.
- **Lodestar is observational.** Never punitive. Governance / REO acts; Lodestar measures, surfaces, and evidences.
- **Persistence before any negative label** (`dead`, `non-serving`). No single-probe verdicts.
- **The detection limit is explicit and load-bearing:** against a competent hider, attribution fails by design (§0.2). The approach is built so this does not matter — service is measured directly, per identity.
- Methodology page + appeal / contact path published alongside any ranking. Outreach attempts (and non-responses) are logged as part of the record.

## 7. Residuals that survive even when the swarm serves (warnings, not flags)

- **Fake redundancy.** N identities on one fault domain: the gateway sees N indexers of headroom and has one; when the box dies they all die. Clustering makes the shared fate visible — the gateway can't. Resilience warning.
- **Stake-split gaming.** If per-identity reward / eligibility / delegation-cap curves are nonlinear, splitting extracts more than running whole. `concentration.ts` surfaces it. **The real fix is criterion design, not detection:** a split-invariant eligibility criterion (service required ∝ stake/allocation, §D3) makes splitting pointless — which is the same direction as the issuance-redirect work. Lodestar's job is to publish the split-invariant served-gap and the dead-subgraph evidence so REO/DIPS can key on it.

---

## Appendix A — iExec PoCo, layer by layer

**Subgraph** `iExec PoCo - Arbitrum Mainnet` v2.1.0 · **Deployment** `QmV3d9dWDQR39YWX76TiNPH12frex2rTs9AmShFWnUTSEc`

Allocated set (all `BadResponse(400)`, all reporting 100% sync):
`0x090f7382…b83ed3`, `0x2b3c7d1e…6200ae`, `0x9af3fc81…f9cf0d0`, `0xdc53e62d…e4625e`, `0xe9e28427…b5ecf59`.

| Layer | Behavior |
|---|---|
| `/status` (existing) | synced / healthy → the green pill. **Does not catch it.** |
| QoS oracle (existing) | quiet — gateway routes nothing there, so served-share is ~0/noisy. Absence ≠ failure. **Does not catch it.** |
| **D1 probe** | `broken` across all five (persistent) → **the catch.** |
| **D2 verdict** | `effectiveServingOperators = 0` → `effectivelyDead`. Keyed on service, not clustering. |
| **D3 served-gap** | each identity `allocShare > 0`, `servedShare ≈ 0` → high gap **individually** — no attribution needed. |
| **D6 alert** | `serving-collapsed` webhook + push to the owner at onset. |
| **D4 clustering** | shared domain + 2025-11-28 cohort + overlapping allocations → behaviorally-correlated cluster, Tier 2. **Explains** it; finds the other starved deployments. Does not flag it. |

**Counterfactual:** the v2.1.0 page reads *"all allocated stake has no working serving path; queries will fail despite 100% sync,"* answering Orlando before he opens the thread; the deployment appears in the starved feed as a one-allocation rescue; the owner is alerted on day one — and none of it required deciding who runs the five addresses.
