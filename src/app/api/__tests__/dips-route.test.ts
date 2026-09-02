/**
 * Contract tests for /api/dips.
 *
 * This route has no fallback by design: nothing else indexes the three Direct Indexer Payments
 * contracts, so there is no second source to disagree with it. That makes the failure modes worth
 * pinning the quiet ones rather than the loud ones.
 *
 * The load-bearing behaviour is the distinction between a measured zero and an absent one.
 * `DefaultAllocation` has never emitted `TargetAllocationUpdated`, so its zero is an absence. The
 * whole panel exists to answer "has governance flipped the switch yet", and a dashboard that
 * renders an absence as a confident zero cannot tell you the difference between "not yet" and
 * "we stopped looking".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/cache', () => ({
  cached: vi.fn((_key: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher()),
}));

vi.mock('@/lib/logger', () => ({
  log: { api: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } },
}));

const mockEnabled = vi.fn(() => true);
const mockSqlReady = vi.fn();
vi.mock('@/lib/nuthatch', () => ({
  nuthatchEnabled: () => mockEnabled(),
  nuthatchSqlReady: (...args: unknown[]) => mockSqlReady(...args),
}));

import { GET } from '../dips/route';

const DEFAULT_ALLOCATION = '0x28cd50e9e02856908f4c1966ab035b1f6c4dde1e';
const REWARDS_MANAGER = '0x971b9d3d0ae3eca029cab5ea1fb0f72c85e6a525';
const INNOVATION_ALLOCATION = '0x2ff06ba8086f37ba656a5b75405bf985f738b16e';

const GRT = 1e18;

const wei = (grt: number) => String(BigInt(Math.round(grt * 1e6)) * BigInt(GRT / 1e6));

/**
 * One `dips_current_allocation` row. A target's share of issuance is `allocator + self`; which
 * of the two carries it says only who does the minting.
 */
function alloc(target: string, allocator: number, self = 0) {
  return {
    target,
    self_minting_rate_dec: wei(self),
    allocator_minting_rate_dec: wei(allocator),
    block_number: 12_000_000,
    block_timestamp: 1_756_000_000,
  };
}

/**
 * Arbitrum One as it actually stood on 2026-09-02, read from the IssuanceAllocator over RPC:
 * getIssuancePerBlock() = 120.73, split between a target that self-mints its whole share and one
 * that is sent its share by the allocator. DefaultAllocation is registered nowhere and draws zero.
 */
const MAINNET = [
  alloc(REWARDS_MANAGER, 0, 96.584),
  alloc(INNOVATION_ALLOCATION, 24.146, 0),
];

const TIMELINE = [
  {
    block_number: 11_000_000,
    block_timestamp: 1_753_000_000,
    tx_hash: '0xaaa',
    step: 'issuance_rate_set',
    subject: REWARDS_MANAGER,
    rate_dec: String(BigInt(120) * BigInt(GRT)),
  },
  {
    block_number: 11_500_000,
    block_timestamp: 1_756_100_000,
    tx_hash: '0xbbb',
    step: 'target_allocation_set',
    subject: DEFAULT_ALLOCATION,
    rate_dec: null,
  },
];

