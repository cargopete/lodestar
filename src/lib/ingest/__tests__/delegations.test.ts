import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDelegationEventsQuery = vi.fn();
vi.mock('@/lib/subgraph', () => ({
  delegationEventsQuery: (...args: unknown[]) => mockDelegationEventsQuery(...args),
}));

import { ingestDelegationEvents } from '../delegations';

const makeEvent = (id: string) => ({
  id,
  eventType: 'delegation',
  indexer: '0xIndexer',
  delegator: '0xDelegator',
  tokens: '1000000000000000000000',
  timestamp: '1700000000',
});

// sql mock: first call returns ingestion state, subsequent calls return []
function makeSql(lastId = '') {
  let calls = 0;
  return vi.fn((..._args: unknown[]) => {
    calls++;
    if (calls === 1) return Promise.resolve(lastId ? [{ last_epoch: null, last_block: null, last_id: lastId }] : []);
    return Promise.resolve([]);
  });
}

describe('ingestDelegationEvents', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns 0 when no events', async () => {
    mockDelegationEventsQuery.mockResolvedValue({ delegationEvents: [] });
    const result = await ingestDelegationEvents(makeSql() as never);
    expect(result.ingested).toBe(0);
  });

  it('ingests a batch of delegation events', async () => {
    const events = ['evt-1', 'evt-2', 'evt-3'].map(makeEvent);
    mockDelegationEventsQuery
      .mockResolvedValueOnce({ delegationEvents: events })
      .mockResolvedValueOnce({ delegationEvents: [] });

    const result = await ingestDelegationEvents(makeSql() as never);
    expect(result.ingested).toBe(3);
  });

  it('picks up from last_id in ingestion state', async () => {
    mockDelegationEventsQuery.mockResolvedValue({ delegationEvents: [] });
    const sql = makeSql('evt-100');
    await ingestDelegationEvents(sql as never);
    expect(sql).toHaveBeenCalled();
  });

  it('stops pagination when batch < 1000', async () => {
    const events = Array.from({ length: 5 }, (_, i) => makeEvent(`evt-${i}`));
    mockDelegationEventsQuery.mockResolvedValueOnce({ delegationEvents: events });

    const result = await ingestDelegationEvents(makeSql() as never);
    expect(result.ingested).toBe(5);
    expect(mockDelegationEventsQuery).toHaveBeenCalledTimes(1);
  });

  it('paginates when batch equals 1000', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => makeEvent(`evt-${i}`));
    const page2 = Array.from({ length: 3 }, (_, i) => makeEvent(`evt-extra-${i}`));
    mockDelegationEventsQuery
      .mockResolvedValueOnce({ delegationEvents: page1 })
      .mockResolvedValueOnce({ delegationEvents: page2 });

    const result = await ingestDelegationEvents(makeSql() as never);
    expect(result.ingested).toBe(1003);
    expect(mockDelegationEventsQuery).toHaveBeenCalledTimes(2);
  });

  it('calls delegationEventsQuery with a GQL query', async () => {
    mockDelegationEventsQuery.mockResolvedValue({ delegationEvents: [] });
    await ingestDelegationEvents(makeSql() as never);
    expect(mockDelegationEventsQuery).toHaveBeenCalledWith(
      expect.stringContaining('delegationEvents')
    );
  });
});
