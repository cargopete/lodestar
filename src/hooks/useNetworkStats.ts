'use client';

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  fetchNetworkStats,
  fetchEpochHistory,
  fetchIndexers,
  fetchGRTPrice,
  fetchTVL,
  fetchDataServices,
  fetchIndexerProvisions,
  fetchServiceProvisions,
  fetchEnrichedIndexers,
  fetchSubgraphDeployments,
  fetchManifestAnalysis,
  fetchPOIOverview,
  fetchPOIDeployment,
} from '@/lib/api';

const FIVE_MINUTES = 1000 * 60 * 5;
const TEN_MINUTES = 1000 * 60 * 10;
const THIRTY_SECONDS = 1000 * 30;
const ONE_HOUR = 1000 * 60 * 60;

/**
 * Hook for network statistics
 */
export function useNetworkStats() {
  return useQuery({
    queryKey: ['networkStats'],
    queryFn: fetchNetworkStats,
    staleTime: TEN_MINUTES,
    refetchInterval: FIVE_MINUTES,
    placeholderData: keepPreviousData,
  });
}

/**
 * Hook for epoch history (for charts)
 */
export function useEpochHistory(count = 30) {
  return useQuery({
    queryKey: ['epochHistory', count],
    queryFn: () => fetchEpochHistory(count),
    staleTime: TEN_MINUTES,
    refetchInterval: FIVE_MINUTES,
    placeholderData: keepPreviousData,
  });
}

/**
 * Hook for indexers with pagination and sorting
 */
export function useIndexers(params: {
  first?: number;
  skip?: number;
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
} = {}) {
  return useQuery({
    queryKey: ['indexers', params],
    queryFn: () => fetchIndexers(params),
    staleTime: FIVE_MINUTES,
    refetchInterval: FIVE_MINUTES,
    placeholderData: keepPreviousData,
  });
}

/**
 * Hook for enriched indexers (pre-computed by cron, the big win)
 */
export function useEnrichedIndexers() {
  return useQuery({
    queryKey: ['enrichedIndexers'],
    queryFn: fetchEnrichedIndexers,
    staleTime: TEN_MINUTES,
    refetchInterval: FIVE_MINUTES,
    placeholderData: keepPreviousData,
  });
}

/**
 * Hook for GRT price with frequent polling
 */
export function useGRTPrice() {
  return useQuery({
    queryKey: ['grtPrice'],
    queryFn: fetchGRTPrice,
    staleTime: THIRTY_SECONDS,
    refetchInterval: THIRTY_SECONDS,
  });
}

/**
 * Hook for real epoch info derived from chain block number
 * The subgraph's currentEpoch can lag — this derives the actual epoch from the chain head
 */
// Ethereum merge reference point for estimating current L1 block from wall-clock time
const ETH_MERGE_BLOCK = 15537393;
const ETH_MERGE_TIMESTAMP = 1663224179; // Sept 15, 2022 UTC
const L1_BLOCK_TIME = 12; // seconds

export function useEpochInfo() {
  const { data: networkData } = useNetworkStats();

  const network = networkData?.graphNetwork;

  if (!network) {
    return { epoch: 0, progress: 0, epochLength: 0 };
  }

  // The subgraph's currentEpoch only updates when EpochManager is called on-chain,
  // so it can lag by several epochs. We derive the real epoch by estimating the
  // current Ethereum L1 block from wall-clock time (post-merge: exactly 12s/block).
  // epochLength is in L1 blocks, so this gives an accurate epoch calculation.
  const now = Math.floor(Date.now() / 1000);
  const estimatedL1Block = ETH_MERGE_BLOCK + Math.floor((now - ETH_MERGE_TIMESTAMP) / L1_BLOCK_TIME);

  const epoch = network.lastLengthUpdateEpoch +
    Math.floor((estimatedL1Block - network.lastLengthUpdateBlock) / network.epochLength);
  const epochStartBlock = network.lastLengthUpdateBlock +
    (epoch - network.lastLengthUpdateEpoch) * network.epochLength;
  const blocksIntoEpoch = estimatedL1Block - epochStartBlock;
  const progress = Math.min((blocksIntoEpoch / network.epochLength) * 100, 100);

  return { epoch, progress, epochLength: network.epochLength };
}

/**
 * Hook for TVL data
 */
export function useTVL() {
  return useQuery({
    queryKey: ['tvl'],
    queryFn: fetchTVL,
    staleTime: FIVE_MINUTES,
    refetchInterval: FIVE_MINUTES,
    placeholderData: keepPreviousData,
  });
}

/**
 * Hook for data services (Horizon multi-service)
 */
