import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

const VALID_EVENT_TYPES = new Set(['trade_click', 'protocol_visit']);

export async function POST(req: NextRequest) {
  if (!db) return NextResponse.json({ ok: false }, { status: 503 });

  try {
    const body = await req.json();
    const {
      event_type,
      token_address,
      token_symbol,
      protocol_slug,
      venue,
      pool_address,
      chain,
      destination_url,
      wallet,
      session_id,
    } = body;

    if (!VALID_EVENT_TYPES.has(event_type) || !venue || !session_id) {
      return NextResponse.json({ ok: false, error: 'invalid payload' }, { status: 400 });
    }

    // Sanity-check wallet looks like an address if provided
    const cleanWallet =
      wallet && /^0x[a-fA-F0-9]{40}$/.test(wallet) ? wallet.toLowerCase() : null;

    await db`
      INSERT INTO clickthrough_events (
        event_type, token_address, token_symbol, protocol_slug,
        venue, pool_address, chain, destination_url, wallet, session_id
      ) VALUES (
        ${event_type},
        ${token_address ?? null},
        ${token_symbol ?? null},
        ${protocol_slug ?? null},
        ${venue},
        ${pool_address ?? null},
        ${chain ?? 'mainnet'},
        ${destination_url ?? null},
        ${cleanWallet},
        ${String(session_id).slice(0, 64)}
      )
    `;

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[analytics/clickthrough]', e);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
