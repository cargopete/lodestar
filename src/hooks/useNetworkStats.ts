'use client';

import { useQuery } from '@tanstack/react-query';
import { useBlockNumber } from 'wagmi';
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
  const { data: blockNumber } = useBlockNumber({ watch: true });

  const network = networkData?.graphNetwork;
  const currentBlock = blockNumber ? Number(blockNumber) : 0;

  if (!network || !currentBlock) {
    return { epoch: network?.currentEpoch ?? 0, progress: 0, epochLength: network?.epochLength ?? 0 };
  }

  const epoch = network.lastLengthUpdateEpoch +
    Math.floor((currentBlock - network.lastLengthUpdateBlock) / network.epochLength);
  const epochStartBlock = network.lastLengthUpdateBlock +
    (epoch - network.lastLengthUpdateEpoch) * network.epochLength;
  const blocksIntoEpoch = currentBlock - epochStartBlock;
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
