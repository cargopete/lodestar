import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { log } from '@/lib/logger';

/**
 * GET /api/indexer-disputes/[address]
 * Disputes / slashing history for an indexer, read from the ingested `disputes`
 * table (populated by the ingest-disputes cron). Gracefully returns [] if the DB
 * is unavailable.
 */
const ETH_ADDRESS_RE = /^0x[0-9a-f]{40}$/;

interface DisputeRow {
  id: string;
  dispute_type: string | null;
  fisherman: string | null;
  allocation_id: string | null;
  deployment_id: string | null;
  status: string | null;
  tokens_slashed_grt: string | null;
  tokens_burned_grt: string | null;
  created_at: string | null;
  closed_at: string | null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  const addr = address.toLowerCase();

  if (!ETH_ADDRESS_RE.test(addr)) {
    return NextResponse.json({ error: 'Invalid address' }, { status: 400 });
  }
  if (!db) {
    return NextResponse.json({ disputes: [] });
  }

  try {
    const disputes = await db<DisputeRow[]>`
      SELECT id, dispute_type, fisherman, allocation_id, deployment_id, status,
             tokens_slashed_grt, tokens_burned_grt, created_at, closed_at
      FROM disputes
      WHERE indexer_address = ${addr}
      ORDER BY created_at DESC NULLS LAST
      LIMIT 100
    `;
    return NextResponse.json({ disputes }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (error) {
    log.api.error({ err: error }, 'Indexer disputes error');
    return NextResponse.json({ disputes: [] });
  }
}
