import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { nuthatchEnabled, nuthatchSqlReady } from '@/lib/nuthatch';
import {
  AGREEMENT_TABLES,
  buildAgreements,
  forIndexer,
  type AgreementStage,
  type StageRows,
} from '@/lib/dips-agreements';
import { log } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * The DIPS agreement lifecycle: offer, acceptance, registration, collection, cancellation.
 *
 * Every table behind this is empty on Arbitrum One today, because no indexing agreement has ever
 * been funded. `empty: true` says so explicitly rather than leaving a caller to infer it from a
 * zero, which is the same distinction the allocation panel makes between an absent figure and a
 * measured one.
 *
 * `?indexer=0x…` narrows it to one service provider, which is the per-indexer portfolio.
 *
 * Note what is NOT here: POI presentation. The roadmap's lifecycle bullet lists it between
 * acceptance and collection, but POIs go to the data service, and no event on the
 * RecurringCollector or the RecurringAgreementManager carries one. dips-nest cannot answer that
 * leg, and pretending otherwise would put a gap in the middle of a view that looks complete.
 */

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export async function GET(request: NextRequest) {
  if (!nuthatchEnabled('NUTHATCH_DIPS')) {
    return NextResponse.json({ data: { available: false } });
  }

  const indexer = request.nextUrl.searchParams.get('indexer');
  if (indexer && !ADDRESS.test(indexer)) {
    return NextResponse.json({ error: 'indexer must be a 0x address' }, { status: 400 });
  }

  try {
    // Cached whole, then narrowed in memory: the lifecycle is small and shared, so one indexer
    // asking must not cost a fresh read of every table.
    const summary = await cached('dips:agreements:v1', 300, async () => {
      const stages = Object.keys(AGREEMENT_TABLES) as AgreementStage[];

      // One `Promise.all` over nine tiny reads. Thanks to the in-flight probe coalescing in
      // `nuthatch.ts` this costs a single `/ready` probe, not nine.
      const results = await Promise.all(
        stages.map((stage) =>
          nuthatchSqlReady<Record<string, unknown>>(
            `SELECT * FROM "${AGREEMENT_TABLES[stage]}" ORDER BY block_number`,
            '/dips',
          ),
        ),
      );

      const rows: StageRows = {};
      results.forEach((result, i) => {
        if (!result.ok) throw Object.assign(new Error(result.error), { nest: result });
        rows[stages[i]] = result.data.rows;
      });

      return buildAgreements(rows);
    });

    const data = indexer ? forIndexer(summary, indexer) : summary;

    return NextResponse.json(
      { data: { available: true, ...data } },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900' } },
    );
  } catch (error) {
    log.api.error({ err: error }, 'DIPS agreements route error');
    const nest = (error as { nest?: { error: string; reason?: string; status?: number } }).nest;
    if (nest) {
      return NextResponse.json(
        { error: nest.error, reason: nest.reason },
        { status: nest.status ?? 503 },
      );
    }
    return NextResponse.json({ error: 'Failed to load DIPS agreements' }, { status: 500 });
  }
}
