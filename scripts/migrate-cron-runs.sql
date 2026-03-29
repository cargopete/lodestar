-- Tier 1 Monitoring: cron_runs history table
-- Tracks every cron execution with timing, row counts, and errors.

CREATE TABLE IF NOT EXISTS cron_runs (
  id            SERIAL PRIMARY KEY,
  step          TEXT NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL,
  duration_ms   INTEGER NOT NULL,
  rows_affected INTEGER,
  success       BOOLEAN NOT NULL,
  error_message TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_step_started ON cron_runs (step, started_at DESC);
