import { GraphQLClient } from 'graphql-request';
import {
  NETWORK_STATS_QUERY,
  EPOCH_HISTORY_QUERY,
  INDEXERS_QUERY,
  DATA_SERVICES_QUERY,
  INDEXER_PROVISIONS_QUERY,
  SERVICE_PROVISIONS_QUERY,
  type NetworkStatsResponse,
  type EpochHistoryResponse,
  type IndexersResponse,
  type DataServicesResponse,
  type IndexerProvisionsResponse,
  type ServiceProvisionsResponse,
} from './queries';

// The Graph Network subgraph on Arbitrum
const SUBGRAPH_URL = '/api/subgraph';

const client = new GraphQLClient(SUBGRAPH_URL);

/**
 * Fetch network statistics
 */
export async function fetchNetworkStats(): Promise<NetworkStatsResponse> {
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
      }
      _meta {
        block {
          number
        }
      }
    }
  `;

  const response = await fetch('/api/subgraph', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: queryString }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status}`);
  }

  const json = await response.json();

  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  return json.data as NetworkStatsResponse;
}

/**
 * Fetch epoch history for charts
 */
export async function fetchEpochHistory(count = 30): Promise<EpochHistoryResponse> {
  // Inline the variable to avoid escape character issues with $ in GraphQL
  const queryString = `
    {
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
    }
  `;

  const response = await fetch('/api/subgraph', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: queryString }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status}`);
  }

  const json = await response.json();

  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  return json.data as EpochHistoryResponse;
}

/**
 * Fetch indexers with pagination and sorting
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

  // Inline variables to avoid escape character issues with $ in GraphQL
  const queryString = `
    {
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
    }
  `;

  const response = await fetch('/api/subgraph', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: queryString }),
  });

  if (!response.ok) {
    throw new Error(`HTTP error: ${response.status}`);
  }

  const json = await response.json();

  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  return json.data as IndexersResponse;
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
  return client.request<DataServicesResponse>(DATA_SERVICES_QUERY, {
    first,
  });
}

/**
 * Fetch provisions for a specific indexer
 */
export async function fetchIndexerProvisions(indexer: string): Promise<IndexerProvisionsResponse> {
  return client.request<IndexerProvisionsResponse>(INDEXER_PROVISIONS_QUERY, {
    indexer: indexer.toLowerCase(),
  });
}

/**
 * Fetch provisions for a specific data service
 */
export async function fetchServiceProvisions(
  dataService: string,
  first = 50,
  skip = 0
): Promise<ServiceProvisionsResponse> {
  return client.request<ServiceProvisionsResponse>(SERVICE_PROVISIONS_QUERY, {
    dataService: dataService.toLowerCase(),
    first,
    skip,
  });
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
