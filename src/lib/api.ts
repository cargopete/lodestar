import { GraphQLClient } from 'graphql-request';
import {
  NETWORK_STATS_QUERY,
  EPOCH_HISTORY_QUERY,
  INDEXERS_QUERY,
  type NetworkStatsResponse,
  type EpochHistoryResponse,
  type IndexersResponse,
  type DataServicesResponse,
  type IndexerProvisionsResponse,
  type ServiceProvisionsResponse,
} from './queries';
import type { EnrichedIndexer } from './enriched';

// The Graph Network subgraph on Arbitrum (kept for user-specific POST queries)
const SUBGRAPH_URL = '/api/subgraph';

const client = new GraphQLClient(SUBGRAPH_URL);

async function subgraphFetch<T>(query: string): Promise<T> {
  const response = await fetch(SUBGRAPH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
  const json = await response.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data as T;
}

/**
 * Fetch network statistics via GET endpoint (CDN-cacheable)
 */
export async function fetchNetworkStats(): Promise<NetworkStatsResponse> {
  const response = await fetch('/api/network-stats');

  if (!response.ok) {
    // Fall back to POST if GET endpoint unavailable (e.g. no API key)
    const queryString = `
      query NetworkStats {
        graphNetwork(id: "1") {
          totalTokensStaked
          totalDelegatedTokens
          totalTokensSignalled
          totalTokensAllocated
          totalIndexingRewards
          totalQueryFees
          currentEpoch
          epochLength
          lastLengthUpdateEpoch
          lastLengthUpdateBlock
          indexerCount
          stakedIndexersCount
          delegatorCount
          activeDelegatorCount
          curatorCount
          activeCuratorCount
          subgraphCount
          activeSubgraphCount
          delegationRatio
          protocolFeePercentage
          delegationTaxPercentage
          maxAllocationEpochs
          thawingPeriod
          totalSupply
          networkGRTIssuancePerBlock
        }
        _meta {
          block {
            number
          }
        }
      }
    `;

    const fallback = await fetch('/api/subgraph', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: queryString }),
    });

    if (!fallback.ok) throw new Error(`HTTP error: ${fallback.status}`);
    const json = await fallback.json();
    if (json.errors) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
    return json.data as NetworkStatsResponse;
  }

  const json = await response.json();
  return json.data as NetworkStatsResponse;
}

/**
 * Fetch epoch history via GET endpoint (CDN-cacheable)
 */
export async function fetchEpochHistory(count = 30): Promise<EpochHistoryResponse> {
  const response = await fetch(`/api/epochs?count=${count}`);

  if (!response.ok) {
    // Fall back to POST
    const queryString = `{
      epoches(first: ${count}, orderBy: startBlock, orderDirection: desc) {
        id
        startBlock
        endBlock
        signalledTokens
        stakeDeposited
        totalQueryFees
        totalRewards
        totalIndexerRewards
        totalDelegatorRewards
      }
    }`;

    const fallback = await fetch('/api/subgraph', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: queryString }),
    });

    if (!fallback.ok) throw new Error(`HTTP error: ${fallback.status}`);
    const json = await fallback.json();
    if (json.errors) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
    return json.data as EpochHistoryResponse;
  }

  const json = await response.json();
  return json.data as EpochHistoryResponse;
}

/**
 * Fetch indexers via GET endpoint (CDN-cacheable)
 */
export async function fetchIndexers(params: {
  first?: number;
  skip?: number;
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
}): Promise<IndexersResponse> {
  const {
    first = 25,
    skip = 0,
    orderBy = 'stakedTokens',
    orderDirection = 'desc',
  } = params;

  const qs = new URLSearchParams({
    first: String(first),
    skip: String(skip),
    orderBy,
    orderDirection,
  });

  const response = await fetch(`/api/indexers?${qs}`);

  if (!response.ok) {
    // Fall back to POST
    const queryString = `{
      indexers(
        first: ${first}
        skip: ${skip}
        orderBy: ${orderBy}
        orderDirection: ${orderDirection}
        where: { stakedTokens_gt: "0" }
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
      }
    }`;

    const fallback = await fetch('/api/subgraph', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: queryString }),
    });

    if (!fallback.ok) throw new Error(`HTTP error: ${fallback.status}`);
    const json = await fallback.json();
    if (json.errors) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
    return json.data as IndexersResponse;
  }

  const json = await response.json();
  return json.data as IndexersResponse;
}

