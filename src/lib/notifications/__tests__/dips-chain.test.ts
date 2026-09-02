/**
 * Edge-triggering for the DIPS chain cross-check.
 *
 * The alerting rule matters more than the detection here. A divergence that has stood for a week
 * pushing every hour is an alert nobody reads, and the run after that is the one that mattered.
 * So: first run seeds silently, an unchanged divergence set says nothing, and only a change to the
 * set reaches anybody.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DbClient } from '@/lib/db';

const sendToAddress = vi.fn();
const apnsConfigured = vi.fn();
const nuthatchSql = vi.fn();
const readChainState = vi.fn();

vi.mock('@/lib/apns', () => ({
  apnsConfigured: () => apnsConfigured(),
  sendToAddress: (...args: unknown[]) => sendToAddress(...args),
}));
vi.mock('@/lib/nuthatch', () => ({
  nuthatchSql: (...args: unknown[]) => nuthatchSql(...args),
}));
vi.mock('@/lib/dips-chain', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/dips-chain')>()),
  readChainState: () => readChainState(),
}));

import { dispatchDipsChainNotifications, signature } from '../dips-chain';
import type { Divergence } from '@/lib/dips-chain';

const GRT = 10n ** 18n;
const wei = (grt: number) => (BigInt(Math.round(grt * 1000)) * GRT) / 1000n;

const REWARDS_MANAGER = '0x971b9d3d0ae3eca029cab5ea1fb0f72c85e6a525';
const INNOVATION = '0x2ff06ba8086f37ba656a5b75405bf985f738b16e';

const CHAIN = {
  issuancePerBlock: wei(120.73),
  targets: [
    { target: REWARDS_MANAGER, total: wei(96.584), allocatorMinting: 0n, selfMinting: wei(96.584) },
    { target: INNOVATION, total: wei(24.146), allocatorMinting: wei(24.146), selfMinting: 0n },
  ],
};

const AGREEING = [
  {
    target: REWARDS_MANAGER,
    self_minting_rate_dec: wei(96.584).toString(),
    allocator_minting_rate_dec: '0',
  },
  {
    target: INNOVATION,
    self_minting_rate_dec: '0',
    allocator_minting_rate_dec: wei(24.146).toString(),
  },
];

/** The nest never saw InnovationAllocation registered. */
const DIVERGING = [AGREEING[0]];

/** A postgres.js-shaped tag resolving queued result sets in call order. */
function makeSql(queue: unknown[][]) {
  let i = 0;
  const fn = (() => Promise.resolve(queue[i++] ?? [])) as unknown as DbClient;
  (fn as unknown as { json: (x: unknown) => unknown }).json = (x) => x;
  return fn;
}

beforeEach(() => {
  sendToAddress.mockReset().mockResolvedValue(1);
  apnsConfigured.mockReset().mockReturnValue(true);
  readChainState.mockReset().mockResolvedValue(CHAIN);
  nuthatchSql.mockReset();
});

describe('dispatchDipsChainNotifications', () => {
  it('SEEDS SILENTLY on the first run, even with a divergence standing', async () => {
    // A divergence that began before anything was watching is not news.
    nuthatchSql.mockResolvedValue(DIVERGING);
    const r = await dispatchDipsChainNotifications(makeSql([[], []]));

    expect(r.seeded).toBe(true);
    expect(r.divergences).toHaveLength(1);
    expect(r.changed).toBe(false);
    expect(sendToAddress).not.toHaveBeenCalled();
  });

  it('says nothing when the two sides agree', async () => {
    nuthatchSql.mockResolvedValue(AGREEING);
    const r = await dispatchDipsChainNotifications(makeSql([[{ details: { signature: '' } }]]));

    expect(r.divergences).toEqual([]);
    expect(r.changed).toBe(false);
    expect(sendToAddress).not.toHaveBeenCalled();
  });

  it('notifies when a divergence appears', async () => {
    nuthatchSql.mockResolvedValue(DIVERGING);
    const r = await dispatchDipsChainNotifications(
      makeSql([[{ details: { signature: '' } }], [{ address: '0xa' }, { address: '0xb' }], []]),
    );

    expect(r.changed).toBe(true);
    expect(r.divergences[0].kind).toBe('missing_from_nest');
    expect(r.delivered).toBe(2);
    expect(sendToAddress).toHaveBeenCalledTimes(2);
    expect(sendToAddress.mock.calls[0][1]).toMatchObject({
      title: 'DIPS nest disagrees with the chain',
    });
    expect(sendToAddress.mock.calls[0][1].body).toContain('24.146');
  });

  it('stays quiet while the same divergence persists', async () => {
    // The run that would otherwise turn this into wallpaper.
    nuthatchSql.mockResolvedValue(DIVERGING);
    const standing = signature([
      {
        kind: 'missing_from_nest',
        target: INNOVATION,
        chain: wei(24.146).toString(),
        detail: '',
      } as Divergence,
    ]);
    const r = await dispatchDipsChainNotifications(
      makeSql([[{ details: { signature: standing } }]]),
    );

    expect(r.divergences).toHaveLength(1);
    expect(r.changed).toBe(false);
    expect(sendToAddress).not.toHaveBeenCalled();
  });

  it('records a recovery without waking anybody', async () => {
    nuthatchSql.mockResolvedValue(AGREEING);
    const r = await dispatchDipsChainNotifications(
      makeSql([[{ details: { signature: 'missing_from_nest:0xabc::' } }], []]),
    );

    expect(r.changed).toBe(true);
    expect(r.divergences).toEqual([]);
    expect(sendToAddress).not.toHaveBeenCalled();
  });

  it('records the new baseline when APNs is unconfigured, so it does not re-fire forever', async () => {
    apnsConfigured.mockReturnValue(false);
    nuthatchSql.mockResolvedValue(DIVERGING);
    const r = await dispatchDipsChainNotifications(
      makeSql([[{ details: { signature: '' } }], []]),
    );

    expect(r.changed).toBe(true);
    expect(r.skipped).toBe('apns unconfigured');
    expect(sendToAddress).not.toHaveBeenCalled();
  });
});

describe('signature', () => {
  it('is stable under reordering, because neither side guarantees an order', () => {
    const a: Divergence[] = [
      { kind: 'missing_from_nest', target: '0xb', detail: '' },
      { kind: 'rate_mismatch', target: '0xa', chain: '1', nest: '2', detail: '' },
    ];
    expect(signature(a)).toBe(signature([...a].reverse()));
  });

  it('changes when a rate changes, so a worsening divergence still alerts', () => {
    const one: Divergence[] = [
      { kind: 'rate_mismatch', target: '0xa', chain: '1', nest: '2', detail: '' },
    ];
    const two: Divergence[] = [
      { kind: 'rate_mismatch', target: '0xa', chain: '1', nest: '3', detail: '' },
    ];
    expect(signature(one)).not.toBe(signature(two));
  });
});
