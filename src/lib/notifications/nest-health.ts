import type { DbClient } from '../db';
import { apnsConfigured, sendToAddress } from '../apns';
import { hasNestOrigin, probeAllNests, type NestHealth } from '../nest-health';
import { SQL_DATASETS } from '../sql-datasets';

// Alerting on the nests this dashboard runs on.
//
// Modelled on `liveness.ts` deliberately, down to the edge-triggering: a nest that has been down
// for a week must not push every fifteen minutes forever, or the alert becomes noise and the next
// real outage is ignored along with it. Same reason, same shape.
//
// The subject key is a label rather than an address because these are our own nests, not on-chain
// providers. The notification_log schema wants something in that column and inventing a fake
// address would put a lie in a table other code reads.

const SUBJECT = 'nuthatch-nests';

export interface NestHealthDispatchResult {
  nests: number;
  ready: number;
  /** Nests whose readiness changed this run. */
  transitions: { id: string; ready: boolean }[];
  seeded: boolean;
  delivered: number;
  skipped?: string;
}

async function lastKnown(sql: DbClient): Promise<Map<string, boolean> | null> {
  const rows = await sql<{ details: { states?: Record<string, boolean> } | null }[]>`
    SELECT details FROM notification_log
    WHERE event_type = 'nest_health'
    ORDER BY notified_at DESC LIMIT 1
  `;
  const states = rows[0]?.details?.states;
  return states ? new Map(Object.entries(states)) : null;
}

/** A line an operator can act on: which nest, and how far behind. */
function describe(n: NestHealth): string {
  if (n.ready) return `${n.label} is answering again`;
  if (n.lagBlocks != null) return `${n.label} is ${n.lagBlocks.toLocaleString()} blocks behind`;
  return `${n.label} is ${n.reason ?? 'not ready'}`;
}

export async function dispatchNestHealthNotifications(
  sql: DbClient
): Promise<NestHealthDispatchResult> {
  if (!hasNestOrigin()) {
    return { nests: 0, ready: 0, transitions: [], seeded: false, delivered: 0, skipped: 'no nuthatch origin' };
  }

  // Archival nests are excluded, not because their state is uninteresting but because it never
  // changes: a frozen archive reports `stalled` for ever and is correct to. Alerting on one would
  // fire on the first run and every run after it, and an alert that is always on is an alert
  // nobody reads. Found on the first real probe: `legacy-flows` is
  // `graph-staking-legacy-readonly.service`, a deliberate full-history shadow.
  const watched = SQL_DATASETS.filter((d) => !d.archival);
  const nests = await probeAllNests(watched);
  const ready = nests.filter((n) => n.ready).length;
  const states = Object.fromEntries(nests.map((n) => [n.id, n.ready]));

  const record = async (transitions: { id: string; ready: boolean }[], recipients: number) =>
    sql`
      INSERT INTO notification_log (event_type, indexer_address, recipient_count, details)
      VALUES ('nest_health', ${SUBJECT}, ${recipients}, ${sql.json({
        states,
        transitions,
        ready,
        nests: nests.map((n) => ({ id: n.id, ready: n.ready, lagBlocks: n.lagBlocks ?? null })),
      })})
    `;

  const previous = await lastKnown(sql);

  // First run records the baseline and says nothing. Announcing an outage that started before
  // anything was watching would be both wrong and, worse, the kind of wrong that trains people to
  // ignore the alert.
  if (previous === null) {
    await record([], 0);
    return { nests: nests.length, ready, transitions: [], seeded: true, delivered: 0 };
  }

  const transitions = nests
    .filter((n) => previous.has(n.id) && previous.get(n.id) !== n.ready)
    .map((n) => ({ id: n.id, ready: n.ready }));

  let delivered = 0;
  if (transitions.length > 0 && apnsConfigured()) {
    const recipients = await sql<{ address: string }[]>`
      SELECT address FROM push_subscriptions WHERE is_active
    `;
    const byId = new Map(nests.map((n) => [n.id, n]));
    const lost = transitions.filter((t) => !t.ready);
    const body = [
      ...transitions.map((t) => describe(byId.get(t.id)!)),
      `${ready}/${nests.length} nests ready.`,
    ].join(' ');

    for (const r of recipients) {
      delivered += await sendToAddress(r.address, {
        title: lost.length > 0 ? 'A nuthatch nest went dark' : 'Nest recovered',
        body,
        path: '/sql',
        collapseId: `nest-health-${Date.now()}`,
      });
    }
    await record(transitions, recipients.length);
  } else if (transitions.length > 0) {
    // APNs unconfigured: still record the new baseline, or the transition fires forever.
    await record(transitions, 0);
  }

  return { nests: nests.length, ready, transitions, seeded: false, delivered };
}
