import {
  type NetworkStatsResponse,
  type EpochHistoryResponse,
  type IndexersResponse,
  type DataServicesResponse,
  type IndexerProvisionsResponse,
  type ServiceProvisionsResponse,
  type DelegatorPortfolioResponse,
  type CuratorPortfolioResponse,
} from './queries';
import type { EnrichedIndexer } from './enriched';
import type { ManifestAnalysis } from './manifest';
import type { POIOverview, POIDeploymentDetail } from './poi';
import type { DeploymentIndexingStatus } from './indexing-status';
import type { LeaderboardEntry } from './scoring';
import type { VotesResponse, VoteMessage } from './voting';

/**
 * Fetch network statistics via cached GET endpoint
 */
export async function fetchNetworkStats(): Promise<NetworkStatsResponse> {
  const response = await fetch('/api/network-stats');
  if (!response.ok) throw new Error(`Network stats failed: ${response.status}`);
  const json = await response.json();
  return json.data as NetworkStatsResponse;
}

/**
 * Fetch epoch history via cached GET endpoint
 */
export async function fetchEpochHistory(count = 30): Promise<EpochHistoryResponse> {
  const response = await fetch(`/api/epochs?count=${count}`);
  if (!response.ok) throw new Error(`Epoch history failed: ${response.status}`);
  const json = await response.json();
  return json.data as EpochHistoryResponse;
}

/**
 * Fetch indexers via cached GET endpoint
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
  if (!response.ok) throw new Error(`Indexers failed: ${response.status}`);
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
 * Fetch leaderboard scores from Redis cache
 */
export async function fetchLeaderboard(period?: string): Promise<{
  periodStart: string;
  periodEnd: string;
  computedAt: number;
  entries: LeaderboardEntry[];
  badgeHolder?: { address: string; score: number; period: string } | null;
}> {
  const qs = period ? `?period=${encodeURIComponent(period)}` : '';
  const response = await fetch(`/api/leaderboard${qs}`);
  if (!response.ok) throw new Error('Leaderboard data not available');
  return response.json();
}

/**
 * Fetch available leaderboard periods
 */
export async function fetchLeaderboardPeriods(): Promise<{
  periods: { start: string; end: string }[];
}> {
  const response = await fetch('/api/leaderboard?periods=true');
  if (!response.ok) throw new Error('Failed to fetch periods');
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
  if (!response.ok) throw new Error('Failed to fetch GRT price');
  return response.json();
}

/**
 * Fetch TVL from DefiLlama proxy
 */
export async function fetchTVL(): Promise<{
  tvl: number;
}> {
  const response = await fetch('/api/tvl');
  if (!response.ok) throw new Error('Failed to fetch TVL');
  return response.json();
}

/**
 * Fetch all data services via cached GET endpoint
 */
export async function fetchDataServices(): Promise<DataServicesResponse> {
  const response = await fetch('/api/data-services');
  if (!response.ok) throw new Error(`Data services failed: ${response.status}`);
  const json = await response.json();
  return json.data as DataServicesResponse;
}

/**
 * Fetch provisions for a specific indexer via cached GET endpoint
 */
export async function fetchIndexerProvisions(indexer: string): Promise<IndexerProvisionsResponse> {
  const response = await fetch(`/api/provisions?indexer=${encodeURIComponent(indexer)}`);
  if (!response.ok) throw new Error(`Indexer provisions failed: ${response.status}`);
  const json = await response.json();
  return json.data as IndexerProvisionsResponse;
}

/**
 * Fetch provisions for a specific data service via cached GET endpoint
 */
export async function fetchServiceProvisions(
  dataService: string,
  first = 50,
  skip = 0
): Promise<ServiceProvisionsResponse> {
  const qs = new URLSearchParams({
    service: dataService,
    first: String(first),
    skip: String(skip),
  });
  const response = await fetch(`/api/provisions?${qs}`);
  if (!response.ok) throw new Error(`Service provisions failed: ${response.status}`);
  const json = await response.json();
  return json.data as ServiceProvisionsResponse;
}

/**
 * Fetch delegator portfolio via cached GET endpoint
 */
export async function fetchDelegatorPortfolio(address: string): Promise<DelegatorPortfolioResponse> {
  const response = await fetch(`/api/portfolio?address=${encodeURIComponent(address)}&type=delegator`);
  if (!response.ok) throw new Error(`Delegator portfolio failed: ${response.status}`);
  const json = await response.json();
  return json.data as DelegatorPortfolioResponse;
}

/**
 * Fetch curator portfolio via cached GET endpoint
 */
export async function fetchCuratorPortfolio(address: string): Promise<CuratorPortfolioResponse> {
  const response = await fetch(`/api/portfolio?address=${encodeURIComponent(address)}&type=curator`);
  if (!response.ok) throw new Error(`Curator portfolio failed: ${response.status}`);
  const json = await response.json();
  return json.data as CuratorPortfolioResponse;
}

/**
 * Fetch subgraph deployments via GET endpoint
 */
