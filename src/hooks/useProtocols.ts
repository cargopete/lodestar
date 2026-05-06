'use client';

import { useQuery } from '@tanstack/react-query';
import type { ProtocolSummary, ProtocolDetail } from '@/lib/protocols/fetcher';

const ONE_HOUR = 1000 * 60 * 60;

export type ProtocolsDirectoryMap = Record<string, ProtocolSummary | null>;

async function fetchProtocolsDirectory(): Promise<ProtocolsDirectoryMap> {
  const res = await fetch('/api/protocols');
  if (!res.ok) throw new Error(`Protocols directory failed: ${res.status}`);
  const json = await res.json();
  return json.data as ProtocolsDirectoryMap;
}

async function fetchProtocolDetail(slug: string): Promise<ProtocolDetail> {
  const res = await fetch(`/api/protocols/${slug}`);
  if (!res.ok) throw new Error(`Protocol detail failed: ${res.status}`);
  const json = await res.json();
  return json.data as ProtocolDetail;
}

export function useProtocolsDirectory() {
  return useQuery({
    queryKey: ['protocols', 'directory'],
    queryFn: fetchProtocolsDirectory,
    staleTime: ONE_HOUR,
    refetchInterval: ONE_HOUR,
  });
}

export function useProtocolDetail(slug: string) {
  return useQuery({
    queryKey: ['protocols', 'detail', slug],
    queryFn: () => fetchProtocolDetail(slug),
    staleTime: ONE_HOUR,
    refetchInterval: ONE_HOUR,
    enabled: !!slug,
  });
}
