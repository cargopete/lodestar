/**
 * Database row types — matches the schema in supabase/migrations/.
 */

// ── Row types ──────────────────────────────────────────────

export interface EpochRow {
  id: number;
  start_block: number;
  end_block: number | null;
  stake_deposited: number | null;
  signalled_tokens: number | null;
  total_rewards: number | null;
  total_indexer_rewards: number | null;
  total_delegator_rewards: number | null;
  total_query_fees: number | null;
  query_fees_collected: number | null;
  curator_query_fees: number | null;
  query_fee_rebates: number | null;
  taxed_query_fees: number | null;
  ingested_at: string;
}

export interface NetworkSnapshotRow {
  id: number;
  snapshot_at: string;
  total_staked: number | null;
  total_delegated: number | null;
  total_signalled: number | null;
  total_allocated: number | null;
  indexer_count: number | null;
  active_indexer_count: number | null;
  delegator_count: number | null;
  active_delegator_count: number | null;
  curator_count: number | null;
  active_curator_count: number | null;
  subgraph_count: number | null;
  active_subgraph_count: number | null;
  current_epoch: number | null;
  grt_price_usd: number | null;
  network_tvl_usd: number | null;
}

export interface IndexerDbRow {
  address: string;
  name: string | null;
  ens_name: string | null;
  url: string | null;
  geo_hash: string | null;
  created_at_epoch: number | null;
  created_at_ts: string | null;
  self_stake_grt: number | null;
  delegated_grt: number | null;
  allocated_grt: number | null;
  provisioned_grt: number | null;
  reward_cut: number | null;
  query_fee_cut: number | null;
  effective_cut: number | null;
  delegator_apr: number | null;
  delegation_capacity_pct: number | null;
  over_delegation_dilution: number | null;
  own_stake_ratio: number | null;
  indexer_rewards_own_ratio: number | null;
  delegator_parameter_cooldown: number | null;
  last_delegation_param_update: number | null;
  reo_status: string | null;
  reo_source: string | null;
  reo_renewal_timestamp: number | null;
  reo_expires_at: number | null;
  reo_days_remaining: number | null;
  score: number | null;
  score_grade: string | null;
  delegations_in_7d: number;
  undelegations_in_7d: number;
  net_flow_grt_7d: number;
  rewards_earned_grt: number | null;
  query_fees_collected_grt: number | null;
  allocation_count: number | null;
  last_updated: string;
}

export interface IndexerSnapshotRow {
  id: number;
  indexer_address: string;
  snapshot_at: string;
  epoch: number | null;
  self_stake_grt: number | null;
  delegated_grt: number | null;
  allocated_grt: number | null;
  reward_cut: number | null;
  query_fee_cut: number | null;
  delegator_apr: number | null;
  delegation_capacity_pct: number | null;
  score: number | null;
  score_grade: string | null;
}

export interface ParameterChangeRow {
  id: number;
  indexer_address: string;
  param_name: string;
  old_value: number | null;
  new_value: number;
  epoch: number | null;
  detected_at: string;
}

export interface AllocationDbRow {
  id: string;
  indexer_address: string;
  deployment_id: string;
  allocated_tokens_grt: number | null;
  created_epoch: number | null;
  closed_epoch: number | null;
  created_at: string | null;
  closed_at: string | null;
  reward_cut_at_open: number | null;
  query_fee_cut_at_open: number | null;
  signal_at_open: number | null;
  reward_cut_at_close: number | null;
  poi: string | null;
  indexing_rewards_grt: number | null;
  query_fees_grt: number | null;
  status: string;
}

export interface DelegationEventRow {
  id: string;
  event_type: string;
  delegator: string;
  indexer: string;
  tokens_grt: number;
  epoch: number | null;
  tx_hash: string | null;
  block_number: number | null;
  timestamp: string | null;
}

export interface DelegatorPositionRow {
  id: number;
  delegator: string;
  indexer_address: string;
  staked_tokens_grt: number | null;
  share_amount: number | null;
  unrealized_rewards_grt: number | null;
  realized_rewards_grt: number | null;
  first_delegated_at: string | null;
  last_event_at: string;
}

export interface SubgraphDeploymentRow {
  id: string;
  ipfs_hash: string;
  signalled_tokens_grt: number | null;
  staked_tokens_grt: number | null;
  query_fees_total_grt: number | null;
  query_fees_7d_grt: number | null;
  indexer_count: number | null;
  curator_count: number | null;
  complexity_category: string | null;
  complexity_score: number | null;
  network: string | null;
  last_updated: string;
}

export interface CurationSignalRow {
  id: string;
  curator: string;
  deployment_id: string;
  signalled_tokens_grt: number | null;
  unsignalled_tokens_grt: number | null;
  signal: number | null;
  realized_rewards_grt: number | null;
  last_signal_change: string | null;
  last_updated: string;
}

export interface DisputeRow {
  id: string;
  dispute_type: string | null;
  indexer_address: string;
  fisherman: string | null;
  allocation_id: string | null;
  deployment_id: string | null;
  status: string | null;
  tokens_slashed_grt: number | null;
  tokens_burned_grt: number | null;
  created_epoch: number | null;
  created_at: string | null;
  closed_at: string | null;
  ingested_at: string;
}

export interface IngestionStateRow {
  key: string;
  last_epoch: number | null;
  last_block: number | null;
  last_id: string | null;
  updated_at: string;
}

export interface BlogPostRow {
  slug: string;
  title: string;
  content: string;
  excerpt: string | null;
  author: string;
  tags: string[] | null;
  published_at: string | null;
  updated_at: string;
  is_published: boolean;
}

