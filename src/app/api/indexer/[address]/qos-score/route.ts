import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { db, hasDbAccess } from '@/lib/db';
import { log } from '@/lib/logger';

interface ScoreRow {
  day_number: number;
  day: string | null;
  reliability: number | null;
  lat_util: number | null;
  fresh_util: number | null;
  coverage: number | null;
  served_gap: number | null;
  efficiency: number | null;
  q_score: number | null;
}

// GET /api/indexer/[address]/qos-score
// Latest QoS quality score + sub-metric breakdown + a q_score daily series.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  const addr = address.toLowerCase();

  if (!/^0x[0-9a-f]{40}$/.test(addr)) {
    return NextResponse.json({ error: 'Invalid address format' }, { status: 400 });
  }
  if (!hasDbAccess() || !db) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  try {
    const data = await cached(`lodestar:indexer:qos-score:${addr}`, 1800, async () => {
      const rows = await db!<ScoreRow[]>`
        SELECT day_number, day::text,
               reliability::float8, lat_util::float8, fresh_util::float8,
               coverage::float8, served_gap::float8, efficiency::float8, q_score::float8
        FROM indexer_qos_score
        WHERE indexer_address = ${addr}
        ORDER BY day_number ASC
      `;
      const latest = rows.length ? rows[rows.length - 1] : null;
      return {
        latest,
        daily: rows.map((s) => ({ day: s.day, q_score: s.q_score })),
      };
    });

    return NextResponse.json({ data }, {
      headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600' },
    });
  } catch (error) {
    log.api.error({ err: error }, 'Indexer QoS score error');
    return NextResponse.json({ error: 'Failed to fetch QoS score' }, { status: 500 });
  }
}
