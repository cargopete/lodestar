# RFC-002: Monitoring, Diagnostics & Observability

**Author:** Chief + Jenny
**Date:** 2026-03-26
**Status:** Draft

---

## Executive Summary

Lodestar currently has zero observability. No health checks, no structured logging, no metrics, no alerting. Everything works until it doesn't, and then we're guessing. This RFC lays out a tiered approach to go from "completely blind" to "reasonably informed" without over-engineering things.

---

## Current State

What exists today:

- **Ingestion state table** — `ingestion_state` tracks cursors for incremental data ingestion across 5 data types
- **Console logging** — `console.log/error` scattered through cron routes and scripts; cron-runner prints duration + row counts
- **HTTP status codes** — Cron/API routes return 401 (auth fail), 503 (missing config), 500 (exception)
- **Redis graceful degradation** — logs a warning, serves uncached data if Redis is down
- **Basic DB check** — `hasDbAccess()` in routes, but no active probe

What's missing:

- No health check endpoint (`/health`, `/status`, `/ready`)
- No structured logging (JSON logs for aggregators)
- No metrics scraping (Prometheus/StatsD)
- No distributed tracing (Sentry, Datadog, etc.)
- No error alerts or uptime monitoring
- No request/response timing instrumentation beyond manual `Date.now()`
- No database connection pool monitoring
- No Redis connectivity checks
- No historical record of cron job runs

---

## Tier 1 — Quick Wins

Minimal effort, maximum immediate value. Do these first.

### 1.1 Health Endpoint (`/api/health`)

A single API route that probes all critical dependencies and returns structured JSON.

**Checks:**
- Postgres connectivity (simple query + latency)
- Redis connectivity (ping + latency)
- Ingestion freshness (time since last `ingestion_state.updated_at` per data type)
- Last network snapshot age

**Response shape:**
```json
{
  "status": "healthy" | "degraded" | "unhealthy",
  "timestamp": "2026-03-26T12:00:00Z",
  "components": {
    "postgres": { "status": "up", "latency_ms": 12 },
    "redis": { "status": "up", "latency_ms": 3 },
    "ingestion": {
      "epochs": { "last_updated": "...", "age_minutes": 15, "healthy": true },
      "allocations": { "last_updated": "...", "age_minutes": 45, "healthy": true },
      "delegations": { "last_updated": "...", "age_minutes": 200, "healthy": false }
    }
  }
}
```

**Staleness thresholds:** configurable per data type. Epochs should be fresh within ~2 hours, allocations within ~6 hours, etc.

**Auth:** Public for status checks (no secrets exposed), but consider a `?verbose=true` mode behind the cron bearer token for detailed diagnostics.

### 1.2 Structured Logging

