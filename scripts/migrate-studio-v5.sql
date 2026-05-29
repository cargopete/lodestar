-- Studio v5: prepaid GRT billing + Lodestar-issued API keys (RFC-004 metered gateway).
-- GRT amounts are exact NUMERIC(38,18) — 18 dp matches token precision, no float rounding.
-- Safe to re-run (all IF NOT EXISTS).

-- One billing account per owner address (the SIWE wallet). balance_grt is the hard
-- spend ceiling; the ledger is off-chain, the chain only proves deposits/withdrawals.
CREATE TABLE IF NOT EXISTS billing_accounts (
  owner_address    TEXT PRIMARY KEY,
  balance_grt      NUMERIC(38,18) NOT NULL DEFAULT 0,
  total_deposited  NUMERIC(38,18) NOT NULL DEFAULT 0,
  total_spent      NUMERIC(38,18) NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT billing_accounts_balance_nonneg CHECK (balance_grt >= 0)
);

-- Append-only audit trail of every balance movement.
CREATE TABLE IF NOT EXISTS billing_transactions (
  id             SERIAL PRIMARY KEY,
  owner_address  TEXT NOT NULL REFERENCES billing_accounts(owner_address) ON DELETE CASCADE,
  type           TEXT NOT NULL,                 -- deposit | debit | withdrawal | adjustment | refund
  amount_grt     NUMERIC(38,18) NOT NULL,       -- positive credit, negative debit
  tx_hash        TEXT,                          -- on-chain tx for deposit/withdrawal (NULL for debit/refund)
  query_count    INTEGER,                       -- for debit/refund batches
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT billing_transactions_type CHECK (type IN ('deposit','debit','withdrawal','adjustment','refund'))
);

-- Deposits/withdrawals are idempotent by on-chain tx hash (one credit per tx).
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_txn_tx_hash
  ON billing_transactions(tx_hash) WHERE tx_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_billing_txn_owner ON billing_transactions(owner_address, created_at DESC);

-- Lodestar-issued API keys. We issue these, so we store a one-way hash (like deploy
-- keys) — never the plaintext. key_prefix (e.g. "lod_live_ab12") is for display only.
CREATE TABLE IF NOT EXISTS studio_api_keys (
  id                SERIAL PRIMARY KEY,
  owner_address     TEXT NOT NULL REFERENCES billing_accounts(owner_address) ON DELETE CASCADE,
  label             TEXT,
  key_hash          TEXT NOT NULL UNIQUE,       -- SHA-256 of the plaintext key
  key_prefix        TEXT NOT NULL,              -- first chars, shown in the UI
  status            TEXT NOT NULL DEFAULT 'active',  -- active | revoked
  per_key_limit_usd NUMERIC(18,2),              -- optional sub-cap; NULL = bounded only by balance
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at      TIMESTAMPTZ,
  revoked_at        TIMESTAMPTZ,
  CONSTRAINT studio_api_keys_status CHECK (status IN ('active','revoked'))
);

CREATE INDEX IF NOT EXISTS idx_studio_api_keys_owner ON studio_api_keys(owner_address);

-- Per-key usage rollup, one row per billing period (YYYY-MM). Redis holds the live
-- counters; the reconcile/flush cron writes them here for history + true-up.
CREATE TABLE IF NOT EXISTS api_key_usage (
  id           SERIAL PRIMARY KEY,
  key_id       INTEGER NOT NULL REFERENCES studio_api_keys(id) ON DELETE CASCADE,
  period       TEXT NOT NULL,                   -- 'YYYY-MM'
  query_count  BIGINT NOT NULL DEFAULT 0,
  grt_spent    NUMERIC(38,18) NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (key_id, period)
);

CREATE INDEX IF NOT EXISTS idx_api_key_usage_period ON api_key_usage(period);
