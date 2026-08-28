import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DbClient } from '@/lib/db';

const sendToAddress = vi.fn();
const apnsConfigured = vi.fn();
const fetchRegistry = vi.fn();
const probeRegistry = vi.fn();

vi.mock('@/lib/apns', () => ({
  apnsConfigured: () => apnsConfigured(),
  sendToAddress: (...args: unknown[]) => sendToAddress(...args),
}));
vi.mock('@/lib/dispatch-liveness', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/dispatch-liveness')>();
  return {
    ...actual,
    arbitrumClient: () => ({}) as never,
    fetchRegistry: (...a: unknown[]) => fetchRegistry(...a),
    probeRegistry: (...a: unknown[]) => probeRegistry(...a),
  };
});

import { dispatchLivenessNotifications } from '../liveness';

const A = '0xaaaa000000000000000000000000000000000000';
const B = '0xbbbb000000000000000000000000000000000000';

function makeSql(queue: unknown[][]) {
  let i = 0;
  const fn = (() => Promise.resolve(queue[i++] ?? [])) as unknown as DbClient;
  (fn as unknown as { json: (x: unknown) => unknown }).json = (x) => x;
  return fn;
}

function providers(states: Record<string, boolean>) {
  return Object.entries(states).map(([address, serving]) => ({
    address,
    serving,
    chains: [42161],
    endpoints: [{ endpoint: 'https://x', status: serving ? 'serving' : 'unreachable' }],
  }));
}

beforeEach(() => {
  sendToAddress.mockReset().mockResolvedValue(1);
  apnsConfigured.mockReset().mockReturnValue(true);
  fetchRegistry.mockReset().mockResolvedValue([]);
  probeRegistry.mockReset();
});

describe('dispatchLivenessNotifications', () => {
  it('SEEDS SILENTLY on first run so a 39-day-old outage is not announced as breaking news', async () => {
    probeRegistry.mockResolvedValue(providers({ [A]: false, [B]: false }));
    const r = await dispatchLivenessNotifications(makeSql([[], []]));
    expect(r.seeded).toBe(true);
    expect(r.serving).toBe(0);
    expect(r.lying).toBe(2);
    expect(sendToAddress).not.toHaveBeenCalled();
  });

  it('stays silent when nothing changed, however bad the state is', async () => {
    probeRegistry.mockResolvedValue(providers({ [A]: false, [B]: false }));
    const r = await dispatchLivenessNotifications(
      makeSql([[{ details: { states: { [A]: false, [B]: false } } }]])
    );
    expect(r.transitions).toEqual([]);
    expect(sendToAddress).not.toHaveBeenCalled();
  });

  it('alerts when a serving provider goes dark', async () => {
    probeRegistry.mockResolvedValue(providers({ [A]: false, [B]: true }));
    const r = await dispatchLivenessNotifications(
      makeSql([[{ details: { states: { [A]: true, [B]: true } } }], [{ address: '0xsub' }], []])
    );
    expect(r.transitions).toEqual([{ address: A, serving: false }]);
    expect(sendToAddress).toHaveBeenCalledTimes(1);
    expect(sendToAddress.mock.calls[0][1].title).toBe('Dispatch provider went dark');
    expect(sendToAddress.mock.calls[0][1].body).toContain('1/2 registered providers now answer');
  });

  it('alerts on recovery too, because a fixed outage is news', async () => {
    probeRegistry.mockResolvedValue(providers({ [A]: true, [B]: true }));
    const r = await dispatchLivenessNotifications(
      makeSql([[{ details: { states: { [A]: false, [B]: true } } }], [{ address: '0xsub' }], []])
    );
    expect(r.transitions).toEqual([{ address: A, serving: true }]);
    expect(sendToAddress.mock.calls[0][1].title).toBe('Dispatch provider recovered');
    expect(sendToAddress.mock.calls[0][1].body).toContain('serving again');
  });

  /** A provider that appears for the first time has no previous state, so it is not a transition. */
  it('does not alert for a newly registered provider it has never seen', async () => {
    probeRegistry.mockResolvedValue(providers({ [A]: true, [B]: false }));
    const r = await dispatchLivenessNotifications(
      makeSql([[{ details: { states: { [A]: true } } }]])
    );
    expect(r.transitions).toEqual([]);
    expect(sendToAddress).not.toHaveBeenCalled();
  });

  /** Without recording the new baseline, an unconfigured APNs would re-fire the same transition
   *  on every run forever once it was configured. */
  it('records the new baseline even when APNs is unconfigured', async () => {
    apnsConfigured.mockReturnValue(false);
    probeRegistry.mockResolvedValue(providers({ [A]: false }));
    const r = await dispatchLivenessNotifications(
      makeSql([[{ details: { states: { [A]: true } } }], []])
    );
    expect(r.transitions).toEqual([{ address: A, serving: false }]);
    expect(r.delivered).toBe(0);
    expect(sendToAddress).not.toHaveBeenCalled();
  });
});
