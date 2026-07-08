'use client';

import { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  fetchNetworkStats,
  fetchEpochHistory,
  fetchIndexers,
  fetchGRTPrice,
  fetchTVL,
  fetchIndexerProvisions,
  fetchEnrichedIndexers,
  fetchSubgraphDeployments,
  fetchSubgraphDeployments30d,
  fetchManifestAnalysis,
  fetchPOIOverview,
  fetchPOIDeployment,
  fetchIndexingStatus,
  fetchGatewayProbe,
  fetchIndexerStatus,
  fetchNetworksRegistry,
  fetchDelegatorPortfolio,
  fetchCuratorPortfolio,
  fetchRewardsHistory,
  fetchPayments,
  fetchIndexerPayments,
  fetchIndexerTrends,
  fetchIndexerQoS,
  fetchIndexerStakeHistory,
  fetchDelegationFlows,
  fetchDeveloperActivity,
  fetchTokenMetrics,
  fetchParameterHistory,
  fetchAprProvenance,
  fetchSubgraphCuration,
  fetchSubgraphSchema,
  fetchCuratorLeaderboard,
} from '@/lib/api';

const FIVE_MINUTES = 1000 * 60 * 5;
const TEN_MINUTES = 1000 * 60 * 10;
const ONE_MINUTE = 1000 * 60;
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
    staleTime: TEN_MINUTES,
    refetchInterval: TEN_MINUTES,
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
    refetchInterval: TEN_MINUTES,
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
    staleTime: ONE_MINUTE,
    refetchInterval: ONE_MINUTE,
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
  // Mount-stable "now" (seconds) — declared before any early return (rules of hooks)
  // and keeps render pure (no Date.now() during render).
  const [nowSec] = useState(() => Math.floor(Date.now() / 1000));

  const network = networkData?.graphNetwork;

  if (!network) {
    return { epoch: 0, progress: 0, epochLength: 0 };
  }

  // The epoch number comes straight from the subgraph's graphNetwork.currentEpoch,
  // which tracks the on-chain EpochManager and is the authoritative value.
  // (We previously estimated it from wall-clock time assuming exactly 12s/L1-block,
  // but post-merge blocks average ~12.09s, so that estimate drifted ~1 epoch ahead
  // every few months — by mid-2026 it was running a full ~10 epochs too high.)
  const epoch = network.currentEpoch;

  // Progress within the epoch is purely cosmetic (a bar that fills over ~24h), so we
  // still estimate it from wall-clock time. We anchor it to the estimate's *own* epoch
  // boundary rather than the subgraph epoch's, which keeps the fraction in [0, 100) and
  // resetting each epoch instead of pinning at 100% if the two sources disagree slightly.
  const estimatedL1Block = ETH_MERGE_BLOCK + Math.floor((nowSec - ETH_MERGE_TIMESTAMP) / L1_BLOCK_TIME);
  const blocksIntoEpoch =
    (estimatedL1Block - network.lastLengthUpdateBlock) % network.epochLength;
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
 * Hook for subgraph deployments with 30-day query fees
 */
export function useSubgraphDeployments30d(enabled = true) {
  return useQuery({
    queryKey: ['subgraphDeployments30d'],
    queryFn: fetchSubgraphDeployments30d,
    staleTime: FIVE_MINUTES,
    refetchInterval: FIVE_MINUTES,
    enabled,
  });
}

/**
 * Hook for Graph Networks Registry (display names + icons for chains)
 */
