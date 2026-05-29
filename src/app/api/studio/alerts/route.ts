/**
 * Subgraph health alert configs (Tier 3 — webhook alerting for subgraph devs).
 *
 * SIWE-gated console CRUD, mirroring the keys route shape.
 *   GET  — list the caller's alert configs.
 *   POST — create/upsert { deploymentId, label?, webhookUrl, channel?, lagThreshold? }.
 *          Re-adding the same deployment edits the existing config.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/studio/auth';
import { hasDbAccess } from '@/lib/db';
import { createAlert, listAlerts } from '@/lib/studio/db';

const VALID_CHANNELS = new Set(['discord', 'slack', 'webhook']);

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  if (!hasDbAccess()) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const alerts = await listAlerts(auth.address);
  return NextResponse.json({
    alerts: alerts.map((a) => ({
      id: a.id,
      deploymentId: a.deployment_id,
      label: a.label,
      webhookUrl: a.webhook_url,
      channel: a.channel,
      lagThreshold: Number(a.lag_threshold_blocks),
      enabled: a.enabled,
      createdAt: a.created_at,
      lastAlertedAt: a.last_alerted_at,
      lastStatus: a.last_status,
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;
  if (!hasDbAccess()) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const deploymentId =
    typeof body.deploymentId === 'string' ? body.deploymentId.trim() : '';
  if (!deploymentId) {
    return NextResponse.json({ error: 'deploymentId is required' }, { status: 400 });
  }

  if (!isHttpsUrl(body.webhookUrl)) {
    return NextResponse.json({ error: 'webhookUrl must be an https URL' }, { status: 400 });
  }

  const label =
    typeof body.label === 'string' && body.label.trim()
      ? body.label.trim().slice(0, 120)
      : null;

  const channel =
    typeof body.channel === 'string' && VALID_CHANNELS.has(body.channel)
      ? body.channel
      : 'webhook';

  const lagThreshold =
    typeof body.lagThreshold === 'number' && Number.isFinite(body.lagThreshold) && body.lagThreshold > 0
      ? Math.floor(body.lagThreshold)
      : 5000;

  const row = await createAlert(
    auth.address,
    deploymentId,
    label,
    body.webhookUrl,
    channel,
    lagThreshold,
  );

  return NextResponse.json({
    id: row.id,
    deploymentId: row.deployment_id,
    label: row.label,
    webhookUrl: row.webhook_url,
    channel: row.channel,
    lagThreshold: Number(row.lag_threshold_blocks),
    enabled: row.enabled,
    createdAt: row.created_at,
  });
}
