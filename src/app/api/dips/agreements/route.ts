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
 * Which nest it reads is `NUTHATCH_DIPS_BASE_PATH`, defaulting to the mainnet `/dips`. Mainnet has
 * never produced an agreement event, so every path through the shaping below runs over empty
 * tables in production and the first real exercise of it would otherwise be the day the numbers
 * start mattering. Pointing a dev instance at `/dips-sepolia` — 1,440 events, 1,099 of them
 * collections — runs the same code over rows. It is an environment variable rather than a query
 * parameter deliberately: which chain a production panel reports is not a caller's choice.
 *
 * Note what is NOT here: POI presentation. The roadmap's lifecycle bullet lists it between
 * acceptance and collection, but POIs go to the data service, and no event on the
 * RecurringCollector or the RecurringAgreementManager carries one. dips-nest cannot answer that
 * leg, and pretending otherwise would put a gap in the middle of a view that looks complete.
 */

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** The nest this route reads. `/dips` is Arbitrum One; `/dips-sepolia` is the testnet variant. */
const BASE_PATH = process.env.NUTHATCH_DIPS_BASE_PATH || '/dips';

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
    // The nest is part of the cache key: a dev instance pointed at Sepolia must not be served the
    // mainnet answer it warmed, nor leave one behind for anything else reading this key.
    const summary = await cached(`dips:agreements:v1:${BASE_PATH}`, 300, async () => {
      const stages = Object.keys(AGREEMENT_TABLES) as AgreementStage[];

      // Sequentially, one slot at a time, and this is not a preference.
      //
      // These nine reads used to go out as one `Promise.all`. A nest caps concurrent `/sql`
      // queries — measured against both dips nests on 2026-09-02, the cap admits two and 503s the
      // rest with "server busy: too many concurrent SQL queries" — so seven of the nine were
      // refused and the route returned that 503 to the caller. Every time. It went unnoticed
      // because the tests mock `nuthatchSqlReady`, so nothing here had ever met the guard, and
      // because mainnet's tables are all empty, so nobody was looking at this panel for data.
      //
      // The guard is the nest protecting itself, not an obstacle: the fix is to stop asking for
      // nine slots. Nine tiny reads in series cost one slot and are cached for five minutes, and
      // the in-flight probe coalescing in `nuthatch.ts` still makes it a single `/ready` probe.
      const rows: StageRows = {};
      for (const stage of stages) {
        const result = await nuthatchSqlReady<Record<string, unknown>>(
          `SELECT * FROM "${AGREEMENT_TABLES[stage]}" ORDER BY block_number`,
          BASE_PATH,
        );
        if (!result.ok) throw Object.assign(new Error(result.error), { nest: result });
        rows[stage] = result.data.rows;
      }

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
