'use client';

import { useQuery } from '@tanstack/react-query';
import {
  fetchFoghornStats,
  fetchFoghornIndexers,
  fetchFoghornScorecard,
  fetchNeedsAttention,
  fetchVerdicts,
  fetchSybilClusters,
  fetchFoghornFeed,
  fetchIndexerQuality,
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
