import { NextResponse } from 'next/server';
import { cacheGet } from '@/lib/cache';

// Returns { [addr]: string[] } — indexer addresses mapped to their dropped chain names.
// Populated by the refresh-chain-health cron every 30 minutes.
export async function GET() {
  const data = await cacheGet<Record<string, string[]>>('lodestar:dropped-chains');
  return NextResponse.json(
    { data: data ?? {} },
    { headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=240' } },
  );
}
