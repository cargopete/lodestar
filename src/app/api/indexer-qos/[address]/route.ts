import { NextResponse, type NextRequest } from 'next/server';
import { cached } from '@/lib/cache';
import { qosOracleQuery, hasSubgraphAccess } from '@/lib/subgraph';

const ETH_ADDRESS_RE = /^0x[0-9a-f]{40}$/i;

interface QoSDataPoint {
  dayNumber: string;
  query_count: string;
  proportion_indexer_200_responses: string;
  avg_indexer_latency_ms: string;
  avg_indexer_blocks_behind: string;
  avg_query_fee: string;
  total_query_fees: string;
}

export interface IndexerQoSPoint {
  date: string;
  queryCount: number;
  successRate: number;   // 0–100
  latencyMs: number;
  blocksBehind: number;
  avgQueryFee: number;   // GRT
  totalQueryFees: number; // GRT
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address: rawAddress } = await params;
  const address = rawAddress.toLowerCase();

  if (!ETH_ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
  }
  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  const cacheKey = `lodestar:indexer-qos-v3:${address}`;

  try {
    const data = await cached(cacheKey, 3600, async () => {
      // QoS oracle dayNumber = days since The Graph mainnet launch (Dec 17 2020 = Unix day 18613)
      const GRAPH_EPOCH_DAYS = 18613;
      const currentDay = Math.floor(Date.now() / 86400000) - GRAPH_EPOCH_DAYS;
      const fromDay = currentDay - 90;

      // Paginate — could be many rows if multiple gateways/chains per day
      const allPoints: QoSDataPoint[] = [];
      let lastId = '';

      while (true) {
        const result = await qosOracleQuery<{ indexerDailyDataPoints: QoSDataPoint[] }>(`{
          indexerDailyDataPoints(
            first: 1000
            orderBy: id
            orderDirection: asc
            where: {
              indexer_wallet: "${address}"
              dayNumber_gte: ${fromDay}
              ${lastId ? `id_gt: "${lastId}"` : ''}
            }
          ) {
            id
            dayNumber
            query_count
            proportion_indexer_200_responses
            avg_indexer_latency_ms
            avg_indexer_blocks_behind
            avg_query_fee
            total_query_fees
          }
        }`);

        const batch = result.indexerDailyDataPoints ?? [];
        allPoints.push(...batch);
        if (batch.length < 1000) break;
        lastId = (batch[batch.length - 1] as QoSDataPoint & { id: string }).id;
      }

      if (allPoints.length === 0) return { qos: [] };

      // Aggregate by dayNumber (multiple rows per day from different gateways/chains)
      const byDay = new Map<number, {
        queryCount: number;
        successRateSum: number;
        latencySum: number;
        blocksSum: number;
        totalQueryFees: number;
        count: number;
      }>();

      for (const p of allPoints) {
        const day = Number(p.dayNumber);
        const existing = byDay.get(day) ?? { queryCount: 0, successRateSum: 0, latencySum: 0, blocksSum: 0, totalQueryFees: 0, count: 0 };
        existing.queryCount += Number(p.query_count);
        existing.successRateSum += Number(p.proportion_indexer_200_responses);
        existing.latencySum += Number(p.avg_indexer_latency_ms);
        existing.blocksSum += Number(p.avg_indexer_blocks_behind);
        existing.totalQueryFees += Number(p.total_query_fees) / 1e18;
        existing.count += 1;
        byDay.set(day, existing);
      }

      const qos: IndexerQoSPoint[] = Array.from(byDay.entries())
        .sort(([a], [b]) => a - b)
        .map(([day, agg]) => ({
          date: new Date((day + GRAPH_EPOCH_DAYS) * 86400000).toISOString().slice(0, 10),
          queryCount: agg.queryCount,
          successRate: (agg.successRateSum / agg.count) * 100,
          latencyMs: agg.latencySum / agg.count,
          blocksBehind: agg.blocksSum / agg.count,
          avgQueryFee: agg.count > 0 && agg.queryCount > 0
            ? (agg.totalQueryFees / agg.queryCount) * 1e18 / 1e18
            : 0,
          totalQueryFees: agg.totalQueryFees,
        }));

      return { qos };
    });

    return NextResponse.json({ data }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
    });
  } catch (error) {
    console.error('Indexer QoS error (non-critical):', error);
    return NextResponse.json({ data: { qos: [] } }, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
    });
  }
}
