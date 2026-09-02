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

/**
 * Arbitrum One. Reconciled 2026-09-02 against `packages/issuance/addresses.json` in
 * graphprotocol/contracts, chain 42161, rather than against a previous reading of this file.
 */
const ADDR = {
  issuanceAllocator: '0xb64f29b2d81140ffc3a135e319561a1bd03b1a7e',
  agreementManager: '0x51f860b03dee6a6ea27392dcceccd908204149f2',
  recurringCollector: '0xff0dc7310fbfbcc2524dae230cd4f34727eb84ee',
  /** The indexing-agreement side of the split. Zero today; non-zero means DIPS is funding indexers. */
  defaultAllocation: '0x28cd50e9e02856908f4c1966ab035b1f6c4dde1e',
  rewardsManager: '0x971b9d3d0ae3eca029cab5ea1fb0f72c85e6a525',
  /**
   * GIP-0089. The roadmap carried this as "on Sepolia only today, watch for it on mainnet".
   * It arrived: it is in the mainnet address book and holds 24.146 GRT/block, a fifth of all
   * issuance. Before it was labelled here the panel rendered it as a bare hex string, which is
   * how a fifth of issuance can sit on a dashboard for days looking like noise.
   */
  innovationAllocation: '0x2ff06ba8086f37ba656a5b75405bf985f738b16e',
  reclaimedRewards: '0xe26cdc4ef915d12551ea67a7cbb838e91a24bb37',
} as const;

const LABELS: Record<string, string> = {
  [ADDR.defaultAllocation]: 'Indexing agreements (DefaultAllocation)',
  [ADDR.rewardsManager]: 'Indexing rewards (RewardsManager)',
  [ADDR.innovationAllocation]: 'Innovation allocation (GIP-0089)',
  [ADDR.reclaimedRewards]: 'Reclaimed rewards',
  [ADDR.issuanceAllocator]: 'Issuance Allocator',
  [ADDR.agreementManager]: 'Recurring Agreement Manager',
  [ADDR.recurringCollector]: 'Recurring Collector',
  '0x02753bae61c08abd4351bce7f48524935c2cc78e': 'Rewards Eligibility Oracle A',
  '0xeebc4919a239c1315a7e0652e692812719bad591': 'Rewards Eligibility Oracle B',
  '0xae656a0aa51cd465b7506f98f2e8fbb82aa79894': 'Network Operator',
  '0x7700d56d2cfafa620048633b2586b063ecd93dd1': 'Innovation Operator',
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
  self_minting_rate_dec: string | null;
  allocator_minting_rate_dec: string | null;
  block_number: number;
  block_timestamp: number;
}

/**
 * The most recent issuance actually delivered to a target.
 *
 * A configured rate and a delivered one are different claims. The panel has always shown the
 * first; a rate set but never distributed would read as Live with nothing flowing, which is a
 * quieter version of the failure this whole panel exists to catch.
 */
interface DistributionRow {
  target: string;
  block_number: number;
  block_timestamp: number;
  amount_dec: string | null;
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
  /** GRT per block allocated to this target, whoever does the minting. */
  rate: number;
  /** Share of total issuance, 0-100. */
  sharePct: number;
  /**
   * True when the target mints its own share rather than receiving it from the allocator. A
   * mechanism, not an amount: `rate` is the same either way.
   */
  selfMinting: boolean;
  /**
   * Unix seconds of the most recent issuance actually delivered to this target, by either
   * mechanism. Null means a rate is configured and nothing has ever been seen to move under it,
   * which is not the same as a rate of zero.
   */
  lastDistributedAt: number | null;
  /**
   * True when this target has a non-zero configured rate and no delivery has ever been observed.
   * The gap between what governance set and what the chain did.
   */
  configuredNotDistributed: boolean;
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
      // Latest delivery per target, for each of the two mechanisms. The join is the same shape
      // the nest's own `dips_current_allocation` view uses, so it is known to work on this engine
      // rather than assumed to. All four reads share one `/ready` probe.
      const latestPerTarget = (table: string) =>
        `SELECT d.target, d.block_number, d.block_timestamp, d.amount_dec ` +
        `FROM "${table}" d ` +
        `JOIN (SELECT target AS t, max(block_number) AS bn FROM "${table}" GROUP BY target) l ` +
        `ON d.target = l.t AND d.block_number = l.bn`;

