import {
  type NetworkStatsResponse,
  type EpochHistoryResponse,
  type IndexersResponse,
  type IndexerProvisionsResponse,
  type DelegatorPortfolioResponse,
  type CuratorPortfolioResponse,
  type PaymentsOverview,
  type IndexerTrendsResponse,
} from './queries';
import type { EnrichedIndexer } from './enriched';
import type { ManifestAnalysis } from './manifest';
import type { POIOverview, POIDeploymentDetail } from './poi';
import type { DeploymentIndexingStatus } from './indexing-status';
import type { VotesResponse, VoteMessage } from './voting';
import type { DeveloperActivityResponse } from '@/app/api/developer-activity/route';

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
 * Fetch provisions for a specific indexer via cached GET endpoint
 */
export async function fetchIndexerProvisions(indexer: string): Promise<IndexerProvisionsResponse> {
  const response = await fetch(`/api/provisions?indexer=${encodeURIComponent(indexer)}`);
  if (!response.ok) throw new Error(`Indexer provisions failed: ${response.status}`);
  const json = await response.json();
  return json.data as IndexerProvisionsResponse;
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
  createdAt: number;
  indexerAllocations: { id: string }[];
  curatorSignals: { id: string }[];
  displayName: string | null;
  categories: string[];
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
  createdAt: number;
  indexerAllocations: { id: string }[];
  curatorSignals: { id: string }[];
  displayName: string | null;
  categories: string[];
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
    displayName: string | null;
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
 * Fetch rewards accrual history for a delegator address
 */
export async function fetchRewardsHistory(
  address: string,
  days = 90
): Promise<{
  history: Array<{
    date: string;
    timestamp: number;
    value: number;
    rewards: number;
    principal: number;
  }>;
}> {
  const qs = new URLSearchParams({ address, days: String(days) });
  const response = await fetch(`/api/rewards-history?${qs}`);
  if (!response.ok) throw new Error(`Rewards history failed: ${response.status}`);
  return response.json();
}

/**
 * Fetch network-wide payment pipeline overview
 */
export async function fetchPayments(): Promise<PaymentsOverview> {
  const response = await fetch('/api/payments');
  if (!response.ok) throw new Error(`Payments failed: ${response.status}`);
  const json = await response.json();
  return json.data as PaymentsOverview;
}

/**
 * Fetch payment data for a specific indexer (receiver)
 */
export async function fetchIndexerPayments(receiver: string): Promise<PaymentsOverview> {
  const response = await fetch(`/api/payments?receiver=${encodeURIComponent(receiver)}`);
  if (!response.ok) throw new Error(`Indexer payments failed: ${response.status}`);
  const json = await response.json();
  return json.data as PaymentsOverview;
}

/**
 * Fetch daily reward and query fee trends for an indexer
 * (supplementary data from community Horizon Performance subgraph)
 */
export async function fetchIndexerTrends(
  indexer: string,
  days = 30
): Promise<IndexerTrendsResponse> {
  const qs = new URLSearchParams({ indexer, days: String(days) });
  const response = await fetch(`/api/indexer-trends?${qs}`);
  if (!response.ok) throw new Error(`Indexer trends failed: ${response.status}`);
  const json = await response.json();
  return json.data as IndexerTrendsResponse;
}

/**
 * Fetch 90-day QoS metrics for an indexer (gateway quality of service oracle)
 */
export async function fetchIndexerQoS(address: string) {
  const response = await fetch(`/api/indexer-qos/${encodeURIComponent(address)}`);
  if (!response.ok) throw new Error(`QoS fetch failed: ${response.status}`);
  const json = await response.json();
  return json.data as { qos: import('@/app/api/indexer-qos/[address]/route').IndexerQoSPoint[] };
}

/**
 * Fetch 26-week stake history for an indexer (time-travel snapshots)
 */
export async function fetchIndexerStakeHistory(
  address: string
): Promise<{ history: Array<{ date: string; selfStakeGrt: number; delegatedGrt: number }> }> {
  const response = await fetch(`/api/indexer-stake-history/${encodeURIComponent(address)}`);
  if (!response.ok) throw new Error(`Stake history failed: ${response.status}`);
  const json = await response.json();
  return json.data as { history: Array<{ date: string; selfStakeGrt: number; delegatedGrt: number }> };
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

/**
 * Fetch per-epoch token issuance and burn metrics
 */
export async function fetchTokenMetrics(count = 100): Promise<{
  epoch: number;
  issuance: number;
  queryFeeTaxBurn: number;
  disputeBurn: number;
  totalBurn: number;
  net: number;
}[]> {
  const response = await fetch(`/api/token-metrics?count=${count}`);
  if (!response.ok) throw new Error(`Token metrics failed: ${response.status}`);
  const json = await response.json();
  return json.data ?? [];
}

/**
 * Fetch developer-activity timeseries (subgraphs published per week)
 */
export async function fetchDeveloperActivity(): Promise<DeveloperActivityResponse> {
  const response = await fetch('/api/developer-activity');
  if (!response.ok) throw new Error(`Developer activity failed: ${response.status}`);
  const json = await response.json();
  return json.data as DeveloperActivityResponse;
}

/**
 * Fetch network-wide delegation inflows/outflows aggregated by day
 */
export async function fetchDelegationFlows(days = 90, compare = false): Promise<{
  date: string;
  inflows: number;
  outflows: number;
  net: number;
}[]> {
  const response = await fetch(`/api/delegation-flows?days=${days}${compare ? '&compare=1' : ''}`);
  if (!response.ok) throw new Error(`Delegation flows failed: ${response.status}`);
  const json = await response.json();
  return json.data ?? [];
}

export async function fetchParameterHistory(address: string): Promise<{
  param_name: string;
  old_value: number | null;
  new_value: number;
  epoch: number | null;
  detected_at: string;
}[]> {
  const response = await fetch(`/api/parameter-history/${encodeURIComponent(address)}`);
  if (!response.ok) throw new Error(`Parameter history failed: ${response.status}`);
  const json = await response.json();
  return json.data ?? [];
}

export interface ProvenanceEvent {
  kind: 'delegation' | 'undelegation' | 'withdrawal' | 'reward_cut' | 'query_fee_cut';
  timestamp: string;
  tokensGRT?: number;
  delegator?: string;
  delegatorName?: string | null;
  oldValue?: number | null;
  newValue?: number;
}

export interface PoolReconciliation {
  verified: boolean;
  driftGRT: number;
  driftPct: number;
  chain: { tokens: number; thawing: number; active: number };
  subgraph: { tokens: number; thawing: number; active: number };
}

export interface AprProvenance {
  reconcile: PoolReconciliation | null;
  events: ProvenanceEvent[];
}

export async function fetchAprProvenance(address: string): Promise<AprProvenance> {
  const response = await fetch(`/api/apr-provenance/${encodeURIComponent(address)}`);
  if (!response.ok) throw new Error(`APR provenance failed: ${response.status}`);
  const json = await response.json();
  return json.data ?? { reconcile: null, events: [] };
}

export interface CuratorSignalEntry {
  id: string;
  curatorAddress: string;
  signalledTokens: string;
  unsignalledTokens: string;
  signal: string;
  lastSignalChange: number;
  realizedRewards: string;
}

export interface SubgraphCurationData {
  signals: CuratorSignalEntry[];
  totalSignalledTokens: string;
  queryFeesAmount: string;
}

export async function fetchSubgraphCuration(hash: string): Promise<SubgraphCurationData> {
  const response = await fetch(`/api/subgraph-curation/${encodeURIComponent(hash)}`);
  if (!response.ok) throw new Error(`Subgraph curation failed: ${response.status}`);
  const json = await response.json();
  return json.data;
}

export async function fetchSubgraphSchema(hash: string): Promise<{ schemaText: string; schemaHash: string }> {
  const response = await fetch(`/api/subgraph-schema/${encodeURIComponent(hash)}`);
  if (!response.ok) throw new Error(`Schema fetch failed: ${response.status}`);
  const json = await response.json();
  return json.data;
}

export async function fetchCuratorLeaderboard(params: { first?: number; skip?: number } = {}): Promise<
  import('@/app/api/curators/route').CuratorLeaderboardEntry[]
> {
  const { first = 50, skip = 0 } = params;
  const qs = new URLSearchParams({ first: String(first), skip: String(skip) });
  const response = await fetch(`/api/curators?${qs}`);
  if (!response.ok) throw new Error(`Curator leaderboard failed: ${response.status}`);
  const json = await response.json();
  return json.data;
}