Replace `console.log` scatter-gun with [pino](https://github.com/pinojs/pino).

- JSON output with level, timestamp, and context fields
- Log levels: `debug`, `info`, `warn`, `error`
- Context binding per module (e.g., `{ module: "ingest", step: "allocations" }`)
- Keeps `console.log` simplicity for dev, structured JSON for production

**Why pino:** Fastest Node.js logger, zero-dep, first-class Next.js support, trivial to set up. No reason to reach for anything heavier.

### 1.3 Cron Metrics Table

The cron-runner already tracks duration and row counts — just persist them.

**Schema:**
```sql
CREATE TABLE cron_runs (
  id            SERIAL PRIMARY KEY,
  step          TEXT NOT NULL,        -- 'refresh', 'epochs', 'allocations', etc.
  started_at    TIMESTAMPTZ NOT NULL,
  duration_ms   INTEGER NOT NULL,
  rows_affected INTEGER,
  success       BOOLEAN NOT NULL,
  error_message TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cron_runs_step_started ON cron_runs (step, started_at DESC);
```

**Value:** Immediate historical visibility into cron health. "When did allocations last run? How long did it take? Did it fail?" — all answerable with a simple query. Also becomes a perfect Grafana data source later.

---

## Tier 2 — Proper Observability

Build on the Tier 1 foundation with external tooling.

### 2.1 Uptime Monitoring

Point an external service at `/api/health`. Get alerts when things go sideways.

**Options:**
- [UptimeRobot](https://uptimerobot.com) — free tier, 5-min intervals, email/Slack/Telegram alerts
- [Better Stack](https://betterstack.com) — free tier, nicer UI, status pages
- [Cronitor](https://cronitor.io) — specifically good for cron job monitoring (ping-based)

**Recommendation:** UptimeRobot for the health endpoint + Cronitor for cron jobs. Both free, both set-and-forget.

### 2.2 Grafana Dashboards

Two options, depending on appetite for infra:

**Option A: Grafana Cloud (recommended)**
- Free tier: 10k metrics, 50GB logs, 50GB traces
- Connect directly to Postgres as a data source
- No extra infra to maintain
- Dashboard: `cron_runs`, `network_snapshots`, `ingestion_state` freshness, indexer count trends

**Option B: Self-hosted on the droplet**
- Run Grafana alongside the cron runner
- More control, more maintenance
- Makes sense if we outgrow the free tier or want full ownership

**Suggested dashboards:**

| Dashboard | Panels |
|-----------|--------|
| **System Health** | Component status, ingestion freshness gauges, last cron run per step |
| **Cron Performance** | Duration over time per step, success/failure rate, rows affected trends |
| **Protocol Metrics** | Total stake, delegation, indexer count, GRT price — all from `network_snapshots` |
| **Indexer Analytics** | Score distribution, APR trends, stake/delegation movement — from `indexer_snapshots` |

The protocol and indexer dashboards are practically free — the data already exists in `network_snapshots` and `indexer_snapshots`. Just needs a Grafana connection and some panel config.

### 2.3 Error Tracking (Sentry)

[Sentry](https://sentry.io) has a generous free tier and first-class Next.js SDK.

- Catches unhandled errors with full stack traces
- Source maps integration for meaningful traces in production
- Alerts on new/regression issues
- Performance monitoring (request waterfall, slow queries)

**Setup:** `npx @sentry/wizard@latest -i nextjs` — handles instrumentation files, webpack config, and environment variables. About 10 minutes.

---

## Tier 3 — Future Enhancements

Not needed now, but worth knowing the path forward.

### 3.1 Prometheus Metrics

Instrument application-level metrics:
- Request latency histograms (p50, p95, p99)
- Cache hit/miss rates
- DB query timing
- Subgraph query latency and error rates
- Active connections (Postgres pool)

Scrape with Grafana Cloud's built-in Prometheus or self-hosted. Use `prom-client` for Node.js instrumentation.

### 3.2 OpenTelemetry Tracing

Trace requests end-to-end: API route → DB query → Redis lookup → subgraph call. Useful for debugging slow requests and understanding data flow. Next.js has experimental OTel support built in.

Probably overkill for current scale, but lovely if the project grows.

### 3.3 Log Aggregation

Ship pino JSON logs to a central aggregator:
- Grafana Loki (pairs with Grafana dashboards, free tier available)
- Better Stack Logs
- Axiom (generous free tier, good DX)

Enables searching across Vercel function logs + droplet cron logs in one place.

---

## Implementation Order

```
Phase 1 (Tier 1):  Health endpoint → Cron metrics table → Structured logging
Phase 2 (Tier 2):  Uptime monitoring → Sentry → Grafana Cloud + dashboards
Phase 3 (Tier 3):  Prometheus metrics → Log aggregation → OTel (if needed)
```

Phase 1 is self-contained — no external accounts or services needed. Phase 2 adds external tooling with free tiers. Phase 3 is for when we want to get fancy.

---

## Open Questions

- **Alerting channels:** Email? Slack? Telegram? Where do alerts go?
- **Log retention:** How long do we keep `cron_runs` history? 90 days? Forever?
- **Public status page:** Worth exposing a status page (e.g., via Better Stack) for the community?
- **Budget:** Are we strictly free-tier, or is there budget for paid observability tooling?
