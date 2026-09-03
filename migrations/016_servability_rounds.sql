-- servability_rounds: one row per probe round of /api/indexing-status/[hash] (RFC-006 D5,
-- lodestar#59). The rendered "Effectively dead" state is derived from the last K rows for a
-- deployment rather than from the round just probed, and the rows are what answers "was it
-- actually down at 1:34?" after the fact - which nothing could answer for uniswap-v4-base-3.
--
-- Run on VPS: psql $DATABASE_URL -f migrations/016_servability_rounds.sql

CREATE TABLE IF NOT EXISTS servability_rounds (
  id                     BIGSERIAL PRIMARY KEY,
  deployment_hash        TEXT NOT NULL,
  probed_at              TIMESTAMPTZ NOT NULL,
  serving_operator_count INTEGER NOT NULL,
  serving_indexer_count  INTEGER NOT NULL,
  gateway_verdict        TEXT,
  verdict_json           JSONB NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_servability_rounds_hash_probed
  ON servability_rounds (deployment_hash, probed_at DESC);
