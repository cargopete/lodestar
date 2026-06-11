import type { DbClient } from '../db';
import { apnsConfigured, sendToAddress } from '../apns';

// Event → notification dispatch. Phase 1: disputes. When the ingestion writes a
// new dispute (push_notified = FALSE), we alert the subscribed wallets that
// currently delegate to the disputed indexer — a dispute risks slashing, which
// is a direct risk to their delegated stake.
//
// "Currently delegating" is derived from delegation_events (the `delegations`
// aggregate table is unpopulated): net stake = Σ(delegation) − Σ(undelegation)
// per (delegator, indexer); > 0 means an active position. The query runs once
// per active subscriber (a small set), each using idx_delegation_events_delegator.

interface DisputeRow {
  id: string;
  indexer_address: string;
  dispute_type: string | null;
}

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Notifies subscribed delegators of newly-ingested disputes, then marks each
 * dispute notified. Caps per run so a surprise backlog can't fan out unbounded.
 */
export async function dispatchDisputeNotifications(
  sql: DbClient,
): Promise<{ count: number; disputes: number; delivered: number }> {
  // Nothing to deliver to if APNs isn't configured — leave disputes unnotified
  // so they fire once it is, rather than silently marking them done.
  if (!apnsConfigured()) return { count: 0, disputes: 0, delivered: 0 };

  const disputes = await sql<DisputeRow[]>`
    SELECT id, indexer_address, dispute_type
    FROM disputes
    WHERE NOT push_notified
    ORDER BY created_at ASC NULLS FIRST
    LIMIT 50
  `;

  let delivered = 0;

  for (const dispute of disputes) {
    const indexer = dispute.indexer_address.toLowerCase();

    const [meta] = await sql<{ name: string | null; ens_name: string | null }[]>`
      SELECT name, ens_name FROM indexers WHERE lower(address) = ${indexer}
    `;
    const label = meta?.ens_name || meta?.name || shortAddr(indexer);

    const recipients = await sql<{ address: string }[]>`
      SELECT ps.address
      FROM push_subscriptions ps
      WHERE ps.is_active
        AND (
          SELECT COALESCE(SUM(
            CASE de.event_type
              WHEN 'delegation'   THEN de.tokens_grt
              WHEN 'undelegation' THEN -de.tokens_grt
              ELSE 0
            END
          ), 0)
          FROM delegation_events de
          WHERE lower(de.delegator) = ps.address
            AND lower(de.indexer) = ${indexer}
        ) > 0
    `;

    for (const recipient of recipients) {
      delivered += await sendToAddress(recipient.address, {
        title: 'Dispute opened',
        body: `A dispute was opened against ${label}, an indexer you delegate to.`,
        path: `/indexers/${indexer}`,
        collapseId: `dispute-${dispute.id}`,
      });
    }

    await sql`
      INSERT INTO notification_log (event_type, indexer_address, recipient_count, details)
      VALUES ('dispute', ${indexer}, ${recipients.length}, ${sql.json({ disputeId: dispute.id })})
    `;
    await sql`UPDATE disputes SET push_notified = TRUE WHERE id = ${dispute.id}`;
  }

  return { count: disputes.length, disputes: disputes.length, delivered };
}
