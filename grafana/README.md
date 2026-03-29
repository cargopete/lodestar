# Grafana Dashboard Setup

## Quick Start (Grafana Cloud)

1. Sign up at https://grafana.com/products/cloud/ (free tier)
2. Add a **PostgreSQL data source** with your `DATABASE_URL` credentials
3. Import each dashboard JSON via **Dashboards → Import → Upload JSON file**

## Dashboards

| File | Description |
|------|-------------|
| `system-health.json` | Ingestion freshness, last cron runs, failure log |
| `cron-performance.json` | Duration trends, rows affected, success rates, p95 timings |
| `protocol-metrics.json` | Total staked/delegated, GRT price, participant counts |
| `indexer-analytics.json` | Score distribution, top indexers, delegation event trends |

## Notes

- All queries target the PostgreSQL data source — no Prometheus or additional infra needed
- Cron performance dashboard includes a `$step` variable for filtering by cron step
- Protocol and indexer dashboards use data from `network_snapshots` and `indexer_snapshots`
