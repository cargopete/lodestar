-- Lodestar Dashboard — full schema setup
-- Run this on a fresh Postgres instance, then run the backfill script.
-- Safe to re-run (all CREATE TABLE / CREATE INDEX use IF NOT EXISTS).

-- ── Ingestion cursors ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ingestion_state (
  key        TEXT PRIMARY KEY,
  last_epoch INTEGER,
  last_block INTEGER,
  last_id    TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed required cursor rows (ingest scripts expect these to exist)
INSERT INTO ingestion_state (key) VALUES
  ('epochs'),
  ('allocations'),
  ('delegation_events'),
  ('disputes'),
  ('rav'),
  ('qos')
ON CONFLICT (key) DO NOTHING;

-- ── On-chain data ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS epochs (
  id                      INTEGER PRIMARY KEY,
  start_block             INTEGER,
  end_block               INTEGER,
  stake_deposited         NUMERIC,
  signalled_tokens        NUMERIC,
  total_rewards           NUMERIC,
  total_indexer_rewards   NUMERIC,
  total_delegator_rewards NUMERIC,
  total_query_fees        NUMERIC,
  query_fees_collected    NUMERIC,
  curator_query_fees      NUMERIC,
  query_fee_rebates       NUMERIC,
  taxed_query_fees        NUMERIC
);

CREATE TABLE IF NOT EXISTS indexers (
  address                          TEXT PRIMARY KEY,
  name                             TEXT,
  ens_name                         TEXT,
  url                              TEXT,
  geo_hash                         TEXT,
  created_at_epoch                 INTEGER,
  self_stake_grt                   NUMERIC,
  delegated_grt                    NUMERIC,
  allocated_grt                    NUMERIC,
  provisioned_grt                  NUMERIC,
  reward_cut                       NUMERIC,
  query_fee_cut                    NUMERIC,
  effective_cut                    NUMERIC,
  delegator_apr                    NUMERIC,
  delegation_capacity_pct          NUMERIC,
  over_delegation_dilution         NUMERIC,
  own_stake_ratio                  NUMERIC,
  indexer_rewards_own_ratio        NUMERIC,
  delegator_parameter_cooldown     INTEGER,
  last_delegation_param_update     INTEGER,
  reo_status                       TEXT,
  reo_source                       TEXT,
  reo_renewal_timestamp            BIGINT,
  reo_expires_at                   TIMESTAMPTZ,
  reo_days_remaining               INTEGER,
  score                            NUMERIC,
  score_grade                      TEXT,
  delegations_in_7d                INTEGER,
  undelegations_in_7d              INTEGER,
  net_flow_grt_7d                  NUMERIC,
  rewards_earned_grt               NUMERIC,
  query_fees_collected_grt         NUMERIC,
  allocation_count                 INTEGER,
  distinct_data_services           INTEGER DEFAULT 0,
  delegation_exchange_rate         NUMERIC,
  last_updated                     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS indexer_snapshots (
  id                       SERIAL PRIMARY KEY,
  indexer_address          TEXT NOT NULL,
  epoch                    INTEGER,
  self_stake_grt           NUMERIC,
  delegated_grt            NUMERIC,
  delegated_thawing_grt    NUMERIC,
  allocated_grt            NUMERIC,
  reward_cut               NUMERIC,
  query_fee_cut            NUMERIC,
  delegator_apr            NUMERIC,
  delegation_capacity_pct  NUMERIC,
  query_fees_collected_grt NUMERIC,
  delegation_exchange_rate NUMERIC,
  score                    NUMERIC,
  score_grade              TEXT,
  snapshot_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_indexer_snapshots_address_epoch
  ON indexer_snapshots (indexer_address, epoch DESC);

CREATE TABLE IF NOT EXISTS allocations (
  id                    TEXT PRIMARY KEY,
  indexer_address       TEXT NOT NULL,
  deployment_id         TEXT,
  allocated_tokens_grt  NUMERIC,
  created_epoch         INTEGER,
  closed_epoch          INTEGER,
  created_at            TIMESTAMPTZ,
  closed_at             TIMESTAMPTZ,
  signal_at_open        NUMERIC,
  poi                   TEXT,
  indexing_rewards_grt  NUMERIC,
  query_fees_grt        NUMERIC,
  status                TEXT
);

CREATE INDEX IF NOT EXISTS idx_allocations_indexer ON allocations (indexer_address);
CREATE INDEX IF NOT EXISTS idx_allocations_status  ON allocations (status);

-- RAV redemptions — historical query-fee revenue (GraphTallyCollector collections
-- + legacy rebates). Time-series behind indexer P&L. Stores COLLECTED tokens only.
CREATE TABLE IF NOT EXISTS rav_redemptions (
  id              TEXT PRIMARY KEY,
  indexer_address TEXT        NOT NULL,
  payer           TEXT,
  allocation_id   TEXT,
  deployment_id   TEXT,
  tokens_grt      NUMERIC     NOT NULL,
  source          TEXT        NOT NULL DEFAULT 'graphtally',  -- 'graphtally' | 'legacy_rebate'
  collected_at    TIMESTAMPTZ,
  block           INTEGER,
  chain_id        INTEGER     NOT NULL DEFAULT 42161,
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rav_indexer_collected
  ON rav_redemptions (indexer_address, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_rav_deployment_collected
  ON rav_redemptions (deployment_id, collected_at DESC);

-- QoS quality scoring (see migrations/011_qos_scoring.sql for full notes).
-- Source: QoS Oracle subgraph (V1). day_number = oracle Unix-day index.
CREATE TABLE IF NOT EXISTS qos_daily (
  indexer_address      TEXT        NOT NULL,
  deployment_id        TEXT        NOT NULL,
  day_number           INTEGER     NOT NULL,
  day                  DATE,
  query_count          BIGINT      NOT NULL DEFAULT 0,
  success_count        NUMERIC,     -- NULL = the oracle published no success figure that day
  avg_latency_ms       NUMERIC,
  stdev_latency_ms     NUMERIC,
  blocks_behind        NUMERIC,
  total_query_fees_grt NUMERIC,
  gateway_id           TEXT        NOT NULL DEFAULT '',
  chain_id             TEXT,
  ingested_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (indexer_address, deployment_id, day_number, gateway_id)
);
CREATE INDEX IF NOT EXISTS idx_qos_daily_indexer_day    ON qos_daily (indexer_address, day_number DESC);
CREATE INDEX IF NOT EXISTS idx_qos_daily_deployment_day ON qos_daily (deployment_id, day_number DESC);

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

CREATE TABLE IF NOT EXISTS indexer_qos_score (
  indexer_address TEXT        NOT NULL,
  day_number      INTEGER     NOT NULL,
  day             DATE,
  reliability     NUMERIC,
  lat_util        NUMERIC,
  fresh_util      NUMERIC,
  coverage        NUMERIC,
  served_gap      NUMERIC,
  efficiency      NUMERIC,
  q_score         NUMERIC,
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (indexer_address, day_number)
);
CREATE INDEX IF NOT EXISTS idx_indexer_qos_score_day_q ON indexer_qos_score (day_number DESC, q_score DESC);

CREATE TABLE IF NOT EXISTS delegation_events (
  id          TEXT PRIMARY KEY,
  event_type  TEXT,
  delegator   TEXT NOT NULL,
  indexer     TEXT NOT NULL,
  tokens_grt  NUMERIC,
  timestamp   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_delegation_events_indexer   ON delegation_events (indexer);
CREATE INDEX IF NOT EXISTS idx_delegation_events_delegator ON delegation_events (delegator);
CREATE INDEX IF NOT EXISTS idx_delegation_events_timestamp ON delegation_events (timestamp DESC);

CREATE TABLE IF NOT EXISTS delegations (
  id              TEXT PRIMARY KEY,
  delegator       TEXT NOT NULL,
  indexer_address TEXT NOT NULL,
  tokens_grt      NUMERIC,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delegations_indexer ON delegations (indexer_address);

CREATE TABLE IF NOT EXISTS disputes (
  id                  TEXT PRIMARY KEY,
  dispute_type        TEXT,
  indexer_address     TEXT NOT NULL,
  fisherman           TEXT,
  allocation_id       TEXT,
  deployment_id       TEXT,
  status              TEXT,
  tokens_slashed_grt  NUMERIC,
  tokens_burned_grt   NUMERIC,
  created_at          TIMESTAMPTZ,
  closed_at           TIMESTAMPTZ,
  push_notified       BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_disputes_indexer ON disputes (indexer_address);
CREATE INDEX IF NOT EXISTS idx_disputes_unnotified ON disputes (created_at) WHERE NOT push_notified;

CREATE TABLE IF NOT EXISTS parameter_changes (
  id               SERIAL PRIMARY KEY,
  indexer_address  TEXT NOT NULL,
  param_name       TEXT NOT NULL,
  old_value        NUMERIC,
  new_value        NUMERIC,
  epoch            INTEGER,
  push_notified    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_parameter_changes_indexer ON parameter_changes (indexer_address, created_at DESC);

CREATE TABLE IF NOT EXISTS network_snapshots (
  id                    SERIAL PRIMARY KEY,
  total_staked          NUMERIC,
  total_delegated       NUMERIC,
  total_signalled       NUMERIC,
  total_allocated       NUMERIC,
  total_supply_grt      NUMERIC,
  indexer_count         INTEGER,
  active_indexer_count  INTEGER,
  delegator_count       INTEGER,
  active_delegator_count INTEGER,
  curator_count         INTEGER,
  active_curator_count  INTEGER,
  subgraph_count        INTEGER,
  active_subgraph_count INTEGER,
  current_epoch         INTEGER,
  grt_price_usd         NUMERIC,
  network_tvl_usd       NUMERIC,
  snapshot_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ── Scoring ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS indexer_scores (
  indexer_address           TEXT NOT NULL,
  period_type               TEXT NOT NULL,
  period_start              DATE NOT NULL,
  period_end                DATE NOT NULL,
  query_fee_score           NUMERIC,
  allocation_efficiency_score NUMERIC,
  delegator_apr_score       NUMERIC,
  effective_cut_score       NUMERIC,
  capacity_score            NUMERIC,
  cut_stability_score       NUMERIC,
  tenure_bonus              NUMERIC,
  retention_score           NUMERIC,
  reo_score                 NUMERIC,
  poi_consensus_score       NUMERIC,
  allocation_breadth_score  NUMERIC,
  community_vote_score      NUMERIC,
  data_service_score        NUMERIC,
  subtotal                  NUMERIC,
  penalty_multiplier        NUMERIC,
  final_score               NUMERIC,
  months_active             NUMERIC,
  is_eligible_for_badge     BOOLEAN DEFAULT FALSE,
  rank                      INTEGER,
  PRIMARY KEY (indexer_address, period_type, period_start)
);

CREATE INDEX IF NOT EXISTS idx_indexer_scores_period ON indexer_scores (period_type, period_start DESC);

-- ── Community features ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS community_votes (
  id               SERIAL PRIMARY KEY,
  period           TEXT NOT NULL,
  voter_address    TEXT NOT NULL,
  indexer_address  TEXT NOT NULL,
  is_delegator     BOOLEAN DEFAULT FALSE,
  vote_weight      NUMERIC DEFAULT 1,
  signature        TEXT,
  message          TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_community_votes_period   ON community_votes (period);
CREATE INDEX IF NOT EXISTS idx_community_votes_voter    ON community_votes (voter_address);
CREATE INDEX IF NOT EXISTS idx_community_votes_indexer  ON community_votes (indexer_address);

CREATE TABLE IF NOT EXISTS roadmap_community_updates (
  id           SERIAL PRIMARY KEY,
  item_id      TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('on_track', 'delayed', 'shipped', 'uncertain')),
  note         TEXT,
  submitted_by TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_roadmap_updates_item_id ON roadmap_community_updates (item_id, created_at DESC);

-- ── Push notifications ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS push_subscriptions (
  address       TEXT PRIMARY KEY,
  subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS notification_log (
  id               SERIAL PRIMARY KEY,
  event_type       TEXT NOT NULL,
  indexer_address  TEXT NOT NULL,
  recipient_count  INTEGER NOT NULL DEFAULT 0,
  notified_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  details          JSONB
);

CREATE INDEX IF NOT EXISTS idx_notification_log_notified_at ON notification_log (notified_at DESC);

-- Native push device tokens (iOS APNs; room for fcm later). One row per device,
-- bound to the wallet address that opted in (proved by an EIP-191 signature over
-- the push-subscribe message). Many devices may map to one address.
CREATE TABLE IF NOT EXISTS device_tokens (
  token        TEXT PRIMARY KEY,
  address      TEXT NOT NULL,
  platform     TEXT NOT NULL DEFAULT 'ios',
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_address ON device_tokens (address) WHERE is_active;

-- ── Operations ────────────────────────────────────────────────────────────────

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

-- One row per probe round of /api/indexing-status/[hash] (RFC-006 D5). "Effectively dead" is
-- derived from the last K rows per deployment, never from one round (lodestar#59).
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
