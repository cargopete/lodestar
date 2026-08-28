import type { DbClient } from '../db';
import { apnsConfigured, sendToAddress } from '../apns';
import { nuthatchSql } from '../nuthatch';

// DIPS → notification dispatch. Every Direct Indexer Payments contract is live on Arbitrum One and
// the indexing-agreement allocation is zero, so the whole ecosystem is waiting on a single
// governance transaction. A dashboard only tells you that if somebody happens to be looking at it.
//
// Two events are worth waking someone for:
//   dips_live   — the allocation goes above zero. DIPS is funding indexers. Fires once, ever.
//   dips_config — a new configuration step lands (a target rate changes, a target is registered).
//
// Idempotency comes from notification_log rather than a new table: `dips_live` is a "has it ever
// fired" check, `dips_config` carries the highest block already announced in its details.
//
// FIRST RUN MUST BE SILENT. The timeline already contains six steps, the most recent from
// 2026-08-25. Announcing those as news the first time this cron runs would be a false alarm about
// history, so a run with no prior `dips_config` row records the watermark and notifies nobody.

/** The Issuance Allocator on Arbitrum One. notification_log.indexer_address is NOT NULL, and this
 *  is the honest subject for a protocol-level event that belongs to no indexer. */
const ISSUANCE_ALLOCATOR = '0xb64f29b2d81140ffc3a135e319561a1bd03b1a7e';

/** Reached only via a TargetAllocationUpdated event; absence means zero. */
const DEFAULT_ALLOCATION = '0x28cd50e9e02856908f4c1966ab035b1f6c4dde1e';

const GRT = 1e18;

export interface DipsDispatchResult {
  /** GRT per block currently reaching indexing agreements. */
  agreementRate: number;
  /** Highest configuration block observed in the nest. */
  latestBlock: number;
  /** Whether this run seeded the watermark instead of notifying. */
  seeded: boolean;
  events: string[];
  delivered: number;
}

interface AllocationRow {
  target: string;
  self_minting_rate_dec: string;
}

interface TimelineRow {
  block_number: number;
  step: string;
}

/** Reads the live DIPS state straight from the nest, bypassing the API route's 5-minute cache. */
async function readState(): Promise<{ agreementRate: number; latest: TimelineRow | null }> {
  const [allocations, timeline] = await Promise.all([
    nuthatchSql<AllocationRow>('SELECT * FROM dips_current_allocation', '/dips'),
    nuthatchSql<TimelineRow>(
      'SELECT block_number, step FROM dips_timeline ORDER BY block_number DESC LIMIT 1',
      '/dips'
    ),
  ]);
  const agreement = allocations.find(
    (a) => a.target.toLowerCase() === DEFAULT_ALLOCATION
  );
  return {
    agreementRate: agreement ? Number(agreement.self_minting_rate_dec) / GRT : 0,
    latest: timeline[0] ?? null,
  };
}

/**
 * Notifies every active push subscriber when DIPS goes live, or when its configuration moves.
 * A protocol-wide event, so there is no per-wallet relevance test: it matters to everyone.
 */
export async function dispatchDipsNotifications(sql: DbClient): Promise<DipsDispatchResult> {
  const { agreementRate, latest } = await readState();
  const latestBlock = latest ? Number(latest.block_number) : 0;
  const events: string[] = [];
  let delivered = 0;

  // Leave everything unfired rather than silently marking it done, exactly as the dispute
  // dispatcher does — it should fire once APNs is configured, not be swallowed now.
  if (!apnsConfigured()) {
    return { agreementRate, latestBlock, seeded: false, events, delivered };
  }

  const [liveAlready] = await sql<{ id: number }[]>`
    SELECT id FROM notification_log WHERE event_type = 'dips_live' LIMIT 1
  `;
  const [watermark] = await sql<{ block: number | null }[]>`
    SELECT MAX((details->>'block')::bigint) AS block
    FROM notification_log WHERE event_type = 'dips_config'
  `;

  // First ever run: record where we are, announce nothing.
  if (watermark?.block == null) {
    await sql`
      INSERT INTO notification_log (event_type, indexer_address, recipient_count, details)
      VALUES ('dips_config', ${ISSUANCE_ALLOCATOR}, 0, ${sql.json({ block: latestBlock, seeded: true })})
    `;
    return { agreementRate, latestBlock, seeded: true, events, delivered };
  }

  const recipients = await sql<{ address: string }[]>`
    SELECT address FROM push_subscriptions WHERE is_active
  `;

  async function broadcast(
    eventType: string,
    title: string,
    body: string,
    details: Record<string, string | number | boolean | null>
  ) {
    for (const r of recipients) {
      delivered += await sendToAddress(r.address, {
        title,
        body,
        path: '/',
        collapseId: `${eventType}-${latestBlock}`,
      });
    }
    await sql`
      INSERT INTO notification_log (event_type, indexer_address, recipient_count, details)
      VALUES (${eventType}, ${ISSUANCE_ALLOCATOR}, ${recipients.length}, ${sql.json(details)})
    `;
    events.push(eventType);
  }

  if (agreementRate > 0 && !liveAlready) {
    await broadcast(
      'dips_live',
      'DIPS is live',
      `Direct Indexer Payments are funded: ${agreementRate.toFixed(2)} GRT per block now reaches indexing agreements.`,
      { block: latestBlock, agreementRate }
    );
  }

  if (latestBlock > Number(watermark.block)) {
    await broadcast(
      'dips_config',
      'DIPS configuration changed',
      `A new Direct Indexer Payments configuration step landed at block ${latestBlock}.`,
      { block: latestBlock, step: latest?.step ?? null }
    );
  }

  return { agreementRate, latestBlock, seeded: false, events, delivered };
}
