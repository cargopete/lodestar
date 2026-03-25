-- ============================================================
-- Lodestar Dashboard — Initial Schema
-- RFC-002: Persistent Storage, Full History & Unlocked Features
-- ============================================================

-- -----------------------------------------------------------
-- EPOCHS
-- Protocol epoch history. Append-only, ingested incrementally.
-- -----------------------------------------------------------
CREATE TABLE epochs (
  id                        integer PRIMARY KEY,
  start_block               integer NOT NULL,
  end_block                 integer,

  -- Staking
  stake_deposited           numeric,
  signalled_tokens          numeric,

  -- Rewards
  total_rewards             numeric,
  total_indexer_rewards     numeric,
  total_delegator_rewards   numeric,

  -- Query fees
  total_query_fees          numeric,
  query_fees_collected      numeric,
  curator_query_fees        numeric,
  query_fee_rebates         numeric,
  taxed_query_fees          numeric,

  ingested_at               timestamptz DEFAULT now()
);

CREATE INDEX idx_epochs_id ON epochs(id DESC);


-- -----------------------------------------------------------
-- NETWORK SNAPSHOTS
-- Point-in-time protocol-level stats. One row per cron run.
-- -----------------------------------------------------------
CREATE TABLE network_snapshots (
  id                        bigserial PRIMARY KEY,
  snapshot_at               timestamptz NOT NULL DEFAULT now(),

  total_staked              numeric,
  total_delegated           numeric,
  total_signalled           numeric,
  total_allocated           numeric,

  indexer_count             integer,
  active_indexer_count      integer,
  delegator_count           integer,
  active_delegator_count    integer,
  curator_count             integer,
  active_curator_count      integer,
  subgraph_count            integer,
  active_subgraph_count     integer,

  current_epoch             integer,
  grt_price_usd             numeric,
  network_tvl_usd           numeric
);

CREATE INDEX idx_network_snapshots_at ON network_snapshots(snapshot_at DESC);


-- -----------------------------------------------------------
-- INDEXERS
-- Current state of each indexer. Upserted every 5 min.
-- -----------------------------------------------------------
CREATE TABLE indexers (
  address                   text PRIMARY KEY,

  -- Identity
  name                      text,
  ens_name                  text,
  url                       text,
  geo_hash                  text,
  created_at_epoch          integer,
  created_at_ts             timestamptz,

  -- Stake
  self_stake_grt            numeric,
  delegated_grt             numeric,
  allocated_grt             numeric,
  provisioned_grt           numeric,

  -- Economics
  reward_cut                integer,
  query_fee_cut             integer,
  effective_cut             numeric,
  delegator_apr             numeric,
  delegation_capacity_pct   numeric,
  over_delegation_dilution  numeric,
  own_stake_ratio           numeric,
  indexer_rewards_own_ratio numeric,

  -- Cooldown
  delegator_parameter_cooldown integer,
  last_delegation_param_update integer,

  -- REO
  reo_status                text,
  reo_source                text,
  reo_renewal_timestamp     integer,
  reo_expires_at            integer,
  reo_days_remaining        numeric,

  -- Score
  score                     numeric,
  score_grade               text,

  -- Activity (rolling 7d)
  delegations_in_7d         integer DEFAULT 0,
  undelegations_in_7d       integer DEFAULT 0,
  net_flow_grt_7d           numeric DEFAULT 0,

  -- Totals
  rewards_earned_grt        numeric,
  query_fees_collected_grt  numeric,
  allocation_count          integer,

  last_updated              timestamptz DEFAULT now()
);

CREATE INDEX idx_indexers_stake ON indexers(self_stake_grt DESC);
CREATE INDEX idx_indexers_delegated ON indexers(delegated_grt DESC);
CREATE INDEX idx_indexers_apr ON indexers(delegator_apr DESC NULLS LAST);
CREATE INDEX idx_indexers_reo ON indexers(reo_status);


