import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// db is used as a tagged template: sql`SELECT ...`. Queue rows it should return.
const dbResults: unknown[] = [];
const mockDb = vi.fn(() => Promise.resolve(dbResults.shift() ?? []));
const mockHasDbAccess = vi.fn(() => true);
vi.mock('@/lib/db', () => ({
  get db() {
    return mockDb;
  },
  hasDbAccess: () => mockHasDbAccess(),
}));

const mockNuthatchSql = vi.fn();
const mockHasNuthatch = vi.fn(() => true);
vi.mock('@/lib/nuthatch', () => ({
  hasNuthatch: () => mockHasNuthatch(),
  nuthatchSqlReady: async (...args: unknown[]) => {
    const rows = await mockNuthatchSql(...args);
    return { ok: true, data: { rows, count: rows.length } };
  },
}));

vi.mock('@/lib/cache', () => ({
  cached: vi.fn((_k: string, _t: number, f: () => Promise<unknown>) => f()),
}));

vi.mock('@/lib/logger', () => ({
  log: { api: { error: vi.fn() } },
}));

const VALID = '0x' + 'a'.repeat(40);

function makeRequest(qs: string): NextRequest {
  return new NextRequest(new URL(`/api/rewards-history${qs}`, 'http://localhost:3000'));
}

let GET: (req: NextRequest) => Promise<Response>;

describe('/api/rewards-history', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    dbResults.length = 0;
    mockHasDbAccess.mockReturnValue(true);
    mockHasNuthatch.mockReturnValue(true);
    const mod = await import('@/app/api/rewards-history/route');
    GET = mod.GET as typeof GET;
  });

  it('returns 400 when address is missing', async () => {
    const res = await GET(makeRequest(''));
    expect(res.status).toBe(400);
  });

  it('returns 400 for an invalid address format', async () => {
    const res = await GET(makeRequest('?address=0xnotanaddress'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/invalid address/i);
  });

  it('rejects an uppercase-only non-hex address (lowercased fails regex)', async () => {
    const res = await GET(makeRequest('?address=0xZZZ'));
    expect(res.status).toBe(400);
  });

  it('returns 503 when DB is not configured', async () => {
    mockHasDbAccess.mockReturnValue(false);
    const res = await GET(makeRequest(`?address=${VALID}`));
    expect(res.status).toBe(503);
  });

  it('returns 503 when no nest is configured', async () => {
    mockHasNuthatch.mockReturnValue(false);
    const res = await GET(makeRequest(`?address=${VALID}`));
    expect(res.status).toBe(503);
  });

  it('returns empty history when delegator has no stakes', async () => {
    mockNuthatchSql.mockResolvedValueOnce([]);
    const res = await GET(makeRequest(`?address=${VALID}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.history).toEqual([]);
  });

  it('returns empty history when delegator stakes array is empty', async () => {
    mockNuthatchSql.mockResolvedValueOnce([]);
    const res = await GET(makeRequest(`?address=${VALID}`));
    const json = await res.json();
    expect(json.history).toEqual([]);
  });

  it('returns empty history when no snapshots exist for the positions', async () => {
    mockNuthatchSql.mockResolvedValueOnce([
      { staked_tokens: '1000000000000000000000', share_amount: '1000000000000000000000', indexer: '0xidx1' },
    ]);
    dbResults.push([]); // snapshots query => empty
    const res = await GET(makeRequest(`?address=${VALID}`));
    const json = await res.json();
    expect(json.history).toEqual([]);
  });

  it('transforms snapshots into a per-date portfolio timeseries with rewards', async () => {
    // 1000 GRT principal, 1000 GRT shares. Exchange rate climbs 1.0 -> 1.1 => +100 GRT rewards.
    mockNuthatchSql.mockResolvedValueOnce([
      { staked_tokens: '1000000000000000000000', share_amount: '1000000000000000000000', indexer: '0xidx1' },
    ]);
    dbResults.push([
      { indexer_address: '0xidx1', snapshot_date: new Date('2026-05-01T00:00:00Z'), delegation_exchange_rate: 1.0 },
      { indexer_address: '0xidx1', snapshot_date: new Date('2026-05-02T00:00:00Z'), delegation_exchange_rate: 1.1 },
    ]);

    const res = await GET(makeRequest(`?address=${VALID}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.history)).toBe(true);
    expect(json.history).toHaveLength(2);

    const first = json.history[0];
    expect(first).toHaveProperty('date');
    expect(first).toHaveProperty('timestamp');
    expect(first).toHaveProperty('value');
    expect(first).toHaveProperty('rewards');
    expect(first).toHaveProperty('principal');
    expect(first.principal).toBe(1000);
    expect(first.value).toBe(1000); // rate 1.0
    expect(first.rewards).toBe(0);

    const second = json.history[1];
    expect(second.value).toBe(1100); // rate 1.1
    expect(second.rewards).toBe(100); // 1100 - 1000
    expect(res.headers.get('Cache-Control')).toContain('s-maxage=300');
  });

  it('forward-fills missing rates across dates per indexer', async () => {
    // Two indexers; idx2 only has a snapshot on day 1, idx1 on both days.
    // On day 2 idx2's rate should be forward-filled from day 1.
    mockNuthatchSql.mockResolvedValueOnce([
      { staked_tokens: '1000000000000000000000', share_amount: '1000000000000000000000', indexer: '0xidx1' },
      { staked_tokens: '1000000000000000000000', share_amount: '1000000000000000000000', indexer: '0xidx2' },
    ]);
    dbResults.push([
      { indexer_address: '0xidx1', snapshot_date: new Date('2026-05-01T00:00:00Z'), delegation_exchange_rate: 1.0 },
      { indexer_address: '0xidx1', snapshot_date: new Date('2026-05-02T00:00:00Z'), delegation_exchange_rate: 1.0 },
      { indexer_address: '0xidx2', snapshot_date: new Date('2026-05-01T00:00:00Z'), delegation_exchange_rate: 2.0 },
    ]);

    const res = await GET(makeRequest(`?address=${VALID}`));
    const json = await res.json();
    // Day 1: idx1=1000*1.0 + idx2=1000*2.0 = 3000
    expect(json.history[0].value).toBe(3000);
    // Day 2: idx1=1000*1.0 + idx2 forward-filled 2.0 => 1000*2.0 = 3000
    expect(json.history[1].value).toBe(3000);
  });

  it('clamps the days param into [7, 365]', async () => {
    mockNuthatchSql.mockResolvedValueOnce([]);
    const res = await GET(makeRequest(`?address=${VALID}&days=99999`));
    expect(res.status).toBe(200);
    // The cache key encodes the clamped value; we just assert the route did not error.
    const json = await res.json();
    expect(json.history).toEqual([]);
  });

  it('returns 500 when the nest query throws', async () => {
    mockNuthatchSql.mockRejectedValueOnce(new Error('nest down'));
    const res = await GET(makeRequest(`?address=${VALID}`));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/failed/i);
  });
});
