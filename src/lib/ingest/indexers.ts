import type { DbClient } from '../db';
import type { EnrichedIndexer } from '../enriched';
import { log } from '../logger';

/**
 * Write enriched indexers to Postgres (upsert current state)
 * and record historical snapshots + parameter changes.
 *
 * Called from the existing cron job — the enriched data is already computed.
 */
export async function writeIndexers(
  sql: DbClient,
  enriched: EnrichedIndexer[],
  currentEpoch?: number
): Promise<{ upserted: number; snapshots: number; paramChanges: number }> {
  if (enriched.length === 0) return { upserted: 0, snapshots: 0, paramChanges: 0 };

  // 1. Read existing indexers to detect parameter changes
  const existing = await sql`
    SELECT address, reward_cut, query_fee_cut FROM indexers
  `;

  const existingMap = new Map(
    existing.map((i) => [i.address, i])
  );

  // 2. Detect parameter changes
  const paramChanges = enriched.flatMap((indexer) => {
    const prev = existingMap.get(indexer.id);
    if (!prev) return [];
    const changes: Array<{
      indexer_address: string;
      param_name: string;
      old_value: number | null;
      new_value: number;
      epoch: number | null;
    }> = [];

    if (prev.reward_cut !== null && prev.reward_cut !== indexer.indexingRewardCut) {
      changes.push({
        indexer_address: indexer.id,
        param_name: 'reward_cut',
        old_value: prev.reward_cut,
        new_value: indexer.indexingRewardCut,
        epoch: currentEpoch ?? null,
      });
    }
    if (prev.query_fee_cut !== null && prev.query_fee_cut !== indexer.queryFeeCut) {
      changes.push({
        indexer_address: indexer.id,
        param_name: 'query_fee_cut',
        old_value: prev.query_fee_cut,
        new_value: indexer.queryFeeCut,
        epoch: currentEpoch ?? null,
      });
    }
    return changes;
  });

  if (paramChanges.length > 0) {
    try {
      await sql`
        INSERT INTO parameter_changes ${sql(paramChanges)}
      `;
    } catch (e) {
      log.ingest.warn({ err: e }, 'Parameter changes insert failed');
    }
  }

  // 3. Upsert current indexer state (batch in chunks to avoid query size limits)
  const CHUNK = 200;
  let upserted = 0;
  for (let i = 0; i < enriched.length; i += CHUNK) {
    const rows = enriched.slice(i, i + CHUNK).map(mapToIndexerRow);
    await sql`
      INSERT INTO indexers ${sql(rows)}
      ON CONFLICT (address) DO UPDATE SET
        name = EXCLUDED.name,
        ens_name = EXCLUDED.ens_name,
        url = EXCLUDED.url,
        geo_hash = EXCLUDED.geo_hash,
        created_at_epoch = EXCLUDED.created_at_epoch,
        self_stake_grt = EXCLUDED.self_stake_grt,
        delegated_grt = EXCLUDED.delegated_grt,
        allocated_grt = EXCLUDED.allocated_grt,
        provisioned_grt = EXCLUDED.provisioned_grt,
        reward_cut = EXCLUDED.reward_cut,
        query_fee_cut = EXCLUDED.query_fee_cut,
        effective_cut = EXCLUDED.effective_cut,
        delegator_apr = EXCLUDED.delegator_apr,
        delegation_capacity_pct = EXCLUDED.delegation_capacity_pct,
        over_delegation_dilution = EXCLUDED.over_delegation_dilution,
        own_stake_ratio = EXCLUDED.own_stake_ratio,
        indexer_rewards_own_ratio = EXCLUDED.indexer_rewards_own_ratio,
        delegator_parameter_cooldown = EXCLUDED.delegator_parameter_cooldown,
        last_delegation_param_update = EXCLUDED.last_delegation_param_update,
        reo_status = EXCLUDED.reo_status,
        reo_source = EXCLUDED.reo_source,
        reo_renewal_timestamp = EXCLUDED.reo_renewal_timestamp,
        reo_expires_at = EXCLUDED.reo_expires_at,
        reo_days_remaining = EXCLUDED.reo_days_remaining,
        score = EXCLUDED.score,
        score_grade = EXCLUDED.score_grade,
        delegations_in_7d = EXCLUDED.delegations_in_7d,
        undelegations_in_7d = EXCLUDED.undelegations_in_7d,
        net_flow_grt_7d = EXCLUDED.net_flow_grt_7d,
        rewards_earned_grt = EXCLUDED.rewards_earned_grt,
        query_fees_collected_grt = EXCLUDED.query_fees_collected_grt,
        allocation_count = EXCLUDED.allocation_count,
        distinct_data_services = EXCLUDED.distinct_data_services,
        delegation_exchange_rate = EXCLUDED.delegation_exchange_rate,
        last_updated = EXCLUDED.last_updated
    `;
    upserted += rows.length;
  }

  // 4. Write indexer snapshots for trend analysis
  const snapshots = enriched.map((i) => ({
    indexer_address: i.id,
    epoch: currentEpoch ?? null,
    self_stake_grt: i.selfStakeGRT,
    delegated_grt: i.delegatedGRT,
    allocated_grt: weiToGRT(i.allocatedTokens),
    reward_cut: i.indexingRewardCut,
    query_fee_cut: i.queryFeeCut,
    delegator_apr: i.delegatorAPR,
    delegation_capacity_pct: i.delegationCapacity.utilizationPercent,
    query_fees_collected_grt: i.queryFeesCollectedGRT,
    delegation_exchange_rate: i.delegationExchangeRate,
    score: i.score,
    score_grade: i.scoreGrade,
  }));

  let snapshotCount = 0;
  for (let i = 0; i < snapshots.length; i += CHUNK) {
    const batch = snapshots.slice(i, i + CHUNK);
    try {
      await sql`INSERT INTO indexer_snapshots ${sql(batch)}`;
      snapshotCount += batch.length;
    } catch (e) {
      log.ingest.warn({ err: e }, 'Indexer snapshot insert failed');
    }
  }

  return { upserted, snapshots: snapshotCount, paramChanges: paramChanges.length };
}

