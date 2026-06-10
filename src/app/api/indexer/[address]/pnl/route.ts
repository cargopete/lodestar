import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { db, hasDbAccess } from '@/lib/db';
import { getIndexerRevenue, REVENUE_WINDOWS, type RevenueWindow } from '@/lib/rav';
import { resolveCostModel, DEFAULT_CHAIN_COSTS } from '@/lib/infra-cost';
import { computeIndexerPnl } from '@/lib/pnl';
import { log } from '@/lib/logger';

// GET /api/indexer/[address]/pnl?window=30&grtPrice=0.09&chains=arbitrum,mainnet&overhead=300&cost_arbitrum=1800
//   - chains:    comma-separated chain keys the operator runs (uses DEFAULT_CHAIN_COSTS)
//   - cost_<chain>: per-chain monthly USD override
//   - overhead:  operator overhead USD/mo override
//   - grtPrice:  optional; enables USD/net/margin fields
//
// Cost overrides are request input only (no persisted per-indexer config) until the
// cockpit's operator-auth layer (B0) exists — we won't open an unauthenticated write
// surface keyed by an arbitrary address.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  const addr = address.toLowerCase();
  const sp = request.nextUrl.searchParams;

  if (!/^0x[0-9a-f]{40}$/.test(addr)) {
    return NextResponse.json({ error: 'Invalid address format' }, { status: 400 });
  }
  if (!hasDbAccess() || !db) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const windowParam = Number(sp.get('window') ?? 30);
  const windowDays: RevenueWindow = (REVENUE_WINDOWS as number[]).includes(windowParam)
    ? (windowParam as RevenueWindow)
    : 30;

  const grtPriceParam = sp.get('grtPrice');
  const grtPrice =
    grtPriceParam != null && Number.isFinite(Number(grtPriceParam)) && Number(grtPriceParam) >= 0
      ? Number(grtPriceParam)
      : null;

  const chains = (sp.get('chains') ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);

  // Per-chain overrides via cost_<chain>=NNN
  const overrides: Record<string, number> = {};
  for (const [k, v] of sp.entries()) {
    if (k.startsWith('cost_')) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) overrides[k.slice(5)] = n;
    }
  }
  const overheadParam = sp.get('overhead');
  const baseOverheadUsd =
    overheadParam != null && Number.isFinite(Number(overheadParam)) && Number(overheadParam) >= 0
      ? Number(overheadParam)
      : undefined;

  try {
    const costModel = resolveCostModel({ chains, overrides, baseOverheadUsd });

    const cacheKey = `lodestar:indexer:revenue:${addr}:${windowDays}:1`;
    const revenue = await cached(cacheKey, 300, () =>
      getIndexerRevenue(db!, addr, { windowDays, byDeployment: true }),
    );

    const pnl = computeIndexerPnl({ revenue, costModel, grtPrice, windowDays });

    return NextResponse.json(
      { data: { pnl, costModel, defaultChainCosts: DEFAULT_CHAIN_COSTS } },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    log.api.error({ err: error }, 'Indexer P&L error');
    return NextResponse.json({ error: 'Failed to compute P&L' }, { status: 500 });
  }
}
