import { NextResponse } from 'next/server';
import { db, hasDbAccess } from '@/lib/db';
import { cached } from '@/lib/cache';
import { computeConcentration, type IndexerAllocation } from '@/lib/concentration';
import { log } from '@/lib/logger';

const FOGHORN_API_URL = process.env.FOGHORN_API_URL ?? '';

interface FoghornIndexer {
  indexer_address: string;
  composite: number;
  rated: boolean;
}

interface AllocRow {
  address: string;
  allocated_grt: number;
}

/**
 * GET /api/qos/capture — how the network's allocated stake is distributed across quality bands,
 * scored by the Lodestar Oracle.
 *
 * This is the reward-distribution analysis that used to live on /indexer-qos. It moved because it
 * was computed from `indexer_qos_score`, which is derived from Edge & Node's gateway telemetry —
 * a perfectly good instrument, but a different one from the oracle whose numbers the rest of /qos
 * reports. An analysis that says "this much stake sits behind poor service" should be able to say
 * which measurement it means, and it could not.
 *
 * The honest consequence is a much larger unscored band. The Lodestar Oracle only grades indexers
 * it has actually probed — roughly a third of the active set — so most of the network's allocated
 * GRT lands in "not measured". That is the true state of our coverage, and it is reported rather
 * than hidden by falling back to somebody else's numbers for the rest.
 */
export async function GET() {
  if (!hasDbAccess() || !db) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }
  if (!FOGHORN_API_URL) {
    return NextResponse.json({ error: 'Foghorn API not configured' }, { status: 503 });
  }

  try {
    const data = await cached('lodestar:qos-capture:v1', 900, async () => {
      const [scores, allocs] = await Promise.all([
        fetch(`${FOGHORN_API_URL}/v1/indexers?limit=500`, {
          headers: { Accept: 'application/json' },
          next: { revalidate: 0 },
        }).then((r) => {
          if (!r.ok) throw new Error(`Foghorn returned ${r.status}`);
          return r.json() as Promise<{ indexers: FoghornIndexer[] }>;
        }),
        db!<AllocRow[]>`
          SELECT address, allocated_grt::float8 AS allocated_grt
          FROM indexers
          WHERE allocated_grt > 0
        `,
      ]);

      // Only RATED indexers carry a score. An unrated one is not a zero — it is an indexer we have
      // not measured, and collapsing those two into the same bucket is the exact failure the rest
      // of this page exists to complain about.
      const byAddress = new Map<string, number | null>();
      for (const ix of scores.indexers) {
        byAddress.set(ix.indexer_address.toLowerCase(), ix.rated ? ix.composite : null);
      }

      const rows: IndexerAllocation[] = allocs.map((a) => ({
        allocated_grt: a.allocated_grt,
        q_score: byAddress.get(a.address.toLowerCase()) ?? null,
      }));

      const concentration = computeConcentration(rows);

      return {
        concentration,
        coverage: {
          allocated_indexers: rows.length,
          measured_indexers: rows.filter((r) => r.q_score !== null).length,
          note:
            'Scored by the Lodestar Oracle, which grades only what it has probed. Unscored means ' +
            'not measured, never measured and found wanting.',
        },
      };
    });

    return NextResponse.json({ data });
  } catch (error) {
    log.api.error({ error: String(error) }, 'qos-capture failed');
    return NextResponse.json({ error: 'Failed to compute quality capture' }, { status: 500 });
  }
}