-- -----------------------------------------------------------
-- INDEXER SNAPSHOTS
-- Historical snapshots of indexer state. One row per indexer
-- per cron run. Enables trend analysis on individual indexers.
-- -----------------------------------------------------------
CREATE TABLE indexer_snapshots (
  id                bigserial PRIMARY KEY,
  indexer_address   text NOT NULL REFERENCES indexers(address),
  snapshot_at       timestamptz NOT NULL DEFAULT now(),
  epoch             integer,

  self_stake_grt    numeric,
  delegated_grt     numeric,
  allocated_grt     numeric,
  reward_cut        integer,
  query_fee_cut     integer,
  delegator_apr     numeric,
  delegation_capacity_pct numeric,
  score             numeric,
  score_grade       text
);

CREATE INDEX idx_indexer_snapshots_addr_at
  ON indexer_snapshots(indexer_address, snapshot_at DESC);


-- -----------------------------------------------------------
-- PARAMETER CHANGES
-- Append-only log of indexer reward_cut / query_fee_cut changes.
-- -----------------------------------------------------------
CREATE TABLE parameter_changes (
  id                bigserial PRIMARY KEY,
  indexer_address   text NOT NULL,
  param_name        text NOT NULL,
  old_value         integer,
  new_value         integer NOT NULL,
  epoch             integer,
  detected_at       timestamptz DEFAULT now()
);

CREATE INDEX idx_param_changes_indexer ON parameter_changes(indexer_address, detected_at DESC);
CREATE INDEX idx_param_changes_recent ON parameter_changes(detected_at DESC);


-- -----------------------------------------------------------
-- ALLOCATIONS
-- Historical record of every allocation open/close.
-- -----------------------------------------------------------
CREATE TABLE allocations (
  id                        text PRIMARY KEY,
  indexer_address            text NOT NULL,
  deployment_id             text NOT NULL,

  allocated_tokens_grt      numeric,

  created_epoch             integer,
  closed_epoch              integer,
  created_at                timestamptz,
  closed_at                 timestamptz,

  reward_cut_at_open        integer,
  query_fee_cut_at_open     integer,
  signal_at_open            numeric,

  reward_cut_at_close       integer,
  poi                       text,

  indexing_rewards_grt      numeric,
  query_fees_grt            numeric,

  status                    text DEFAULT 'open'
);

CREATE INDEX idx_allocations_indexer ON allocations(indexer_address, closed_epoch DESC NULLS FIRST);
CREATE INDEX idx_allocations_deployment ON allocations(deployment_id);
CREATE INDEX idx_allocations_epoch ON allocations(closed_epoch DESC NULLS FIRST);
CREATE INDEX idx_allocations_open ON allocations(status) WHERE status = 'open';


-- -----------------------------------------------------------
-- DELEGATION EVENTS
-- Append-only log of every delegation/undelegation/withdrawal.
-- -----------------------------------------------------------
CREATE TABLE delegation_events (
  id                text PRIMARY KEY,
  event_type        text NOT NULL,
  delegator         text NOT NULL,
  indexer           text NOT NULL,
  tokens_grt        numeric NOT NULL,
  epoch             integer,
  tx_hash           text,
  block_number      integer,
  timestamp         timestamptz
);

CREATE INDEX idx_deleg_events_delegator ON delegation_events(delegator, timestamp DESC);
CREATE INDEX idx_deleg_events_indexer ON delegation_events(indexer, timestamp DESC);
CREATE INDEX idx_deleg_events_epoch ON delegation_events(epoch DESC);
CREATE INDEX idx_deleg_events_recent ON delegation_events(timestamp DESC);


-- -----------------------------------------------------------
-- DELEGATOR POSITIONS
-- Current state of each delegator->indexer position.
-- -----------------------------------------------------------
CREATE TABLE delegator_positions (
  id                        bigserial PRIMARY KEY,
  delegator                 text NOT NULL,
  indexer_address            text NOT NULL,

  staked_tokens_grt         numeric,
  share_amount              numeric,

  unrealized_rewards_grt    numeric,
  realized_rewards_grt      numeric,

  first_delegated_at        timestamptz,
  last_event_at             timestamptz DEFAULT now(),

  UNIQUE(delegator, indexer_address)
);

