/**
 * Send a test webhook for one alert config (Tier 3).
 *
 * POST /api/studio/alerts/[id]/test — owner-scoped. Routes a sample payload
 * through the server (client→webhook is blocked by CORS) so the dev can confirm
 * their Discord/Slack URL works. Returns { ok } from the delivery attempt.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/studio/auth';
import { hasDbAccess } from '@/lib/db';
import { getAlert } from '@/lib/studio/db';
import { sendWebhook } from '@/lib/studio/alerts';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  if (!hasDbAccess()) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const alert = await getAlert(numId, auth.address);
  if (!alert) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const msg = '✅ test alert from Lodestar';
  const result = await sendWebhook(alert.webhook_url, { content: msg, text: msg });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, status: result.status ?? null, error: 'Webhook delivery failed' },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true });
}