export function useDataServices(first = 20) {
  return useQuery({
    queryKey: ['dataServices', first],
    queryFn: () => fetchDataServices(first),
    staleTime: FIVE_MINUTES,
    refetchInterval: FIVE_MINUTES,
  });
}

/**
 * Hook for indexer provisions
 */
export function useIndexerProvisions(indexer: string) {
  return useQuery({
    queryKey: ['indexerProvisions', indexer],
    queryFn: () => fetchIndexerProvisions(indexer),
    staleTime: FIVE_MINUTES,
    refetchInterval: FIVE_MINUTES,
    enabled: !!indexer,
  });
}

/**
 * Hook for service provisions
 */
export function useServiceProvisions(dataService: string, first = 50, skip = 0) {
  return useQuery({
    queryKey: ['serviceProvisions', dataService, first, skip],
    queryFn: () => fetchServiceProvisions(dataService, first, skip),
    staleTime: FIVE_MINUTES,
    refetchInterval: FIVE_MINUTES,
    enabled: !!dataService,
  });
}

/**
 * Hook for subgraph deployments
 */
export function useSubgraphDeployments(params: {
  first?: number;
  skip?: number;
  orderBy?: string;
  orderDirection?: 'asc' | 'desc';
} = {}) {
  return useQuery({
    queryKey: ['subgraphDeployments', params],
    queryFn: () => fetchSubgraphDeployments(params),
    staleTime: FIVE_MINUTES,
    refetchInterval: FIVE_MINUTES,
    placeholderData: keepPreviousData,
  });
}

/**
 * Hook for manifest complexity analysis
 */
export function useManifestAnalysis(hash: string | null) {
  return useQuery({
    queryKey: ['manifestAnalysis', hash],
    queryFn: () => fetchManifestAnalysis(hash!),
    staleTime: ONE_HOUR,
    enabled: !!hash,
    retry: 1,
  });
}

/**
 * Hook for POI consensus overview
 */
export function usePOIOverview() {
  return useQuery({
    queryKey: ['poiOverview'],
    queryFn: fetchPOIOverview,
    staleTime: FIVE_MINUTES,
    refetchInterval: FIVE_MINUTES,
    placeholderData: keepPreviousData,
  });
}

/**
 * Hook for POI detail for a specific deployment
 */
export function usePOIDeployment(deployment: string | null) {
  return useQuery({
    queryKey: ['poiDeployment', deployment],
    queryFn: () => fetchPOIDeployment(deployment!),
    staleTime: FIVE_MINUTES,
    enabled: !!deployment,
  });
}

/**
 * Hook for REO (Rewards Eligibility Oracle) status
 */
export function useREOStatus(address: string) {
  return useQuery({
    queryKey: ['reoStatus', address],
    queryFn: async () => {
      const res = await fetch(`/api/reo?address=${address}`);
      if (!res.ok) throw new Error('Failed to fetch REO status');
      return res.json();
    },
    staleTime: FIVE_MINUTES,
    refetchInterval: FIVE_MINUTES,
    enabled: !!address,
  });
}

/**
 * Hook for recent delegation events on an indexer
 * Sources from Paolo Diomede's delegation events subgraph for discrete event data
 */
export interface DelegationEvent {
  id: string;
  eventType: string;
  indexer: string;
  delegator: string;
  tokens: string;
  timestamp: string;
  txHash: string;
}

export function useRecentDelegations(indexerAddress: string) {
  return useQuery<DelegationEvent[]>({
    queryKey: ['recentDelegations', indexerAddress],
    queryFn: async () => {
      const query = `{
        delegationEvents(
          first: 20,
          orderBy: timestamp,
          orderDirection: desc,
          where: { indexer: "${indexerAddress.toLowerCase()}" }
        ) {
          id
          eventType
          indexer
          delegator
          tokens
          timestamp
          txHash
        }
      }`;
      const response = await fetch('/api/delegation-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      if (!response.ok) throw new Error('Failed to fetch delegation events');
      const json = await response.json();
      return json.data?.delegationEvents ?? [];
    },
    staleTime: FIVE_MINUTES,
    refetchInterval: FIVE_MINUTES,
    enabled: !!indexerAddress,
  });
}

/**
 * Hook for ENS name resolution
 */
export function useENSName(address: string) {
  return useQuery<{ ensName: string | null }>({
    queryKey: ['ensName', address],
    queryFn: async () => {
      const res = await fetch(`/api/ens?address=${address}`);
      if (!res.ok) return { ensName: null };
      return res.json();
    },
    staleTime: ONE_HOUR,
    enabled: !!address,
  });
}
