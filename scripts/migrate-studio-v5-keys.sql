-- Studio v5 — metered query gateway API keys (RFC-004 Phase A).
--
-- Non-custodial, FREE-TIER ONLY. There is deliberately NO billing here:
-- no GRT balances, no deposits, no billing accounts/transactions. We only
-- issue keys and meter query counts per calendar month for free-tier caps.
--
-- Safe to re-run (all IF NOT EXISTS).

BEGIN;

-- Issued API keys. We store only a SHA-256 hash of the plaintext; the
-- plaintext is shown to the owner exactly once at mint time.
CREATE TABLE IF NOT EXISTS studio_api_keys (
  id            BIGSERIAL PRIMARY KEY,
  owner_address TEXT      NOT NULL,
  label         TEXT,
  key_hash      TEXT      NOT NULL UNIQUE,
  key_prefix    TEXT      NOT NULL,
  status        TEXT      NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'revoked')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ
);

-- Per-key, per-month query meter. One row per (key, YYYY-MM) period.
CREATE TABLE IF NOT EXISTS api_key_usage (
  id          BIGSERIAL PRIMARY KEY,
  key_id      BIGINT  NOT NULL REFERENCES studio_api_keys(id) ON DELETE CASCADE,
  period      TEXT    NOT NULL,            -- YYYY-MM
  query_count BIGINT  NOT NULL DEFAULT 0,
  UNIQUE (key_id, period)
);

CREATE INDEX IF NOT EXISTS idx_studio_api_keys_owner   ON studio_api_keys (owner_address);
CREATE INDEX IF NOT EXISTS idx_api_key_usage_key_id    ON api_key_usage (key_id);

COMMIT;
