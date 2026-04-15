-- Push Protocol notification opt-in subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
  address        TEXT PRIMARY KEY,
  subscribed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE
);

-- Mark which parameter changes have been notified via Push
ALTER TABLE parameter_changes ADD COLUMN IF NOT EXISTS push_notified BOOLEAN NOT NULL DEFAULT FALSE;

-- Log of dispatched notification batches (for audit / debugging)
CREATE TABLE IF NOT EXISTS notification_log (
  id               SERIAL PRIMARY KEY,
  event_type       TEXT NOT NULL,        -- 'cut_change' | 'indexer_inactive'
  indexer_address  TEXT NOT NULL,
  recipient_count  INTEGER NOT NULL DEFAULT 0,
  notified_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  details          JSONB
);
CREATE INDEX IF NOT EXISTS idx_notification_log_notified_at ON notification_log (notified_at DESC);
