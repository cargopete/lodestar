import type { DbClient } from '../db';
import { apnsConfigured, sendToAddress } from '../apns';
import { nuthatchSql } from '../nuthatch';
import {
  ISSUANCE_ALLOCATOR,
  compareAllocations,
  readChainState,
  type Divergence,
  type NestAllocationRow,
} from '../dips-chain';

// Alerting when the DIPS nest and the chain it indexes stop agreeing.
//
// Edge-triggered, for the same reason as `nest-health.ts`: a divergence that has stood for a week
// must not push every hour, or the alert becomes wallpaper and the next real one is ignored with
// it. The signature of the current divergence set is stored in `notification_log` and only a change
// to that signature notifies.
//
// The first run seeds and says nothing, which is the same rule `check-dips` follows. Announcing a
// divergence that began before anything was watching is a false alarm about history.

const SUBJECT = ISSUANCE_ALLOCATOR;
const EVENT = 'dips_chain_divergence';

export interface DipsChainDispatchResult {
  /** Targets the allocator currently lists. */
  chainTargets: number;
  /** Rows the nest currently holds. */
  nestRows: number;
  divergences: Divergence[];
  /** Whether this run recorded a baseline instead of notifying. */
  seeded: boolean;
  /** Whether the divergence set differs from the last recorded one. */
  changed: boolean;
  delivered: number;
  skipped?: string;
}

/**
 * A stable identity for a set of divergences, so "still broken in exactly the same way" is
 * distinguishable from "broken differently now". Sorted, because neither the allocator's target
 * order nor the nest's row order is guaranteed and a reordering is not a change.
 */
export function signature(divergences: Divergence[]): string {
  return divergences
    .map((d) => `${d.kind}:${d.target}:${d.chain ?? ''}:${d.nest ?? ''}`)
    .sort()
    .join('|');
}

async function lastSignature(sql: DbClient): Promise<string | null> {
  const rows = await sql<{ details: { signature?: string } | null }[]>`
    SELECT details FROM notification_log
    WHERE event_type = ${EVENT}
    ORDER BY notified_at DESC LIMIT 1
  `;
  return rows[0]?.details?.signature ?? null;
}

/** Reads both sides and alerts when they stop agreeing. */
export async function dispatchDipsChainNotifications(
  sql: DbClient,
): Promise<DipsChainDispatchResult> {
  const [chain, nestRows] = await Promise.all([
    readChainState(),
    nuthatchSql<NestAllocationRow>('SELECT * FROM dips_current_allocation', '/dips'),
  ]);

  const divergences = compareAllocations(chain, nestRows);
  const sig = signature(divergences);

  const base = {
    chainTargets: chain.targets.length,
    nestRows: nestRows.length,
    divergences,
  };

  const record = (recipients: number) => sql`
    INSERT INTO notification_log (event_type, indexer_address, recipient_count, details)
    VALUES (${EVENT}, ${SUBJECT}, ${recipients}, ${sql.json({
      signature: sig,
      divergences: divergences.map((d) => ({ kind: d.kind, target: d.target, detail: d.detail })),
      issuancePerBlock: chain.issuancePerBlock.toString(),
    })})
  `;

  const previous = await lastSignature(sql);

  // First run: record where things stand, announce nothing.
  if (previous === null) {
    await record(0);
    return { ...base, seeded: true, changed: false, delivered: 0 };
  }

  if (sig === previous) {
    return { ...base, seeded: false, changed: false, delivered: 0 };
  }

  // Agreement restored. Worth recording so the next divergence is a fresh edge, but not worth
  // waking anybody at three in the morning.
  if (divergences.length === 0) {
    await record(0);
    return { ...base, seeded: false, changed: true, delivered: 0 };
  }

  if (!apnsConfigured()) {
    // Record the new baseline anyway, or this divergence re-fires every hour once APNs lands.
    await record(0);
    return { ...base, seeded: false, changed: true, delivered: 0, skipped: 'apns unconfigured' };
  }

  const recipients = await sql<{ address: string }[]>`
    SELECT address FROM push_subscriptions WHERE is_active
  `;

  const body = divergences
    .slice(0, 3)
    .map((d) => d.detail)
    .join(' ');

  let delivered = 0;
  for (const r of recipients) {
    delivered += await sendToAddress(r.address, {
      title: 'DIPS nest disagrees with the chain',
      body:
        divergences.length > 3
          ? `${body} (+${divergences.length - 3} more)`
          : body,
      path: '/',
      collapseId: `${EVENT}-${sig.length}-${divergences.length}`,
    });
  }

  await record(recipients.length);
  return { ...base, seeded: false, changed: true, delivered };
}
