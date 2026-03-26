import { cacheSet } from './cache';
import { subgraphQuery, delegationEventsQuery, ensQuery, hasSubgraphAccess } from './subgraph';
import { weiToGRT, resolveIndexerName } from './utils';
import { batchCheckEligibility, type OracleEligibility } from './reo-contract';
import {
  calculateDelegatorAPR,
  calculateDelegationCapacity,
  calculateRollingAPY,
} from './rewards';
import { calculateIndexerScore } from './risk-score';
import type { EnrichedIndexer } from './enriched';
import type { DbClient } from './db';
import { writeIndexers } from './ingest/indexers';

// Minimum self-stake for REO eligibility (100K GRT)
const MIN_STAKE_REO = 100000;

interface SubgraphIndexer {
  id: string;
  account: {
    id: string;
    defaultDisplayName?: string | null;
    metadata?: { displayName?: string | null; description?: string | null } | null;
  };
  stakedTokens: string;
  lockedTokens?: string;
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
  url: string | null;
  geoHash: string | null;
  createdAt: number;
  indexingRewardEffectiveCut?: string;
  overDelegationDilution?: string;
  ownStakeRatio?: string;
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

interface DelegationEventData {
  eventType: string;
  indexer: string;
  delegator: string;
  tokens: string;
  timestamp: string;
}

/**
 * Core indexer enrichment pipeline.
 * Fetches from subgraphs, computes scores, writes to Redis + Postgres.
 * Extracted so it can be called from both the Next.js route and the standalone cron runner.
 */
export async function refreshIndexers(opts: {
  sql?: DbClient | null;
  writeToRedis?: boolean;
}): Promise<{ count: number; durationMs: number }> {
  const { sql, writeToRedis = true } = opts;

  if (!hasSubgraphAccess()) {
    throw new Error('No GRAPH_API_KEY configured');
  }

  const startTime = Date.now();

  // Step 1: Fetch ALL indexers (paginated) + network stats
  const networkResult = await subgraphQuery<{
    graphNetwork: {
      totalTokensSignalled: string;
      networkGRTIssuancePerBlock?: string;
      delegationRatio: number;
      currentEpoch: number;
    };
  }>(`{
    graphNetwork(id: "1") {
      totalTokensSignalled
      networkGRTIssuancePerBlock
      delegationRatio
      currentEpoch
    }
  }`);

  const indexers: SubgraphIndexer[] = [];
  let lastId = '';
  while (true) {
    const page = await subgraphQuery<{ indexers: SubgraphIndexer[] }>(`{
      indexers(
        first: 1000
        orderBy: id
        orderDirection: asc
        where: { stakedTokens_gt: "0"${lastId ? `, id_gt: "${lastId}"` : ''} }
      ) {
        id
        account {
          id
          defaultDisplayName
          metadata {
            displayName
            description
          }
        }
        stakedTokens
        delegatedTokens
        allocatedTokens
        allocationCount
        indexingRewardCut
        queryFeeCut
        delegatorParameterCooldown
        lastDelegationParameterUpdate
        rewardsEarned
        queryFeesCollected
        delegatorShares
        url
        geoHash
        createdAt
        indexingRewardEffectiveCut
        overDelegationDilution
        ownStakeRatio
        indexerRewardsOwnGenerationRatio
        provisionedTokens
      }
    }`);
    indexers.push(...page.indexers);
    if (page.indexers.length < 1000) break;
    lastId = page.indexers[page.indexers.length - 1].id;
  }
  const network = networkResult.graphNetwork;
  const totalNetworkSignal = weiToGRT(network.totalTokensSignalled);
  const delegationRatio = network.delegationRatio;

  const issuancePerBlock = network.networkGRTIssuancePerBlock
    ? weiToGRT(network.networkGRTIssuancePerBlock)
    : 0;
  const L1_BLOCKS_PER_YEAR = 2_628_000;
  const annualIssuance = issuancePerBlock * L1_BLOCKS_PER_YEAR;

  // Step 2: Fetch allocations in batches of 10 indexer IDs
  const indexerIds = indexers.map((i) => i.id);
  const allocationMap = new Map<string, AllocationData[]>();

  const BATCH_SIZE = 10;
  for (let i = 0; i < indexerIds.length; i += BATCH_SIZE) {
    const batch = indexerIds.slice(i, i + BATCH_SIZE);
    const idList = batch.map((id) => `"${id}"`).join(', ');

    let lastId = '';
    while (true) {
      const result = await subgraphQuery<{ allocations: AllocationData[] }>(`{
        allocations(
          first: 1000
          orderBy: id
          orderDirection: asc
          where: { indexer_in: [${idList}], status: Active${lastId ? `, id_gt: "${lastId}"` : ''} }
        ) {
          id
          allocatedTokens
          indexer { id }
          subgraphDeployment {
            signalledTokens
            stakedTokens
          }
        }
      }`);

      for (const alloc of result.allocations) {
        const existing = allocationMap.get(alloc.indexer.id) ?? [];
        existing.push(alloc);
        allocationMap.set(alloc.indexer.id, existing);
      }

      if (result.allocations.length < 1000) break;
      lastId = result.allocations[result.allocations.length - 1].id;
    }
  }

  // Step 3: Fetch recent delegation events (7d)
  const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 86400;
  let delegationActivity: Record<string, { delegations: number; undelegations: number; netFlowGRT: number }> = {};
  try {
    let allEvents: DelegationEventData[] = [];
    let lastTimestamp = '999999999999';
    let hasMore = true;

    while (hasMore) {
      const result = await delegationEventsQuery<{ delegationEvents: DelegationEventData[] }>(`{
        delegationEvents(
          first: 1000
          orderBy: timestamp
          orderDirection: desc
          where: { timestamp_gt: "${sevenDaysAgo}", timestamp_lt: "${lastTimestamp}" }
        ) {
          eventType
          indexer
          delegator
          tokens
          timestamp
        }
      }`);

      const events = result.delegationEvents;
      allEvents = allEvents.concat(events);
      hasMore = events.length === 1000;
      if (hasMore) {
        lastTimestamp = events[events.length - 1].timestamp;
      }
    }

    for (const event of allEvents) {
      const id = event.indexer.toLowerCase();
      if (!delegationActivity[id]) delegationActivity[id] = { delegations: 0, undelegations: 0, netFlowGRT: 0 };
      const tokens = weiToGRT(event.tokens);

      if (event.eventType === 'delegation') {
        delegationActivity[id].delegations++;
        delegationActivity[id].netFlowGRT += tokens;
      } else if (event.eventType === 'undelegation') {
        delegationActivity[id].undelegations++;
        delegationActivity[id].netFlowGRT -= tokens;
      }
    }
  } catch (e) {
    console.warn('Delegation events fetch failed, continuing without:', e);
  }

  // Step 4: Resolve ENS names
  let ensNames: Record<string, string> = {};
  try {
    const ENS_BATCH = 20;
    for (let i = 0; i < indexerIds.length; i += ENS_BATCH) {
      const batch = indexerIds.slice(i, i + ENS_BATCH);
      const idList = batch.map((id) => `"${id}"`).join(', ');
      const ensResult = await ensQuery<{ domains: Array<{ name: string; resolvedAddress: { id: string } }> }>(`{
        domains(first: 1000, where: { resolvedAddress_in: [${idList}], name_not: null }) {
          name
          resolvedAddress { id }
        }
      }`);
      for (const domain of ensResult.domains) {
        const addr = domain.resolvedAddress.id.toLowerCase();
        if (!ensNames[addr] || domain.name.length < ensNames[addr].length) {
          ensNames[addr] = domain.name;
        }
      }
    }
    console.log(`ENS: resolved ${Object.keys(ensNames).length} names`);
  } catch (e) {
    console.warn('ENS lookup failed, continuing without:', e);
  }

  // Step 5: Batch-read REO oracle
  let reoMap = new Map<string, OracleEligibility>();
  let reoSource: 'oracle' | 'heuristic' = 'heuristic';
  try {
    reoMap = await batchCheckEligibility(indexerIds);
    reoSource = 'oracle';
    console.log(`REO oracle: checked ${reoMap.size} indexers`);
  } catch (e) {
    console.warn('REO oracle batch call failed, falling back to heuristics:', e);
  }

  // Step 5b: Fetch closed allocations (last 90d) for rolling APY
  const closedAllocsByIndexer = new Map<string, Array<{ delegator_rewards_grt: number; closed_at: number }>>();
  try {
    const ninetyDaysAgoUnix = Math.floor(Date.now() / 1000) - 90 * 86400;
    let lastAllocId = '';
    let totalRows = 0;

    while (true) {
      const result = await subgraphQuery<{
        allocations: Array<{
          id: string;
          indexer: { id: string };
          indexingDelegatorRewards: string;
          closedAt: number;
        }>;
      }>(`{
        allocations(
          first: 1000
          orderBy: id
          orderDirection: asc
          where: {
            status: Closed
            closedAt_gte: ${ninetyDaysAgoUnix}
            ${lastAllocId ? `id_gt: "${lastAllocId}"` : ''}
          }
        ) {
          id
          indexer { id }
          indexingDelegatorRewards
          closedAt
        }
      }`);

      if (result.allocations.length === 0) break;

      for (const alloc of result.allocations) {
        const delegatorRewards = weiToGRT(alloc.indexingDelegatorRewards);
        if (delegatorRewards <= 0) continue;
        const addr = alloc.indexer.id.toLowerCase();
        const existing = closedAllocsByIndexer.get(addr) ?? [];
        existing.push({
          delegator_rewards_grt: delegatorRewards,
          closed_at: alloc.closedAt,
        });
        closedAllocsByIndexer.set(addr, existing);
      }

      totalRows += result.allocations.length;
      lastAllocId = result.allocations[result.allocations.length - 1].id;
      if (result.allocations.length < 1000) break;
    }

    console.log(`Rolling APY: loaded ${totalRows} closed allocations for ${closedAllocsByIndexer.size} indexers`);
  } catch (e) {
    console.warn('Rolling APY subgraph query failed (non-fatal):', e);
  }

  // Step 6: Compute enriched data for each indexer
  const enriched: EnrichedIndexer[] = indexers.map((indexer) => {
    const lockedTokens = weiToGRT(indexer.lockedTokens ?? '0');
    const selfStake = weiToGRT(indexer.stakedTokens) - lockedTokens;
    const delegated = weiToGRT(indexer.delegatedTokens);

    const allocations = (allocationMap.get(indexer.id) ?? []).map((a) => ({
      allocatedTokens: a.allocatedTokens,
      subgraphDeployment: a.subgraphDeployment,
    }));

    const apr = calculateDelegatorAPR(
      allocations,
      indexer.indexingRewardCut,
      delegated,
      totalNetworkSignal,
      annualIssuance
    );

    const capacity = calculateDelegationCapacity(selfStake, delegated, delegationRatio);

    const oracle = reoMap.get(indexer.id);
    let reoStatus: 'eligible' | 'ineligible' | 'unknown';
    let reoRenewalTimestamp: number | null = null;
    let reoExpiresAt: number | null = null;
    let reoDaysRemaining: number | null = null;
    let thisReoSource = reoSource;

    if (oracle) {
      reoStatus = oracle.isEligible ? 'eligible' : 'ineligible';
      reoRenewalTimestamp = oracle.renewalTimestamp;
      reoExpiresAt = oracle.expiresAt;
      reoDaysRemaining = oracle.daysRemaining;
    } else {
      const hasAllocations = indexer.allocationCount > 0;
      const hasSufficientStake = selfStake >= MIN_STAKE_REO;
      reoStatus = (hasAllocations && hasSufficientStake) ? 'eligible' : 'ineligible';
      thisReoSource = 'heuristic';
    }

    const activity = delegationActivity[indexer.id] ?? { delegations: 0, undelegations: 0, netFlowGRT: 0 };

    const ens = ensNames[indexer.id] ?? null;
    const displayName = ens || resolveIndexerName(indexer.account, indexer.id);

    const ownStakeRatio = indexer.ownStakeRatio
      ? parseFloat(indexer.ownStakeRatio) * 100
      : null;
    const provisionedGRT = indexer.provisionedTokens
      ? weiToGRT(indexer.provisionedTokens)
      : null;

    const indexerClosedAllocs = closedAllocsByIndexer.get(indexer.id) ?? [];
    const rollingAPY30d = indexerClosedAllocs.length > 0 && delegated > 0
      ? calculateRollingAPY(indexerClosedAllocs, delegated, 30)
      : null;
    const rollingAPY90d = indexerClosedAllocs.length > 0 && delegated > 0
      ? calculateRollingAPY(indexerClosedAllocs, delegated, 90)
      : null;

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
      effectiveCutPercent: indexer.indexingRewardEffectiveCut
        ? parseFloat(indexer.indexingRewardEffectiveCut) * 100
        : null,
      queryFeesCollectedGRT: weiToGRT(indexer.queryFeesCollected),
      netFlowGRT: activity.netFlowGRT,
      delegatedGRT: delegated,
      rollingAPY30d,
      delegatorAPR: apr,
    });

    return {
      id: indexer.id,
      name: displayName,
      ensName: ens,
      stakedTokens: indexer.stakedTokens,
      lockedTokens: indexer.lockedTokens ?? '0',
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
      delegatedGRT: delegated,
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
      effectiveCut: indexer.indexingRewardEffectiveCut
        ? parseFloat(indexer.indexingRewardEffectiveCut) * 100
        : null,
      overDelegationDilution: indexer.overDelegationDilution
        ? parseFloat(indexer.overDelegationDilution) * 100
        : null,
      ownStakeRatio,
      indexerRewardsOwnGenerationRatio: indexer.indexerRewardsOwnGenerationRatio
        ? parseFloat(indexer.indexerRewardsOwnGenerationRatio)
        : null,
      provisionedGRT,
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
      console.log(`Postgres: ${pgResult.upserted} indexers, ${pgResult.snapshots} snapshots, ${pgResult.paramChanges} param changes`);
    } catch (e) {
      console.warn('Postgres write failed (non-fatal):', e);
    }
  }

  const duration = Date.now() - startTime;
  console.log(`Refresh completed: ${enriched.length} indexers enriched in ${duration}ms`);

  return { count: enriched.length, durationMs: duration };
}
