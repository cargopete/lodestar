/**
 * Tests for /api/cron/warm-token-details — Bearer CRON_SECRET auth + the warming
 * loop. Token fetchers and cache writes are mocked; the seed list is replaced
 * with a small deterministic fixture so we can assert warmed/failed counts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const cacheSetSwr = vi.fn();
vi.mock('@/lib/cache', () => ({ cacheSetSwr: (...a: unknown[]) => cacheSetSwr(...a) }));

const fetchTokenDetail = vi.fn();
vi.mock('@/lib/tokens/fetcher', () => ({ fetchTokenDetail: (...a: unknown[]) => fetchTokenDetail(...a) }));

vi.mock('@/lib/tokens/seed', () => ({
  TOKEN_SEEDS: [
    { contract: '0xAAA', symbol: 'AAA', chain: 'mainnet', pool: {} },
    { contract: '0xBBB', symbol: 'BBB', chain: 'mainnet', pool: {} },
    { contract: '0xCCC', symbol: 'CCC', chain: 'mainnet', pool: {} },
    // non-mainnet seed must be filtered out and never fetched
    { contract: '0xDDD', symbol: 'DDD', chain: 'arbitrum', pool: {} },
  ],
}));

vi.mock('@/lib/logger', () => ({
  log: { cron: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

const SECRET = 'warm-secret';

async function load() {
  const mod = await import('@/app/api/cron/warm-token-details/route');
  return mod.GET as (req: NextRequest) => Promise<Response>;
}

function req(auth?: string) {
  return new NextRequest('http://localhost/api/cron/warm-token-details', {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  process.env.CRON_SECRET = SECRET;
});

describe('warm-token-details auth', () => {
  it('401s with no Authorization header', async () => {
    const GET = await load();
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(fetchTokenDetail).not.toHaveBeenCalled();
  });

  it('401s with a wrong secret', async () => {
    const GET = await load();
    const res = await GET(req('Bearer wrong'));
    expect(res.status).toBe(401);
  });

  it('401s when CRON_SECRET is unset (fail closed)', async () => {
    delete process.env.CRON_SECRET;
    const GET = await load();
    const res = await GET(req('Bearer anything'));
    expect(res.status).toBe(401);
  });
});

describe('warm-token-details warming loop', () => {
  it('warms every mainnet seed and skips non-mainnet, counting warmed', async () => {
    fetchTokenDetail.mockResolvedValue({ symbol: 'X', priceUsd: 1 });
    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, warmed: 3, failed: 0 });
    expect(typeof body.durationMs).toBe('number');
    // only the 3 mainnet seeds fetched; arbitrum seed filtered out
    expect(fetchTokenDetail).toHaveBeenCalledTimes(3);
    expect(cacheSetSwr).toHaveBeenCalledTimes(3);
    expect(fetchTokenDetail).not.toHaveBeenCalledWith('arbitrum', expect.anything());
  });

  it('does not cache or count a null detail (no warm, no fail)', async () => {
    fetchTokenDetail.mockResolvedValue(null);
    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(await res.json()).toMatchObject({ ok: true, warmed: 0, failed: 0 });
    expect(cacheSetSwr).not.toHaveBeenCalled();
  });

  it('counts a thrown fetch as failed without aborting the batch', async () => {
    fetchTokenDetail
      .mockResolvedValueOnce({ symbol: 'AAA' })
      .mockRejectedValueOnce(new Error('429'))
      .mockResolvedValueOnce({ symbol: 'CCC' });
    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    const body = await res.json();
    expect(body.warmed).toBe(2);
    expect(body.failed).toBe(1);
    expect(cacheSetSwr).toHaveBeenCalledTimes(2);
  });

  it('writes the cache under the chain:address detail key', async () => {
    fetchTokenDetail.mockResolvedValue({ symbol: 'AAA' });
    const GET = await load();
    await GET(req(`Bearer ${SECRET}`));
    expect(cacheSetSwr).toHaveBeenCalledWith(
      expect.stringMatching(/^lodestar:tokens:detail:v0:mainnet:0x/),
      expect.anything(),
      600,
    );
  });
});
