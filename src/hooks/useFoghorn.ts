'use client';

import { useQuery } from '@tanstack/react-query';
import {
  fetchFoghornStats,
  fetchFoghornIndexers,
  fetchFoghornScorecard,
  fetchNeedsAttention,
  fetchDeploymentNames,
  fetchVerdicts,
  fetchSybilClusters,
  fetchNonDeterministic,
  fetchDeploymentQos,
  fetchIndexerAllocationsQos,
  fetchFoghornFeed,
  fetchIndexerQuality,
  fetchQosStatus,
  fetchQosBuckets,
  fetchQosCompare,
  fetchQosCanonical,
} from '@/lib/foghorn';

const MINUTE = 60 * 1000;

export function useFoghornStats() {
  return useQuery({ queryKey: ['foghorn', 'stats'], queryFn: fetchFoghornStats, staleTime: MINUTE, retry: 0 });
}

export function useFoghornIndexers(window: 7 | 30 = 30, order: 'asc' | 'desc' = 'desc') {
  return useQuery({
    queryKey: ['foghorn', 'indexers', window, order],
    queryFn: () => fetchFoghornIndexers(window, order),
    staleTime: MINUTE,
    retry: 0,
  });
}

export function useFoghornScorecard(address: string | null) {
  return useQuery({
    queryKey: ['foghorn', 'scorecard', address],
    queryFn: () => fetchFoghornScorecard(address!),
    enabled: !!address,
    staleTime: MINUTE,
    retry: 0,
  });
}

export function useNeedsAttention(kind?: string) {
  return useQuery({
    queryKey: ['foghorn', 'needs-attention', kind ?? 'all'],
    queryFn: () => fetchNeedsAttention(kind),
    staleTime: MINUTE,
    retry: 0,
  });
}

/** Batch-resolve deployment IPFS hashes → subgraph display names. */
export function useDeploymentNames(hashes: string[]) {
  const unique = Array.from(new Set(hashes)).sort();
  return useQuery({
    queryKey: ['foghorn', 'deployment-names', unique],
    queryFn: () => fetchDeploymentNames(unique),
    enabled: unique.length > 0,
    staleTime: 5 * MINUTE,
    retry: 0,
  });
}

export function useVerdicts(params: { kind?: string; severity?: string; limit?: number } = {}) {
  return useQuery({
    queryKey: ['foghorn', 'verdicts', params.kind ?? '', params.severity ?? '', params.limit ?? 100],
    queryFn: () => fetchVerdicts(params),
    staleTime: MINUTE,
    retry: 0,
  });
}

export function useSybilClusters() {
  return useQuery({ queryKey: ['foghorn', 'sybil'], queryFn: fetchSybilClusters, staleTime: MINUTE, retry: 0 });
}

export function useNonDeterministic() {
  return useQuery({ queryKey: ['foghorn', 'nondeterministic'], queryFn: fetchNonDeterministic, staleTime: MINUTE, retry: 0 });
}

/** One indexer's per-deployment query success/lag → Map<deploymentId(ipfs), row>. */
export function useIndexerAllocationsQos(address: string | null) {
  return useQuery({
    queryKey: ['foghorn', 'indexer-alloc-qos', address],
    queryFn: async () => {
      const data = await fetchIndexerAllocationsQos(address!);
      const map = new Map<string, { successRate: number | null; blocksBehind: number | null; queryCount: number | null }>();
      for (const r of data.deployments) {
        map.set(r.deployment_id, { successRate: r.success_rate, blocksBehind: r.blocks_behind, queryCount: r.query_count });
      }
      return map;
    },
    enabled: !!address,
    staleTime: MINUTE,
    retry: 0,
  });
}

/** Per-indexer query success/lag for one deployment → Map<address, row>. */
export function useDeploymentQos(deploymentHash: string | null) {
  return useQuery({
    queryKey: ['foghorn', 'deployment-qos', deploymentHash],
    queryFn: async () => {
      const data = await fetchDeploymentQos(deploymentHash!);
      const map = new Map<string, { successRate: number | null; blocksBehind: number | null; queryCount: number | null }>();
      for (const r of data.indexers) {
        map.set(r.indexer_address.toLowerCase(), {
          successRate: r.success_rate,
          blocksBehind: r.blocks_behind,
          queryCount: r.query_count,
        });
      }
      return map;
    },
    enabled: !!deploymentHash,
    staleTime: MINUTE,
    retry: 0,
  });
}

export function useFoghornFeed(limit = 50) {
  return useQuery({
    queryKey: ['foghorn', 'feed', limit],
    queryFn: () => fetchFoghornFeed(limit),
    staleTime: MINUTE,
    retry: 0,
  });
}

export function useIndexerQuality(address: string | null) {
  return useQuery({
    queryKey: ['foghorn', 'quality', address],
    queryFn: () => fetchIndexerQuality(address!),
    enabled: !!address,
    staleTime: MINUTE,
    retry: 0,
  });
}

export interface FoghornGrade {
  grade: string;
  rated: boolean;
  composite: number;
  verdictCount: number;
  needsAttention: boolean;
  sybilFlag: boolean;
}

/**
 * One leaderboard fetch → a Map<address, grade> for merging Foghorn grades into
 * the indexer table without N+1 requests. Uses the 30d window.
 */
export function useFoghornGrades() {
  return useQuery({
    queryKey: ['foghorn', 'grades', 30],
    queryFn: async (): Promise<Map<string, FoghornGrade>> => {
      const data = await fetchFoghornIndexers(30, 'desc');
      const map = new Map<string, FoghornGrade>();
      for (const ix of data.indexers) {
        map.set(ix.indexer_address.toLowerCase(), {
          grade: ix.grade,
          rated: ix.rated,
          composite: ix.composite,
          verdictCount: ix.verdict_count,
          needsAttention: ix.needs_attention,
          sybilFlag: ix.sybil_flag,
        });
      }
      return map;
    },
    staleTime: 5 * MINUTE,
    retry: 0,
  });
}

// ── Foghorn QoS (measured, not ingested) ─────────────────────────────────────

/**
 * Freshness of both QoS sources. Polled on a short interval because its whole purpose is
 * answering "is this current?" — a status panel that is itself stale would be worse than none.
 */
export function useQosStatus() {
  return useQuery({
    queryKey: ['foghorn', 'qos-status'],
    queryFn: fetchQosStatus,
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    retry: 0,
  });
}

export function useQosBuckets(hours = 24, limit = 500) {
  return useQuery({
    queryKey: ['foghorn', 'qos-buckets', hours, limit],
    queryFn: () => fetchQosBuckets(hours, limit),
    staleTime: MINUTE,
    retry: 0,
  });
}

/**
 * Agreement between Foghorn's measurements and the canonical oracle.
 *
 * Longer staleTime than the live feeds: this is an evidence panel, not a monitor, and it changes
 * on the oracle's daily cadence rather than ours.
 */
export function useQosCompare(days = 3) {
  return useQuery({
    queryKey: ['foghorn', 'qos-compare', days],
    queryFn: () => fetchQosCompare(days),
    staleTime: 5 * MINUTE,
    retry: 0,
  });
}

/**
 * The canonical oracle's data from Lodestar's mirror. Longer staleTime than the measured feed
 * because it changes on the publisher's cadence, not ours — and during a stall it does not change
 * at all, which the `publisher` block in the response reports honestly.
 */
export function useQosCanonical(days = 1, limit = 1000) {
  return useQuery({
    queryKey: ['foghorn', 'qos-canonical', days, limit],
    queryFn: () => fetchQosCanonical(days, limit),
    staleTime: 5 * MINUTE,
    retry: 0,
  });
}
