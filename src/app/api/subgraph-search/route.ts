import { NextResponse, type NextRequest } from 'next/server';
import { cached } from '@/lib/cache';
import { log } from '@/lib/logger';
import { hasNuthatch } from '@/lib/nuthatch';
import { searchDeploymentsByHashPrefix, searchDeploymentsByManifestAddress, searchSubgraphsByName } from '@/lib/subgraph-metadata';

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ data: [] });
  }
  if (q.length > 100) {
    return NextResponse.json({ data: [] });
  }

  // Allowlist: alphanumeric, spaces, hyphens, underscores, dots (covers names + CIDv0/CIDv1 hashes)
  if (!/^[a-zA-Z0-9\s\-_.]+$/.test(q)) {
    return NextResponse.json({ data: [] });
  }
  const safe = q;

  // From the nest, always (nuthatch#1160); the gateway path this once fell back to left with the key.
  if (!hasNuthatch()) {
    return NextResponse.json({ error: 'Nuthatch is not configured' }, { status: 503 });
  }
  try {
    const data = await cached(`lodestar:subgraph-search:${safe.toLowerCase()}:nuthatch:v1`, 300, async () => {
      if (/^0x[a-fA-F0-9]{40}$/.test(safe)) return searchDeploymentsByManifestAddress(safe, 20);
      if (safe.startsWith('Qm') && safe.length >= 8) return searchDeploymentsByHashPrefix(safe, 10);
      return searchSubgraphsByName(safe, 10);
    });
    return NextResponse.json({ data, source: 'nuthatch' }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (error) {
    log.api.error({ err: error }, 'Subgraph search from the nest failed');
    return NextResponse.json({ error: 'Search failed' }, { status: 503 });
  }
}
