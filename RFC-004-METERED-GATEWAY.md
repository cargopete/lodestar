# RFC-004 — Metered Query Gateway (prepaid GRT)

> Status: **PARKED (2026-05-29)** — halted after Phase 0. Code lives on branch `metered-gateway`.
> Author: Chief (design) / Jenny (drafting)

## ⛔ Why this is parked

A strategic re-think (2026-05-29) flagged that, in the dashboard's current state, a paying
gateway user gets a `lod_live_` key that **proxies The Graph's gateway at cost** — i.e. very nearly
nothing they can't get **directly from Subgraph Studio**, which mints keys in minutes, takes GRT
deposits directly, shows per-key usage, and carries the official SLA with no SPOF or custody risk.

So the metered gateway would have us take on **custody of user funds + treasury ops +
money-transmitter/regulatory exposure** to **resell a commodity at zero margin** with no
differentiation. Poor value-to-risk.

**Where Lodestar's payable value actually sits** is the *intelligence layer* (risk scores, REO,
rolling APY, advisor, comparison, **Lodie AI** — which has real per-call cost — alerts, and a
programmatic API over the enriched cron-materialised data). That's a SaaS-analytics business, and the
billing math here (`billing.ts` reserve/commit/reconcile) is **metering-agnostic** — directly reusable
for it. Revisit this RFC only if (a) we monetise the intelligence layer and want one billing surface,
or (b) a differentiated reason for the gateway emerges (e.g. abstracting GRT away entirely).

## What was built before parking (Phase 0, on this branch)

- `scripts/migrate-studio-v5.sql` — billing/keys schema.
- `src/lib/studio/billing.ts` + `api-keys.ts` — pure money math + key gen/hash (22 unit tests).
- `scripts/backup-lodestar-db.sh` — DB backup script (needed **regardless** of this RFC; the DB is
  currently unbacked — see the separate backup work).

---

_Original design below, retained for reference._

## Summary

Lodestar becomes a **metered query gateway**: developers prepay **GRT**, receive Lodestar-issued
API keys, and query subgraphs through a Lodestar proxy that bills each query against their balance.
This closes the largest remaining Studio-parity gap ("API key management") and does so as a
**non-profit pass-through** — users pay exactly what The Graph charges Lodestar, no spread.

## Motivation

The gap analysis lists the Studio API-key suite (create/restrict/route/monitor keys) as the one
remaining Tier-1 gap and the only thing stopping Lodestar from being a Studio *replacement* for
developers. Lodestar can't mint real gateway keys (it isn't a gateway operator), so the only way to
offer keys with real query access is to **proxy through Lodestar's own gateway key and meter usage**.

## Locked decisions

| Decision | Setting |
|---|---|
| Proxy home | **Path B** — runs on the Hetzner VPS behind the existing Caddy, co-located with local Redis (6379) + Postgres (5433). Dashboard stays on Vercel. |
| Payment | **Prepaid GRT.** Users deposit Arbitrum GRT (`0x9623…88C7`) to a Lodestar treasury → off-chain balance ledger. They can only spend what they deposited. |
| Margin | **None — at cost, no spread.** Lodestar is a pass-through, not a business. |
| Withdrawals | **Allowed** — users pull unspent GRT back to their SIWE address. |
| Attribution | **One address per account**; deposits + withdrawals tied to the SIWE wallet. |
| Caps | Hard per-key + global caps + Redis kill-switch; reserve-then-commit via atomic Redis Lua so concurrency can't overshoot. |

## Architecture & funds flow

1. User connects wallet (SIWE) → sends GRT from that address to the Lodestar **treasury**.
2. A **deposit watcher** sees `Transfer(from=user, to=treasury)` and credits an off-chain
   `balance_grt` ledger (Postgres) for that address.
3. Each query the proxy **reserves then debits** a conservative `EST_GRT_PER_QUERY` from the balance.
   Balance hits zero → `402`, cut off until top-up.
4. Lodestar uses the collected GRT to keep its **own gateway billing budget** funded; the gateway
   draws from that as queries run.

### The no-bankruptcy invariant

