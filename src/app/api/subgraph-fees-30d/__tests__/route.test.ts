/**
 * Tests for /api/subgraph-fees-30d - the nest guard, the two-pass fee aggregation (fees per
 * deployment, then the deployments' figures and IPFS metadata), dust-signal filtering, the empty
 * result, and the error path. Inputs are the nest's rows (nuthatch#1160); the gateway path left
 * with the key.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const nuthatchSql = vi.fn();
const hasNuthatch = vi.fn(() => true);
vi.mock('@/lib/nuthatch', () => ({
  hasNuthatch: () => hasNuthatch(),
  nuthatchSqlReady: async (...a: unknown[]) => {
    const rows = await nuthatchSql(...a);
    return { ok: true, data: { rows, count: rows.length } };
  },
}));
const metadataFor = vi.fn<(ids: string[]) => Promise<Map<string, unknown>>>(async () => new Map());
vi.mock('@/lib/subgraph-metadata', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/subgraph-metadata')>()),
  subgraphMetadataForDeployments: (ids: string[]) => metadataFor(ids),
}));
vi.mock('@/lib/cache', () => ({
  cached: vi.fn((_k: string, _t: number, f: () => unknown) => f()),
}));
vi.mock('@/lib/logger', () => ({ log: { api: { error: vi.fn() } } }));

async function load() {
  const mod = await import('@/app/api/subgraph-fees-30d/route');
  return mod.GET as () => Promise<Response>;
}

const ABOVE_DUST = '5000000000000000000'; // 5 GRT signalled
const DUST = '500000000000000000'; // 0.5 GRT signalled
// Deployment ids are bytes32 on the nest; the route turns them back into Qm hashes.
const DEP_A = '0x' + 'aa'.repeat(32);
const DEP_B = '0x' + 'bb'.repeat(32);
const DEP_DUST = '0x' + 'dd'.repeat(32);
const DEP_X = '0x' + 'ee'.repeat(32);

function deployment(id: string, opts: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    signalled_tokens: ABOVE_DUST,
    staked_tokens: '1000000000000000000000',
    query_fees_amount: '2000000000000000000000',
    created_at: 1700000000,
    active_allocation_count: 1,
    curator_count: 1,
    ...opts,
  };
}
/** Route the nest mock's two queries: the fee sum first, then the deployments by id. */
function nest(fees: { id: string; query_fees: string }[], deployments: Record<string, unknown>[]) {
  nuthatchSql.mockImplementation(async (sql: string) => {
    if (sql.includes('SUM(query_fees_collected)')) return fees;
    if (sql.includes('FROM lodestar_deployments')) return deployments;
    return [];
  });
}
const demo = (ids: string[]) => new Map(ids.map((id) => [id, { subgraphId: 's', metadata: { displayName: 'Demo', categories: ['defi'] } }]));

beforeEach(() => {
  vi.clearAllMocks();
  hasNuthatch.mockReturnValue(true);
  metadataFor.mockResolvedValue(new Map());
});

describe('/api/subgraph-fees-30d guards', () => {
  it('503 when no nest is configured', async () => {
    hasNuthatch.mockReturnValue(false);
    const GET = await load();
    const res = await GET();
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toMatch(/Nuthatch is not configured/i);
    expect(nuthatchSql).not.toHaveBeenCalled();
  });
});

describe('/api/subgraph-fees-30d aggregation', () => {
  it('carries per-deployment fees in the order the nest ranks them, with metadata', async () => {
    // The view sums and orders; depB (5000) ranks ahead of depA (1000).
    nest([{ id: DEP_B, query_fees: '5000' }, { id: DEP_A, query_fees: '1000' }], [deployment(DEP_A), deployment(DEP_B)]);
    metadataFor.mockResolvedValue(demo([DEP_A, DEP_B]));

    const GET = await load();
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    const data = json.data as { id: string; queryFees30d: string; displayName: string | null; categories: string[] }[];
    expect(data.length).toBe(2);
    expect(data[0].id).toBe(DEP_B);
    expect(data[0].queryFees30d).toBe('5000');
    expect(data[1].id).toBe(DEP_A);
    expect(data[1].queryFees30d).toBe('1000');
    expect(data[0].displayName).toBe('Demo');
    expect(data[0].categories).toEqual(['defi']);
    // pass 2 asks for exactly the deployments pass 1 named
    expect(String(nuthatchSql.mock.calls[1][0])).toContain(DEP_B);
    expect(String(nuthatchSql.mock.calls[1][0])).toContain(DEP_A);
  });

  it('filters out dust-signal deployments (<= 1 GRT signalled)', async () => {
    nest(
      [{ id: DEP_DUST, query_fees: '100' }, { id: DEP_A, query_fees: '200' }],
      [deployment(DEP_DUST, { signalled_tokens: DUST }), deployment(DEP_A)],
    );
    const GET = await load();
    const res = await GET();
    const json = await res.json();
    const data = json.data as { id: string }[];
    expect(data.map((d) => d.id)).toEqual([DEP_A]);
  });

  it('returns empty array when no allocations collected fees in the window', async () => {
    nest([], []);
    const GET = await load();
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual([]);
    // pass 2 never runs
    expect(nuthatchSql).toHaveBeenCalledTimes(1);
  });

  it('defaults displayName null and categories [] when metadata missing', async () => {
    nest([{ id: DEP_X, query_fees: '100' }], [deployment(DEP_X)]);
    const GET = await load();
    const res = await GET();
    const json = await res.json();
    expect(json.data[0].displayName).toBeNull();
    expect(json.data[0].categories).toEqual([]);
  });

  it('503 when the nest query throws', async () => {
    nuthatchSql.mockRejectedValueOnce(new Error('boom'));
    const GET = await load();
    const res = await GET();
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toMatch(/Failed to load 30-day fees/i);
  });
});
