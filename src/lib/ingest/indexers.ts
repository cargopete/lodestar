import type { DbClient } from '../db';
import type { EnrichedIndexer } from '../enriched';

/**
 * Write enriched indexers to Postgres (upsert current state)
 * and record historical snapshots + parameter changes.
 *
 * Called from the existing cron job — the enriched data is already computed.
 */
export async function writeIndexers(
  db: DbClient,
  enriched: EnrichedIndexer[],
  currentEpoch?: number
): Promise<{ upserted: number; snapshots: number; paramChanges: number }> {
  if (enriched.length === 0) return { upserted: 0, snapshots: 0, paramChanges: 0 };

  // 1. Read existing indexers to detect parameter changes
  const { data: existing } = await db
    .from('indexers')
    .select('address, reward_cut, query_fee_cut');

  const existingMap = new Map(
    (existing ?? []).map((i) => [i.address, i])
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
    const { error } = await db.from('parameter_changes').insert(paramChanges);
    if (error) console.warn('Parameter changes insert failed:', error.message);
  }

  // 3. Upsert current indexer state (batch in chunks of 200 to avoid body size limits)
  const CHUNK = 200;
  let upserted = 0;
  for (let i = 0; i < enriched.length; i += CHUNK) {
    const rows = enriched.slice(i, i + CHUNK).map(mapToIndexerRow);
    const { error } = await db.from('indexers').upsert(rows, { onConflict: 'address' });
    if (error) throw new Error(`Indexer upsert failed: ${error.message}`);
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
    score: i.score,
    score_grade: i.scoreGrade,
  }));

  // Batch snapshots too
  let snapshotCount = 0;
  for (let i = 0; i < snapshots.length; i += CHUNK) {
    const batch = snapshots.slice(i, i + CHUNK);
    const { error } = await db.from('indexer_snapshots').insert(batch);
    if (error) console.warn('Indexer snapshot insert failed:', error.message);
    else snapshotCount += batch.length;
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
    last_updated: new Date().toISOString(),
  };
}

function weiToGRT(wei: string): number {
  return Number(BigInt(wei || '0') / BigInt(10 ** 14)) / 10000;
}
