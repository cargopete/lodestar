'use client';

import { useQuery } from '@tanstack/react-query';
import type { FeedItem } from '@/lib/feed';

const FIVE_MINUTES = 1000 * 60 * 5;

async function fetchFeed(): Promise<FeedItem[]> {
  const response = await fetch('/api/feed');
  if (!response.ok) throw new Error(`Feed fetch failed: ${response.status}`);
  const data = await response.json();
  return data.items;
}

export function useFeed() {
  return useQuery({
    queryKey: ['feed'],
    queryFn: fetchFeed,
    staleTime: FIVE_MINUTES,
    refetchInterval: FIVE_MINUTES,
  });
}