export async function fetchSubgraphDeployments(params: {
  first?: number;
  skip?: number;
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
} = {}): Promise<{
  id: string;
  ipfsHash: string;
  signalledTokens: string;
  stakedTokens: string;
  queryFeesAmount: string;
  indexerAllocations: { id: string }[];
  curatorSignals: { id: string }[];
  displayName: string | null;
}[]> {
  const qs = new URLSearchParams();
  if (params.first) qs.set('first', String(params.first));
  if (params.skip) qs.set('skip', String(params.skip));
  if (params.orderBy) qs.set('orderBy', params.orderBy);
  if (params.orderDirection) qs.set('orderDirection', params.orderDirection);
  const response = await fetch(`/api/subgraph-deployments?${qs}`);
  if (!response.ok) throw new Error(`Deployments fetch failed: ${response.status}`);
  const json = await response.json();
  return json.data;
}

/**
 * Fetch subgraph deployments with 30-day query fees
 */
export async function fetchSubgraphDeployments30d(): Promise<{
  id: string;
  ipfsHash: string;
  signalledTokens: string;
  stakedTokens: string;
  queryFeesAmount: string;
  queryFees30d: string;
  indexerAllocations: { id: string }[];
  curatorSignals: { id: string }[];
  displayName: string | null;
}[]> {
  const response = await fetch('/api/subgraph-fees-30d');
  if (!response.ok) throw new Error(`30d fees fetch failed: ${response.status}`);
  const json = await response.json();
  return json.data;
}

/**
 * Fetch manifest complexity analysis for an IPFS hash
 */
export async function fetchManifestAnalysis(hash: string): Promise<ManifestAnalysis> {
  const response = await fetch(`/api/manifest?hash=${encodeURIComponent(hash)}`);
  if (!response.ok) throw new Error(`Manifest analysis failed: ${response.status}`);
  const json = await response.json();
  return json.data;
}

/**
 * Fetch POI consensus overview
 */
export async function fetchPOIOverview(): Promise<POIOverview> {
  const response = await fetch('/api/poi');
  if (!response.ok) throw new Error(`POI overview failed: ${response.status}`);
  const json = await response.json();
  return json.data;
}

/**
 * Fetch POI detail for a specific deployment
 */
export async function fetchPOIDeployment(deployment: string): Promise<POIDeploymentDetail> {
  const response = await fetch(`/api/poi?deployment=${encodeURIComponent(deployment)}`);
  if (!response.ok) throw new Error(`POI detail failed: ${response.status}`);
  const json = await response.json();
  return json.data;
}

/**
 * Fetch indexing status for a subgraph deployment
 */
export async function fetchIndexingStatus(hash: string): Promise<DeploymentIndexingStatus> {
  const response = await fetch(`/api/indexing-status/${encodeURIComponent(hash)}`);
  if (!response.ok) throw new Error(`Indexing status failed: ${response.status}`);
  const json = await response.json();
  return json.data;
}

/**
 * Fetch indexing status for all deployments of a specific indexer
 */
export async function fetchIndexerStatus(address: string): Promise<{
  indexerAddress: string;
  indexerUrl: string | null;
  totalAllocations: number;
  syncedCount: number;
  syncingCount: number;
  failedCount: number;
  unreachableCount: number;
  deployments: Array<{
    deploymentId: string;
    ipfsHash: string;
    allocatedTokens: string;
    signalledTokens: string;
    stakedTokens: string;
    createdAtEpoch: number;
    status: 'synced' | 'syncing' | 'failed' | 'unreachable';
    health?: 'healthy' | 'unhealthy' | 'failed';
    network?: string;
    chainHeadBlock?: number;
    latestBlock?: number;
    blocksBehind?: number;
    syncProgress?: number;
    entityCount?: string;
    fatalError?: string;
  }>;
}> {
  const response = await fetch(`/api/indexer-status/${encodeURIComponent(address)}`);
  if (!response.ok) throw new Error(`Indexer status failed: ${response.status}`);
  const json = await response.json();
  return json.data;
}

/**
 * Fetch networks registry (cached 24h server-side)
 */
export async function fetchNetworksRegistry(): Promise<{
  networks: import('@/app/api/networks/route').NetworkInfo[];
}> {
  const response = await fetch('/api/networks');
  if (!response.ok) throw new Error('Failed to fetch networks registry');
  return response.json();
}

/**
 * Fetch community votes for a period
 */
export async function fetchVotes(period?: string, voter?: string): Promise<VotesResponse> {
  const params = new URLSearchParams();
  if (period) params.set('period', period);
  if (voter) params.set('voter', voter);
  const response = await fetch(`/api/vote?${params}`);
  if (!response.ok) throw new Error('Failed to fetch votes');
  return response.json();
}

/**
 * Submit a community vote
 */
export async function submitVote(message: VoteMessage, signature: string): Promise<{
  success: boolean;
  vote: { voter: string; indexer: string; isDelegator: boolean; voteWeight: number; period: string };
}> {
  const response = await fetch('/api/vote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, signature }),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || 'Failed to submit vote');
  return json;
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