      const [alloc, timelineRes, sent, selfMinted] = await Promise.all([
        nuthatchSqlReady<AllocationRow>('SELECT * FROM dips_current_allocation', '/dips'),
        nuthatchSqlReady<TimelineRow>('SELECT * FROM dips_timeline ORDER BY block_number', '/dips'),
        nuthatchSqlReady<DistributionRow>(
          latestPerTarget('issuance_allocator__issuance_distributed'), '/dips'),
        nuthatchSqlReady<DistributionRow>(
          latestPerTarget('issuance_allocator__issuance_self_mint_allowance'), '/dips'),
      ]);
      if (!alloc.ok) throw Object.assign(new Error(alloc.error), { nest: alloc });
      if (!timelineRes.ok) throw Object.assign(new Error(timelineRes.error), { nest: timelineRes });
      if (!sent.ok) throw Object.assign(new Error(sent.error), { nest: sent });
      if (!selfMinted.ok) throw Object.assign(new Error(selfMinted.error), { nest: selfMinted });
      const allocRows = alloc.data.rows;
      const timelineRows = timelineRes.data.rows;

      // Either mechanism counts as delivery; keep whichever happened later.
      const deliveredAt = new Map<string, number>();
      for (const r of [...sent.data.rows, ...selfMinted.data.rows]) {
        const t = r.target?.toLowerCase();
        if (!t) continue;
        const ts = Number(r.block_timestamp ?? 0);
        deliveredAt.set(t, Math.max(deliveredAt.get(t) ?? 0, ts));
      }

      const observed = new Map(allocRows.map((r) => [r.target.toLowerCase(), r]));

      // A target's share of issuance is `allocatorMintingRate + selfMintingRate`. The two are
      // mechanism, not amount: the allocator either mints the share and sends it, or the target
      // mints its own. The contract exposes the sum as `totalAllocationRate`, but the
      // TargetAllocationUpdated event carries only the two parts, so the view adds them back.
      //
      // This panel used to sum the self rates alone. On 2026-09-02 that put InnovationAllocation
      // at 0.00 and 0% while it was in fact drawing 24.146 GRT/block, a fifth of all issuance,
      // through the allocator-minted side — and understated the total as 96.584 against 120.73.
      // Reading only the allocator side instead is the same bug facing the other way: it would
      // zero the RewardsManager, which self-mints its entire 96.584.
      //
      // The check that this reading is right, confirmed over RPC: the per-target sums must equal
      // `getIssuancePerBlock()`, and they do, at 120.73 exactly.
      const grt = (v: string | null | undefined) => (v ? Number(v) / GRT : 0);
      const rateOf = (r: AllocationRow) =>
        grt(r.allocator_minting_rate_dec) + grt(r.self_minting_rate_dec);
      const totalRate = allocRows.reduce((sum, r) => sum + rateOf(r), 0);

      // Every target we want on the chart, whether or not it has ever emitted an allocation event.
      const targets = new Set([
        ...observed.keys(),
        ADDR.defaultAllocation,
        ADDR.rewardsManager,
      ]);

      const allocations: DipsAllocation[] = [...targets]
        .map((target) => {
          const row = observed.get(target);
          const rate = row ? rateOf(row) : 0;
          const lastDistributedAt = deliveredAt.get(target) ?? null;
          return {
            target,
            label: LABELS[target] ?? target,
            rate,
            sharePct: totalRate > 0 ? (rate / totalRate) * 100 : 0,
            selfMinting: row ? grt(row.self_minting_rate_dec) > 0 : false,
            lastDistributedAt,
            configuredNotDistributed: rate > 0 && lastDistributedAt == null,
            observed: Boolean(row),
          };
        })
        .sort((a, b) => b.rate - a.rate);

      // Either field going positive means indexing agreements are funded, and the sum covers
      // both, so the panel cannot miss the flip by having watched the wrong column.
      const agreementRow = observed.get(ADDR.defaultAllocation);
      const agreementRate = agreementRow ? rateOf(agreementRow) : 0;

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
        /**
         * Targets carrying a configured rate that nothing has ever been seen to deliver under.
         * Empty is the healthy answer; a name here means governance set a rate and the chain has
         * not acted on it, which no amount of staring at the rate itself would reveal.
         */
        configuredNotDistributed: allocations
          .filter((a) => a.configuredNotDistributed)
          .map((a) => a.target),
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
