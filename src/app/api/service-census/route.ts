import { NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { censusHeadline, runCensus, type ServiceCensus } from '@/lib/service-census';
import { log } from '@/lib/logger';

// Same reason as the Dispatch probe next door: no request argument, so Next would freeze this at
// build time, and a liveness answer served from a build artefact is worse than none.
export const dynamic = 'force-dynamic';

/**
 * Registry versus reality across every data service, not just Dispatch.
 *
 * G-1 is the top risk in the delivery tracker and its provider counts were kept by hand, which is
 * how the tracker came to carry Seahorn at zero while its registry held two registrations, and to
 * leave "what is the actual Dispatch provider count?" open as a question that four RPC calls
 * settle. This answers it from chain.
 */
export async function GET() {
  try {
    const data = await cached<{ services: ServiceCensus[] }>('service-census:v1', 300, async () => ({
      services: await runCensus(),
    }));
    return NextResponse.json(
      { data: { ...data, headline: censusHeadline(data.services) } },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } }
    );
  } catch (error) {
    log.api.error({ err: error }, 'service census failed');
    // A census that could not run must not be indistinguishable from one that found nothing.
    return NextResponse.json({ error: 'Service census failed' }, { status: 500 });
  }
}
