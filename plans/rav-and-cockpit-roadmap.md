# RAV Tracking + Indexer Cockpit — Implementation Roadmap

**Status:** Planning → Build
**Created:** 2026-06-10
**Owners:** Jenny / Chief
**Strategic context:** Converts Lodestar from "best read-only dashboard" into "the tool indexers run their business in." Two workstreams: the **RAV keystone** (the missing revenue half of indexer P&L, and the same plumbing DIPs will need) and the **Indexer Cockpit** (the management-API write layer — the moat nobody else ships).

---

## 0. Why these two, why now

A codebase audit (2026-06-10) confirmed the foundations are largely real:

| Asset | State | File(s) |
|---|---|---|
| POI consensus (stake-weighted, per-epoch) | Production | `src/lib/poi.ts`, `src/app/api/poi/route.ts` |
| Risk score (10-dimension 0–100) | Production | `src/lib/risk-score.ts` |
| REO oracle | Production | `src/lib/reo-contract.ts`, `src/app/api/reo/route.ts` |
| Rewards history + CSV + daily snapshots | Production | `src/lib/rewards.ts`, `src/app/api/portfolio/route.ts` |
| TAP **payer** (receipt signing, escrow) | Production | `src/lib/tap.ts` |
| Payments subgraph reads (escrow, `graphTallyTokensCollecteds`) | Production | `src/app/api/payments/route.ts` |
| Indexer-agent proxy | **One hardcoded `presentPOI` mutation only** | `src/app/api/indexer/present-poi/route.ts` |
| RAV redemption **history / attribution** | **MISSING** | — |

Two honest gaps fall out of that table, and they are exactly our two workstreams:

1. **RAV revenue is not tracked over time.** `payments/route.ts` already *reads* `graphTallyTokensCollecteds` (query-fee collection / RAV redemption events) at network and per-receiver level, but nothing snapshots it per-indexer/per-deployment into history. Without that, indexer P&L has no revenue line beyond indexing rewards. `ROADMAP.md` Phase 1.1 still carries an unchecked `[ ] Add TAP/RAV redemption data support`.
2. **The cockpit is a single mutation, not a management surface.** `present-poi/route.ts` proves the proxy pattern (body-overridable `agentUrl`/`agentToken`, SSRF guard, input validation, Basic auth) but only queues `presentPOI`. The general management API — indexing rules, the actions queue, cost models — is unbuilt.

The dependency is clean: **RAV → P&L → Cockpit P&L pane**, and RAV's ingest plumbing is reused by the DIPs cockpit (`plans/on-chain-indexing-agreements.md`) later. So RAV is the keystone; build it first.

---

## Established patterns to reuse (do not reinvent)

- **DB:** `src/lib/db.ts` — `postgres.js` singleton `db`, `hasDbAccess()`. Cursor helpers `getIngestionState` / `updateIngestionState` over the `ingestion_state` table.
- **Ingest:** `src/lib/ingest/<thing>.ts` exports `ingest<Thing>(db)`; thin cron route at `src/app/api/cron/ingest-<thing>/route.ts` with `withCronTracking(db, key, fn)`, `Bearer ${CRON_SECRET}` auth, `export const maxDuration = 300`. Models: `ingest-allocations`, `ingest-delegations`, `ingest-disputes`, `ingest-epochs`.
- **Subgraph reads:** `src/lib/subgraph.ts` — `subgraphQuery<T>()`, `hasSubgraphAccess()`.
- **Caching:** `src/lib/cache.ts` — `cached(key, ttlSeconds, fn)`.
- **Proxy safety:** `src/lib/ssrf.ts` — `isSafeUrlResolved()`. Reuse for any cockpit agent URL.
- **Cron registration:** Vercel cron config (whatever `snapshot-network` etc. are registered in — confirm `vercel.json`/`vercel.ts` before adding).

---

# WORKSTREAM A — RAV Tracking (the keystone)

**Goal:** A queryable, historical, per-indexer and per-deployment record of query-fee revenue (RAV redemptions / `graphTallyTokensCollected`), surfaced as the revenue line of an indexer income statement. Plus the legacy query-fee rebate path where it still applies.

**Definition of done:** Given an indexer address, the API returns query-fee revenue over 7/30/90/365d, broken down by deployment where the data allows, alongside indexing rewards, with daily granularity backed by snapshots — and a P&L endpoint that nets revenue against a user-overridable infra-cost model.

