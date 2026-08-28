import { NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import {
  arbitrumClient,
  fetchRegistry,
  probeRegistry,
  summarise,
  type LivenessSummary,
} from '@/lib/dispatch-liveness';
import { log } from '@/lib/logger';

// No request argument, so Next would otherwise freeze this at build time — and a liveness probe
// that answers from a build artefact is worse than no probe at all.
export const dynamic = 'force-dynamic';

/**
 * Registry versus reality for the Dispatch RPC data service.
 *
 * Reads which providers are registered on Arbitrum One and what endpoints they advertise, then
 * calls those endpoints. The gap between the two numbers is the whole point: on 2026-08-28 it was
 * two registered and zero serving, and had been for 39 days, because everything anyone looked at
 * was on-chain state.
 */
export async function GET() {
  try {
    const data = await cached<LivenessSummary>('provider-liveness:v1', 300, async () => {
      const registry = await fetchRegistry(arbitrumClient());
      return summarise(await probeRegistry(registry));
    });
    return NextResponse.json(
      { data },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } }
    );
  } catch (error) {
    log.api.error({ err: error }, 'provider liveness probe failed');
    // Deliberately a 500 rather than an empty-but-cheerful payload. A probe that cannot run must
    // not be indistinguishable from a probe that found everything healthy.
    return NextResponse.json({ error: 'Liveness probe failed' }, { status: 500 });
  }
}
