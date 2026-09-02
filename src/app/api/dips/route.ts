import { NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { nuthatchEnabled, nuthatchSqlReady } from '@/lib/nuthatch';
import { log } from '@/lib/logger';

// No request argument, so Next would statically cache this at build time and freeze the data
// source. `cached()` below is the real cache.
export const dynamic = 'force-dynamic';

/**
 * Direct Indexer Payments (DIPS) on Arbitrum One, from the `dips-nest` on the Helsinki box.
 *
 * There is deliberately no subgraph fallback: nothing else indexes these three contracts, which is
 * the entire reason this panel exists. With the nest unconfigured the route reports
 * `available: false` and the panel hides itself, rather than inventing a zero.
 */

/** Arbitrum One, verified 2026-08-28. */
const ADDR = {
  issuanceAllocator: '0xb64f29b2d81140ffc3a135e319561a1bd03b1a7e',
  agreementManager: '0x51f860b03dee6a6ea27392dcceccd908204149f2',
  recurringCollector: '0xff0dc7310fbfbcc2524dae230cd4f34727eb84ee',
  /** The indexing-agreement side of the split. Zero today; non-zero means DIPS is funding indexers. */
  defaultAllocation: '0x28cd50e9e02856908f4c1966ab035b1f6c4dde1e',
  rewardsManager: '0x971b9d3d0ae3eca029cab5ea1fb0f72c85e6a525',
} as const;

const LABELS: Record<string, string> = {
  [ADDR.defaultAllocation]: 'Indexing agreements (DefaultAllocation)',
  [ADDR.rewardsManager]: 'Indexing rewards (RewardsManager)',
  [ADDR.issuanceAllocator]: 'Issuance Allocator',
  [ADDR.agreementManager]: 'Recurring Agreement Manager',
  [ADDR.recurringCollector]: 'Recurring Collector',
  '0x02753bae61c08abd4351bce7f48524935c2cc78e': 'Rewards Eligibility Oracle A',
};

const STEP_LABELS: Record<string, string> = {
  issuance_rate_set: 'Allocator issuance rate set',
  agreement_manager_wired: 'Agreement manager wired to allocator',
  collector_pause_guardian_set: 'Collector pause guardian set',
  eligibility_oracle_set: 'Provider eligibility oracle set',
  default_target_set: 'Default target set',
  target_allocation_set: 'Target allocation set',
};

const GRT = 1e18;

interface AllocationRow {
  target: string;
  self_minting_rate_dec: string;
  allocator_minting_rate_dec: string;
  block_number: number;
  block_timestamp: number;
}

interface TimelineRow {
  block_number: number;
  block_timestamp: number;
  tx_hash: string;
  step: string;
  subject: string;
  rate_dec: string | null;
}

export interface DipsAllocation {
  target: string;
  label: string;
  /** GRT per block. */
  rate: number;
  /** Share of total issuance, 0-100. */
  sharePct: number;
  /**
   * True when the rate is read from an actual TargetAllocationUpdated event rather than inferred.
   * DefaultAllocation has never emitted one, so its zero is an absence, not a measurement — and an
   * absence rendered as a confident zero is exactly how a dashboard lies.
   */
  observed: boolean;
}

export interface DipsStep {
  block: number;
  timestamp: number;
  txHash: string;
  step: string;
  label: string;
  subject: string;
  subjectLabel: string | null;
  rate: number | null;
}

export async function GET() {
  if (!nuthatchEnabled('NUTHATCH_DIPS')) {
    return NextResponse.json({ data: { available: false } });
  }

  try {
    const data = await cached('dips:v1', 300, async () => {
      const [alloc, timelineRes] = await Promise.all([
        nuthatchSqlReady<AllocationRow>('SELECT * FROM dips_current_allocation', '/dips'),
        nuthatchSqlReady<TimelineRow>('SELECT * FROM dips_timeline ORDER BY block_number', '/dips'),
      ]);
      if (!alloc.ok) throw Object.assign(new Error(alloc.error), { nest: alloc });
      if (!timelineRes.ok) throw Object.assign(new Error(timelineRes.error), { nest: timelineRes });
      const allocRows = alloc.data.rows;
      const timelineRows = timelineRes.data.rows;

      const observed = new Map(allocRows.map((r) => [r.target.toLowerCase(), r]));
      const totalRate = allocRows.reduce((sum, r) => sum + Number(r.self_minting_rate_dec) / GRT, 0);

      // Every target we want on the chart, whether or not it has ever emitted an allocation event.
      const targets = new Set([
        ...observed.keys(),
        ADDR.defaultAllocation,
        ADDR.rewardsManager,
      ]);

      const allocations: DipsAllocation[] = [...targets]
        .map((target) => {
          const row = observed.get(target);
          const rate = row ? Number(row.self_minting_rate_dec) / GRT : 0;
          return {
            target,
            label: LABELS[target] ?? target,
            rate,
            sharePct: totalRate > 0 ? (rate / totalRate) * 100 : 0,
            observed: Boolean(row),
          };
        })
        .sort((a, b) => b.rate - a.rate);

      const agreementRate =
        allocations.find((a) => a.target === ADDR.defaultAllocation)?.rate ?? 0;

      const timeline: DipsStep[] = timelineRows.map((r) => ({
        block: Number(r.block_number),
        timestamp: Number(r.block_timestamp),
        txHash: r.tx_hash,
        step: r.step,
        label: STEP_LABELS[r.step] ?? r.step,
        subject: r.subject,
        subjectLabel: LABELS[r.subject?.toLowerCase()] ?? null,
        rate: r.rate_dec ? Number(r.rate_dec) / GRT : null,
      }));

      return {
        available: true,
        /** Total issuance being allocated, GRT per block. */
        totalRate,
        /** GRT per block reaching indexing agreements. Zero until governance moves it. */
        agreementRate,
        /** The whole point: has the switch been flipped? */
        live: agreementRate > 0,
        allocations,
        timeline,
        lastConfiguredAt: timeline.length > 0 ? timeline[timeline.length - 1].timestamp : null,
      };
    });

    return NextResponse.json(
      { data },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900' } }
    );
  } catch (error) {
    log.api.error({ err: error }, 'DIPS route error');
    const nest = (error as { nest?: { error: string; reason?: string; status?: number } }).nest;
    if (nest) {
      return NextResponse.json(
        { error: nest.error, reason: nest.reason },
        { status: nest.status ?? 503 },
      );
    }
    return NextResponse.json({ error: 'Failed to load DIPS state' }, { status: 500 });
  }
}
