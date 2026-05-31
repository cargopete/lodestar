/**
 * Tests for /api/cron/refresh-chain-health — Bearer CRON_SECRET auth, the
 * per-indexer /status fan-out, dropped-chain detection, and chain-lag
 * (median blocks-behind) aggregation. Mocks isolated to this file.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const cacheGet = vi.fn();
const cacheSet = vi.fn();
vi.mock('@/lib/cache', () => ({
  cacheGet: (...a: unknown[]) => cacheGet(...a),
  cacheSet: (...a: unknown[]) => cacheSet(...a),
}));
vi.mock('@/lib/logger', () => ({
  log: { cron: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const SECRET = 'test-cron-secret';

async function load() {
  const mod = await import('@/app/api/cron/refresh-chain-health/route');
  return mod.GET as (req: NextRequest) => Promise<Response>;
}

function req(auth?: string) {
  return new NextRequest('http://localhost/api/cron/refresh-chain-health', {
    headers: auth ? { authorization: auth } : {},
  });
}

// Build a /status response body for one indexer with the given chain rows.
function statusBody(
  rows: Array<{ network: string; synced: boolean; health?: string; head?: number; latest?: number }>,
) {
  return new Response(
    JSON.stringify({
      data: {
        indexingStatuses: rows.map((r) => ({
          synced: r.synced,
          health: r.health ?? (r.synced ? 'healthy' : 'unhealthy'),
          chains: [
            {
              network: r.network,
              chainHeadBlock: r.head !== undefined ? { number: r.head } : null,
              latestBlock: r.latest !== undefined ? { number: r.latest } : null,
            },
          ],
        })),
      },
    }),
    { status: 200 },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = SECRET;
  cacheGet.mockResolvedValue(null);
  cacheSet.mockResolvedValue(undefined);
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe('auth', () => {
  it('401 without an Authorization header', async () => {
    const GET = await load();
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(cacheGet).not.toHaveBeenCalled();
  });

  it('401 with a wrong bearer token', async () => {
    const GET = await load();
    const res = await GET(req('Bearer wrong'));
    expect(res.status).toBe(401);
  });

  it('401 when CRON_SECRET is unset (fail-closed)', async () => {
    delete process.env.CRON_SECRET;
    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(401);
  });

  it('passes auth with the correct bearer token', async () => {
    cacheGet.mockResolvedValueOnce([]); // indexers-enriched empty
    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
  });
});

describe('early exit', () => {
  it('returns no-indexers message when cache is empty', async () => {
    cacheGet.mockResolvedValueOnce(null);
    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.message).toMatch(/No indexers/);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('SSRF filtering of candidate indexers', () => {
  it('skips indexers with private/loopback urls', async () => {
    // first cacheGet = enriched list; subsequent = per-indexer snapshots (null)
    cacheGet.mockImplementation(async (key: string) =>
      key === 'lodestar:indexers-enriched'
        ? [
            { id: '0xAAA', url: 'http://127.0.0.1:8030' },
            { id: '0xBBB', url: 'http://10.0.0.9' },
          ]
        : null,
    );
    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    const json = await res.json();
    expect(res.status).toBe(200);
    // both unsafe → no fetches, zero chains
    expect(mockFetch).not.toHaveBeenCalled();
    expect(json.indexers).toBe(0);
    expect(json.chains).toBe(0);
  });
});

describe('chain-lag aggregation', () => {
  it('computes median blocks-behind, sampled + lagging counts', async () => {
    cacheGet.mockImplementation(async (key: string) =>
      key === 'lodestar:indexers-enriched'
        ? [
            { id: '0xAAA', url: 'https://a.example.com' },
            { id: '0xBBB', url: 'https://b.example.com' },
            { id: '0xCCC', url: 'https://c.example.com' },
          ]
        : null,
    );
    // Three indexers on mainnet: behinds 100, 300, and synced (no behind).
    mockFetch.mockImplementation(async (url: string) => {
      if (url.startsWith('https://a.example.com')) return statusBody([{ network: 'mainnet', synced: false, head: 1000, latest: 900 }]);
      if (url.startsWith('https://b.example.com')) return statusBody([{ network: 'mainnet', synced: false, head: 1000, latest: 700 }]);
      return statusBody([{ network: 'mainnet', synced: true, head: 1000, latest: 1000 }]);
    });

    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.chains).toBe(1);
    expect(json.indexers).toBe(3);

    // chain-lag cacheSet payload
    const lagCall = cacheSet.mock.calls.find((c) => c[0] === 'lodestar:chain-lag');
    expect(lagCall).toBeTruthy();
    const lag = lagCall![1] as { chains: Record<string, { medianBlocksBehind: number; sampledIndexers: number; laggingCount: number }> };
    expect(lag.chains.mainnet.sampledIndexers).toBe(3);
    expect(lag.chains.mainnet.laggingCount).toBe(2);
    // median of [100, 300] = 200
    expect(lag.chains.mainnet.medianBlocksBehind).toBe(200);
  });

  it('excludes failed deployments from lag stats but still counts unknown-skip', async () => {
    cacheGet.mockImplementation(async (key: string) =>
      key === 'lodestar:indexers-enriched'
        ? [{ id: '0xAAA', url: 'https://a.example.com' }]
        : null,
    );
    mockFetch.mockResolvedValue(
      statusBody([
        { network: 'mainnet', synced: false, health: 'failed', head: 1000, latest: 1 },
        { network: 'arbitrum-one', synced: false, head: 1000, latest: 950 },
      ]),
    );
    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    const json = await res.json();
    // failed mainnet dropped; only arbitrum-one aggregated
    const lag = (cacheSet.mock.calls.find((c) => c[0] === 'lodestar:chain-lag')![1]) as {
      chains: Record<string, { medianBlocksBehind: number; laggingCount: number }>;
    };
    expect(json.chains).toBe(1);
    expect(lag.chains['arbitrum-one'].medianBlocksBehind).toBe(50);
    expect(lag.chains.mainnet).toBeUndefined();
  });

  it('caps cross-chain noise: blocksBehind > 10,000 is not counted as lagging', async () => {
    cacheGet.mockImplementation(async (key: string) =>
      key === 'lodestar:indexers-enriched' ? [{ id: '0xAAA', url: 'https://a.example.com' }] : null,
    );
    mockFetch.mockResolvedValue(statusBody([{ network: 'mainnet', synced: false, head: 5_000_000, latest: 1 }]));
    const GET = await load();
    await GET(req(`Bearer ${SECRET}`));
    const lag = (cacheSet.mock.calls.find((c) => c[0] === 'lodestar:chain-lag')![1]) as {
      chains: Record<string, { laggingCount: number; sampledIndexers: number }>;
    };
    // sampled (not failed) but blocksBehind capped to null → not lagging
    expect(lag.chains.mainnet.sampledIndexers).toBe(1);
    expect(lag.chains.mainnet.laggingCount).toBe(0);
  });
});

describe('dropped-chain detection', () => {
  it('flags a chain present in the previous snapshot but gone now', async () => {
    cacheGet.mockImplementation(async (key: string) => {
      if (key === 'lodestar:indexers-enriched') return [{ id: '0xAAA', url: 'https://a.example.com' }];
      if (key === 'lodestar:indexer-chains:0xaaa') {
        return { current: ['mainnet', 'gnosis'], previous: null, capturedAt: 1 };
      }
      return null;
    });
    // Now only serving mainnet → gnosis dropped
    mockFetch.mockResolvedValue(statusBody([{ network: 'mainnet', synced: true, head: 10, latest: 10 }]));
    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    const json = await res.json();
    expect(json.droppedCount).toBe(1);
    const dropped = (cacheSet.mock.calls.find((c) => c[0] === 'lodestar:dropped-chains')![1]) as Record<string, string[]>;
    expect(dropped['0xaaa']).toEqual(['gnosis']);
  });

  it('skips unreachable nodes entirely (no snapshot write)', async () => {
    cacheGet.mockImplementation(async (key: string) =>
      key === 'lodestar:indexers-enriched' ? [{ id: '0xAAA', url: 'https://a.example.com' }] : null,
    );
    mockFetch.mockResolvedValue(new Response('boom', { status: 500 }));
    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    const json = await res.json();
    expect(json.chains).toBe(0);
    // no per-indexer snapshot persisted for an unreachable node
    const snapWrite = cacheSet.mock.calls.find((c) => String(c[0]).startsWith('lodestar:indexer-chains:'));
    expect(snapWrite).toBeUndefined();
  });
});

describe('error handling', () => {
  it('500s if cacheGet of the enriched list throws', async () => {
    cacheGet.mockRejectedValueOnce(new Error('redis down'));
    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/failed/i);
  });
});
