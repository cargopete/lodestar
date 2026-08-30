import { NextResponse } from 'next/server';
import { createPublicClient, http, isAddress } from 'viem';
import { arbitrum } from 'viem/chains';
import { CENSUS_SERVICES, runCensus } from '@/lib/service-census';
import { readRequirements, toJson } from '@/lib/operator-requirements';
import { preflight, preflightVerdict, readPreflight } from '@/lib/operator-preflight';
import { cached } from '@/lib/cache';
import { log } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * What would happen if this address tried to run this service, read from Arbitrum One.
 *
 * Read-only by construction: no wallet, no signature, no gas. That is the point rather than a
 * limitation, because it means somebody can price the job before deciding they care, and can do it
 * for an address they have not funded yet or do not control.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const address = (url.searchParams.get('address') ?? '').trim();
  const serviceId = (url.searchParams.get('service') ?? '').trim();

  if (!isAddress(address)) {
    return NextResponse.json({ error: 'Give an ?address= that is a valid address' }, { status: 400 });
  }
  const service = CENSUS_SERVICES.find((s) => s.id === serviceId);
  if (!service) {
    return NextResponse.json(
      { error: `Unknown service. One of: ${CENSUS_SERVICES.map((s) => s.id).join(', ')}` },
      { status: 400 }
    );
  }

  try {
    const rpc = process.env.ARBITRUM_RPC_URL;
    if (!rpc) throw new Error('ARBITRUM_RPC_URL is not set');
    const client = createPublicClient({ chain: arbitrum, transport: http(rpc) });

    const [reads, requirements, census] = await Promise.all([
      readPreflight(client, address as `0x${string}`, service.address),
      readRequirements(client, service.address),
      // Cached separately and shared with the census panel, so asking about five addresses in a row
      // does not re-read the registry five times.
      cached('service-census:v2:registry', 300, () => runCensus()),
    ]);

    const registered = (census.find((c) => c.id === service.id)?.providers ?? []).some(
      (p) => p.address.toLowerCase() === address.toLowerCase()
    );

    const steps = preflight({
      ...reads,
      registered,
      requirements: requirements && toJson(requirements),
    });

    return NextResponse.json(
      {
        data: {
          address,
          service: { id: service.id, name: service.name, address: service.address },
          verdict: preflightVerdict(steps),
          steps,
        },
      },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } }
    );
  } catch (error) {
    log.api.error({ err: error }, 'operator preflight failed');
    // A preflight that could not run must never look like a preflight that found nothing wrong.
    return NextResponse.json({ error: 'Preflight failed' }, { status: 500 });
  }
}
