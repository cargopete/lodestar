import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DbClient } from '@/lib/db';

const sendToAddress = vi.fn();
const apnsConfigured = vi.fn();
const nuthatchSql = vi.fn();

vi.mock('@/lib/apns', () => ({
  apnsConfigured: () => apnsConfigured(),
  sendToAddress: (...args: unknown[]) => sendToAddress(...args),
}));
vi.mock('@/lib/nuthatch', () => ({
  nuthatchSql: (...args: unknown[]) => nuthatchSql(...args),
  nuthatchEnabled: () => true,
}));

import { dispatchDipsNotifications } from '../dips';

const DEFAULT_ALLOCATION = '0x28cd50e9e02856908f4c1966ab035b1f6c4dde1e';
const REWARDS_MANAGER = '0x971b9d3d0ae3eca029cab5ea1fb0f72c85e6a525';

/** A postgres.js-shaped tag that resolves queued result sets in call order. */
function makeSql(queue: unknown[][]) {
  let i = 0;
  const fn = (() => Promise.resolve(queue[i++] ?? [])) as unknown as DbClient;
  (fn as unknown as { json: (x: unknown) => unknown }).json = (x) => x;
  return fn;
}

/** allocations, then the one-row timeline query. */
function nestReturns(allocations: unknown[], timeline: unknown[]) {
  nuthatchSql.mockReset();
  nuthatchSql.mockResolvedValueOnce(allocations).mockResolvedValueOnce(timeline);
}

// Arbitrum One as read over RPC on 2026-09-02: the RewardsManager self-mints its whole 96.584
// and is sent nothing by the allocator.
const ZERO_STATE = [
  {
    target: REWARDS_MANAGER,
    self_minting_rate_dec: '96584000000000000000',
    allocator_minting_rate_dec: '0',
  },
];
const LIVE_STATE = [
  ...ZERO_STATE,
  {
    target: DEFAULT_ALLOCATION,
    self_minting_rate_dec: '6000000000000000000',
    allocator_minting_rate_dec: '0',
  },
];
/** Funded through the allocator alone, which is the case a self-rate-only watcher sleeps through. */
const LIVE_VIA_ALLOCATOR = [
  ...ZERO_STATE,
  {
    target: DEFAULT_ALLOCATION,
    self_minting_rate_dec: '0',
    allocator_minting_rate_dec: '6000000000000000000',
  },
];
const TIMELINE = [{ block_number: 498298724, step: 'target_allocation_set' }];

beforeEach(() => {
  sendToAddress.mockReset().mockResolvedValue(1);
  apnsConfigured.mockReset().mockReturnValue(true);
});

describe('dispatchDipsNotifications', () => {
  it('reports the zero allocation without notifying when APNs is unconfigured', async () => {
    apnsConfigured.mockReturnValue(false);
    nestReturns(ZERO_STATE, TIMELINE);
    const r = await dispatchDipsNotifications(makeSql([]));
    expect(r.agreementRate).toBe(0);
    expect(r.events).toEqual([]);
    expect(sendToAddress).not.toHaveBeenCalled();
  });

  it('SEEDS SILENTLY on the first run so three-day-old history is not announced as news', async () => {
    nestReturns(ZERO_STATE, TIMELINE);
    const r = await dispatchDipsNotifications(
      makeSql([
        [], // no dips_live row
        [{ block: null }], // no watermark — first run
        [], // the seeding insert
      ])
    );
    expect(r.seeded).toBe(true);
    expect(r.latestBlock).toBe(498298724);
    expect(r.events).toEqual([]);
    expect(sendToAddress).not.toHaveBeenCalled();
  });

  it('stays quiet while the allocation is still zero and nothing has moved', async () => {
    nestReturns(ZERO_STATE, TIMELINE);
    const r = await dispatchDipsNotifications(
      makeSql([[], [{ block: 498298724 }], [{ address: '0xsub' }]])
    );
    expect(r.seeded).toBe(false);
    expect(r.events).toEqual([]);
    expect(sendToAddress).not.toHaveBeenCalled();
  });

  it('broadcasts dips_live the first time the allocation goes above zero', async () => {
    nestReturns(LIVE_STATE, TIMELINE);
    const r = await dispatchDipsNotifications(
      makeSql([[], [{ block: 498298724 }], [{ address: '0xa' }, { address: '0xb' }], []])
    );
    expect(r.agreementRate).toBe(6);
    expect(r.events).toEqual(['dips_live']);
    expect(sendToAddress).toHaveBeenCalledTimes(2);
    expect(sendToAddress.mock.calls[0][1]).toMatchObject({ title: 'DIPS is live' });
    expect(sendToAddress.mock.calls[0][1].body).toContain('6.00 GRT per block');
  });

  it('broadcasts dips_live when the allocation arrives on the allocator-minted field alone', async () => {
    // Governance can fund DefaultAllocation through either minting field. This dispatcher read
    // only the self-minting one, so a flip made the other way would have gone unannounced —
    // a silent miss of the single event it exists for.
    nestReturns(LIVE_VIA_ALLOCATOR, TIMELINE);
    const r = await dispatchDipsNotifications(
      makeSql([[], [{ block: 498298724 }], [{ address: '0xa' }], []])
    );
    expect(r.agreementRate).toBe(6);
    expect(r.events).toEqual(['dips_live']);
    expect(sendToAddress).toHaveBeenCalledTimes(1);
  });

  it('does not re-announce dips_live once it has fired', async () => {
    nestReturns(LIVE_STATE, TIMELINE);
    const r = await dispatchDipsNotifications(
      makeSql([[{ id: 1 }], [{ block: 498298724 }], [{ address: '0xa' }]])
    );
    expect(r.events).toEqual([]);
    expect(sendToAddress).not.toHaveBeenCalled();
  });

  it('broadcasts dips_config when a new configuration step lands past the watermark', async () => {
    nestReturns(ZERO_STATE, [{ block_number: 499000000, step: 'target_allocation_set' }]);
    const r = await dispatchDipsNotifications(
      makeSql([[], [{ block: 498298724 }], [{ address: '0xa' }], []])
    );
    expect(r.events).toEqual(['dips_config']);
    expect(sendToAddress).toHaveBeenCalledTimes(1);
    expect(sendToAddress.mock.calls[0][1].title).toBe('DIPS configuration changed');
  });
});
