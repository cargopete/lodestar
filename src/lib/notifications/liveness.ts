import type { DbClient } from '../db';
import { apnsConfigured, sendToAddress } from '../apns';
import {
  arbitrumClient,
  fetchRegistry,
  isRegistryLying,
  probeRegistry,
  type ProviderLiveness,
} from '../dispatch-liveness';

// Registry-versus-reality alerting.
//
// The failure this exists for went unnoticed for 39 days: two providers registered and active
// on-chain, zero endpoints answering. Nothing alerted because nothing was watching the thing that
// actually broke. On-chain state is not liveness.
//
// EDGE-TRIGGERED, like check-subgraph-health: a notification fires only when a provider's serving
// state CHANGES. A permanently dead provider must not push every fifteen minutes forever, or the
// alert becomes noise and the next real outage is ignored along with it.

const SUBJECT = '0x7101d5c1a5c89c3647f5118da118e56c023ba0b9';

export interface LivenessDispatchResult {
  registered: number;
  serving: number;
  lying: number;
  /** Providers whose serving state changed this run. */
  transitions: { address: string; serving: boolean }[];
  seeded: boolean;
  delivered: number;
}

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

/** Last known serving state per provider, from the notification log. */
async function lastKnown(sql: DbClient): Promise<Map<string, boolean> | null> {
  const rows = await sql<{ details: { states?: Record<string, boolean> } | null }[]>`
    SELECT details FROM notification_log
    WHERE event_type = 'provider_liveness'
    ORDER BY notified_at DESC LIMIT 1
  `;
  const states = rows[0]?.details?.states;
  return states ? new Map(Object.entries(states)) : null;
}

export async function dispatchLivenessNotifications(
  sql: DbClient
): Promise<LivenessDispatchResult> {
  const registry = await fetchRegistry(arbitrumClient());
  const providers: ProviderLiveness[] = await probeRegistry(registry);

  const serving = providers.filter((p) => p.serving).length;
  const lying = providers.filter(isRegistryLying).length;
  const states = Object.fromEntries(providers.map((p) => [p.address, p.serving]));

  const record = async (transitions: { address: string; serving: boolean }[], recipients: number) =>
    sql`
      INSERT INTO notification_log (event_type, indexer_address, recipient_count, details)
      VALUES ('provider_liveness', ${SUBJECT}, ${recipients}, ${sql.json({
        states,
        transitions,
        serving,
        lying,
      })})
    `;

  const previous = await lastKnown(sql);

  // First run records the baseline and says nothing. Announcing a 39-day-old outage as breaking
  // news would be both wrong and, worse, the kind of wrong that trains people to ignore the alert.
  if (previous === null) {
    await record([], 0);
    return { registered: providers.length, serving, lying, transitions: [], seeded: true, delivered: 0 };
  }

  const transitions = providers
    .filter((p) => previous.has(p.address) && previous.get(p.address) !== p.serving)
    .map((p) => ({ address: p.address, serving: p.serving }));

  let delivered = 0;
  if (transitions.length > 0 && apnsConfigured()) {
    const recipients = await sql<{ address: string }[]>`
      SELECT address FROM push_subscriptions WHERE is_active
    `;
    const recovered = transitions.filter((t) => t.serving);
    const lost = transitions.filter((t) => !t.serving);
    const body = [
      lost.length > 0 && `${lost.map((t) => shortAddr(t.address)).join(', ')} stopped answering.`,
      recovered.length > 0 &&
        `${recovered.map((t) => shortAddr(t.address)).join(', ')} is serving again.`,
      `${serving}/${providers.length} registered providers now answer.`,
    ]
      .filter(Boolean)
      .join(' ');

    for (const r of recipients) {
      delivered += await sendToAddress(r.address, {
        title: lost.length > 0 ? 'Dispatch provider went dark' : 'Dispatch provider recovered',
        body,
        path: '/data-services',
        collapseId: `provider-liveness-${Date.now()}`,
      });
    }
    await record(transitions, recipients.length);
  } else if (transitions.length > 0) {
    // APNs unconfigured: still record the new baseline, or the transition fires forever.
    await record(transitions, 0);
  }

  return { registered: providers.length, serving, lying, transitions, seeded: false, delivered };
}
