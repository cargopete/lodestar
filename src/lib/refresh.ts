import { log } from './logger';
import { cacheSet } from './cache';
import { resolveEnsNames } from './ens';
import { weiToGRT, resolveIndexerName } from './utils';
import { batchCheckEligibility, type OracleEligibility } from './reo-contract';
import {
  calculateDelegatorAPR,
  calculateDelegationCapacity,
  calculateRollingAPY,
  calculatePoolExchangeRate,
  calculateExchangeRateAPY,
} from './rewards';
import { calculateIndexerScore } from './risk-score';
import type { EnrichedIndexer } from './enriched';
import type { DbClient } from './db';
import { updateIngestionState } from './db';
import { writeIndexers } from './ingest/indexers';
import { nuthatchSql } from './nuthatch';
import {
  indexersAllSql, activeAllocationsAllSql, delegationEventsSinceSql, closedAllocationsSinceSql, exchangeRatesAsOfSql,
  dataServiceCountsSql, networkSql, networkParamsSql,
  type NestIndexerDetailRow, type NestActiveAllocationAllRow, type NestDelegationEventRow, type NestClosedAllocationRewardRow,
  type NestExchangeRateRow, type NestDataServiceCountRow, type NestNetworkRow, type NestNetworkParamsRow,
} from './nest-queries';
import { refreshIndexerFromNest } from './nest-indexers';

const REFRESH_BASE_PATH = process.env.NUTHATCH_REFRESH_BASE_PATH || '/alloc';

interface SubgraphIndexer {
  id: string;
  account: {
    id: string;
    defaultDisplayName?: string | null;
    metadata?: { displayName?: string | null; description?: string | null } | null;
  };
  stakedTokens: string;
  lockedTokens: string;
  delegatedTokens: string;
  allocatedTokens: string;
  allocationCount: number;
  indexingRewardCut: number;
  queryFeeCut: number;
  delegatorParameterCooldown: number;
  lastDelegationParameterUpdate: number;
  rewardsEarned: string;
  queryFeesCollected: string;
  delegatorShares: string;
  delegatedThawingTokens?: string;
  url: string | null;
  geoHash: string | null;
  createdAt: number;
  indexingRewardEffectiveCut?: string;
  overDelegationDilution?: string;
  ownStakeRatio?: string;
  delegatedStakeRatio?: string;
  indexerRewardsOwnGenerationRatio?: string;
  provisionedTokens?: string;
}

interface AllocationData {
  id: string;
  allocatedTokens: string;
  indexer: { id: string };
  subgraphDeployment: {
    signalledTokens: string;
    stakedTokens: string;
  };
}

/** ENS for the whole indexer set; a failure costs the names and nothing else, as the subgraph step's did. */
async function resolveEnsNamesForRefresh(ids: string[]): Promise<Record<string, string>> {
  try {
    const names = await resolveEnsNames(ids);
    log.refresh.info({ count: Object.keys(names).length }, 'ENS names resolved');
    return names;
  } catch (e) {
    log.refresh.warn({ err: e }, 'ENS lookup failed, continuing without');
    return {};
  }
}

/** Everything the enrichment needs, gathered from one source or the other. */
export interface RefreshInputs {
  network: { totalTokensSignalled: string; networkGRTIssuancePerBlock?: string; delegationRatio: number; currentEpoch: number };
  indexers: SubgraphIndexer[];
  allocationMap: Map<string, AllocationData[]>;
  delegationActivity: Record<string, { delegations: number; undelegations: number; netFlowGRT: number }>;
  ensNames: Record<string, string>;
  closedAllocsByIndexer: Map<string, Array<{ delegator_rewards_grt: number; closed_at: number }>>;
  exchangeRateHistory: Map<string, { rate30d: number | null; rate90d: number | null }>;
  dataServiceCountMap: Map<string, number>;
}