### A1. Data model
- [ ] Design `rav_redemptions` table: `id` (collectionId or tx-derived), `indexer` (receiver), `payer`, `allocation_id` (nullable), `deployment_id` (nullable, resolved via allocation), `tokens` (numeric/wei), `collected_at` (timestamptz), `block`, `chain_id`, `source` (`graphtally` | `legacy_rebate`). Indexes on `(indexer, collected_at)` and `(deployment_id, collected_at)`.
- [ ] Add `ingestion_state` key `rav` (cursor: `last_block` or `last_id` by timestamp).
- [ ] Migration script consistent with existing schema (find how current tables are created — migrations dir vs ad-hoc; **check before writing**).

### A2. Ingest
- [ ] `src/lib/ingest/rav.ts` → `ingestRav(db)`: incrementally page `graphTallyTokensCollecteds` (and legacy `queryFeeRebates`/equivalent if the network subgraph exposes it) via cursor; resolve `allocationId → deploymentId` (reuse allocation data already ingested by `ingest-allocations`); upsert into `rav_redemptions`; advance cursor.
- [ ] `src/app/api/cron/ingest-rav/route.ts` — clone `ingest-allocations` route; `withCronTracking(db, 'rav', …)`.
- [ ] Register cron schedule (hourly is plenty; redemptions are not high-frequency).
- [ ] Backfill: one-shot historical pull (guard runtime against `maxDuration`; page in batches, resumable via cursor).

### A3. Aggregation + API
- [ ] `src/lib/rav.ts` — `getRavRevenue(indexer, { window, byDeployment })`: rolling sums + daily series from `rav_redemptions`.
- [ ] Extend `src/lib/rewards.ts` (or a new `pnl.ts`) to combine indexing rewards (existing) + RAV revenue into one series.
- [ ] `src/app/api/indexer/[address]/revenue/route.ts` (or extend an existing indexer route) — query-fee revenue + indexing rewards, windowed, cached.

### A4. Indexer P&L ("financial statements")
- [ ] Cost model: `src/lib/infra-cost.ts` — maintained, **user-overridable** per-chain archive-node $/mo table (ship sensible defaults; never hard-code as gospel — Arbitrum archive alone ranges 3.27 TB PathDB → ~38 TB by source). Overrides stored per connected wallet/indexer.
- [ ] `src/app/api/indexer/[address]/pnl/route.ts` — per-deployment & per-chain income statement: revenue (rewards + RAV rebates) − modeled infra cost; margin; break-even signal; rolling P&L.
- [ ] UI: P&L panel on the indexer detail page (reuse existing rewards-history chart components); CSV export via existing `generateRewardsCSV` pattern.

### A5. Tests
- [ ] Unit: `getRavRevenue` aggregation, P&L netting, cost-model override resolution.
- [ ] Ingest: cursor advance, dedup on re-run, allocation→deployment resolution.
- [ ] Follow `project_testing_setup` conventions (vitest, jsdom docblock, `--legacy-peer-deps`).

**Risks / watch-items**
- Legacy vs Horizon query-fee paths may both need representing during the transition; model `source` from day one.
- `allocationId → deploymentId` resolution gaps for closed/old allocations — store nullable, degrade gracefully.
- Don't double-count: `graphTallyTokensCollected` (redeemed) vs receipts in flight (escrow) are different ledgers — P&L uses **collected**, not signed-but-unredeemed.

---

# WORKSTREAM B — Indexer Cockpit (the moat)

**Goal:** A web UI over the indexer-agent **Indexer Management API**: view/edit indexing rules; queue/approve/execute/cancel actions in the actions queue; edit Agora cost models; manage Horizon provisions and allocation resize/present-poi — with POI-consensus and risk context in the same pane, and a pre-close POI safety gate.

**Non-negotiable trust model:** **self-hosted only.** The operator runs Lodestar inside their own network/VPN; the proxy to the agent stays local. No hosted Lodestar instance ever points at a remote agent. This is the open-core boundary. The management API and graph-node admin ports are explicitly "keep locked down" per Graph docs — honour that.

**Definition of done:** A self-hosted operator can, from the Lodestar UI, read their indexing rules and actions queue, edit a rule, edit a cost model, and approve/execute an action — with a pre-close POI divergence check gating close/present-poi actions.

### B0. Trust & deployment model (do this first — it shapes everything)
- [ ] Document & implement the self-hosted boundary: cockpit routes gated behind a `LODESTAR_SELF_HOSTED=true` (or presence of `INDEXER_AGENT_URL` + an explicit opt-in flag); **disabled by default** and on the hosted deployment.
- [ ] Auth between browser and Lodestar for cockpit actions (these are privileged writes): require operator auth — at minimum a server-side shared secret / session, not anonymous. Decide: wallet-sig session vs basic gate. (Open question — see below.)
- [ ] Keep `agentToken` server-side only; never round-trip agent credentials to the browser.
- [ ] SSRF guard on every agent URL via `src/lib/ssrf.ts`.

