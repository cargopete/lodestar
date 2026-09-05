import { NextRequest, NextResponse } from 'next/server';
import { db, hasDbAccess } from '@/lib/db';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import { log } from '@/lib/logger';
import { hasNuthatch, nuthatchEnabled, nuthatchSqlReady } from '@/lib/nuthatch';
import { epochsSql, type NestEpochRow } from '@/lib/nest-queries';

const EPOCHS_BASE_PATH = process.env.NUTHATCH_EPOCHS_BASE_PATH || '/alloc';

export interface TokenMetricPoint {
  epoch: number;
  issuance: number;
  queryFeeTaxBurn: number;
  disputeBurn: number;
  totalBurn: number;
  net: number;
}

const ALLOWED_COUNTS = new Set([50, 100, 200, 500]);

/** Thrown from inside `cached()` so the handler can answer 503 rather than a hollow 200. */
class NoSubgraphAccess extends Error {}

/**
 * The fallback when Postgres has nothing, from `lodestar_epochs` instead of the gateway (nuthatch#1160).
 * `disputeBurn` is 0 here as it is on the gateway path: only the Postgres path joins disputes.
 */
async function fetchFromNest(count: number): Promise<TokenMetricPoint[]> {
  const r = await nuthatchSqlReady<NestEpochRow>(epochsSql(count), EPOCHS_BASE_PATH);
  if (!r.ok) throw Object.assign(new Error(r.error), { nest: r });
  return r.data.rows
    .map((e) => {
      const issuance = parseFloat(e.total_rewards) / 1e18;
      const queryFeeTaxBurn = parseFloat(e.taxed_query_fees) / 1e18;
      return { epoch: Number(e.id), issuance, queryFeeTaxBurn, disputeBurn: 0, totalBurn: queryFeeTaxBurn, net: issuance - queryFeeTaxBurn };
    })
    .reverse();
}

async function fetchFromSubgraph(count: number): Promise<TokenMetricPoint[]> {
  const result = await subgraphQuery<{
    epoches: Array<{ id: string; totalRewards: string; taxedQueryFees: string }>;
  }>(`{
    epoches(first: ${count}, orderBy: startBlock, orderDirection: desc) {
      id
      totalRewards
      taxedQueryFees
    }
  }`);

  return result.epoches
    .map((e) => {
      const issuance = parseFloat(e.totalRewards) / 1e18;
      const queryFeeTaxBurn = parseFloat(e.taxedQueryFees) / 1e18;
      return {
        epoch: parseInt(e.id),
        issuance,
        queryFeeTaxBurn,
        disputeBurn: 0,
        totalBurn: queryFeeTaxBurn,
        net: issuance - queryFeeTaxBurn,
      };
    })
    .reverse();
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const count = ALLOWED_COUNTS.has(Number(params.get('count')))
    ? Number(params.get('count'))
    : 100;

  const cacheKey = `lodestar:token-metrics:v3:${count}`;

  try {
    const data = await cached<TokenMetricPoint[]>(cacheKey, 600, async () => {
      // Try DB first
      if (hasDbAccess() && db) {
        try {
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

          if (rows.length > 0) {
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
              .reverse();
          }
        } catch {
          // DB unreachable or query failed — fall through to subgraph
        }
      }

      // DB empty, unavailable, or failed — fall back to subgraph. With no gateway key there is
      // no fallback left, and an empty series here would draw a flat line that reads exactly like
      // a real one (#36). `cached()` does not memoise a rejection, so throwing is safe.
      // On the nest path (nuthatch#1160) the fallback is the nest, and the key is not consulted.
      if (nuthatchEnabled('NUTHATCH_EPOCHS') && hasNuthatch()) return fetchFromNest(count);
      if (!hasSubgraphAccess()) throw new NoSubgraphAccess();
      return fetchFromSubgraph(count);
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
    // Never a successful empty series: a subgraph outage, a malformed response and a genuinely
    // empty range would all have been one flat line on the chart.
    if (error instanceof NoSubgraphAccess) {
      return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
    }
    return NextResponse.json({ error: 'Failed to load token metrics' }, { status: 500 });
  }
}
