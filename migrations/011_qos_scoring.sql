-- QoS quality scoring — daily per-(indexer,deployment) QoS, per-deployment totals,
-- and computed per-indexer daily quality scores.
-- Run on VPS: psql $DATABASE_URL -f migrations/011_qos_scoring.sql
--
-- Source: E&N/GraphOps QoS Oracle subgraph (V1 — avg+stdev latency, blocks_behind,
-- proportion_200, query_count). V2 (p90/p99, time_behind seconds) is NOT live yet, so
-- we store V1 fields and approximate the latency tail as avg + k*stdev in scoring.
-- See plans/qos-scoring-and-network-health.md.
--
-- `day_number` is the oracle's Unix-day index (days since epoch); `day` is the derived
-- DATE for readability. gateway_id is kept in the key — scores are gateway-conditional
-- once gateways decentralize.

-- Per (indexer, deployment, day) — the scoring primitive + per-deployment cohort source.
CREATE TABLE IF NOT EXISTS qos_daily (
  indexer_address      TEXT        NOT NULL,
  deployment_id        TEXT        NOT NULL,   -- subgraph_deployment_ipfs_hash
  day_number           INTEGER     NOT NULL,
  day                  DATE,
  query_count          BIGINT      NOT NULL DEFAULT 0,
  success_count        NUMERIC     NOT NULL DEFAULT 0,  -- proportion_200 * query_count
  avg_latency_ms       NUMERIC,
  stdev_latency_ms     NUMERIC,
  blocks_behind        NUMERIC,                          -- avg_indexer_blocks_behind
  total_query_fees_grt NUMERIC,
  gateway_id           TEXT        NOT NULL DEFAULT '',
  chain_id             TEXT,
  ingested_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (indexer_address, deployment_id, day_number, gateway_id)
);

CREATE INDEX IF NOT EXISTS idx_qos_daily_indexer_day    ON qos_daily (indexer_address, day_number DESC);
CREATE INDEX IF NOT EXISTS idx_qos_daily_deployment_day ON qos_daily (deployment_id, day_number DESC);

-- Per (deployment, day) totals — the served-share denominator (QueryDailyDataPoint).
CREATE TABLE IF NOT EXISTS deployment_daily (
  deployment_id        TEXT        NOT NULL,
  day_number           INTEGER     NOT NULL,
  day                  DATE,
  total_query_count    BIGINT      NOT NULL DEFAULT 0,
  gateway_success_rate NUMERIC,
  gateway_id           TEXT        NOT NULL DEFAULT '',
  chain_id             TEXT,
  ingested_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (deployment_id, day_number, gateway_id)
);

CREATE INDEX IF NOT EXISTS idx_deployment_daily_day ON deployment_daily (deployment_id, day_number DESC);

-- Computed per-indexer daily quality score + sub-metrics.
CREATE TABLE IF NOT EXISTS indexer_qos_score (
  indexer_address TEXT        NOT NULL,
  day_number      INTEGER     NOT NULL,
  day             DATE,
  reliability     NUMERIC,    -- Wilson lower bound, 0..1
  lat_util        NUMERIC,    -- latency utility, 0..1
  fresh_util      NUMERIC,    -- freshness utility, 0..1
  coverage        NUMERIC,    -- breadth of deployments served with credible volume
  served_gap      NUMERIC,    -- Phase 2: signal-share minus served-share (routed-around)
  efficiency      NUMERIC,    -- Phase 2: indexing rewards per useful query
  q_score         NUMERIC,    -- composite weighted-product quality, 0..100
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (indexer_address, day_number)
);

-- Leaderboard read: newest day, ranked by quality.
CREATE INDEX IF NOT EXISTS idx_indexer_qos_score_day_q ON indexer_qos_score (day_number DESC, q_score DESC);

INSERT INTO ingestion_state (key) VALUES ('qos')
ON CONFLICT (key) DO NOTHING;
