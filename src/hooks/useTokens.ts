'use client';

import { useQuery } from '@tanstack/react-query';
import type { TokenDetail, TokenSummary } from '@/lib/tokens/types';

const FIVE_MIN = 1000 * 60 * 5;
const TWO_MIN = 1000 * 60 * 2;

async function fetchDirectory(): Promise<TokenSummary[]> {
  const res = await fetch('/api/tokens');
  if (!res.ok) throw new Error(`tokens directory failed: ${res.status}`);
  const json = await res.json();
  return json.data as TokenSummary[];
}

async function fetchDetail(chain: string, address: string): Promise<TokenDetail> {
  const res = await fetch(`/api/tokens/${chain}/${address}`);
  if (!res.ok) throw new Error(`tokens detail failed: ${res.status}`);
  const json = await res.json();
  return json.data as TokenDetail;
}

export function useTokenDirectory() {
  return useQuery({
    queryKey: ['tokens', 'directory', 'v0'],
    queryFn: fetchDirectory,
    staleTime: FIVE_MIN,
    refetchInterval: FIVE_MIN,
  });
}

export function useTokenDetail(chain: string, address: string) {
  return useQuery({
    queryKey: ['tokens', 'detail', 'v0', chain, address.toLowerCase()],
    queryFn: () => fetchDetail(chain, address),
    staleTime: TWO_MIN,
    refetchInterval: TWO_MIN,
    refetchOnWindowFocus: true,
    enabled: !!chain && !!address,
  });
}
