import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

const UNI_V3_URL = process.env.GRAPH_API_KEY
  ? `https://gateway-arbitrum.network.thegraph.com/api/${process.env.GRAPH_API_KEY}/subgraphs/id/5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV`
  : null;

function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  return !cronSecret || req.headers.get('authorization') === `Bearer ${cronSecret}`;
}

interface Swap {
  id: string;
  timestamp: string;
  amountUSD: string;
  transaction: { id: string };
}

async function querySwapsByWallet(wallet: string, fromTimestamp: number): Promise<Swap[]> {
  if (!UNI_V3_URL) return [];

  const query = `{
    swaps(
      where: { origin: "${wallet.toLowerCase()}", timestamp_gte: "${fromTimestamp}" }
      orderBy: timestamp
      orderDirection: asc
      first: 5
    ) {
      id
      timestamp
      amountUSD
      transaction { id }
    }
  }`;

  const res = await fetch(UNI_V3_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(8000),
  });

  const json = await res.json();
  return json.data?.swaps ?? [];
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!db) return NextResponse.json({ ok: false, error: 'no db' }, { status: 503 });

  // Expire events older than 15 min that never converted
  await db`
    UPDATE clickthrough_events
    SET converted = false
    WHERE converted IS NULL
      AND wallet IS NOT NULL
      AND clicked_at < NOW() - INTERVAL '15 minutes'
  `;

  // Fetch pending events with wallets still within the window
  const pending = await db`
    SELECT id, wallet, clicked_at
    FROM clickthrough_events
    WHERE converted IS NULL
      AND wallet IS NOT NULL
      AND clicked_at > NOW() - INTERVAL '15 minutes'
    ORDER BY clicked_at ASC
    LIMIT 100
  `;

  let checked = 0;
  let converted = 0;

  for (const event of pending) {
    const fromTimestamp = Math.floor(new Date(event.clicked_at).getTime() / 1000);

    try {
      const swaps = await querySwapsByWallet(event.wallet, fromTimestamp);

      if (swaps.length > 0) {
        const swap = swaps[0];
        await db`
          UPDATE clickthrough_events
          SET
            converted     = true,
            converted_at  = TO_TIMESTAMP(${parseInt(swap.timestamp)}),
            converted_tx  = ${swap.transaction.id},
            converted_usd = ${parseFloat(swap.amountUSD)}
          WHERE id = ${event.id}
        `;
        converted++;
      }

      checked++;
    } catch (e) {
      console.error('[check-conversions] swap query failed for', event.wallet, e);
    }
  }

  return NextResponse.json({ ok: true, checked, converted });
}