/**
 * The nest gatherer (nuthatch#1160): the same eight inputs from `graph-allocations-nest`, none of them
 * through the gateway key. Differences from the gateway path, each deliberate:
 *   - display names from IPFS metadata are null (group B work); ENS names come from a mainnet RPC as on the gateway path;
 *   - the derived ratios are computed here from the subgraph's own formulas rather than read;
 *   - the 30- and 90-day exchange rates are the ledger summed up to real Unix times instead of
 *     block numbers estimated from an average block time;
 *   - the pool figure excludes thawing already, so the thawing argument to the rate is 0.
 * Every read is `nuthatchSql`: this is a cron, not the page the user sees, and a stalled nest is a
 * stale Redis entry that the readiness probe on the pages reports rather than a 503 here.
 */
export async function gatherFromNest(): Promise<RefreshInputs> {
  const now = Math.floor(Date.now() / 1000);
  const q = <T,>(sql: string) => nuthatchSql<T>(sql, REFRESH_BASE_PATH);
  const [net, params, rows, allocs, events, closed, r30, r90, dsc] = await Promise.all([
    q<NestNetworkRow>(networkSql()), q<NestNetworkParamsRow>(networkParamsSql()), q<NestIndexerDetailRow>(indexersAllSql()),
    q<NestActiveAllocationAllRow>(activeAllocationsAllSql()), q<NestDelegationEventRow>(delegationEventsSinceSql(now - 7 * 86400)),
    q<NestClosedAllocationRewardRow>(closedAllocationsSinceSql(now - 90 * 86400)),
    q<NestExchangeRateRow>(exchangeRatesAsOfSql(now - 30 * 86400)), q<NestExchangeRateRow>(exchangeRatesAsOfSql(now - 90 * 86400)),
    q<NestDataServiceCountRow>(dataServiceCountsSql()),
  ]);
  const n = net[0]; const p = params[0];
  if (!n || !p) throw new Error('lodestar_network or lodestar_network_params returned no row');
  const delegationRatio = Number(p.delegation_ratio ?? 16);
  const network = {
    totalTokensSignalled: n.total_tokens_signalled,
    networkGRTIssuancePerBlock: n.issuance_per_block ?? undefined,
    delegationRatio,
    currentEpoch: Number(n.current_epoch),
  };
  const indexers: SubgraphIndexer[] = rows.map((r) => refreshIndexerFromNest(r, delegationRatio));
  const allocationMap = new Map<string, AllocationData[]>();
  for (const a of allocs) {
    const list = allocationMap.get(a.indexer) ?? [];
    list.push({ id: a.id, allocatedTokens: a.allocated_tokens, indexer: { id: a.indexer }, subgraphDeployment: { signalledTokens: a.signalled_tokens, stakedTokens: a.deployment_staked_tokens ?? '0' } });
    allocationMap.set(a.indexer, list);
  }
  const delegationActivity: RefreshInputs['delegationActivity'] = {};
  for (const e of events) {
    const id = e.indexer.toLowerCase();
    if (!delegationActivity[id]) delegationActivity[id] = { delegations: 0, undelegations: 0, netFlowGRT: 0 };
    const tokens = weiToGRT(e.tokens);
    if (e.event_type === 'delegation') { delegationActivity[id].delegations++; delegationActivity[id].netFlowGRT += tokens; }
    else if (e.event_type === 'undelegation') { delegationActivity[id].undelegations++; delegationActivity[id].netFlowGRT -= tokens; }
  }
  const closedAllocsByIndexer = new Map<string, Array<{ delegator_rewards_grt: number; closed_at: number }>>();
  for (const c of closed) {
    const rewards = weiToGRT(c.indexing_delegator_rewards);
    if (rewards <= 0 || c.closed_at == null) continue;
    const list = closedAllocsByIndexer.get(c.indexer) ?? [];
    list.push({ delegator_rewards_grt: rewards, closed_at: Number(c.closed_at) });
    closedAllocsByIndexer.set(c.indexer, list);
  }
  const exchangeRateHistory = new Map<string, { rate30d: number | null; rate90d: number | null }>();
  for (const r of r30) { const rate = calculatePoolExchangeRate(r.pool_tokens, '0', r.pool_shares); if (rate > 0) exchangeRateHistory.set(r.indexer, { rate30d: rate, rate90d: null }); }
  for (const r of r90) { const rate = calculatePoolExchangeRate(r.pool_tokens, '0', r.pool_shares); if (rate > 0) { const e = exchangeRateHistory.get(r.indexer) ?? { rate30d: null, rate90d: null }; e.rate90d = rate; exchangeRateHistory.set(r.indexer, e); } }
  const dataServiceCountMap = new Map<string, number>(dsc.map((d) => [d.indexer, Number(d.n)]));
  log.refresh.info({ indexers: indexers.length, allocations: allocs.length, events: events.length, closed: closed.length }, 'refresh inputs gathered from the nest');
  const ensNames = await resolveEnsNamesForRefresh(indexers.map((i) => i.id));
  return { network, indexers, allocationMap, delegationActivity, ensNames, closedAllocsByIndexer, exchangeRateHistory, dataServiceCountMap };
}

