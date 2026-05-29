-- Studio v6 — subgraph health monitoring with webhook alerting (Tier 3).
--
-- Subgraph developers wire an incoming-webhook URL (Discord/Slack/generic)
-- per deployment; a cron scans enabled alerts every 15 min and fires a webhook
-- when the subgraph falls behind (block-lag) or hits a fatal error, and again
-- when it recovers. Edge-triggered: we only POST on a status TRANSITION.
--
-- Safe to re-run (all IF NOT EXISTS).

BEGIN;

-- One alert config per (owner, deployment). Re-adding the same deployment
-- edits the existing row (see createAlert ON CONFLICT in src/lib/studio/db.ts).
CREATE TABLE IF NOT EXISTS subgraph_alerts (
  id                  BIGSERIAL PRIMARY KEY,
  owner_address       TEXT        NOT NULL,
  deployment_id       TEXT        NOT NULL,        -- Qm… IPFS hash
  label               TEXT,
  webhook_url         TEXT        NOT NULL,
  channel             TEXT        NOT NULL DEFAULT 'webhook',  -- hint: 'discord'|'slack'|'webhook'
  lag_threshold_blocks BIGINT     NOT NULL DEFAULT 5000,
  enabled             BOOLEAN     NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  last_alerted_at     TIMESTAMPTZ,
  last_status         TEXT,
  UNIQUE (owner_address, deployment_id)
);

-- Append-only fire log, one row per webhook actually sent.
CREATE TABLE IF NOT EXISTS subgraph_alert_log (
  id        BIGSERIAL PRIMARY KEY,
  alert_id  BIGINT REFERENCES subgraph_alerts(id) ON DELETE CASCADE,
  sent_at   TIMESTAMPTZ DEFAULT NOW(),
  status    TEXT,                                   -- condition: 'lagging'|'failed'|'recovered'
  detail    TEXT
);

CREATE INDEX IF NOT EXISTS idx_subgraph_alerts_owner   ON subgraph_alerts (owner_address);
CREATE INDEX IF NOT EXISTS idx_subgraph_alerts_enabled ON subgraph_alerts (enabled);
CREATE INDEX IF NOT EXISTS idx_subgraph_alert_log_alert ON subgraph_alert_log (alert_id);

COMMIT;
