import { NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { db, hasDbAccess } from '@/lib/db';
import { computeConcentration, type IndexerAllocation } from '@/lib/concentration';
import { log } from '@/lib/logger';

interface LeaderboardRow {
  address: string;
  name: string | null;
  ens_name: string | null;
  q_score: number | null;
  reliability: number | null;
  lat_util: number | null;
  fresh_util: number | null;
  coverage: number | null;
  served_gap: number | null;
  efficiency: number | null;
  old_grade: string | null;
  allocation_count: number | null;
  self_stake_grt: number | null;
}

// GET /api/network-health — QoS-quality leaderboard across all scored indexers (latest day).
export async function GET() {
  if (!hasDbAccess() || !db) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  try {
    const data = await cached('lodestar:network-health:leaderboard', 1800, async () => {
      const rows = await db!<LeaderboardRow[]>`
        SELECT
          s.indexer_address      AS address,
          i.name,
          i.ens_name,
          s.q_score::float8      AS q_score,
          s.reliability::float8  AS reliability,
          s.lat_util::float8     AS lat_util,
          s.fresh_util::float8   AS fresh_util,
          s.coverage::float8     AS coverage,
          s.served_gap::float8   AS served_gap,
          s.efficiency::float8   AS efficiency,
          i.score_grade          AS old_grade,
          i.allocation_count,
          i.self_stake_grt::float8 AS self_stake_grt
        FROM indexer_qos_score s
        LEFT JOIN indexers i ON i.address = s.indexer_address
        WHERE s.day_number = (SELECT MAX(day_number) FROM indexer_qos_score)
        ORDER BY s.q_score DESC NULLS LAST
      `;

      const scored = rows.filter((r) => r.q_score != null);
      const qScores = scored.map((r) => r.q_score as number).sort((a, b) => a - b);
      const medianQ = qScores.length
        ? qScores[Math.floor(qScores.length / 2)]
        : 0;
      const flaggedGap = scored.filter((r) => (r.served_gap ?? 0) > 0.3).length;
      const failing = scored.filter((r) => (r.q_score as number) < 30).length;

      // Concentration + crowding-out over ALL allocated indexers (incl. unscored / never-routed),
      // left-joined to their latest QoS score.
      const allocRows = await db!<IndexerAllocation[]>`
        SELECT i.allocated_grt::float8 AS allocated_grt, s.q_score::float8 AS q_score
        FROM indexers i
        LEFT JOIN indexer_qos_score s
          ON s.indexer_address = i.address
         AND s.day_number = (SELECT MAX(day_number) FROM indexer_qos_score)
        WHERE i.allocated_grt > 0
      `;
      const concentration = computeConcentration(allocRows);

      return {
        indexers: rows,
        summary: {
          total: scored.length,
          medianQ,
          flaggedGap, // routed-around / crowding suspects
          failing, // Q < 30
        },
        concentration,
      };
    });

    return NextResponse.json({ data }, {
      headers: { 'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600' },
    });
  } catch (error) {
    log.api.error({ err: error }, 'Network health leaderboard error');
    return NextResponse.json({ error: 'Failed to fetch leaderboard' }, { status: 500 });
  }
}
