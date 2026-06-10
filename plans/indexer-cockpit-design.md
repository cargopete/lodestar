# Indexer Cockpit — Design / Parked Idea

**Status:** PARKED (2026-06-10) — design captured, not being built yet. Resume when ready.
**Relation:** This is the "B" workstream of `plans/rav-and-cockpit-roadmap.md` (the "A" RAV workstream shipped). Tasks B0–B5 exist in the tracker.

---

## One-line pitch
A web control surface over the indexer-agent's GraphQL **Management API** — the thing indexers currently drive via SSH + the `graph indexer` CLI + hand-poking Postgres — wrapped in the intelligence Lodestar already has (POI consensus, risk score, P&L) in the same pane. We already proxy *one* agent mutation (`src/app/api/indexer/present-poi/route.ts`); the Cockpit generalises that into the full surface.

## Why it's the moat
No tool combines management-API **writes** + POI consensus + risk + P&L:
- **Vincent Taglia's Indexer Tools** — the de-facto community standard, but allocation-focused and largely read/compute.
- **stakemachine/indexer-agent-ui** — bare.
- Neither shows "this allocation is diverging from stake-weighted POI consensus *and* losing money" in one view. That fusion is the differentiator.

## The defining constraint: SELF-HOSTED ONLY (non-negotiable)
The management API + graph-node admin ports are "keep locked down" per Graph docs. No indexer will point a *hosted* dashboard at their agent. Therefore:
- Cockpit lives behind a `LODESTAR_SELF_HOSTED` flag — **off by default, and on the hosted `lodestar-dashboard.com` deployment**. The hosted site never exposes it.
- Operator runs Lodestar *inside their own network* (same VPN/host as the agent). Browser → local Lodestar → local agent. Agent credentials never leave their infra.
- This is the clean open-core line: free hosted analytics for everyone; the Cockpit is the paid/sponsored self-hosted operator tool.

## What an operator sees

A new `/cockpit` route, visible only when self-hosted flag on + agent reachable:

```
┌─ COCKPIT ──────────────────  agent ●reachable · arbitrum · 0xedca…2beb ─┐
│  [Allocations]  [Actions Queue ②]  [Indexing Rules]  [Cost Models]      │
├──────────────────────────────────────────────────┬─────────────────────┤
│  ALLOCATIONS                                       │  CONTEXT            │
│  deployment        alloc    POI consensus  P&L/30d │  Risk score  A  87  │
│  Uniswap v3      120k GRT   ✅ 98% agree   +4.2k   │  REO    ✅ 5.1d     │
│  Aave v3          80k GRT   ⚠️ 71% — DIVERGE -1.1k │  Net/30d  +$451k    │
│  ENS              40k GRT   ✅ 100%        +0.9k   │  Query fees 835k GRT│
│  [+ allocate]  [reallocate]  [close]               │                     │
└────────────────────────────────────────────────────┴─────────────────────┘
```

Four working surfaces:
1. **Allocations** — live allocations with POI consensus + sync status + per-deployment P&L inline (reuses `src/lib/poi.ts`, risk-score, and the RAV P&L from workstream A).
2. **Actions Queue** — the agent's real queue (pending/approved/executing/failed + `failureReason`). Approve/execute/cancel from the browser. **POI close-gate lives here**: closing/present-POI on a deployment diverging from stake-weighted consensus is blocked/warned — the GDR-3 slashing scenario (27k GRT).
3. **Indexing Rules** — global + per-deployment rules editor (decision basis, allocation amount, parallel allocations, auto-renew).
4. **Cost Models** — live Agora cost-model editor per deployment, with templates + a guard against accidentally zeroing fees.

## Build phases (B0–B5)
- **B0** — trust model + operator auth + the self-hosted gate (foundation; everything hangs off it).
- **B1** — typed proxy client over the agent's management API, using **parameterised GraphQL variables** (not string interpolation — the present-poi route currently mitigates injection by regex; the generalised client should remove that risk class entirely). Refactor present-poi onto it. Routes under `src/app/api/cockpit/*`, all behind the B0 gate.
- **B2** — Indexing rules UI.
- **B3** — Actions queue UI + POI close-gate (B3a).
- **B4** — Agora cost-model editor.
- **B5** — Context overlays (risk / REO / P&L beside every decision) — the differentiator.

## OPEN DECISION (blocks B0): operator auth
How does the operator authenticate to their own Cockpit? These are privileged, money-moving writes (closing allocations, editing cost models), so it matters. Pluggable — can change later, but picking saves a refactor. Options considered:

1. **Wallet signature (leaning toward this).** Operator signs in with their indexer/operator wallet (EIP-191 — same pattern already used for Push/gateway in `src/lib/wallet.ts`/push). Lodestar verifies the signer ∈ `indexer.operators` on-chain → session. No passwords, ties writes to on-chain identity, reuses existing signing code. Most effort, best security.
2. **Shared admin secret.** `LODESTAR_COCKPIT_SECRET` in the operator's env; UI gates behind it. Trivial; fine for a single-operator box; a shared secret to manage; no on-chain identity tie.
3. **Network isolation only.** No app auth; rely entirely on the self-hosted VPN/firewall boundary. Zero auth code, but a misconfigured network = exposed writes; no defense-in-depth.

**Decision: deferred.** Chief paused the Cockpit before locking this. Revisit at resume.

## Caveat to check at resume (don't skip)
Edge & Node flagged "post-Horizon cleanup removing legacy-allocation support from the indexer agent." **Before writing B1, pin the Cockpit against the *current* agent management-API schema** (introspect a live/post-Horizon agent) — if the surface moved, re-scope rather than build against stale assumptions.

## Existing assets it builds on (already in the repo)
- `src/app/api/indexer/present-poi/route.ts` — proxy pattern (body-overridable agentUrl/agentToken, SSRF guard via `src/lib/ssrf.ts`, input validation, Basic auth).
- `src/lib/poi.ts` — stake-weighted POI consensus (for the close-gate + overlays).
- `src/lib/risk-score.ts`, `src/lib/reo-contract.ts` — context overlays.
- `src/lib/rav.ts` / `src/lib/pnl.ts` + `/api/indexer/[address]/pnl` — per-deployment P&L overlay (shipped).
- Env vars already present in Vercel: `INDEXER_AGENT_URL`, `INDEXER_AGENT_TOKEN`.

## Funding angle
Frame a Graph Foundation tooling grant around the Cockpit (+ the DIPs cockpit in `plans/on-chain-indexing-agreements.md`) before committing serious engineering. See `project_rav_cockpit_roadmap` memory.
