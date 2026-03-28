import { NextResponse, type NextRequest } from 'next/server';
import { cacheGet } from '@/lib/cache';
import { db, hasDbAccess } from '@/lib/db';
import type { LeaderboardEntry } from '@/lib/scoring';

interface LeaderboardCache {
  periodStart: string;
  periodEnd: string;
  computedAt: number;
  entries: LeaderboardEntry[];
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  // --- List available periods ---
  if (params.get('periods') === 'true') {
    if (!hasDbAccess() || !db) {
      return NextResponse.json({ periods: [] });
    }
    const rows = await db`
      SELECT DISTINCT period_start, period_end
      FROM indexer_scores
      WHERE period_type = 'monthly'
      ORDER BY period_start DESC
    `;
    const periods = rows.map((r) => ({
      start: String(r.period_start).slice(0, 10),
      end: String(r.period_end).slice(0, 10),
    }));
    return NextResponse.json({ periods }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
    });
  }

  // --- Fetch scores for a specific period (or latest) ---
  const periodParam = params.get('period'); // YYYY-MM format

  // Try Redis cache first (always has "latest")
  const cached = await cacheGet<LeaderboardCache>('lodestar:leaderboard:latest');

  // If no specific period requested, or requested period matches cached period, use Redis
  if (!periodParam || (cached && cached.periodStart.startsWith(periodParam))) {
    if (!cached) {
      return NextResponse.json(
        { error: 'Leaderboard data not yet available — scores have not been computed' },
        { status: 503 }
      );
    }

    // Look up previous month's badge holder from Postgres
    let badgeHolder: { address: string; score: number; period: string } | null = null;
    if (hasDbAccess() && db) {
      const badgeRows = await db`
        SELECT indexer_address, final_score, period_start
        FROM indexer_scores
        WHERE period_type = 'monthly'
          AND is_eligible_for_badge = true
          AND period_start::text < ${cached.periodStart.slice(0, 10)}
        ORDER BY period_start DESC
        LIMIT 1
      `;
      if (badgeRows.length > 0) {
        badgeHolder = {
          address: badgeRows[0].indexer_address,
          score: Number(badgeRows[0].final_score),
          period: String(badgeRows[0].period_start).slice(0, 10),
        };
      }
    }

    return NextResponse.json({ ...cached, badgeHolder }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
    });
  }

  // Historical period — query Postgres
  if (!hasDbAccess() || !db) {
    return NextResponse.json(
      { error: 'Database not configured for historical queries' },
      { status: 503 }
    );
  }

  const [year, month] = periodParam.split('-').map(Number);
  if (!year || !month || month < 1 || month > 12) {
    return NextResponse.json({ error: 'Invalid period format, use YYYY-MM' }, { status: 400 });
  }

  const periodPrefix = `${year}-${String(month).padStart(2, '0')}`;

  const rows = await db`
    SELECT *
    FROM indexer_scores
    WHERE period_type = 'monthly'
      AND period_start::text LIKE ${periodPrefix + '%'}
    ORDER BY final_score DESC
  `;

  if (rows.length === 0) {
    return NextResponse.json(
      { error: `No scores available for ${periodPrefix}` },
      { status: 404 }
    );
  }

  // Assign ranks and build response
  const entries: LeaderboardEntry[] = rows.map((r, i) => ({
    indexer_address: r.indexer_address,
    period_type: r.period_type,
    period_start: r.period_start,
    period_end: r.period_end,
    query_fee_score: Number(r.query_fee_score),
    allocation_efficiency_score: Number(r.allocation_efficiency_score),
    delegator_apr_score: Number(r.delegator_apr_score ?? 0),
    effective_cut_score: Number(r.effective_cut_score ?? 0),
    capacity_score: Number(r.capacity_score),
    cut_stability_score: Number(r.cut_stability_score),
    tenure_bonus: Number(r.tenure_bonus),
    retention_score: Number(r.retention_score),
    reo_score: Number(r.reo_score),
    poi_consensus_score: Number(r.poi_consensus_score ?? 0),
    allocation_breadth_score: Number(r.allocation_breadth_score),
    community_vote_score: Number(r.community_vote_score),
    subtotal: Number(r.subtotal),
    penalty_multiplier: Number(r.penalty_multiplier),
    final_score: Number(r.final_score),
    months_active: Number(r.months_active),
    is_eligible_for_badge: Boolean(r.is_eligible_for_badge),
    rank: i + 1,
  }));

  const data: LeaderboardCache = {
    periodStart: String(rows[0].period_start),
    periodEnd: String(rows[0].period_end),
    computedAt: Date.now(),
    entries,
  };

  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
  });
}
