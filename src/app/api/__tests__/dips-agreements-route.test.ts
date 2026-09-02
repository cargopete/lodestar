/**
 * GET /api/dips/agreements.
 *
 * The route has no populated nest to answer it, on Arbitrum One or anywhere else, so these tests
 * are the only thing standing between it and its first contact with real data. What they pin is
 * mostly refusal and honesty: an unready nest must surface as an error rather than as an empty
 * lifecycle, and "nothing has ever happened" must arrive as `empty: true` rather than as silence.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/cache', () => ({
  cached: (_k: string, _t: number, f: () => Promise<unknown>) => f(),
}));
vi.mock('@/lib/logger', () => ({ log: { api: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } } }));

const mockEnabled = vi.fn(() => true);
const mockSqlReady = vi.fn();
vi.mock('@/lib/nuthatch', () => ({
  nuthatchEnabled: () => mockEnabled(),
  nuthatchSqlReady: (...a: unknown[]) => mockSqlReady(...a),
}));

import { GET } from '../dips/agreements/route';
import { AGREEMENT_TABLES } from '@/lib/dips-agreements';

const GRT = 10n ** 18n;
const wei = (n: number) => ((BigInt(Math.round(n * 1000)) * GRT) / 1000n).toString();

const ID = '0x11111111111111111111111111111111';
const INDEXER = '0xaaaa111122223333444455556666777788889999';

const call = (qs = '') =>
  GET(new NextRequest(`http://localhost/api/dips/agreements${qs}`));

/** Answer each table read by which table the SQL names. */
function nest(byTable: Record<string, Record<string, unknown>[]>) {
  mockSqlReady.mockImplementation(async (sql: string) => {
    const table = Object.values(AGREEMENT_TABLES).find((t) => sql.includes(`"${t}"`));
    return { ok: true, data: { count: 0, rows: (table && byTable[table]) || [] } };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockEnabled.mockReturnValue(true);
});

describe('/api/dips/agreements', () => {
  it('reports unavailable without touching the nest when the flag is off', async () => {
    mockEnabled.mockReturnValue(false);
    const body = await (await call()).json();

    expect(body.data).toEqual({ available: false });
    expect(mockSqlReady).not.toHaveBeenCalled();
  });

  it('says the lifecycle is empty rather than just returning nothing', async () => {
    // The state of Arbitrum One today, and the answer most likely to be misread.
    nest({});
    const { data } = await (await call()).json();

    expect(data.available).toBe(true);
    expect(data.empty).toBe(true);
    expect(data.agreements).toEqual([]);
    expect(data.totalCollectedGrt).toBe(0);
  });

  it('reads every lifecycle table', async () => {
    nest({});
    await call();

    const asked = mockSqlReady.mock.calls.map((c) => c[0] as string);
    for (const table of Object.values(AGREEMENT_TABLES)) {
      expect(asked.some((sql) => sql.includes(`"${table}"`))).toBe(true);
    }
    // All against the dips nest, not the default one.
    expect(mockSqlReady.mock.calls.every((c) => c[1] === '/dips')).toBe(true);
  });

  it('folds rows into agreements', async () => {
    nest({
      [AGREEMENT_TABLES.accepted]: [
        {
          block_number: 1,
          block_timestamp: 1_756_000_000,
          agreementId: ID,
          serviceProvider: INDEXER,
          maxInitialTokens_dec: wei(100),
        },
      ],
      [AGREEMENT_TABLES.collected]: [
        { block_number: 2, block_timestamp: 1_756_000_100, agreementId: ID, tokens_dec: wei(4) },
      ],
    });

    const { data } = await (await call()).json();

    expect(data.empty).toBe(false);
    expect(data.agreements).toHaveLength(1);
    expect(data.agreements[0].collectedGrt).toBeCloseTo(4, 9);
    expect(data.totalCollectedGrt).toBeCloseTo(4, 9);
  });

  it('narrows to one service provider when asked', async () => {
    nest({
      [AGREEMENT_TABLES.accepted]: [
        { block_number: 1, agreementId: ID, serviceProvider: INDEXER },
        { block_number: 1, agreementId: '0x22', serviceProvider: '0xbbbb' },
      ],
    });

    const { data } = await (await call(`?indexer=${INDEXER}`)).json();

    expect(data.agreements).toHaveLength(1);
    expect(data.agreements[0].serviceProvider).toBe(INDEXER);
  });

  it('400s on an indexer that is not an address, rather than searching for it', async () => {
    nest({});
    const res = await call('?indexer=not-an-address');

    expect(res.status).toBe(400);
    expect(mockSqlReady).not.toHaveBeenCalled();
  });

  it('refuses with the nest reason when the nest is not ready', async () => {
    // #1080 again: a stalled nest must never render as an empty lifecycle.
    mockSqlReady.mockResolvedValue({
      ok: false,
      status: 503,
      error: 'nest is not ready: stalled',
      reason: 'stalled: it is running but no longer following the chain',
    });

    const res = await call();
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json.error).toMatch(/not ready/);
    expect(json.reason).toMatch(/stalled/);
    expect(json.data).toBeUndefined();
  });

  it('500s without leaking internals when a read throws', async () => {
    mockSqlReady.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8104'));
    const res = await call();
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to load DIPS agreements');
    expect(JSON.stringify(json)).not.toContain('127.0.0.1');
  });
});
