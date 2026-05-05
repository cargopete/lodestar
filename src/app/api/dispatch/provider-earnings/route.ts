import { NextResponse } from 'next/server';
import { cached } from '@/lib/cache';

const GATEWAY = process.env.DISPATCH_GATEWAY_URL ?? 'http://167.235.29.213:8080';

interface ReceiptItem {
  id: number;
  value: string; // GRT wei as decimal string
}

/**
 * Returns the total GRT earned (sum of all receipt values) from the
 * gateway. Since this is a single-provider gateway, all receipts belong
 * to lodestar — no provider filter needed.
 *
 * Paginates via since_id until the gateway returns fewer items than the
 * page size, collecting the full history.
 */
async function sumAllReceipts(): Promise<string> {
  const PAGE = 1000;
  let sinceId = 0;
  let total = BigInt(0);

  for (let page = 0; page < 100; page++) {
    const url = sinceId > 0
      ? `${GATEWAY}/receipts?limit=${PAGE}&since_id=${sinceId}`
      : `${GATEWAY}/receipts?limit=${PAGE}`;

    const resp = await fetch(url, { signal: AbortSignal.timeout(8_000), cache: 'no-store' });
    if (!resp.ok) break;

    const data: ReceiptItem[] = await resp.json();
    if (!Array.isArray(data) || data.length === 0) break;

    for (const r of data) {
      try { total += BigInt(r.value); } catch { /* skip malformed */ }
    }

    if (data.length < PAGE) break; // last page
    sinceId = data[data.length - 1].id;
  }

  return total.toString();
}

export async function GET() {
  try {
    const totalWei = await cached('lodestar:dispatch:provider-earnings', 60, sumAllReceipts);
    return NextResponse.json({ totalWei }, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
