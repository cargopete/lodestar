'use client';

import { useQuery } from '@tanstack/react-query';
import {
  fetchNetworkStats,
  fetchEpochHistory,
  fetchIndexers,
  fetchGRTPrice,
  fetchTVL,
  fetchDataServices,
  fetchIndexerProvisions,
  fetchServiceProvisions,
} from '@/lib/api';

const FIVE_MINUTES = 1000 * 60 * 5;
const THIRTY_SECONDS = 1000 * 30;

/**
 * Hook for network statistics
 */
export function useNetworkStats() {
  return useQuery({
    queryKey: ['networkStats'],
    queryFn: fetchNetworkStats,
    staleTime: FIVE_MINUTES,
    refetchInterval: FIVE_MINUTES,
  });
}

/**
 * Hook for epoch history (for charts)
 */
export function useEpochHistory(count = 30) {
  return useQuery({
    queryKey: ['epochHistory', count],
    queryFn: () => fetchEpochHistory(count),
    staleTime: FIVE_MINUTES,
    refetchInterval: FIVE_MINUTES,
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
export function useEpochInfo() {
  const { data: networkData } = useNetworkStats();

  const network = networkData?.graphNetwork;

  if (!network) {
    return { epoch: 0, progress: 0, epochLength: 0 };
  }

  // Use the subgraph's authoritative currentEpoch directly.
  // The epochLength is defined in L1 (Ethereum) blocks, not L2 (Arbitrum) blocks,
  // so deriving epoch from L2 block numbers produces wildly inflated numbers.
  return { epoch: network.currentEpoch, progress: 0, epochLength: network.epochLength };
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
 * Hook for recent delegation activity on an indexer
 */
export interface DelegationEvent {
  id: string;
  delegator: { id: string };
  indexer: { id: string };
  stakedTokens: string;
  unstakedTokens: string;
  lastDelegatedAt: number;
  lastUndelegatedAt: number | null;
}

export function useRecentDelegations(indexerAddress: string) {
  return useQuery<DelegationEvent[]>({
    queryKey: ['recentDelegations', indexerAddress],
    queryFn: async () => {
      const query = `{
        delegatedStakes(
          first: 10,
          orderBy: lastDelegatedAt,
          orderDirection: desc,
          where: { indexer: "${indexerAddress.toLowerCase()}" }
        ) {
          id
          delegator { id }
          indexer { id }
          stakedTokens
          unstakedTokens
          lastDelegatedAt
          lastUndelegatedAt
        }
      }`;
      const response = await fetch('/api/subgraph', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      if (!response.ok) throw new Error('Failed to fetch delegations');
      const json = await response.json();
      return json.data?.delegatedStakes ?? [];
    },
    staleTime: FIVE_MINUTES,
    refetchInterval: FIVE_MINUTES,
    enabled: !!indexerAddress,
  });
}
