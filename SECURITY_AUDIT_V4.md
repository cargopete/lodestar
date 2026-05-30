# Lodestar v4.0.0 — Security Audit Findings

> Phase 2 of the v4 hardening campaign. Audited 2026-05-30.
> Method: 4 parallel surface audits (authZ, SQL/SSRF, auth primitives, secrets) + adversarial verification of every High/Critical claim against real code. Severities below are the **verified, corrected** ratings — several agent ratings were adjusted up or down after reading the actual code.

## Severity-corrected summary

| # | Finding | Agent rating | **Verified rating** | Status |
|---|---|---|---|---|
| 1 | `present-poi` — unauthenticated open proxy w/ caller-supplied `agentUrl`+`agentToken` | Critical | **High** | open |
| 2 | Cron/health auth fails **open** when `CRON_SECRET` unset (`!cronSecret \|\|`) | Critical | **Medium** | open |
| 3 | Gateway: `deployment`/`subgraphId` unvalidated → path injection into gateway URL | High | **Medium** | open |
| 4 | `rateLimit()` is a no-op (always `allowed:true`) — per-route limits decorative | Medium | **Medium** | open |
| 5 | HMAC session sig compared with `!==` not `timingSafeEqual` | Critical | **Low** | open |
| 6 | `DELETE /push/subscribe` — no ownership check (anyone can unsubscribe anyone) | Critical | **Low** | open |
| 7 | `SESSION_SECRET` has no length/entropy validation | Medium | **Low** | open |
| 8 | Gateway `GRAPH_API_KEY` (in upstream URL) could leak via fetch error message | Medium | **Low** | open |
| 9 | `isSafeUrl` (present-poi, indexer-node-health) vulnerable to DNS rebinding | Medium | **Low** | open |
| 10 | Studio session `secure` cookie flag only in production | Medium | **Info** | accepted |

