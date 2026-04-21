import { NextRequest, NextResponse } from 'next/server';
import { db, hasDbAccess } from '@/lib/db';
import { cached } from '@/lib/cache';
import { log } from '@/lib/logger';

export interface TokenMetricPoint {
  epoch: number;
  issuance: number;
  queryFeeTaxBurn: number;
  disputeBurn: number;
  totalBurn: number;
  net: number;
}

const ALLOWED_COUNTS = new Set([50, 100, 200, 500]);

export async function GET(request: NextRequest) {
  if (!hasDbAccess() || !db) {
    return NextResponse.json({ data: [] });
  }

  const params = request.nextUrl.searchParams;
  const count = ALLOWED_COUNTS.has(Number(params.get('count')))
    ? Number(params.get('count'))
    : 100;

  const cacheKey = `lodestar:token-metrics:${count}`;

  try {
    const data = await cached<TokenMetricPoint[]>(cacheKey, 600, async () => {
      const rows = await db!`
        SELECT
          e.id AS epoch,
          COALESCE(e.total_rewards, 0) AS issuance,
          COALESCE(e.taxed_query_fees, 0) AS query_fee_tax_burn,
          COALESCE(d.dispute_burn, 0) AS dispute_burn
        FROM epochs e
        LEFT JOIN (
          SELECT
            created_epoch,
            SUM(COALESCE(tokens_burned_grt, 0)) AS dispute_burn
          FROM disputes
          WHERE created_epoch IS NOT NULL
          GROUP BY created_epoch
        ) d ON d.created_epoch = e.id
        ORDER BY e.id DESC
        LIMIT ${count}
      `;

      return rows
        .map((r) => {
          const issuance = Number(r.issuance);
          const queryFeeTaxBurn = Number(r.query_fee_tax_burn);
          const disputeBurn = Number(r.dispute_burn);
          const totalBurn = queryFeeTaxBurn + disputeBurn;
          return {
            epoch: Number(r.epoch),
            issuance,
            queryFeeTaxBurn,
            disputeBurn,
            totalBurn,
            net: issuance - totalBurn,
          };
        })
        .reverse(); // chronological order
    });

    return NextResponse.json(
      { data },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1200',
        },
      },
    );
  } catch (error) {
    log.api.error({ err: error }, 'Token metrics error');
    return NextResponse.json({ data: [] });
  }
}