/**
 * Fetch enriched indexers (pre-computed by cron job)
 */
export async function fetchEnrichedIndexers(): Promise<{
  indexers: EnrichedIndexer[];
  computedAt: number;
}> {
  const response = await fetch('/api/indexers-enriched');
  if (!response.ok) throw new Error('Enriched data not available');
  return response.json();
}

/**
 * Fetch GRT price from proxy
 */
export async function fetchGRTPrice(): Promise<{
  price: number;
  change24h: number;
}> {
  const response = await fetch('/api/price');
  if (!response.ok) {
    throw new Error('Failed to fetch GRT price');
  }
  return response.json();
}

/**
 * Fetch TVL from DefiLlama proxy
 */
export async function fetchTVL(): Promise<{
  tvl: number;
}> {
  const response = await fetch('/api/tvl');
  if (!response.ok) {
    throw new Error('Failed to fetch TVL');
  }
  return response.json();
}

/**
 * Fetch all data services (Horizon multi-service)
 */
export async function fetchDataServices(first = 20): Promise<DataServicesResponse> {
  return subgraphFetch<DataServicesResponse>(`{
    dataServices(first: ${first}, orderBy: totalTokensProvisioned, orderDirection: desc) {
      id
      totalTokensProvisioned
      totalTokensAllocated
      totalTokensThawing
      totalTokensDelegated
      minimumProvisionTokens
      maximumVerifierCut
      minimumVerifierCut
      minimumThawingPeriod
      maximumThawingPeriod
      delegationRatio
      curationCut
    }
  }`);
}

/**
 * Fetch provisions for a specific indexer
 */
export async function fetchIndexerProvisions(indexer: string): Promise<IndexerProvisionsResponse> {
  return subgraphFetch<IndexerProvisionsResponse>(`{
    provisions(
      where: { indexer: "${indexer.toLowerCase()}" }
      orderBy: tokensProvisioned
      orderDirection: desc
    ) {
      id
      tokensProvisioned
      tokensAllocated
      tokensThawing
      maxVerifierCut
      thawingPeriod
      createdAt
      allocationCount
      dataService {
        id
        totalTokensProvisioned
        totalTokensAllocated
        minimumThawingPeriod
        maximumThawingPeriod
      }
    }
  }`);
}

/**
 * Fetch provisions for a specific data service
 */
export async function fetchServiceProvisions(
  dataService: string,
  first = 50,
  skip = 0
): Promise<ServiceProvisionsResponse> {
  return subgraphFetch<ServiceProvisionsResponse>(`{
    provisions(
      where: { dataService: "${dataService.toLowerCase()}" }
      first: ${first}
      skip: ${skip}
      orderBy: tokensProvisioned
      orderDirection: desc
    ) {
      id
      tokensProvisioned
      tokensAllocated
      tokensThawing
      maxVerifierCut
      thawingPeriod
      createdAt
      allocationCount
      indexer {
        id
        account {
          defaultDisplayName
          metadata {
            displayName
            description
          }
        }
        stakedTokens
        delegatedTokens
      }
    }
  }`);
}

/**
 * Generic fetch with error handling
 */
export async function fetchWithRetry<T>(
  fetcher: () => Promise<T>,
  retries = 3,
  delay = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let i = 0; i < retries; i++) {
    try {
      return await fetcher();
    } catch (error) {
      lastError = error as Error;
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
      }
    }
  }

  throw lastError;
}