As long as `EST_GRT_PER_QUERY ≥ true gateway cost`, Lodestar never pays out more than it took in.
Metering is inherently off-chain (we count queries), so the **balance ledger is off-chain**; the
chain only proves *deposits/withdrawals*.

### At-cost via reserve-then-reconcile

The gateway returns a signed `graph-attestation` but **no per-query cost**, so we can't charge exact
cost at query time. Instead:
1. Debit each query at a conservative reserve rate (guarantees no short-term loss).
2. Periodically read Lodestar's **actual** gateway spend for the proxy key, compute true per-query
   cost, and **true-up** — refund the over-charge to user balances, apportioned by the per-user query
   counts we track. No markup survives the true-up; The Graph's 100k-free-queries/month tier passes
   straight through to users automatically.

## Pricing anchors (2026-05-29)

- The Graph: **$0.00002/query** ($2 / 100k; recently halved from $40→$20 per million) + **100k free
  queries/month**. ([Studio pricing](https://thegraph.com/studio-pricing/))
- GRT ≈ $0.026 → **~0.00073 GRT/query** observed (verified against the live Studio key: 489.11 GRT
  for 667.6K queries).
- **Default reserve `EST = 0.001 GRT/query`** (~37% buffer, refunded on true-up). Per-key spending
  limit denominated in **USD** (mirrors Studio).

## Data model (Postgres)

- `billing_accounts` — `owner_address` PK, `balance_grt`, `total_deposited`, `total_spent`, `updated_at`.
- `billing_transactions` — append-only audit: `type` (deposit|debit|withdrawal|adjustment), `amount_grt`,
  `tx_hash`, `query_count`, `created_at`.
- `studio_api_keys` — `owner_address`, `label`, `key_hash` (SHA-256), `key_prefix` (`lod_live_…`),
  `status`, `per_key_limit_usd`, `created_at`, `last_used_at`, `revoked_at`.
- `api_key_usage` — `key_id`, `period` (YYYY-MM), `query_count`, `grt_spent`, unique(key_id, period).

## Phased plan

**Phase 0 — Foundations** *(no money, no proxy)*: migration `migrate-studio-v5.sql`; pure libs
(USD↔GRT, reserve/commit, key gen/hash) + unit tests.

**Phase 1 — Billing rails** *(money in/out, no queries)*: deposit watcher cron; withdrawal flow;
`/dock` billing page (deposit / balance / history / withdraw); treasury liquid-reserve vs
gateway-funding split.

**Phase 2 — Key console** *(keys inert)*: `…/api/studio/keys[/id]` CRUD (SIWE-gated, plaintext once);
"API Keys" tab in `/dock`.

**Phase 3 — Metered proxy** *(real spend — gated behind all the above)*: standalone proxy on the VPS
behind Caddy; auth → real rate-limit (replaces the fail-open stub) → reserve against balance + global
cap (atomic Lua) → forward via dedicated Lodestar key → commit + meter; Redis kill-switch.

**Phase 4 — Reconciliation & polish**: true-up cron (read actual fees, apportion, refund buffer);
usage UI; kill-switch control; indexer/dev guide; retire the gap-analysis "billing out of scope" line.

## Risks & responsibilities

- **Custody / regulatory.** Holding prepaid user GRT = custodial funds = money-transmitter / e-money
  territory in many jurisdictions. A deliberate, eyes-open decision, not legal advice.
- **Treasury discipline (load-bearing).** Collected GRT must keep the gateway budget funded *and* a
  liquid float must be reserved for withdrawals. Starts as a manual ops routine.
- **Reserve-rate accuracy.** If the reserve drifts below true cost between reconciliations, Lodestar
  fronts a small bounded loss until the rate is bumped. Self-correcting; keep the buffer conservative.

## Open items / verification

- Programmatic source for the proxy key's **actual** query fees (Studio billing API vs on-chain
  Billing contract) — needed for the Phase 4 true-up; not blocking Phases 0–3.
- Proxy **subdomain** (e.g. `gateway.lodestar-dashboard.com`).
- Which **spare Graph key** to dedicate to the proxy (Studio account already has spares).

## Out of scope

Fiat/card payments; per-key gateway-side routing preferences (gateway-controlled, not ours to set);
non-Arbitrum GRT deposits.
