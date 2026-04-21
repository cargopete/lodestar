import { NextRequest, NextResponse } from 'next/server';
import { db, hasDbAccess } from '@/lib/db';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import { weiToGRT } from '@/lib/utils';
import { cached } from '@/lib/cache';
import { log } from '@/lib/logger';

interface DelegatorStake {
  stakedTokens: string;
  shareAmount: string;
  indexer: { id: string };
}

interface SubgraphResponse {
  delegator: {
    stakes: DelegatorStake[];
  } | null;
}

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get('address')?.toLowerCase();
  const days = Math.min(
    Math.max(parseInt(request.nextUrl.searchParams.get('days') || '90', 10) || 90, 7),
    365
  );

  if (!address) {
    return NextResponse.json({ error: 'address parameter required' }, { status: 400 });
  }

  if (!hasDbAccess() || !db) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  const sql = db; // narrow for closure

  try {
    const result = await cached(`lodestar:rewards-history:${address}:${days}`, 300, async () => {
      // 1. Fetch delegator positions from subgraph
      const data = await subgraphQuery<SubgraphResponse>(`{
        delegator(id: "${address}") {
          stakes(first: 100, where: { stakedTokens_gt: "0" }) {
            stakedTokens
            shareAmount
            indexer { id }
          }
        }
      }`);

      if (!data.delegator || data.delegator.stakes.length === 0) {
        return { history: [] };
      }

      const positions = data.delegator.stakes.map((s) => ({
        indexerAddress: s.indexer.id,
        principalGRT: weiToGRT(s.stakedTokens),
        sharesGRT: weiToGRT(s.shareAmount),
      }));

      const indexerAddresses = positions.map((p) => p.indexerAddress);
      const cutoffDate = new Date(Date.now() - days * 86400 * 1000).toISOString();

      // 2. Fetch exchange rate snapshots — latest per day per indexer
      const snapshots = await sql`
        SELECT DISTINCT ON (indexer_address, snapshot_at::date)
          indexer_address,
          snapshot_at::date as snapshot_date,
          delegation_exchange_rate
        FROM indexer_snapshots
        WHERE indexer_address = ANY(${indexerAddresses})
          AND snapshot_at >= ${cutoffDate}
          AND delegation_exchange_rate IS NOT NULL
        ORDER BY indexer_address, snapshot_at::date, snapshot_at DESC
      `;

      if (snapshots.length === 0) {
        return { history: [] };
      }

      // 3. Build rate lookup: indexerAddress -> date -> rate
      const rateLookup: Record<string, Record<string, number>> = {};
      const dateSet = new Set<string>();

      for (const row of snapshots) {
        const addr = row.indexer_address as string;
        // postgres.js returns Date objects for date columns
        const dateStr =
          row.snapshot_date instanceof Date
            ? row.snapshot_date.toISOString().split('T')[0]
            : String(row.snapshot_date);

        if (!rateLookup[addr]) rateLookup[addr] = {};
        rateLookup[addr][dateStr] = Number(row.delegation_exchange_rate);
        dateSet.add(dateStr);
      }

      const allDates = [...dateSet].sort();

      // 4. Forward-fill missing rates per indexer (rate doesn't change between snapshots)
      for (const pos of positions) {
        const rates = rateLookup[pos.indexerAddress];
        if (!rates) continue;

        let lastRate: number | null = null;
        for (const date of allDates) {
          if (rates[date] !== undefined) {
            lastRate = rates[date];
          } else if (lastRate !== null) {
            rates[date] = lastRate;
          }
        }
      }

      // 5. Compute portfolio value at each date
      const history = allDates.map((date) => {
        let totalValue = 0;
        let totalPrincipal = 0;

        for (const pos of positions) {
          const rate = rateLookup[pos.indexerAddress]?.[date];
          if (rate !== undefined) {
            totalValue += pos.sharesGRT * rate;
          } else {
            // No snapshot yet for this indexer — use principal as baseline
            totalValue += pos.principalGRT;
          }
          totalPrincipal += pos.principalGRT;
        }

        const totalRewards = Math.max(totalValue - totalPrincipal, 0);
        const d = new Date(date);

        return {
          date: `${d.getMonth() + 1}/${d.getDate()}`,
          timestamp: d.getTime(),
          value: Math.round(totalValue * 100) / 100,
          rewards: Math.round(totalRewards * 100) / 100,
          principal: Math.round(totalPrincipal * 100) / 100,
        };
      });

      return { history };
    });

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    log.api.error({ err: error }, 'Rewards history error');
    return NextResponse.json({ error: 'Failed to fetch rewards history' }, { status: 500 });
  }
}
