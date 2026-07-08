import { NextResponse, type NextRequest } from 'next/server';
import { cached } from '@/lib/cache';
import { probeGateway, hasGatewayAccess, type GatewayProbeResult } from '@/lib/gateway-probe';
import { log } from '@/lib/logger';

// Queries an external gateway over the network — keep on Node.
export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ hash: string }> },
) {
  if (!hasGatewayAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  const { hash } = await params;

  try {
    const data = await cached<GatewayProbeResult>(
      `lodestar:gateway-probe:${hash}`,
      30, // Live serving state — short TTL, matches indexing-status.
      // The probe timestamp is stamped once per cache miss, not per request.
      () => probeGateway(hash, new Date().toISOString()),
    );

    return NextResponse.json(
      { data },
      { headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' } },
    );
  } catch (error) {
    log.api.error({ err: error }, 'Gateway probe error');
    return NextResponse.json({ error: 'Failed to probe gateway' }, { status: 500 });
  }
}
