import { NextRequest, NextResponse } from 'next/server';
import { cacheSet } from '@/lib/cache';
import { subgraphQuery, delegationEventsQuery, ensQuery, hasSubgraphAccess } from '@/lib/subgraph';
import { weiToGRT, resolveIndexerName } from '@/lib/utils';
import {
  calculateDelegatorAPR,
  calculateDelegationCapacity,
} from '@/lib/rewards';
import type { EnrichedIndexer } from '@/lib/enriched';

// Verify cron secret in production
function isAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true; // Allow in dev
  return request.headers.get('authorization') === `Bearer ${cronSecret}`;
}

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
  delegatedTokens: string;
  allocatedTokens: string;
  allocationCount: number;
  indexingRewardCut: number;
  queryFeeCut: number;
  delegatorParameterCooldown: number;
  lastDelegationParameterUpdate: number;
  rewardsEarned: string;
  delegatorShares: string;
  url: string | null;
  geoHash: string | null;
  createdAt: number;
  // Horizon metrics
  indexingRewardEffectiveCut?: string;
  overDelegationDilution?: string;
  ownStakeRatio?: string;
  indexerRewardsOwnGenerationRatio?: string;
  provisionedTokens?: string;
}

interface AllocationData {
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

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  const startTime = Date.now();

  try {
    // Step 1: Fetch ALL indexers (paginated) + network stats
    const networkResult = await subgraphQuery<{
      graphNetwork: {
        totalTokensSignalled: string;
        networkGRTIssuancePerBlock?: string;
        delegationRatio: number;
      };
    }>(`{
      graphNetwork(id: "1") {
        totalTokensSignalled
        networkGRTIssuancePerBlock
        delegationRatio
      }
    }`);

    // Paginate through all indexers using id_gt cursor
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

    // Annual issuance: issuancePerBlock * blocks_per_year
    // Arbitrum: ~0.25s block time = ~126_144_000 blocks/year
    // But networkGRTIssuancePerBlock is L1-based (12s blocks) = ~2_628_000 blocks/year
    const issuancePerBlock = network.networkGRTIssuancePerBlock
      ? weiToGRT(network.networkGRTIssuancePerBlock)
      : 0;
    const L1_BLOCKS_PER_YEAR = 2_628_000;
    const annualIssuance = issuancePerBlock * L1_BLOCKS_PER_YEAR;

    // Step 2: Fetch allocations in batches of 20 indexer IDs
    const indexerIds = indexers.map((i) => i.id);
    const allocationMap = new Map<string, AllocationData[]>();

    const BATCH_SIZE = 20;
    for (let i = 0; i < indexerIds.length; i += BATCH_SIZE) {
      const batch = indexerIds.slice(i, i + BATCH_SIZE);
      const idList = batch.map((id) => `"${id}"`).join(', ');
      const result = await subgraphQuery<{ allocations: AllocationData[] }>(`{
        allocations(
          first: 1000
          where: { indexer_in: [${idList}], status: Active }
        ) {
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
    }

    // Step 3: Fetch recent delegation events (7d) from Paolo Diomede's delegation events subgraph
    // This gives us discrete events (delegation/undelegation/withdrawal) with actual token amounts
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 86400;
    let delegationActivity: Record<string, { delegations: number; undelegations: number; netFlowGRT: number }> = {};
    try {
      let allEvents: DelegationEventData[] = [];
      let lastTimestamp = '999999999999';
      let hasMore = true;

      // Paginate through events (the subgraph caps at 1000 per query)
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
        } else if (event.eventType === 'undelegation' || event.eventType === 'withdrawal') {
          delegationActivity[id].undelegations++;
          delegationActivity[id].netFlowGRT -= tokens;
        }
      }
    } catch (e) {
      console.warn('Delegation events fetch failed, continuing without:', e);
    }

    // Step 4: Resolve ENS names for all indexers
    let ensNames: Record<string, string> = {};
    try {
      const addresses = indexers.map((i) => `"${i.id}"`).join(', ');
      const ensResult = await ensQuery<{ domains: Array<{ name: string; resolvedAddress: { id: string } }> }>(`{
        domains(first: 1000, where: { resolvedAddress_in: [${addresses}], name_not: null }) {
          name
          resolvedAddress { id }
        }
      }`);
      for (const domain of ensResult.domains) {
        const addr = domain.resolvedAddress.id.toLowerCase();
        // Prefer shorter .eth names (primary name) over longer subdomains
        if (!ensNames[addr] || domain.name.length < ensNames[addr].length) {
          ensNames[addr] = domain.name;
        }
      }
      console.log(`ENS: resolved ${Object.keys(ensNames).length} names`);
    } catch (e) {
      console.warn('ENS lookup failed, continuing without:', e);
    }

    // Step 5: Compute enriched data for each indexer
    const enriched: EnrichedIndexer[] = indexers.map((indexer) => {
      const selfStake = weiToGRT(indexer.stakedTokens);
      const delegated = weiToGRT(indexer.delegatedTokens);

      const allocations = (allocationMap.get(indexer.id) ?? []).map((a) => ({
        allocatedTokens: a.allocatedTokens,
        subgraphDeployment: a.subgraphDeployment,
      }));

      const apr = calculateDelegatorAPR(
        allocations,
        indexer.indexingRewardCut,
        selfStake,
        delegated,
        totalNetworkSignal,
        annualIssuance
      );

      const capacity = calculateDelegationCapacity(selfStake, delegated, delegationRatio);

      // Quick REO check (same logic as client-side)
      const hasAllocations = indexer.allocationCount > 0;
      const hasSufficientStake = selfStake >= MIN_STAKE_REO;
      let reoStatus: 'eligible' | 'warning' | 'ineligible' = 'ineligible';
      if (hasAllocations && hasSufficientStake) reoStatus = 'eligible';
      else if (hasAllocations || hasSufficientStake) reoStatus = 'warning';

      const activity = delegationActivity[indexer.id] ?? { delegations: 0, undelegations: 0, netFlowGRT: 0 };

      const ens = ensNames[indexer.id] ?? null;

      return {
        id: indexer.id,
        name: ens || resolveIndexerName(indexer.account, indexer.id),
        ensName: ens,
        stakedTokens: indexer.stakedTokens,
        delegatedTokens: indexer.delegatedTokens,
        allocatedTokens: indexer.allocatedTokens,
        allocationCount: indexer.allocationCount,
        indexingRewardCut: indexer.indexingRewardCut,
        queryFeeCut: indexer.queryFeeCut,
        delegatorParameterCooldown: indexer.delegatorParameterCooldown,
        lastDelegationParameterUpdate: indexer.lastDelegationParameterUpdate,
        rewardsEarned: indexer.rewardsEarned,
        delegatorShares: indexer.delegatorShares,
        url: indexer.url,
        geoHash: indexer.geoHash,
        createdAt: indexer.createdAt,
        selfStakeGRT: selfStake,
        delegatedGRT: delegated,
        delegatorAPR: apr,
        delegationCapacity: capacity,
        reoStatus,
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
        ownStakeRatio: indexer.ownStakeRatio
          ? parseFloat(indexer.ownStakeRatio) * 100
          : null,
        indexerRewardsOwnGenerationRatio: indexer.indexerRewardsOwnGenerationRatio
          ? parseFloat(indexer.indexerRewardsOwnGenerationRatio)
          : null,
        provisionedGRT: indexer.provisionedTokens
          ? weiToGRT(indexer.provisionedTokens)
          : null,
        computedAt: Date.now(),
      };
    });

    // Step 5: Write to Redis
    await cacheSet('lodestar:indexers-enriched', enriched, 600);

    const duration = Date.now() - startTime;
    console.log(`Cron refresh completed: ${enriched.length} indexers enriched in ${duration}ms`);

    return NextResponse.json({
      ok: true,
      count: enriched.length,
      durationMs: duration,
    });
  } catch (error) {
    console.error('Cron refresh failed:', error);
    return NextResponse.json(
      { error: 'Cron refresh failed', details: String(error) },
      { status: 500 }
    );
  }
}
