/**
 * Tests for /api/subgraph-fees-30d — access guard, two-pass fee aggregation,
 * dust-signal filtering, empty result, and error path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const subgraphQuery = vi.fn();
const hasSubgraphAccess = vi.fn(() => true);
vi.mock('@/lib/subgraph', () => ({
  subgraphQuery: (...a: unknown[]) => subgraphQuery(...a),
  hasSubgraphAccess: () => hasSubgraphAccess(),
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

function detail(id: string, opts: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    ipfsHash: `ipfs-${id}`,
    signalledTokens: ABOVE_DUST,
    stakedTokens: '1000000000000000000000',
    queryFeesAmount: '2000000000000000000000',
    createdAt: 1700000000,
    indexerAllocations: [{ id: 'a1' }],
    curatorSignals: [{ id: 'c1' }],
    versions: [{ subgraph: { metadata: { displayName: 'Demo', categories: ['defi'] } } }],
    ...opts,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hasSubgraphAccess.mockReturnValue(true);
});

describe('/api/subgraph-fees-30d guards', () => {
  it('503 when no subgraph access', async () => {
    hasSubgraphAccess.mockReturnValue(false);
    const GET = await load();
    const res = await GET();
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toMatch(/No API key/i);
  });
});

describe('/api/subgraph-fees-30d aggregation', () => {
  it('aggregates per-deployment fees and sorts descending', async () => {
    // Pass 1: single short page (length < 1000 => loop stops)
    subgraphQuery.mockResolvedValueOnce({
      allocations: [
        { id: '1', queryFeesCollected: '100', subgraphDeployment: { id: 'depA', ipfsHash: 'ha' } },
        { id: '2', queryFeesCollected: '900', subgraphDeployment: { id: 'depA', ipfsHash: 'ha' } },
        { id: '3', queryFeesCollected: '5000', subgraphDeployment: { id: 'depB', ipfsHash: 'hb' } },
      ],
    });
    // Pass 2: deployment details batch
    subgraphQuery.mockResolvedValueOnce({
      subgraphDeployments: [detail('depA'), detail('depB')],
    });

    const GET = await load();
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    const data = json.data as {
      id: string;
      queryFees30d: string;
      displayName: string | null;
      categories: string[];
    }[];
    expect(data.length).toBe(2);
    // depB (5000) ranks ahead of depA (100+900=1000)
    expect(data[0].id).toBe('depB');
    expect(data[0].queryFees30d).toBe('5000');
    expect(data[1].id).toBe('depA');
    expect(data[1].queryFees30d).toBe('1000');
    expect(data[0].displayName).toBe('Demo');
    expect(data[0].categories).toEqual(['defi']);
  });

  it('filters out dust-signal deployments (<= 1 GRT signalled)', async () => {
    subgraphQuery.mockResolvedValueOnce({
      allocations: [
        { id: '1', queryFeesCollected: '100', subgraphDeployment: { id: 'depDust', ipfsHash: 'hd' } },
        { id: '2', queryFeesCollected: '200', subgraphDeployment: { id: 'depReal', ipfsHash: 'hr' } },
      ],
    });
    subgraphQuery.mockResolvedValueOnce({
      subgraphDeployments: [
        detail('depDust', { signalledTokens: DUST }),
        detail('depReal'),
      ],
    });
    const GET = await load();
    const res = await GET();
    const json = await res.json();
    const data = json.data as { id: string }[];
    expect(data.map((d) => d.id)).toEqual(['depReal']);
  });

  it('returns empty array when no allocations in window', async () => {
    subgraphQuery.mockResolvedValueOnce({ allocations: [] });
    const GET = await load();
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual([]);
    // pass 2 never runs
    expect(subgraphQuery).toHaveBeenCalledTimes(1);
  });

  it('defaults displayName null and categories [] when metadata missing', async () => {
    subgraphQuery.mockResolvedValueOnce({
      allocations: [
        { id: '1', queryFeesCollected: '100', subgraphDeployment: { id: 'depX', ipfsHash: 'hx' } },
      ],
    });
    subgraphQuery.mockResolvedValueOnce({
      subgraphDeployments: [detail('depX', { versions: [] })],
    });
    const GET = await load();
    const res = await GET();
    const json = await res.json();
    expect(json.data[0].displayName).toBeNull();
    expect(json.data[0].categories).toEqual([]);
  });

  it('500 when subgraphQuery throws', async () => {
    subgraphQuery.mockRejectedValueOnce(new Error('boom'));
    const GET = await load();
    const res = await GET();
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/Failed to compute 30-day fees/i);
  });
});