/** Answer the two queries the route makes, dispatching on which table they name. */
function nest(allocations: unknown[], timeline: unknown[] = TIMELINE) {
  mockSqlReady.mockImplementation(async (sql: string) => ({
    ok: true,
    data: {
      count: 0,
      rows: sql.includes('dips_current_allocation') ? allocations : timeline,
    },
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnabled.mockReturnValue(true);
});

describe('/api/dips', () => {
  it('reports unavailable and never touches the nest when the flag is off', async () => {
    mockEnabled.mockReturnValue(false);

    const body = await (await GET()).json();

    expect(body.data).toEqual({ available: false });
    expect(mockSqlReady).not.toHaveBeenCalled();
  });

  it('marks an allocation absent rather than zero when no event has ever set it', async () => {
    // Issuance is flowing, but only to the RewardsManager. DefaultAllocation has never been
    // named by a TargetAllocationUpdated event.
    nest([alloc(REWARDS_MANAGER, 120.73)]);

    const { data } = await (await GET()).json();

    const agreements = data.allocations.find(
      (a: { target: string }) => a.target === DEFAULT_ALLOCATION,
    );
    expect(agreements.rate).toBe(0);
    expect(agreements.observed).toBe(false);

    const rewards = data.allocations.find(
      (a: { target: string }) => a.target === REWARDS_MANAGER,
    );
    expect(rewards.observed).toBe(true);
    expect(rewards.rate).toBeCloseTo(120.73, 6);
    expect(rewards.sharePct).toBeCloseTo(100, 6);
  });

  it('reads as armed, not live, while the agreement allocation is zero', async () => {
    nest(MAINNET);

    const { data } = await (await GET()).json();

    expect(data.available).toBe(true);
    expect(data.agreementRate).toBe(0);
    expect(data.live).toBe(false);
  });

  it('counts a share whichever field carries it, and totals to issuance per block', async () => {
    // The regression this pins: summing `selfMintingRate` alone rendered InnovationAllocation at
    // 0.00 and 0% while it drew 24.146 GRT/block, and put the total at 96.584 against a real
    // 120.73. Reading only the allocator field is the same bug reversed — it zeroes the
    // RewardsManager. The invariant is that the shares sum to getIssuancePerBlock().
    nest(MAINNET);

    const { data } = await (await GET()).json();

    expect(data.totalRate).toBeCloseTo(120.73, 6);

    const rewards = data.allocations.find((a: { target: string }) => a.target === REWARDS_MANAGER);
    expect(rewards.rate).toBeCloseTo(96.584, 6);
    expect(rewards.sharePct).toBeCloseTo(80, 4);
    expect(rewards.selfMinting).toBe(true);

    const innovation = data.allocations.find(
      (a: { target: string }) => a.target === INNOVATION_ALLOCATION,
    );
    expect(innovation.rate).toBeCloseTo(24.146, 6);
    expect(innovation.sharePct).toBeCloseTo(20, 4);
    expect(innovation.selfMinting).toBe(false);
  });

  it('labels InnovationAllocation rather than showing a bare address', async () => {
    // GIP-0089 landed on mainnet holding a fifth of all issuance. Unlabelled, it read as noise.
    nest(MAINNET);

    const { data } = await (await GET()).json();

    const innovation = data.allocations.find(
      (a: { target: string }) => a.target === INNOVATION_ALLOCATION,
    );
    expect(innovation.label).toBe('Innovation allocation (GIP-0089)');
  });

  it('goes live when the agreement allocation moves on the allocator-minted field alone', async () => {
    // Governance can fund DefaultAllocation through either field. Watching only the self-minting
    // column would be a coin-flip on noticing the single event this panel exists for.
    nest([...MAINNET, alloc(DEFAULT_ALLOCATION, 12, 0)]);

    const { data } = await (await GET()).json();

    expect(data.live).toBe(true);
    expect(data.agreementRate).toBeCloseTo(12, 6);
  });

  it('goes live the moment the agreement allocation is observed above zero', async () => {
    // The one state change this whole panel exists to catch.
    nest([alloc(REWARDS_MANAGER, 0, 100), alloc(DEFAULT_ALLOCATION, 20, 0)]);

    const { data } = await (await GET()).json();

    expect(data.live).toBe(true);
    expect(data.agreementRate).toBeCloseTo(20, 6);
    expect(data.totalRate).toBeCloseTo(120, 6);
    const agreements = data.allocations.find(
      (a: { target: string }) => a.target === DEFAULT_ALLOCATION,
    );
    expect(agreements.observed).toBe(true);
    expect(agreements.sharePct).toBeCloseTo(16.666_666, 4);
  });

  it('labels the timeline and scales its rates out of wei', async () => {
    nest([alloc(REWARDS_MANAGER, 120.73)]);

    const { data } = await (await GET()).json();

    expect(data.timeline).toHaveLength(2);
    expect(data.timeline[0].label).toBe('Allocator issuance rate set');
    expect(data.timeline[0].subjectLabel).toBe('Indexing rewards (RewardsManager)');
    expect(data.timeline[0].rate).toBeCloseTo(120, 6);
    // No rate on this step, which is not the same as a rate of zero.
    expect(data.timeline[1].rate).toBeNull();
    expect(data.lastConfiguredAt).toBe(1_756_100_000);
  });

  it('passes an unknown step through unlabelled rather than dropping it', async () => {
    // A step this dashboard has no label for is still a configuration change somebody needs
    // to see. Hiding it would make the timeline quietly incomplete.
    nest(
      [alloc(REWARDS_MANAGER, 120.73)],
      [{ ...TIMELINE[0], step: 'some_new_governance_step' }],
    );

    const { data } = await (await GET()).json();

    expect(data.timeline).toHaveLength(1);
    expect(data.timeline[0].label).toBe('some_new_governance_step');
  });

  it('reports null rather than a timestamp when nothing has been configured', async () => {
    nest([alloc(REWARDS_MANAGER, 120.73)], []);

    const { data } = await (await GET()).json();

    expect(data.lastConfiguredAt).toBeNull();
  });

  it('refuses with 503 and the nest reason when the nest is not ready', async () => {
    // The #1080 failure: a stalled nest answering 200 with three-week-old rows. It must
    // surface as an error, never as a confident zero.
    mockSqlReady.mockResolvedValue({
      ok: false,
      status: 503,
      error: 'nest is not ready: stalled',
      reason: 'stalled: it is running but no longer following the chain',
    });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error).toMatch(/not ready/);
    expect(body.reason).toMatch(/stalled/);
    expect(body.data).toBeUndefined();
  });

  it('returns 500 without leaking internals when the nest read throws', async () => {
    mockSqlReady.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8104'));

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('Failed to load DIPS state');
    expect(JSON.stringify(body)).not.toContain('127.0.0.1');
  });
});