CREATE INDEX idx_deleg_positions_delegator ON delegator_positions(delegator);
CREATE INDEX idx_deleg_positions_indexer ON delegator_positions(indexer_address);


-- -----------------------------------------------------------
-- SUBGRAPH DEPLOYMENTS
-- Snapshot of each subgraph deployment.
-- -----------------------------------------------------------
CREATE TABLE subgraph_deployments (
  id                        text PRIMARY KEY,
  ipfs_hash                 text NOT NULL UNIQUE,

  signalled_tokens_grt      numeric,
  staked_tokens_grt         numeric,
  query_fees_total_grt      numeric,
  query_fees_7d_grt         numeric,

  indexer_count             integer,
  curator_count             integer,

  complexity_category       text,
  complexity_score          integer,

  network                   text,

  last_updated              timestamptz DEFAULT now()
);

CREATE INDEX idx_subgraph_deployments_signal ON subgraph_deployments(signalled_tokens_grt DESC);
CREATE INDEX idx_subgraph_deployments_fees ON subgraph_deployments(query_fees_total_grt DESC);


-- -----------------------------------------------------------
-- CURATION SIGNALS
-- Current signal positions per curator per deployment.
-- -----------------------------------------------------------
CREATE TABLE curation_signals (
  id                        text PRIMARY KEY,
  curator                   text NOT NULL,
  deployment_id             text NOT NULL,

  signalled_tokens_grt      numeric,
  unsignalled_tokens_grt    numeric,
  signal                    numeric,
  realized_rewards_grt      numeric,

  last_signal_change        timestamptz,
  last_updated              timestamptz DEFAULT now(),

  UNIQUE(curator, deployment_id)
);

CREATE INDEX idx_curation_signals_curator ON curation_signals(curator);
CREATE INDEX idx_curation_signals_deployment ON curation_signals(deployment_id);


-- -----------------------------------------------------------
-- DISPUTES
-- On-chain dispute and slashing events.
-- -----------------------------------------------------------
CREATE TABLE disputes (
  id                        text PRIMARY KEY,
  dispute_type              text,
  indexer_address            text NOT NULL,
  fisherman                 text,
  allocation_id             text,
  deployment_id             text,

  status                    text,
  tokens_slashed_grt        numeric,
  tokens_burned_grt         numeric,

  created_epoch             integer,
  created_at                timestamptz,
  closed_at                 timestamptz,

  ingested_at               timestamptz DEFAULT now()
);

CREATE INDEX idx_disputes_indexer ON disputes(indexer_address);
CREATE INDEX idx_disputes_status ON disputes(status);
CREATE INDEX idx_disputes_recent ON disputes(created_at DESC);


-- -----------------------------------------------------------
-- INGESTION STATE
-- Tracks the last successfully ingested cursor per data type.
-- -----------------------------------------------------------
CREATE TABLE ingestion_state (
  key           text PRIMARY KEY,
  last_epoch    integer,
  last_block    integer,
  last_id       text,
  updated_at    timestamptz DEFAULT now()
);

INSERT INTO ingestion_state (key) VALUES
  ('epochs'),
  ('allocations'),
  ('delegation_events'),
  ('disputes'),
  ('indexers')
ON CONFLICT DO NOTHING;


-- -----------------------------------------------------------
-- BLOG POSTS
-- Content storage for /blog route.
-- -----------------------------------------------------------
CREATE TABLE blog_posts (
  slug              text PRIMARY KEY,
  title             text NOT NULL,
  content           text NOT NULL,
  excerpt           text,
  author            text DEFAULT 'cargopete',
  tags              text[],
  published_at      timestamptz,
  updated_at        timestamptz DEFAULT now(),
  is_published      boolean DEFAULT false
);

CREATE INDEX idx_blog_posts_published ON blog_posts(published_at DESC) WHERE is_published = true;
