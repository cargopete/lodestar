import { NextResponse } from 'next/server';

export const revalidate = 15;

const GATEWAY = process.env.DISPATCH_GATEWAY_URL ?? 'http://167.235.29.213:8080';
const BASE = `${GATEWAY}/solana/entity_changes`;

export async function GET() {
  try {
    // Fetch in parallel: max id (≈ total), latest slot, and recent sample for unique wallets.
    const [maxIdResp, recentResp, finalResp] = await Promise.all([
      // Max ID ≈ total indexed (BIGSERIAL, no deletes expected)
      fetch(`${BASE}?entity_type=eq.JupiterSwap&select=id&order=id.desc&limit=1`, {
        signal: AbortSignal.timeout(5_000),
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      }),
      // Recent 200 for slot + unique wallets
      fetch(`${BASE}?entity_type=eq.JupiterSwap&select=slot,fields&order=slot.desc&limit=200`, {
        signal: AbortSignal.timeout(5_000),
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      }),
      // Most recent FINAL row id ≈ finalized count estimate
      fetch(`${BASE}?entity_type=eq.JupiterSwap&commitment_status=eq.FINAL&select=id&order=id.desc&limit=1`, {
        signal: AbortSignal.timeout(5_000),
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      }),
    ]);

    let total = 0;
    let latest_slot = 0;
    let unique_wallets = 0;
    let finalized = 0;

    if (maxIdResp.ok) {
      const rows: { id: number }[] = await maxIdResp.json();
      total = rows[0]?.id ?? 0;
    }

    if (recentResp.ok) {
      const rows: { slot: number; fields: { user?: string } | null }[] = await recentResp.json();
      if (rows.length > 0) latest_slot = rows[0].slot;
      unique_wallets = new Set(rows.map((r) => r.fields?.user).filter(Boolean)).size;
    }

    if (finalResp.ok) {
      const rows: { id: number }[] = await finalResp.json();
      finalized = rows[0]?.id ?? 0;
    }

    return NextResponse.json({ total, finalized, latest_slot, unique_wallets });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
