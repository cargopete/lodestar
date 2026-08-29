/**
 * Edge-triggering is the whole design, so it is the whole test.
 *
 * An alert that fires every fifteen minutes about a nest that has been dark for a week is not
 * monitoring; it is a thing people mute, and once muted it takes the next real outage down with it.
 * So: seed silently, notify only on a change, and record the new baseline even when delivery is
 * impossible — otherwise the same transition fires forever.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DbClient } from '@/lib/db';

const sendToAddress = vi.fn();
const apnsConfigured = vi.fn();
const probeAllNests = vi.fn();
const hasNestOrigin = vi.fn();

vi.mock('@/lib/apns', () => ({
  apnsConfigured: () => apnsConfigured(),
  sendToAddress: (...args: unknown[]) => sendToAddress(...args),
}));
vi.mock('@/lib/nest-health', () => ({
  hasNestOrigin: () => hasNestOrigin(),
  probeAllNests: (...a: unknown[]) => probeAllNests(...a),
}));

import { dispatchNestHealthNotifications } from '../nest-health';

function makeSql(queue: unknown[][]) {
  let i = 0;
  const fn = (() => Promise.resolve(queue[i++] ?? [])) as unknown as DbClient;
  (fn as unknown as { json: (x: unknown) => unknown }).json = (x) => x;
  return fn;
}

const nests = (states: Record<string, boolean>, lag?: Record<string, number>) =>
  Object.entries(states).map(([id, ready]) => ({
    id,
    label: id.toUpperCase(),
    ready,
    lagBlocks: lag?.[id],
  }));

/** A prior run's recorded baseline, in the shape `lastKnown` reads. */
const previous = (states: Record<string, boolean>) => [{ details: { states } }];

beforeEach(() => {
  sendToAddress.mockReset().mockResolvedValue(1);
  apnsConfigured.mockReset().mockReturnValue(true);
  hasNestOrigin.mockReset().mockReturnValue(true);
  probeAllNests.mockReset();
});

describe('dispatchNestHealthNotifications', () => {
  it('seeds silently on the first run rather than announcing an outage nobody was watching', async () => {
    probeAllNests.mockResolvedValue(nests({ staking: false, dips: false }));
    const r = await dispatchNestHealthNotifications(makeSql([[], []]));
    expect(r.seeded).toBe(true);
    expect(r.delivered).toBe(0);
    expect(sendToAddress).not.toHaveBeenCalled();
  });

  it('says nothing when nothing changed, however unwell things are', async () => {
    probeAllNests.mockResolvedValue(nests({ staking: false, dips: false }));
    const r = await dispatchNestHealthNotifications(
      makeSql([previous({ staking: false, dips: false })])
    );
    expect(r.transitions).toEqual([]);
    expect(sendToAddress).not.toHaveBeenCalled();
  });

  it('notifies when a nest goes dark, naming it and how far behind it is', async () => {
    probeAllNests.mockResolvedValue(nests({ staking: false, dips: true }, { staking: 12345 }));
    const r = await dispatchNestHealthNotifications(
      makeSql([previous({ staking: true, dips: true }), [{ address: '0xreader' }], []])
    );
    expect(r.transitions).toEqual([{ id: 'staking', ready: false }]);
    expect(sendToAddress).toHaveBeenCalledTimes(1);
    const [, payload] = sendToAddress.mock.calls[0];
    expect(payload.title).toMatch(/went dark/i);
    expect(payload.body).toContain('12,345 blocks behind');
    expect(payload.body).toContain('1/2 nests ready');
    expect(payload.path).toBe('/sql');
  });

  it('notifies on recovery too, because silence after an outage is ambiguous', async () => {
    probeAllNests.mockResolvedValue(nests({ staking: true }));
    const r = await dispatchNestHealthNotifications(
      makeSql([previous({ staking: false }), [{ address: '0xreader' }], []])
    );
    expect(r.transitions).toEqual([{ id: 'staking', ready: true }]);
    const [, payload] = sendToAddress.mock.calls[0];
    expect(payload.title).toMatch(/recovered/i);
    expect(payload.body).toContain('answering again');
  });

  // Without this the same transition is rediscovered every run and fires forever.
  it('records the new baseline even when APNs cannot deliver', async () => {
    apnsConfigured.mockReturnValue(false);
    probeAllNests.mockResolvedValue(nests({ staking: false }));
    const writes: unknown[] = [];
    let i = 0;
    const queue = [previous({ staking: true })];
    const sql = ((...args: unknown[]) => {
      writes.push(args);
      return Promise.resolve(queue[i++] ?? []);
    }) as unknown as DbClient;
    (sql as unknown as { json: (x: unknown) => unknown }).json = (x) => x;

    const r = await dispatchNestHealthNotifications(sql);
    expect(r.transitions).toEqual([{ id: 'staking', ready: false }]);
    expect(r.delivered).toBe(0);
    // One read, then one write of the new baseline.
    expect(writes.length).toBeGreaterThanOrEqual(2);
  });

  // A nest added to the catalogue after the last run has no previous state; treating "unknown" as
  // a change would announce every deploy that adds a dataset.
  it('does not treat a newly added nest as a transition', async () => {
    probeAllNests.mockResolvedValue(nests({ staking: true, brandnew: false }));
    const r = await dispatchNestHealthNotifications(makeSql([previous({ staking: true })]));
    expect(r.transitions).toEqual([]);
    expect(sendToAddress).not.toHaveBeenCalled();
  });

  it('skips entirely when no nest origin is configured', async () => {
    hasNestOrigin.mockReturnValue(false);
    const r = await dispatchNestHealthNotifications(makeSql([]));
    expect(r.skipped).toBeTruthy();
    expect(probeAllNests).not.toHaveBeenCalled();
  });
});