export function useNetworksRegistry() {
  return useQuery({
    queryKey: ['networksRegistry'],
    queryFn: fetchNetworksRegistry,
    staleTime: ONE_HOUR,
    refetchInterval: ONE_HOUR,
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
 * Hook for indexing status of a subgraph deployment
 */
export function useIndexingStatus(hash: string | null) {
  return useQuery({
    queryKey: ['indexingStatus', hash],
    queryFn: () => fetchIndexingStatus(hash!),
    staleTime: THIRTY_SECONDS,
    refetchInterval: THIRTY_SECONDS,
    enabled: !!hash,
    retry: 1,
  });
}

/**
 * Hook for the gateway's live serving verdict for a deployment (per-indexer
 * rejection reasons when it can't serve).
 */
export function useGatewayProbe(hash: string | null) {
  return useQuery({
    queryKey: ['gatewayProbe', hash],
    queryFn: () => fetchGatewayProbe(hash!),
    staleTime: THIRTY_SECONDS,
    refetchInterval: THIRTY_SECONDS,
    enabled: !!hash,
    retry: 1,
  });
}

export function useSubgraphCuration(hash: string | null) {
  return useQuery({
    queryKey: ['subgraphCuration', hash],
    queryFn: () => fetchSubgraphCuration(hash!),
    staleTime: FIVE_MINUTES,
    enabled: !!hash,
    retry: 1,
  });
}

export interface SubgraphHistoryPoint {
  date: string;
  signalGrt: number;
  stakeGrt: number;
}

async function fetchSubgraphHistory(hash: string): Promise<{ history: SubgraphHistoryPoint[] }> {
  const res = await fetch(`/api/subgraph-history/${hash}`);
  if (!res.ok) throw new Error('Failed to fetch subgraph history');
  const json = await res.json();
  return json.data;
}

export function useSubgraphHistory(hash: string | null) {
  return useQuery({
    queryKey: ['subgraphHistory', hash],
    queryFn: () => fetchSubgraphHistory(hash!),
    staleTime: ONE_HOUR,
    enabled: !!hash,
    retry: 1,
  });
}

export interface SubgraphVersion {
  version: number;
  label: string | null;
  createdAt: number;
  ipfsHash: string;
  signalledTokens: string;
  stakedTokens: string;
  isCurrent: boolean;
}

async function fetchSubgraphVersions(hash: string): Promise<{ subgraphId: string | null; versions: SubgraphVersion[] }> {
  const res = await fetch(`/api/subgraph-versions/${hash}`);
  if (!res.ok) throw new Error('Failed to fetch subgraph versions');
  const json = await res.json();
  return json.data;
}

export function useSubgraphVersions(hash: string | null) {
  return useQuery({
    queryKey: ['subgraphVersions', hash],
    queryFn: () => fetchSubgraphVersions(hash!),
    staleTime: ONE_HOUR,
    enabled: !!hash,
    retry: 1,
  });
}

export interface IndexerDispute {
  id: string;
  dispute_type: string | null;
  fisherman: string | null;
  allocation_id: string | null;
  deployment_id: string | null;
  status: string | null;
  tokens_slashed_grt: string | null;
  tokens_burned_grt: string | null;
  created_at: string | null;
  closed_at: string | null;
}

export function useIndexerDisputes(address: string) {
  return useQuery({
    queryKey: ['indexerDisputes', address],
    queryFn: async () => {
      const res = await fetch(`/api/indexer-disputes/${address.toLowerCase()}`);
      if (!res.ok) throw new Error('Failed to fetch disputes');
      return (await res.json()) as { disputes: IndexerDispute[] };
    },
    staleTime: FIVE_MINUTES,
    enabled: !!address,
    retry: 1,
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
      const response = await fetch(`/api/delegation-events?indexer=${encodeURIComponent(indexerAddress)}&first=100`);
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
 * Hook for network-wide delegation activity feed (last 50 events)
 * Optionally filtered by indexer address
 */
export function useNetworkDelegations(indexerAddress?: string) {
  return useQuery<DelegationEvent[]>({
    queryKey: ['networkDelegations', indexerAddress ?? ''],
    queryFn: async () => {
      const params = new URLSearchParams({ first: '50' });
      if (indexerAddress) params.set('indexer', indexerAddress);
      const response = await fetch(`/api/delegation-events?${params}`);
      if (!response.ok) throw new Error('Failed to fetch delegation events');
      const json = await response.json();
      return json.data?.delegationEvents ?? [];
    },
    staleTime: FIVE_MINUTES,
    refetchInterval: FIVE_MINUTES,
  });
}

/**
 * Hook for delegator portfolio via cached GET endpoint
 */
export function useDelegatorPortfolio(address: string | undefined) {
  return useQuery({
    queryKey: ['delegatorPortfolio', address],
    queryFn: () => fetchDelegatorPortfolio(address!),
    staleTime: FIVE_MINUTES,
    refetchInterval: FIVE_MINUTES,
    enabled: !!address,
  });
}

/**
 * Hook for curator portfolio via cached GET endpoint
 */
export function useCuratorPortfolio(address: string | undefined) {
  return useQuery({
    queryKey: ['curatorPortfolio', address],
    queryFn: () => fetchCuratorPortfolio(address!),
    staleTime: FIVE_MINUTES,
    refetchInterval: FIVE_MINUTES,
    enabled: !!address,
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

/**
 * Hook for delegator rewards accrual history (exchange-rate-based)
 */
export function useRewardsHistory(address: string | undefined, days = 90) {
  return useQuery({
    queryKey: ['rewardsHistory', address, days],
    queryFn: () => fetchRewardsHistory(address!, days),
    staleTime: FIVE_MINUTES,
    refetchInterval: FIVE_MINUTES,
    enabled: !!address,
  });
}

/**
 * Hook for indexer-level indexing status (all allocated deployments)
 */
export function useIndexerStatus(address: string | null) {
  return useQuery({
    queryKey: ['indexerStatus', address],
    queryFn: () => fetchIndexerStatus(address!),
    staleTime: THIRTY_SECONDS,
    refetchInterval: THIRTY_SECONDS,
    enabled: !!address,
  });
}

/**
 * Hook for network-wide payment pipeline stats
 */
export function usePayments() {
  return useQuery({
    queryKey: ['payments'],
    queryFn: fetchPayments,
    staleTime: FIVE_MINUTES,
    refetchInterval: FIVE_MINUTES,
  });
}

/**
 * Hook for per-indexer payment data
 */
export function useIndexerPayments(receiver: string) {
  return useQuery({
    queryKey: ['indexerPayments', receiver],
    queryFn: () => fetchIndexerPayments(receiver),
    staleTime: FIVE_MINUTES,
    refetchInterval: FIVE_MINUTES,
    enabled: !!receiver,
  });
}


/**
 * Hook for indexer daily reward & query fee trends
 * (supplementary data from community Horizon Performance subgraph)
 */
export function useIndexerTrends(indexer: string | null, days = 30) {
  return useQuery({
    queryKey: ['indexerTrends', indexer, days],
    queryFn: () => fetchIndexerTrends(indexer!, days),
    staleTime: TEN_MINUTES,
    refetchInterval: TEN_MINUTES,
    enabled: !!indexer,
    retry: 1, // supplementary — don't hammer it
  });
}

/**
 * Hook for indexer QoS metrics (gateway quality of service oracle)
 */
export function useIndexerQoS(address: string | null) {
  return useQuery({
    queryKey: ['indexerQoS', address],
    queryFn: () => fetchIndexerQoS(address!),
    staleTime: 60 * 60 * 1000, // 1h
    enabled: !!address,
    retry: 1,
  });
}

/**
 * Hook for indexer stake history (26-week time-travel snapshots)
 */
export function useIndexerStakeHistory(address: string | null) {
  return useQuery({
    queryKey: ['indexerStakeHistory', address],
    queryFn: () => fetchIndexerStakeHistory(address!),
    staleTime: 6 * 60 * 60 * 1000, // 6h — matches server cache
    enabled: !!address,
    retry: 1,
  });
}

/**
 * Hook for network-wide delegation inflows/outflows over time
 */
export function useDelegationFlows(days = 90, compare = false) {
  return useQuery({
    queryKey: ['delegationFlows', days, compare],
    queryFn: () => fetchDelegationFlows(days, compare),
    staleTime: TEN_MINUTES,
    refetchInterval: TEN_MINUTES,
  });
}

/**
 * Hook for developer-activity timeseries (subgraphs published per week)
 */
export function useDeveloperActivity() {
  return useQuery({
    queryKey: ['developerActivity'],
    queryFn: fetchDeveloperActivity,
    staleTime: ONE_HOUR,
    refetchInterval: ONE_HOUR,
    placeholderData: keepPreviousData,
  });
}

/**
 * Hook for per-epoch token issuance/burn metrics
 */
export function useTokenMetrics(count = 100) {
  return useQuery({
    queryKey: ['tokenMetrics', count],
    queryFn: () => fetchTokenMetrics(count),
    staleTime: TEN_MINUTES,
    refetchInterval: TEN_MINUTES,
  });
}

/**
 * Hook for indexer parameter change history (reward cut, query fee cut)
 */
export function useParameterHistory(address: string | null) {
  return useQuery({
    queryKey: ['parameterHistory', address],
    queryFn: () => fetchParameterHistory(address!),
    staleTime: TEN_MINUTES,
    refetchInterval: TEN_MINUTES,
    enabled: !!address,
  });
}

/**
 * Hook for APR provenance — on-chain pool reconcile + merged event trail
 * (delegations/undelegations + reward/query-fee cut changes) explaining why
 * an indexer's delegator APR is what it is.
 */
export function useAprProvenance(address: string | null) {
  return useQuery({
    queryKey: ['aprProvenance', address],
    queryFn: () => fetchAprProvenance(address!),
    staleTime: FIVE_MINUTES,
    refetchInterval: FIVE_MINUTES,
    enabled: !!address,
    retry: 1,
  });
}

/**
 * Hook for subgraph schema.graphql content (fetched via IPFS → manifest → schema file)
 */
export function useSubgraphSchema(hash: string | null) {
  return useQuery({
    queryKey: ['subgraphSchema', hash],
    queryFn: () => fetchSubgraphSchema(hash!),
    staleTime: ONE_HOUR,
    enabled: !!hash,
    retry: 1,
  });
}

/**
 * Hook for curator leaderboard
 */
export function useCuratorLeaderboard(params: { first?: number; skip?: number } = {}) {
  return useQuery({
    queryKey: ['curatorLeaderboard', params],
    queryFn: () => fetchCuratorLeaderboard(params),
    staleTime: FIVE_MINUTES,
    refetchInterval: FIVE_MINUTES,
    placeholderData: keepPreviousData,
  });
}
