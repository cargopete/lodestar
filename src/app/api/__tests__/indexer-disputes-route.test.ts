/**
 * Tests for /api/indexer-disputes/[address] — reads the ingested disputes table.
 * Mocks are isolated to this file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockSql = vi.fn();
// db is a tagged-template function; our mock just returns whatever mockSql yields.
vi.mock('@/lib/db', () => ({
  db: (..._args: unknown[]) => mockSql(),
}));
vi.mock('@/lib/logger', () => ({ log: { api: { error: vi.fn() } } }));

const VALID = '0x1234000000000000000000000000000000001234';

async function load() {
  const mod = await import('@/app/api/indexer-disputes/[address]/route');
  return mod.GET as (req: NextRequest, ctx: { params: Promise<{ address: string }> }) => Promise<Response>;
}

beforeEach(() => vi.clearAllMocks());

describe('/api/indexer-disputes/[address]', () => {
  it('rejects an invalid address with 400', async () => {
    const GET = await load();
    const res = await GET(new NextRequest('http://localhost/x'), { params: Promise.resolve({ address: 'nope' }) });
    expect(res.status).toBe(400);
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('returns disputes for a valid address', async () => {
    mockSql.mockResolvedValueOnce([
      { id: 'd1', dispute_type: 'Indexing', indexer_address: VALID, status: 'Accepted', tokens_slashed_grt: '100', tokens_burned_grt: '25', created_at: '2026-01-01T00:00:00Z', closed_at: null },
    ]);
    const GET = await load();
    const res = await GET(new NextRequest(`http://localhost/${VALID}`), { params: Promise.resolve({ address: VALID }) });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.disputes).toHaveLength(1);
    expect(json.disputes[0].id).toBe('d1');
  });

  it('lowercases the address before querying', async () => {
    mockSql.mockResolvedValueOnce([]);
    const GET = await load();
    const upper = '0xABCD000000000000000000000000000000001234';
    const res = await GET(new NextRequest(`http://localhost/${upper}`), { params: Promise.resolve({ address: upper }) });
    expect(res.status).toBe(200);
    // address passes the lowercase regex check (would 400 otherwise)
    expect(mockSql).toHaveBeenCalled();
  });

  it('degrades to an empty list if the query throws', async () => {
    mockSql.mockRejectedValueOnce(new Error('db down'));
    const GET = await load();
    const res = await GET(new NextRequest(`http://localhost/${VALID}`), { params: Promise.resolve({ address: VALID }) });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.disputes).toEqual([]);
  });
});