function mapToIndexerRow(i: EnrichedIndexer) {
  return {
    address: i.id,
    name: i.name,
    ens_name: i.ensName,
    url: i.url,
    geo_hash: i.geoHash,
    created_at_epoch: i.createdAt,
    self_stake_grt: i.selfStakeGRT,
    delegated_grt: i.delegatedGRT,
    allocated_grt: weiToGRT(i.allocatedTokens),
    provisioned_grt: i.provisionedGRT,
    reward_cut: i.indexingRewardCut,
    query_fee_cut: i.queryFeeCut,
    effective_cut: i.effectiveCut,
    delegator_apr: i.delegatorAPR,
    delegation_capacity_pct: i.delegationCapacity.utilizationPercent,
    over_delegation_dilution: i.overDelegationDilution,
    own_stake_ratio: i.ownStakeRatio,
    indexer_rewards_own_ratio: i.indexerRewardsOwnGenerationRatio,
    delegator_parameter_cooldown: i.delegatorParameterCooldown,
    last_delegation_param_update: i.lastDelegationParameterUpdate,
    reo_status: i.reoStatus,
    reo_source: i.reoSource,
    reo_renewal_timestamp: i.reoRenewalTimestamp,
    reo_expires_at: i.reoExpiresAt,
    reo_days_remaining: i.reoDaysRemaining,
    score: i.score,
    score_grade: i.scoreGrade,
    delegations_in_7d: i.recentActivity.delegationsIn7d,
    undelegations_in_7d: i.recentActivity.undelegationsIn7d,
    net_flow_grt_7d: i.recentActivity.netFlowGRT,
    rewards_earned_grt: weiToGRT(i.rewardsEarned),
    query_fees_collected_grt: i.queryFeesCollectedGRT,
    allocation_count: i.allocationCount,
    distinct_data_services: i.distinctDataServices,
    delegation_exchange_rate: i.delegationExchangeRate,
    last_updated: new Date().toISOString(),
  };
}

function weiToGRT(wei: string): number {
  return Number(BigInt(wei || '0') / BigInt(10 ** 14)) / 10000;
}
