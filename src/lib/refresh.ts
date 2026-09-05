import { log } from './logger';
import { cacheSet, cached } from './cache';
import { subgraphQuery, delegationEventsQuery, hasSubgraphAccess } from './subgraph';
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
import { hasNuthatch, nuthatchEnabled, nuthatchSql } from './nuthatch';
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

interface DelegationEventData {
  eventType: string;
  indexer: string;
  delegator: string;
  tokens: string;
  timestamp: string;
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
 * The gateway gatherer: three subgraphs through the key, as it has always worked. Steps 1 to 5d.
 */
export async function gatherFromGateway(): Promise<RefreshInputs> {
  if (!hasSubgraphAccess()) {
    throw new Error('No GRAPH_API_KEY configured');
  }
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
        lockedTokens
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
        delegatedThawingTokens
        url
        geoHash
        createdAt
        indexingRewardEffectiveCut
        overDelegationDilution
        ownStakeRatio
        delegatedStakeRatio
        indexerRewardsOwnGenerationRatio
        provisionedTokens
      }
    }`);
    indexers.push(...page.indexers);
    if (page.indexers.length < 1000) break;
    lastId = page.indexers[page.indexers.length - 1].id;
  }
  const network = networkResult.graphNetwork;

  // Step 2: Fetch allocations in batches of 10 indexer IDs
  const indexerIds = indexers.map((i) => i.id);
  const allocationMap = new Map<string, AllocationData[]>();

  const BATCH_SIZE = 10;
  const batches: string[][] = [];
  for (let i = 0; i < indexerIds.length; i += BATCH_SIZE) {
    batches.push(indexerIds.slice(i, i + BATCH_SIZE));
  }

  const batchResults = await Promise.all(batches.map(async (batch) => {
    const batchMap = new Map<string, AllocationData[]>();
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
        const existing = batchMap.get(alloc.indexer.id) ?? [];
        existing.push(alloc);
        batchMap.set(alloc.indexer.id, existing);
      }

      if (result.allocations.length < 1000) break;
      lastId = result.allocations[result.allocations.length - 1].id;
    }
    return batchMap;
  }));

  for (const batchMap of batchResults) {
    for (const [k, v] of batchMap) {
      allocationMap.set(k, v);
    }
  }

  // Step 3: Fetch recent delegation events (7d)
  const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 86400;
  const delegationActivity: Record<string, { delegations: number; undelegations: number; netFlowGRT: number }> = {};
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
    log.refresh.warn({ err: e }, 'Delegation events fetch failed, continuing without');
  }

  // Step 4: Resolve ENS names - primary names over a mainnet RPC, never the ENS subgraph (nuthatch#1160).
  const ensNames = await resolveEnsNamesForRefresh(indexerIds);

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

    log.refresh.info({ rows: totalRows, indexers: closedAllocsByIndexer.size }, 'Rolling APY loaded');
  } catch (e) {
    log.refresh.warn({ err: e }, 'Rolling APY subgraph query failed (non-fatal)');
  }

  // Step 5c: Fetch historical exchange rates via subgraph time-travel.
  // This is always available and covers all indexers regardless of Postgres snapshot history.
  const exchangeRateHistory = new Map<string, { rate30d: number | null; rate90d: number | null }>();
  try {
    // Get current block to anchor time-travel
    const metaResult = await subgraphQuery<{ _meta: { block: { number: number } } }>(`{ _meta { block { number } } }`);
    const currentBlock = metaResult._meta.block.number;

    // Arbitrum avg block time ~0.25s (4 blocks/sec)
    const BLOCKS_PER_DAY = 86400 * 4;
    const block30d = currentBlock - Math.floor(30 * BLOCKS_PER_DAY);
    const block90d = currentBlock - Math.floor(90 * BLOCKS_PER_DAY);

    async function fetchRatesAtBlock(blockNum: number): Promise<Record<string, number>> {
      const rateMap: Record<string, number> = {};
      let lastId = '';
      while (true) {
        const result = await subgraphQuery<{
          indexers: Array<{ id: string; delegatedTokens: string; delegatedThawingTokens?: string; delegatorShares: string }>;
        }>(`{
          indexers(
            first: 1000
            orderBy: id
            orderDirection: asc
            block: { number: ${blockNum} }
            where: { stakedTokens_gt: "0"${lastId ? `, id_gt: "${lastId}"` : ''} }
          ) {
            id
            delegatedTokens
            delegatedThawingTokens
            delegatorShares
          }
        }`);

        for (const idx of result.indexers) {
          const rate = calculatePoolExchangeRate(
            idx.delegatedTokens,
            idx.delegatedThawingTokens ?? '0',
            idx.delegatorShares
          );
          if (rate > 0) rateMap[idx.id] = rate;
        }

        if (result.indexers.length < 1000) break;
        lastId = result.indexers[result.indexers.length - 1].id;
      }
      return rateMap;
    }

    const TTL_6H = 6 * 3600;
    const [rates30d, rates90d] = await Promise.all([
      cached<Record<string, number>>(`lodestar:er-history:30d:${block30d}`, TTL_6H, () => fetchRatesAtBlock(block30d)),
      cached<Record<string, number>>(`lodestar:er-history:90d:${block90d}`, TTL_6H, () => fetchRatesAtBlock(block90d)),
    ]);

    for (const [id, rate] of Object.entries(rates30d)) {
      exchangeRateHistory.set(id, { rate30d: rate, rate90d: null });
    }
    for (const [id, rate] of Object.entries(rates90d)) {
      const existing = exchangeRateHistory.get(id) ?? { rate30d: null, rate90d: null };
      existing.rate90d = rate;
      exchangeRateHistory.set(id, existing);
    }

    log.refresh.info({ count: exchangeRateHistory.size, block30d, block90d }, 'Exchange rate history loaded via time-travel');
  } catch (e) {
    log.refresh.warn({ err: e }, 'Time-travel exchange rate fetch failed (non-fatal)');
  }

  // Step 5d: Count distinct Horizon data services per indexer
  const dataServiceCountMap = new Map<string, number>();
  try {
    const PROV_BATCH = 50;
    for (let i = 0; i < indexerIds.length; i += PROV_BATCH) {
      const batch = indexerIds.slice(i, i + PROV_BATCH);
      const idList = batch.map((id) => `"${id}"`).join(', ');
      const result = await subgraphQuery<{
        provisions: Array<{ indexer: { id: string }; dataService: { id: string } }>;
      }>(`{
        provisions(first: 1000, where: { indexer_in: [${idList}] }) {
          indexer { id }
          dataService { id }
        }
      }`);
      const servicesByIndexer = new Map<string, Set<string>>();
      for (const p of result.provisions) {
        const addr = p.indexer.id.toLowerCase();
        if (!servicesByIndexer.has(addr)) servicesByIndexer.set(addr, new Set());
        servicesByIndexer.get(addr)!.add(p.dataService.id.toLowerCase());
      }
      for (const [addr, services] of servicesByIndexer) {
        dataServiceCountMap.set(addr, services.size);
      }
    }
    log.refresh.info({ count: dataServiceCountMap.size }, 'Data service counts loaded');
  } catch (e) {
    log.refresh.warn({ err: e }, 'Provisions fetch failed (non-fatal), data service counts will be 0');
  }

  return { network, indexers, allocationMap, delegationActivity, ensNames, closedAllocsByIndexer, exchangeRateHistory, dataServiceCountMap };
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
 * Gathers from the nest behind NUTHATCH_REFRESH (nuthatch#1160) or from the subgraphs, computes
 * scores, writes to Redis + Postgres. Extracted so it can be called from both the Next.js route and
 * the standalone cron runner.
 */
export async function refreshIndexers(opts: {
  sql?: DbClient | null;
  writeToRedis?: boolean;
}): Promise<{ count: number; durationMs: number }> {
  const { sql, writeToRedis = true } = opts;
  const startTime = Date.now();

  const inputs = nuthatchEnabled('NUTHATCH_REFRESH') && hasNuthatch() ? await gatherFromNest() : await gatherFromGateway();
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
