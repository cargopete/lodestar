-- Mark which disputes have already triggered a push notification, so the
-- dispatcher (cron/dispatch-notifications) only alerts on newly-ingested ones.
-- Run on VPS: psql $DATABASE_URL -f migrations/013_disputes_push_notified.sql
--
-- NOTE: after applying, suppress the historical backlog ONCE so existing
-- disputes never fire (they're not "new"):
--   psql $DATABASE_URL -c "UPDATE disputes SET push_notified = TRUE;"
-- Do NOT put that UPDATE in this file — re-running the migration would then wrongly
-- suppress genuinely-new disputes that arrived in the meantime.

ALTER TABLE disputes ADD COLUMN IF NOT EXISTS push_notified BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_disputes_unnotified ON disputes (created_at) WHERE NOT push_notified;
