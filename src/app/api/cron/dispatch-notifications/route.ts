import { NextRequest, NextResponse } from 'next/server';
import { db, hasDbAccess } from '@/lib/db';
import { recordCronRun } from '@/lib/cron-runs';
import { sendPushNotification } from '@/lib/push';
import { log } from '@/lib/logger';

export const maxDuration = 60;

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\n$/, '');

function isAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  return request.headers.get('authorization') === `Bearer ${cronSecret}`;
}

function formatCutPct(ppm: number): string {
  return `${((ppm / 1_000_000) * 100).toFixed(1)}%`;
}

interface ParamChange {
  id: number;
  indexer_address: string;
  param_name: string;
  old_value: number;
  new_value: number;
}

interface DelegatorRow { delegator: string }
interface SubscriberRow { address: string }
interface InactiveIndexer { address: string; name: string | null }

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!hasDbAccess()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const startedAt = new Date();
  const start = Date.now();
  let notified = 0;

  try {
    const subscribers = await db!`
      SELECT address FROM push_subscriptions WHERE is_active = TRUE
    ` as unknown as SubscriberRow[];

    const subscriberSet = new Set(subscribers.map((r) => r.address));

    if (subscriberSet.size === 0) {
      return NextResponse.json({ ok: true, notified: 0, reason: 'no subscribers' });
    }

    const subscriberList = [...subscriberSet];

    // Unnotified parameter changes from the last 24 hours
    const changes = await db!`
      SELECT id, indexer_address, param_name, old_value, new_value
      FROM parameter_changes
      WHERE push_notified = FALSE
        AND created_at >= NOW() - INTERVAL '24 hours'
      ORDER BY created_at ASC
    ` as unknown as ParamChange[];

    // Group changes by indexer
    const byIndexer = new Map<string, ParamChange[]>();
    for (const change of changes) {
      if (!byIndexer.has(change.indexer_address)) byIndexer.set(change.indexer_address, []);
      byIndexer.get(change.indexer_address)!.push(change);
    }

    for (const [indexerAddress, indexerChanges] of byIndexer) {
      const delegators = await db!`
        SELECT DISTINCT delegator
        FROM delegator_positions
        WHERE indexer_address = ${indexerAddress}
          AND delegator = ANY(${subscriberList})
      ` as unknown as DelegatorRow[];

      const changeIds = indexerChanges.map((c) => c.id);

      if (delegators.length === 0) {
        await db!`UPDATE parameter_changes SET push_notified = TRUE WHERE id = ANY(${changeIds})`;
        continue;
      }

      const recipients = delegators.map((d) => d.delegator);
      const lines = indexerChanges.map((c) => {
        const label = c.param_name === 'reward_cut' ? 'Reward cut' : 'Query fee cut';
        return `${label}: ${formatCutPct(c.old_value)} → ${formatCutPct(c.new_value)}`;
      });

      const shortAddr = `${indexerAddress.slice(0, 6)}…${indexerAddress.slice(-4)}`;
      const title = `Indexer cut changed — ${shortAddr}`;
      const body = lines.join(' · ');
      const cta = SITE_URL ? `${SITE_URL}/indexers/${indexerAddress}` : undefined;

      try {
        await sendPushNotification(recipients, title, body, cta);
        notified += recipients.length;
        await db!`
          INSERT INTO notification_log (event_type, indexer_address, recipient_count, details)
          VALUES ('cut_change', ${indexerAddress}, ${recipients.length}, ${JSON.stringify({ changes: indexerChanges, recipients })})
        `;
      } catch (err) {
        log.cron.error({ err, indexerAddress }, 'Push notification send failed');
      }

      await db!`UPDATE parameter_changes SET push_notified = TRUE WHERE id = ANY(${changeIds})`;
    }

    // Inactive indexer notifications
    const newlyInactive = await db!`
      SELECT address, name FROM indexers
      WHERE is_active = FALSE
        AND updated_at >= NOW() - INTERVAL '20 minutes'
    ` as unknown as InactiveIndexer[];

    for (const indexer of newlyInactive) {
      const delegators = await db!`
        SELECT DISTINCT delegator
        FROM delegator_positions
        WHERE indexer_address = ${indexer.address}
          AND delegator = ANY(${subscriberList})
      ` as unknown as DelegatorRow[];

      if (delegators.length === 0) continue;

      const recipients = delegators.map((d) => d.delegator);
      const label = indexer.name ?? `${indexer.address.slice(0, 6)}…${indexer.address.slice(-4)}`;
      const title = `Indexer went inactive — ${label}`;
      const body = 'This indexer has no active allocations. Consider redelegating.';
      const cta = SITE_URL ? `${SITE_URL}/indexers/${indexer.address}` : undefined;

      try {
        await sendPushNotification(recipients, title, body, cta);
        notified += recipients.length;
        await db!`
          INSERT INTO notification_log (event_type, indexer_address, recipient_count, details)
          VALUES ('indexer_inactive', ${indexer.address}, ${recipients.length}, ${JSON.stringify({ recipients })})
        `;
      } catch (err) {
        log.cron.error({ err, indexerAddress: indexer.address }, 'Push inactive notification failed');
      }
    }

    const durationMs = Date.now() - start;
    log.cron.info({ step: 'dispatch-notifications', notified, durationMs }, 'Notifications dispatched');

    await recordCronRun(db!, {
      step: 'dispatch-notifications',
      startedAt,
      durationMs,
      rowsAffected: notified,
      success: true,
    });

    return NextResponse.json({ ok: true, notified, durationMs });
  } catch (error) {
    const durationMs = Date.now() - start;
    log.cron.error({ err: error, step: 'dispatch-notifications', durationMs }, 'Notification dispatch failed');

    await recordCronRun(db!, {
      step: 'dispatch-notifications',
      startedAt,
      durationMs,
      success: false,
      errorMessage: String(error),
    });

    return NextResponse.json({ error: 'Dispatch failed' }, { status: 500 });
  }
}
