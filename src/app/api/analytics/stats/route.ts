import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  const secret = process.env.ANALYTICS_SECRET;
  if (secret && req.headers.get('x-analytics-secret') !== secret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!db) return NextResponse.json({ error: 'no db' }, { status: 503 });

  const [totals] = await db`
    SELECT
      COUNT(*)                                                        AS total_clicks,
      COUNT(DISTINCT session_id)                                      AS unique_sessions,
      COUNT(DISTINCT wallet) FILTER (WHERE wallet IS NOT NULL)        AS unique_wallets,
      COUNT(*)               FILTER (WHERE converted = true)          AS conversions,
      COALESCE(SUM(converted_usd) FILTER (WHERE converted = true), 0) AS total_referred_usd
    FROM clickthrough_events
  `;

  const by_venue = await db`
    SELECT
      venue,
      COUNT(*)                                                        AS clicks,
      COUNT(DISTINCT session_id)                                      AS unique_sessions,
      COUNT(DISTINCT wallet) FILTER (WHERE wallet IS NOT NULL)        AS wallet_clicks,
      COUNT(*)               FILTER (WHERE converted = true)          AS conversions,
      COALESCE(SUM(converted_usd) FILTER (WHERE converted = true), 0) AS referred_usd
    FROM clickthrough_events
    GROUP BY venue
    ORDER BY clicks DESC
  `;

  const by_token = await db`
    SELECT
      token_symbol,
      token_address,
      COUNT(*)                               AS clicks,
      COUNT(*) FILTER (WHERE converted = true) AS conversions,
      COALESCE(SUM(converted_usd) FILTER (WHERE converted = true), 0) AS referred_usd
    FROM clickthrough_events
    WHERE event_type = 'trade_click'
    GROUP BY token_symbol, token_address
    ORDER BY clicks DESC
    LIMIT 20
  `;

  const recent = await db`
    SELECT
      event_type, token_symbol, protocol_slug, venue,
      wallet, session_id, clicked_at, converted, converted_usd, converted_tx
    FROM clickthrough_events
    ORDER BY clicked_at DESC
    LIMIT 100
  `;

  return NextResponse.json({ totals, by_venue, by_token, recent });
}
