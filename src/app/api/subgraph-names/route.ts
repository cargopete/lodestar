import { NextResponse, type NextRequest } from 'next/server';
import { hasNuthatch } from '@/lib/nuthatch';
import { displayNamesForDeployments } from '@/lib/subgraph-metadata';
import { log } from '@/lib/logger';

/**
 * Batch-resolve deployment IPFS hashes → subgraph display names.
 * POST { hashes: string[] } → { data: { [ipfsHash]: displayName } }.
 * Used by the Foghorn needs-attention surface, where many erroring deployments
 * are unsignalled and so never appear in the top-N signalled list.
 */
export async function POST(request: NextRequest) {
  // The names come from graph-gns-nest's metadata hashes and the IPFS documents behind them, cached
  // in Postgres (nuthatch#1160, group B). The gateway path this once fell back to left with the key.
  if (!hasNuthatch()) {
    return NextResponse.json({ error: 'Nuthatch is not configured' }, { status: 503 });
  }

  let hashes: string[] = [];
  try {
    const body = await request.json();
    hashes = Array.isArray(body?.hashes)
      ? body.hashes.filter((h: unknown): h is string => typeof h === 'string')
      : [];
  } catch {
    hashes = [];
  }

  const unique = Array.from(
    new Set(hashes.filter((h) => h.startsWith('Qm') || h.startsWith('baf'))),
  ).slice(0, 500);
  if (unique.length === 0) return NextResponse.json({ data: {} });
  try {
    const names = await displayNamesForDeployments(unique);
    const map: Record<string, string> = {};
    for (const [h, n] of Object.entries(names)) if (n) map[h] = n;
    return NextResponse.json({ data: map, source: 'nuthatch' });
  } catch (error) {
    log.api.error({ err: error }, 'Subgraph names from the nest failed');
    return NextResponse.json({ data: {} });
  }
}