**Verified false positives / corrections:**
- "Indefinite signature replay" (agent Critical) — **partly wrong**: `verifySignIn` DOES have replay protection (`AUTH_WINDOW` 5-min timestamp check, `auth.ts:91`). The stateless-cookie 7-day TTL is a normal trade-off, not a vuln.
- **SQL injection: genuinely none.** All postgres.js queries parameterized; all GraphQL string-interp inputs regex-validated or whitelisted (orderBy/orderDir). Confirmed clean.
- **Secret leakage to client bundle: none.** All server secrets server-only; `NEXT_PUBLIC_*` hold only public data (WC project id, contract address, site URL).
- **SSRF to internal hosts:** mitigated by `isSafeUrl` private-IP blocks (except DNS-rebinding edge, #9).

## Detail & remediation

### 1. `present-poi` unauthenticated open proxy — HIGH
`src/app/api/indexer/present-poi/route.ts` — `POST` takes `agentUrl` + `agentToken` from the request body, no auth. Forwards a `queueActions(presentPOI)` GraphQL mutation to any public host with caller-supplied Basic auth. `isSafeUrl` blocks private IPs (so no internal SSRF), but it's still an unauthenticated request-forwarder.
**Fix:** require an EIP-191 signature proving the caller controls the indexer/allocation, OR restrict `targetUrl` to the server's own `INDEXER_AGENT_URL` (drop the body override). Given the bounty-claim use case, signature is the right call.

### 2. Cron/health fail-open — MEDIUM
`check-conversions/route.ts:10`, `check-subgraph-health/route.ts:42`, `health/route.ts:32` use `!cronSecret || header === ...`. If `CRON_SECRET` is ever unset in prod, these open. 11 other cron routes correctly use `if (!cronSecret) return false`.
**Fix:** make all three fail-closed (`if (!cronSecret) return false`).

### 3. Gateway path injection — MEDIUM
`gateway/[key]/route.ts:103` interpolates `deployment`/`subgraphId` into the gateway URL with no format check. A key-holder could inject `../` to probe other gateway paths (not arbitrary-host SSRF — target host is fixed).
**Fix:** validate against `^Qm[1-9A-HJ-NP-Za-km-z]{44}$` (deployment) / `^0x[0-9a-f]{64}$`-style (subgraphId) before building the URL.

### 4. Rate-limit no-op — MEDIUM
`rate-limit.ts:19` always returns `allowed:true` (Edge runtime, no ioredis). Wired into `middleware.ts` but toothless, so the per-route limits (cron 20/min, vote 60/min, lodie 10/min) don't apply. Amplifies #6 griefing and analytics/vote spam.
**Fix:** back it with Upstash REST (Edge-compatible) or Vercel KV; or move rate-limited routes off Edge. At minimum, document that limits are aspirational.

### 5–10
Lower-severity hardening: swap `!==`→`crypto.timingSafeEqual` for the HMAC and cron Bearer compares (#5); validate `SESSION_SECRET` length ≥32 (#7); sanitise gateway fetch-error messages to strip the upstream URL (#8); resolve-and-check IP to close the DNS-rebinding window (#9); `DELETE /push/subscribe` is low-risk (unsubscribe-only, reversible) but a signature check would close it (#6).

## Dependency CVEs — RESOLVED
- **9 high axios CVEs eliminated** via pnpm `overrides: { axios: ^1.13.6 }` (was pinned to vulnerable 0.27.2 transitively by `@pushprotocol/restapi`). Build + type-check verified green post-override.
- Remaining: 2 high (Vite) are **devDependencies only** (vitest) — not shipped to prod. 4 moderate (PostCSS via Next/Sentry, ws, uuid) transitive in framework deps, low real-risk. `pnpm audit --prod`: 0 high.

## Infrastructure findings (live — verified against the running VPS 2026-05-30)

### I1. Postgres exposed to the public internet — HIGH
The lodestar DB on `167.235.29.213:5433` is bound to `0.0.0.0` AND UFW allows `5433/tcp ALLOW Anywhere`. Confirmed reachable from an external laptop. `pg_hba.conf` has `host lodestar lodestar 0.0.0.0/0 scram-sha-256` — so the whole internet can reach the DB and attempt auth. Mitigated only by the SCRAM password (no `trust` rules — verified). Still: this exposes the DB to credential brute-force and any future Postgres CVE.
**Fix:** Vercel is serverless (no fixed egress IPs), so the app needs remote access — but lock it down. Options, best first: (a) require TLS + move to an allowlist if a static egress is available; (b) at minimum restrict UFW `5433` to known sources and force `sslmode=require` (currently `prefer`); (c) put it behind a WireGuard/Tailscale tunnel. The cron-runner (on the VPS) uses the local socket so isn't affected.

### I2. Redis exposed to the public internet — MEDIUM
`6379/tcp ALLOW Anywhere`, reachable externally. It DOES require auth (`-NOAUTH Authentication required` from outside — good), but should not be internet-facing. Brute-forceable; exposed to Redis CVEs.
**Fix:** UFW-restrict 6379, or bind to localhost / private interface. Confirm a strong `requirepass`.

### I3. Stray open ports — LOW
UFW allows `8080`, `8082`, `3001` `ALLOW Anywhere`. `3001` is reachable (the `pocket-pocket` docker container); `8080/8082` filtered. Review whether each needs public exposure; close what doesn't.

### Backup system (from the recent infra work) — OK
Pull-model, forced-command SSH key, DB password never on disk (peer auth). Sound. No findings. See [[infra_backups]].

> ⚠️ I1–I3 touch **live production firewall/DB config** on a box actively serving traffic. NOT changed without explicit go-ahead (per deployment-workflow rule). Recommend doing these in a maintenance window with the app's DB connectivity tested immediately after.

## Out of scope / not yet done
- On-chain write-path review (GNS lifecycle, BountyBoard) — covered functionally by typed confirmations; not re-audited here.
