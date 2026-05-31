import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Exercise the IN-MEMORY fallback deterministically by ensuring REDIS_URL is
// unset. hasRedis() is evaluated at call-time, so deleting the env var is
// sufficient. We resetModules() between tests so the module-scoped memCache /
// memInflight maps start empty each time.

vi.mock('@/lib/logger', () => ({
  log: {
    cache: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
  },
}));

const ORIGINAL_REDIS_URL = process.env.REDIS_URL;

beforeEach(() => {
  delete process.env.REDIS_URL;
  vi.resetModules();
});

afterEach(() => {
  if (ORIGINAL_REDIS_URL === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = ORIGINAL_REDIS_URL;
  vi.useRealTimers();
});

describe('cache: hasRedis', () => {
  it('returns false when REDIS_URL is unset', async () => {
    const mod = await import('@/lib/cache');
    expect(mod.hasRedis()).toBe(false);
  });

  it('returns true when REDIS_URL is set', async () => {
    process.env.REDIS_URL = 'redis://localhost:6379';
    const mod = await import('@/lib/cache');
    expect(mod.hasRedis()).toBe(true);
  });
});

describe('cache: cached() in-memory memoization', () => {
  it('computes once and serves the cached value within ttl', async () => {
    const mod = await import('@/lib/cache');
    const fetcher = vi.fn().mockResolvedValue('value-1');

    const a = await mod.cached('k1', 60, fetcher);
    const b = await mod.cached('k1', 60, fetcher);

    expect(a).toBe('value-1');
    expect(b).toBe('value-1');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keys are isolated — different keys compute independently', async () => {
    const mod = await import('@/lib/cache');
    const f1 = vi.fn().mockResolvedValue('one');
    const f2 = vi.fn().mockResolvedValue('two');

    expect(await mod.cached('a', 60, f1)).toBe('one');
    expect(await mod.cached('b', 60, f2)).toBe('two');
    expect(f1).toHaveBeenCalledTimes(1);
    expect(f2).toHaveBeenCalledTimes(1);
  });

  it('de-dupes concurrent first-callers onto one in-flight fetch', async () => {
    const mod = await import('@/lib/cache');
    let resolveFetch!: (v: string) => void;
    const fetcher = vi.fn(
      () => new Promise<string>((res) => { resolveFetch = res; })
    );

    const p1 = mod.cached('dedupe', 60, fetcher);
    const p2 = mod.cached('dedupe', 60, fetcher);
    resolveFetch('shared');

    expect(await p1).toBe('shared');
    expect(await p2).toBe('shared');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('cache: cached() ttl expiry & stale-while-revalidate', () => {
  it('recomputes after the soft ttl expires (serving stale, refreshing in background)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const mod = await import('@/lib/cache');

    const fetcher = vi
      .fn()
      .mockResolvedValueOnce('fresh-A')
      .mockResolvedValueOnce('fresh-B');

    expect(await mod.cached('swr', 10, fetcher)).toBe('fresh-A');

    // Advance past the soft ttl (10s) but within the hard ttl (40s).
    vi.setSystemTime(15_000);
    // SWR: returns the STALE value immediately, kicks off a background refresh.
    expect(await mod.cached('swr', 10, fetcher)).toBe('fresh-A');

    // Let the background refresh settle.
    await vi.runAllTimersAsync();
    expect(fetcher).toHaveBeenCalledTimes(2);

    // Next read (still fake-time 15s, within new soft ttl) now serves fresh-B.
    expect(await mod.cached('swr', 10, fetcher)).toBe('fresh-B');
  });

  it('blocks and recomputes once the hard ttl (4x) has passed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const mod = await import('@/lib/cache');

    const fetcher = vi
      .fn()
      .mockResolvedValueOnce('old')
      .mockResolvedValueOnce('new');

    expect(await mod.cached('hard', 10, fetcher)).toBe('old');

    // Past hard ttl (10s * 4 = 40s). Entry is fully dead, must block-recompute.
    vi.setSystemTime(50_000);
    expect(await mod.cached('hard', 10, fetcher)).toBe('new');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('cache: cacheGet / cacheSet / cachedSwr without Redis', () => {
  it('cachedSwr delegates to the in-memory cached() path', async () => {
    const mod = await import('@/lib/cache');
    const fetcher = vi.fn().mockResolvedValue('swr-value');

    expect(await mod.cachedSwr('swr-key', 60, fetcher)).toBe('swr-value');
    expect(await mod.cachedSwr('swr-key', 60, fetcher)).toBe('swr-value');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('cacheSet / cacheGet reject when Redis is not configured', async () => {
    // redisSet/redisGet call getRedisClient() which imports ioredis and reads
    // process.env.REDIS_URL!. With no URL the connect path fails — assert it
    // rejects rather than silently succeeding.
    const mod = await import('@/lib/cache');
    await expect(mod.cacheSet('x', { a: 1 }, 60)).rejects.toBeTruthy();
    await expect(mod.cacheGet('x')).rejects.toBeTruthy();
  });
});
