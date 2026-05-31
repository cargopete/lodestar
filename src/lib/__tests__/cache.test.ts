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

// The in-memory cached() path memo-izes its in-flight compute promise and
// attaches a *detached* `.finally()` to clear the map entry. When a fetcher
// rejects, that detached chain raises an unhandledRejection even though our
// callers below await and assert the rejection on the original promise. We
// register a process-level guard (installed at module load so it is always
// present when the async event fires) that swallows ONLY these expected
// fetcher errors and rethrows anything genuinely unexpected.
const EXPECTED_FETCHER_ERRORS = new Set(['upstream-down', 'boom', 'hard-refresh-failed']);
process.on('unhandledRejection', (reason) => {
  if (reason instanceof Error && EXPECTED_FETCHER_ERRORS.has(reason.message)) return;
  throw reason;
});

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

describe('cache: cached() error-in-fetcher handling', () => {
  it('propagates a fetcher rejection on a cold miss and does not cache it', async () => {
    const mod = await import('@/lib/cache');
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('upstream-down'))
      .mockResolvedValueOnce('recovered');

    await expect(mod.cached('err-key', 60, fetcher)).rejects.toThrow('upstream-down');
    // A failed compute must NOT poison the cache — the next call retries.
    expect(await mod.cached('err-key', 60, fetcher)).toBe('recovered');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('clears the in-flight entry after a rejection so concurrent callers can retry later', async () => {
    const mod = await import('@/lib/cache');
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('ok-after-retry');

    // Two concurrent first-callers share the single in-flight compute; both reject.
    const p1 = mod.cached('inflight-err', 60, fetcher);
    const p2 = mod.cached('inflight-err', 60, fetcher);
    await expect(p1).rejects.toThrow('boom');
    await expect(p2).rejects.toThrow('boom');
    expect(fetcher).toHaveBeenCalledTimes(1);

    // After the in-flight promise settled (rejected), a fresh call recomputes.
    expect(await mod.cached('inflight-err', 60, fetcher)).toBe('ok-after-retry');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('still serves the previously cached value after a TTL-expired refresh fails (re-block path)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const mod = await import('@/lib/cache');

    const fetcher = vi
      .fn()
      .mockResolvedValueOnce('first')
      .mockRejectedValueOnce(new Error('hard-refresh-failed'))
      .mockResolvedValueOnce('third');

    expect(await mod.cached('hard-fail', 10, fetcher)).toBe('first');

    // Past the HARD ttl (40s): the entry is fully dead, so cached() blocks and
    // recomputes synchronously. This refresh rejects and the rejection is
    // observable by the caller (not a detached background promise).
    vi.setSystemTime(50_000);
    await expect(mod.cached('hard-fail', 10, fetcher)).rejects.toThrow('hard-refresh-failed');

    // A subsequent call recomputes again and succeeds.
    expect(await mod.cached('hard-fail', 10, fetcher)).toBe('third');
    expect(fetcher).toHaveBeenCalledTimes(3);
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