### B1. Generalised management-API proxy
- [ ] `src/lib/indexer-agent.ts` — typed client over the agent GraphQL management API. Use **parameterised/variable** GraphQL (not string interpolation) to kill the injection surface the current `present-poi` route mitigates by regex. Operations:
  - `indexerAllocations`, `indexerRegistration`, `indexerEndpoints`
  - `indexingRules` (get) / `setIndexingRule` / `deleteIndexingRule`
  - `actions` (get) / `queueActions` / `approveActions` / `executeActions` / `cancelActions`
  - `costModels` (get) / `setCostModel`
- [ ] Refactor `present-poi/route.ts` to use the new client (keep behaviour identical; it becomes one caller among many).
- [ ] `src/app/api/cockpit/*` route group — thin handlers over the client, all behind B0 gating.

### B2. Indexing rules UI
- [ ] Rules table (global + per-deployment): decision basis, allocation amount, parallel allocations, auto-renew, etc.
- [ ] Edit/create/delete with validation; optimistic display + reconcile.

### B3. Actions queue UI
- [ ] Queue view: pending/approved/executing/failed with `failureReason`.
- [ ] Queue / approve / execute / cancel controls.
- [ ] **B3a — Pre-close POI safety gate (1B):** before approving/executing a `close`/`present-poi` action, compare local POI vs stake-weighted consensus (reuse `src/lib/poi.ts`); block or warn on divergence. This is the integration of POI consensus into the *action workflow*, not a re-implementation of Graphcast.

### B4. Cost model editor
- [ ] Agora cost-model editor (live editor + validation); set/get per deployment.
- [ ] Sane templates; guard against pushing a model that would zero out fees by accident.

### B5. Context overlays (the differentiator)
- [ ] Surface POI consensus, risk score, and (once Workstream A lands) P&L per deployment alongside rules/actions — so decisions are made with intelligence in the same pane. This is what Indexer Tools / stakemachine UI don't do.

### B6. Tests
- [ ] Client: query/variable building, error mapping, SSRF rejection.
- [ ] Gate: cockpit routes 404/403 when self-hosted flag off.
- [ ] POI gate: divergence blocks close action.

**Risks / watch-items**
- **Post-Horizon agent churn:** Edge & Node flagged "post-Horizon cleanup removing legacy-allocation support from the indexer agent." Before building B1, confirm the current agent management-API schema against a live/post-Horizon agent release; re-scope if the surface moved.
- Hosted-deployment safety: a misconfiguration that exposes cockpit on the public instance is the worst-case. Default-off + explicit flag + tests for the gate.
- Cost-model and rule edits are real money — confirmation steps, dry-run/preview where the API allows.

---

## Staging & sequencing

**Stage 1 — RAV keystone (Workstream A, A1–A3).** Lowest risk, unblocks everything. Ship revenue tracking + API.
**Stage 2 — Indexer P&L (A4–A5).** Layer the income statement on Stage 1.
**Stage 3 — Cockpit foundation (B0–B1).** Trust model + generalised proxy + refactor present-poi onto it.
**Stage 4 — Cockpit UI (B2–B4) + POI gate (B3a).**
**Stage 5 — Context overlays (B5), incl. P&L pane from Workstream A.**

Parallelisable: A4 UI work can overlap B0/B1 (different surfaces). B0 trust model can be designed while Stage 1 builds.

**Course-change triggers**
- If a post-Horizon agent release materially changes the management-API surface → re-scope B1 before writing it.
- RAV `source` modelling must accommodate the legacy→Horizon query-fee transition; if the legacy path is already dead on mainnet, drop `legacy_rebate` to save effort.

---

## Open questions for Chief
1. **Cockpit operator auth:** wallet-signature session, a shared admin secret, or rely entirely on network isolation (self-hosted behind VPN)? Leaning wallet-sig + self-hosted flag.
2. **P&L cost overrides storage:** per connected wallet in DB, or local/exportable config? Leaning DB per indexer.
3. **Grant timing:** lodge the Graph Foundation tooling grant (framed on Cockpit + DIPs) before or after Stage 3? Doesn't block code.
4. **Legacy query-fee path:** still live on mainnet, or Horizon-only — decides whether we model `legacy_rebate` at all.

---

## Out of scope (tracked elsewhere / deliberately deferred)
- DIPs / indexing-agreements cockpit → `plans/on-chain-indexing-agreements.md` (gated on GIP-0087 testnet).
- x402 gateway monetisation → gated on The Graph shipping its own x402 gateway; non-custodial only (`project_custody_decision`).
- Fisherman dispute workbench → parked (ethically loaded, low strategic upside).
- Allocation what-if simulator (1D) → after the cockpit can execute its output.
