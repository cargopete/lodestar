import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DbClient } from '@/lib/db';

const sendToAddress = vi.fn();
const apnsConfigured = vi.fn();

vi.mock('@/lib/apns', () => ({
  apnsConfigured: () => apnsConfigured(),
  sendToAddress: (...args: unknown[]) => sendToAddress(...args),
}));

import { dispatchDisputeNotifications } from '../dispatch';

/** A postgres.js-shaped tag that resolves queued result sets in call order. */
function makeSql(queue: unknown[][]) {
  let i = 0;
  const fn = (() => Promise.resolve(queue[i++] ?? [])) as unknown as DbClient;
  (fn as unknown as { json: (x: unknown) => unknown }).json = (x) => x;
  return fn;
}

beforeEach(() => {
  sendToAddress.mockReset().mockResolvedValue(1);
  apnsConfigured.mockReset().mockReturnValue(true);
});

describe('dispatchDisputeNotifications', () => {
  it('does nothing (and marks nothing) when APNs is not configured', async () => {
    apnsConfigured.mockReturnValue(false);
    const res = await dispatchDisputeNotifications(makeSql([]));
    expect(res).toEqual({ count: 0, disputes: 0, delivered: 0 });
    expect(sendToAddress).not.toHaveBeenCalled();
  });

  it('alerts a subscribed delegator of the disputed indexer and marks it notified', async () => {
    const sql = makeSql([
      [{ id: 'd1', indexer_address: '0xABCdef0000000000000000000000000000001234', dispute_type: 'Indexing' }],
      [{ name: 'CoolIndexer', ens_name: null }],
      [{ address: '0xdelegator' }],
      [], // notification_log insert
      [], // UPDATE disputes
    ]);

    const res = await dispatchDisputeNotifications(sql);

    expect(res).toEqual({ count: 1, disputes: 1, delivered: 1 });
    expect(sendToAddress).toHaveBeenCalledTimes(1);
    const [addr, note] = sendToAddress.mock.calls[0];
    expect(addr).toBe('0xdelegator');
    expect(note.title).toBe('Dispute opened');
    expect(note.body).toContain('CoolIndexer');
    expect(note.path).toBe('/indexers/0xabcdef0000000000000000000000000000001234');
    expect(note.collapseId).toBe('dispute-d1');
  });

  it('logs but sends nothing when no subscriber delegates to the indexer', async () => {
    const sql = makeSql([
      [{ id: 'd2', indexer_address: '0xfeed', dispute_type: null }],
      [{ name: null, ens_name: null }],
      [], // no recipients
      [],
      [],
    ]);
    const res = await dispatchDisputeNotifications(sql);
    expect(res).toEqual({ count: 1, disputes: 1, delivered: 0 });
    expect(sendToAddress).not.toHaveBeenCalled();
  });
});