/**
 * Core indexer enrichment pipeline.
 * Gathers from the nest (nuthatch#1160; the gateway gatherer left with the key), computes
 * scores, writes to Redis + Postgres. Extracted so it can be called from both the Next.js route and
 * the standalone cron runner.
 */
export async function refreshIndexers(opts: {
  sql?: DbClient | null;
  writeToRedis?: boolean;
}): Promise<{ count: number; durationMs: number }> {
  const { sql, writeToRedis = true } = opts;
  const startTime = Date.now();

  const inputs = await gatherFromNest();
  const { network, indexers, allocationMap, delegationActivity, ensNames, closedAllocsByIndexer, exchangeRateHistory, dataServiceCountMap } = inputs;
  const indexerIds = indexers.map((i) => i.id);
  const totalNetworkSignal = weiToGRT(network.totalTokensSignalled);
  const delegationRatio = network.delegationRatio;
  const issuancePerBlock = network.networkGRTIssuancePerBlock
    ? weiToGRT(network.networkGRTIssuancePerBlock)
    : 0;
  const L1_BLOCKS_PER_YEAR = 2_628_000;
  const annualIssuance = issuancePerBlock * L1_BLOCKS_PER_YEAR;

  // Step 5: Batch-read REO oracle. The oracle is the sole source of truth —
  // if the batch read fails, every indexer is left 'unknown' rather than
  // guessed at from on-chain heuristics.
  let reoMap = new Map<string, OracleEligibility>();
  const reoSource: 'oracle' | 'heuristic' = 'oracle';
  try {
    reoMap = await batchCheckEligibility(indexerIds);
    log.refresh.info({ count: reoMap.size }, 'REO oracle checked');
  } catch (e) {
    log.refresh.warn({ err: e }, 'REO oracle batch call failed, indexers left unknown (no heuristic fallback)');
  }

  // Step 6: Compute enriched data for each indexer
  const enriched: EnrichedIndexer[] = indexers.map((indexer) => {
    const lockedTokens = weiToGRT(indexer.lockedTokens);
    const selfStake = weiToGRT(indexer.stakedTokens) - lockedTokens;
    const delegated = weiToGRT(indexer.delegatedTokens);
    const delegatedThawing = weiToGRT(indexer.delegatedThawingTokens ?? '0');
    const delegatedActive = delegated - delegatedThawing;

    const allocations = (allocationMap.get(indexer.id) ?? []).map((a) => ({
      allocatedTokens: a.allocatedTokens,
      subgraphDeployment: a.subgraphDeployment,
    }));

    // Horizon effective-cut inputs: prefer subgraph figures so over-delegated
    // indexers (where the delegation-ratio cap bites) aren't credited APR on
    // delegated stake that earns nothing. delegatedStakeRatio = 1 − ownStakeRatio.
    const effectiveCut = indexer.indexingRewardEffectiveCut != null
      ? parseFloat(indexer.indexingRewardEffectiveCut)
      : null;
    // Prefer the subgraph's own delegatedStakeRatio (correctly capped for
    // over-delegated indexers); fall back to 1 − ownStakeRatio.
    const ownRatio = indexer.ownStakeRatio != null ? parseFloat(indexer.ownStakeRatio) : null;
    const delegatedStakeRatio = indexer.delegatedStakeRatio != null
      ? parseFloat(indexer.delegatedStakeRatio)
      : (ownRatio != null && ownRatio >= 0 && ownRatio <= 1 ? 1 - ownRatio : null);

    const apr = calculateDelegatorAPR(
      allocations,
      indexer.indexingRewardCut,
      delegatedActive,
      totalNetworkSignal,
      annualIssuance,
      effectiveCut,
      delegatedStakeRatio
    );

    const capacity = calculateDelegationCapacity(selfStake, delegated, delegationRatio);

    const oracle = reoMap.get(indexer.id);
    let reoStatus: 'eligible' | 'ineligible' | 'unknown';
    let reoRenewalTimestamp: number | null = null;
    let reoExpiresAt: number | null = null;
    let reoDaysRemaining: number | null = null;
    const thisReoSource = reoSource;

    if (oracle) {
      reoStatus = oracle.isEligible ? 'eligible' : 'ineligible';
      reoRenewalTimestamp = oracle.renewalTimestamp;
      reoExpiresAt = oracle.expiresAt;
      reoDaysRemaining = oracle.daysRemaining;
    } else {
      // No oracle reading for this indexer (batch failed or entry missing) —
      // report unknown rather than guessing from stake/allocations.
      reoStatus = 'unknown';
    }

    const activity = delegationActivity[indexer.id] ?? { delegations: 0, undelegations: 0, netFlowGRT: 0 };
    const distinctDataServices = dataServiceCountMap.get(indexer.id.toLowerCase()) ?? 0;

    const ens = ensNames[indexer.id] ?? null;
    const displayName = ens || resolveIndexerName(indexer.account, indexer.id);

    const ownStakeRatio = indexer.ownStakeRatio
      ? parseFloat(indexer.ownStakeRatio) * 100
      : null;
    const provisionedGRT = indexer.provisionedTokens
      ? weiToGRT(indexer.provisionedTokens)
      : null;

    // Exchange-rate-based APY (primary) with closed-allocation fallback
    const currentExchangeRate = calculatePoolExchangeRate(
      indexer.delegatedTokens,
      indexer.delegatedThawingTokens ?? '0',
      indexer.delegatorShares
    );
    const history = exchangeRateHistory.get(indexer.id);
    const erAPY30d = history?.rate30d
      ? calculateExchangeRateAPY(currentExchangeRate, history.rate30d, 30)
      : null;
    const erAPY90d = history?.rate90d
      ? calculateExchangeRateAPY(currentExchangeRate, history.rate90d, 90)
      : null;

    const indexerClosedAllocs = closedAllocsByIndexer.get(indexer.id) ?? [];
    const rollingAPY30d = erAPY30d ?? (
      indexerClosedAllocs.length > 0 && delegatedActive > 0
        ? calculateRollingAPY(indexerClosedAllocs, delegatedActive, 30)
        : null
    );
    const rollingAPY90d = erAPY90d ?? (
      indexerClosedAllocs.length > 0 && delegatedActive > 0
        ? calculateRollingAPY(indexerClosedAllocs, delegatedActive, 90)
        : null
    );

    const indexerScore = calculateIndexerScore({
      reoStatus,
      reoDaysRemaining,
      reoSource: thisReoSource,
      selfStakeGRT: selfStake,
      lastDelegationParameterUpdate: indexer.lastDelegationParameterUpdate,
      delegatorParameterCooldown: indexer.delegatorParameterCooldown,
      allocationCount: indexer.allocationCount,
      allocatedTokens: indexer.allocatedTokens,
      provisionedGRT,
      delegationUtilization: capacity.utilizationPercent,
      ensName: ens,
      url: indexer.url,
      name: displayName,
      id: indexer.id,
      rewardCutPPM: indexer.indexingRewardCut,
      queryFeeCutPPM: indexer.queryFeeCut,
      effectiveCutPercent: (() => {
        const v = indexer.indexingRewardEffectiveCut ? parseFloat(indexer.indexingRewardEffectiveCut) : null;
        return v !== null && v >= 0 && v <= 1 ? v * 100 : null;
      })(),
      queryFeesCollectedGRT: weiToGRT(indexer.queryFeesCollected),
      netFlowGRT: activity.netFlowGRT,
      delegatedGRT: delegatedActive,
      rollingAPY30d,
      delegatorAPR: apr,
      distinctDataServices,
    });

    return {
      id: indexer.id,
      name: displayName,
      ensName: ens,
      stakedTokens: indexer.stakedTokens,
      lockedTokens: indexer.lockedTokens,
      delegatedTokens: indexer.delegatedTokens,
      allocatedTokens: indexer.allocatedTokens,
      allocationCount: indexer.allocationCount,
      indexingRewardCut: indexer.indexingRewardCut,
      queryFeeCut: indexer.queryFeeCut,
      delegatorParameterCooldown: indexer.delegatorParameterCooldown,
      lastDelegationParameterUpdate: indexer.lastDelegationParameterUpdate,
      rewardsEarned: indexer.rewardsEarned,
      queryFeesCollected: indexer.queryFeesCollected,
      queryFeesCollectedGRT: weiToGRT(indexer.queryFeesCollected),
      delegatorShares: indexer.delegatorShares,
      url: indexer.url,
      geoHash: indexer.geoHash,
      createdAt: indexer.createdAt,
      selfStakeGRT: selfStake,
      delegatedGRT: delegatedActive,
      delegatedThawingGRT: delegatedThawing,
      delegatorAPR: apr,
      delegationCapacity: capacity,
      reoStatus,
      reoSource: thisReoSource,
      reoRenewalTimestamp,
      reoExpiresAt,
      reoDaysRemaining,
      recentActivity: {
        delegationsIn7d: activity.delegations,
        undelegationsIn7d: activity.undelegations,
        netFlowGRT: activity.netFlowGRT,
      },
      effectiveCut: (() => {
        const v = indexer.indexingRewardEffectiveCut ? parseFloat(indexer.indexingRewardEffectiveCut) : null;
        return v !== null && v >= 0 && v <= 1 ? v * 100 : null;
      })(),
      overDelegationDilution: indexer.overDelegationDilution
        ? parseFloat(indexer.overDelegationDilution) * 100
        : null,
      ownStakeRatio,
      indexerRewardsOwnGenerationRatio: indexer.indexerRewardsOwnGenerationRatio
        ? parseFloat(indexer.indexerRewardsOwnGenerationRatio)
        : null,
      provisionedGRT,
      distinctDataServices,
      delegationExchangeRate: currentExchangeRate,
      rollingAPY30d,
      rollingAPY90d,
      score: indexerScore.composite,
      scoreGrade: indexerScore.grade,
      scoreBreakdown: indexerScore.breakdown,
      computedAt: Date.now(),
    };
  });

  // Step 7: Write to Redis
  if (writeToRedis) {
    await cacheSet('lodestar:indexers-enriched', enriched, 600);
  }

  // Step 8: Write to Postgres
  if (sql) {
    try {
      const pgResult = await writeIndexers(sql, enriched, network.currentEpoch);
      log.refresh.info({ upserted: pgResult.upserted, snapshots: pgResult.snapshots, paramChanges: pgResult.paramChanges }, 'Postgres write complete');
      await updateIngestionState(sql, 'indexers', {});
    } catch (e) {
      log.refresh.error({ err: e, message: e instanceof Error ? e.message : String(e) }, 'Postgres write failed (non-fatal)');
    }
  }

  const duration = Date.now() - startTime;
  log.refresh.info({ count: enriched.length, durationMs: duration }, 'Refresh completed');

  return { count: enriched.length, durationMs: duration };
}
