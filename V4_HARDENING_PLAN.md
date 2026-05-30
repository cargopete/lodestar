# Lodestar v4.0.0 — Hardening Campaign

> Started 2026-05-30 · from v3.3.1
> Three goals: **test coverage**, **security** (UI + API + backend), **general hardening**.

## Decisions

- **Coverage scope:** logic-tier 80% — hit 80% on `lib` + API routes + hooks; critical-path component tests only (auth, forms, money/on-chain UI). Not chasing 80% on every presentational component.
- **Sequencing:** gate → security → coverage. Stabilise CI first, audit second, grind coverage third.
- **Security depth:** skill-driven systematic audit (infrastructure-audit + security-review) with a findings report.

## Baseline (measured 2026-05-30)

| Metric | Value |
|---|---|
| Scale | ~62k LOC · 59 lib · 91 API routes (25 mutating) · 67 components · 29 pages · 11 hooks |
| Tests | 598 passing · 34 files · ~2s · green on `vitest run` |
| Coverage | **~37%** (lib-only — API/components/pages/hooks unmeasured) |
| CI | **RED** — type-check (51 tsc errors in test files) + test:coverage (80% gate unmet) both failing |
| Deps | Multiple **HIGH axios CVEs** (transitive) — SSRF, prototype pollution, credential theft, DoS |

## Phase 1 — Stabilise the gate

- [ ] Fix 51 `tsc` errors (all in `cron-auth.test.ts` + `routes-v2.test.ts`; NextRequest/NextResponse → Request/Response casts). Prod code is clean.
- [ ] Reconfigure `vitest.config.ts` coverage to measure `lib` + API routes + hooks (+ critical components). Remove the lib-only blinkers.
- [ ] Set the coverage threshold to the current **real** measured %, then ratchet upward — never let it regress.
- [ ] All 4 CI jobs green (lint, type-check, test, build).

## Phase 2 — Security audit (skill-driven)

- [ ] **AuthZ** on all 25 mutating routes (POST/PUT/DELETE/PATCH).
- [ ] **SQL injection** on 4 raw-SQL surfaces: `lib/db.ts`, `lib/studio/db.ts`, `api/bounty-query/[id]`, `api/studio/query/[id]`.
- [ ] **Studio session auth** — HMAC stateless cookie (`lib/studio/auth.ts`).
- [ ] **Gateway** — `lod_live_` key validation, metering, rate-limit (`api/gateway/[key]`, `lib/rate-limit.ts`).
- [ ] **Cron auth** — `Bearer ${CRON_SECRET}` on all `/api/cron/*`.
- [ ] **Secrets** — 73 distinct env vars; no leakage to client bundles; `NEXT_PUBLIC_` discipline.
- [ ] **On-chain writes** — GNS lifecycle + BountyBoard confirmation/guard paths.
- [ ] **Infra** — the backup system, VPS exposure, Postgres reachability.
- [ ] **Deps** — resolve the axios CVEs (find the transitive puller, override/upgrade).
- [ ] Findings report + remediation.

## Phase 3 — Coverage expansion (to real 80% on logic tiers)

- [ ] `lib` 37% → 80%.
- [ ] API routes — 80%, prioritising the 25 mutating routes.
- [ ] Hooks — 80%.
- [ ] Critical-path component tests (auth flows, forms, money/on-chain UI).
- [ ] A few integration tests across the critical paths.

## Phase 4 — Hardening + release

- [ ] Input validation + rate-limit gaps from the audit.
- [ ] Error handling / graceful degradation review.
- [ ] `pnpm audit` clean (or documented accepted risk).
- [ ] Version bump → **4.0.0**, changelog, README/ROADMAP refresh.

## Notes

- Use `pnpm` (not npm — no npm lockfile; `npm audit` errors).
- Test conventions: jsdom opt-in via `// @vitest-environment jsdom` docblock; installs need `--legacy-peer-deps`; API route tests mock `@/lib/cache` + `@/lib/subgraph`.
