-- RAV redemptions — historical query-fee revenue per indexer/deployment.
-- Run on VPS: psql $DATABASE_URL -f migrations/010_rav_redemptions.sql
--
-- Source: GraphTallyCollector `graphTallyTokensCollected` events (Horizon query-fee
-- collection / RAV redemption), plus the legacy query-fee rebate path during the
-- transition. The network payments subgraph already exposes these (see
-- src/app/api/payments/route.ts); this table snapshots them into a time-series so
-- indexer P&L has a real revenue line, not just a current-value rollup.
--
-- We store COLLECTED (redeemed) tokens only — escrow / signed-but-unredeemed
-- receipts are a different ledger and must not be counted as P&L revenue.

CREATE TABLE IF NOT EXISTS rav_redemptions (
  id              TEXT PRIMARY KEY,          -- collectionId, or "<txHash>:<logIndex>" when no stable id
  indexer_address TEXT        NOT NULL,      -- receiver (lowercased)
  payer           TEXT,                      -- payer / gateway (lowercased)
  allocation_id   TEXT,                      -- nullable; not always resolvable for old collections
  deployment_id   TEXT,                      -- resolved via allocations table; nullable
  tokens_grt      NUMERIC     NOT NULL,      -- GRT (wei / 1e18), matching house _grt convention
  source          TEXT        NOT NULL DEFAULT 'graphtally',  -- 'graphtally' | 'legacy_rebate'
  collected_at    TIMESTAMPTZ,
  block           INTEGER,
  chain_id        INTEGER     NOT NULL DEFAULT 42161,
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Revenue reads are "for an indexer, newest-first / windowed".
CREATE INDEX IF NOT EXISTS idx_rav_indexer_collected
  ON rav_redemptions (indexer_address, collected_at DESC);

-- Per-deployment P&L breakdown.
CREATE INDEX IF NOT EXISTS idx_rav_deployment_collected
  ON rav_redemptions (deployment_id, collected_at DESC);

-- Ingest cursor (the ingest script expects this row to exist).
INSERT INTO ingestion_state (key) VALUES ('rav')
ON CONFLICT (key) DO NOTHING;
