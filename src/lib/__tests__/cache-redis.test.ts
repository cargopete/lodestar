/**
 * The Redis-backed half of the cache: `cached`, `cachedSwr`, pub/sub and the subscriber.
 *
 * The in-memory paths are exercised elsewhere; what is untested here is everything that only runs
 * with `REDIS_URL` set, which is to say everything that runs in production.
 *
 * Two properties matter more than the rest. A cache is a performance device and must never become
 * a correctness one, so every Redis failure has to degrade to computing the value rather than
 * failing the request. And a subscriber connection must never be the shared client, because a
 * connection in subscribe mode cannot issue ordinary commands and quietly breaks every other
 * cache user in the process.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const redisCtor = vi.fn();
const store = new Map<string, string>();
let getShouldThrow = false;
let setShouldThrow = false;
let connectShouldThrow = false;

function makeClient() {
  return {
    connect: vi.fn(async () => {
      if (connectShouldThrow) throw new Error('ECONNREFUSED');
    }),
    disconnect: vi.fn(),
    get: vi.fn(async (k: string) => {
      if (getShouldThrow) throw new Error('redis get failed');
      return store.get(k) ?? null;
    }),
    set: vi.fn(async (k: string, v: string) => {
      if (setShouldThrow) throw new Error('redis set failed');
      store.set(k, v);
      return 'OK';
    }),
    publish: vi.fn(async () => 1),
    quit: vi.fn(),
  };
}

vi.mock('ioredis', () => ({
  default: class {
    constructor(...args: unknown[]) {
      redisCtor(...args);
      return makeClient() as never;
    }
  },
}));
vi.mock('../logger', () => ({
  log: { cache: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } },
}));

const load = () => import('../cache');

beforeEach(() => {
  vi.resetModules(); // the client is memoised at module scope
  vi.clearAllMocks();
  store.clear();
  getShouldThrow = false;
  setShouldThrow = false;
  connectShouldThrow = false;
  process.env.REDIS_URL = 'redis://localhost:6379';
});

afterEach(() => {
  delete process.env.REDIS_URL;
});

describe('cached, with Redis', () => {
  it('computes and stores on a miss', async () => {
    const { cached } = await load();
    const fetcher = vi.fn().mockResolvedValue({ n: 1 });

    await expect(cached('k', 60, fetcher)).resolves.toEqual({ n: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(store.get('k')).toBe(JSON.stringify({ n: 1 }));
  });

  it('serves a hit without calling the fetcher', async () => {
    store.set('k', JSON.stringify({ n: 2 }));
    const { cached } = await load();
    const fetcher = vi.fn();

    await expect(cached('k', 60, fetcher)).resolves.toEqual({ n: 2 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('computes anyway when the Redis read fails', async () => {
    // A cache outage must cost latency, never correctness.
    getShouldThrow = true;
    const { cached } = await load();

    await expect(cached('k', 60, async () => 'computed')).resolves.toBe('computed');
  });

  it('returns the value even when it cannot be written back', async () => {
    setShouldThrow = true;
    const { cached } = await load();
    await expect(cached('k', 60, async () => 'computed')).resolves.toBe('computed');
  });

  it('propagates a fetcher failure rather than caching it', async () => {
    const { cached } = await load();
    await expect(cached('k', 60, async () => { throw new Error('upstream'); })).rejects.toThrow('upstream');
    expect(store.has('k')).toBe(false);
  });
});

describe('connection handling', () => {
  it('shares one client across calls rather than reconnecting', async () => {
    const { cached } = await load();
    await cached('a', 60, async () => 1);
    await cached('b', 60, async () => 2);
    expect(redisCtor).toHaveBeenCalledTimes(1);
  });

  it('has concurrent first callers share a single handshake', async () => {
    // Otherwise every cold caller races its own TLS connect.
    const { cached } = await load();
    await Promise.all([
      cached('a', 60, async () => 1),
      cached('b', 60, async () => 2),
      cached('c', 60, async () => 3),
    ]);
    expect(redisCtor).toHaveBeenCalledTimes(1);
  });

  it('skips CA verification only for rediss://, where the cert is self-signed', async () => {
    process.env.REDIS_URL = 'rediss://host:6379';
    const { cached } = await load();
    await cached('k', 60, async () => 1);

    expect(redisCtor.mock.calls[0][1]).toMatchObject({ tls: { rejectUnauthorized: false } });
  });

  it('does not disable verification for a plain redis:// url', async () => {
    const { cached } = await load();
    await cached('k', 60, async () => 1);
    expect(redisCtor.mock.calls[0][1].tls).toBeUndefined();
  });

  it('falls back to computing when the connection itself cannot be made', async () => {
    connectShouldThrow = true;
    const { cached } = await load();
    await expect(cached('k', 60, async () => 'computed')).resolves.toBe('computed');
  });
});

describe('cachedSwr', () => {
  const KEY = 'swr';

  it('serves fresh data without refreshing', async () => {
    store.set(KEY, JSON.stringify({ data: 'fresh', freshUntil: Date.now() + 60_000 }));
    const { cachedSwr } = await load();
    const fetcher = vi.fn();

    await expect(cachedSwr(KEY, 60, fetcher)).resolves.toBe('fresh');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('serves stale data IMMEDIATELY and refreshes behind it', async () => {
    // The whole point: the caller must not wait for the refresh.
    store.set(KEY, JSON.stringify({ data: 'stale', freshUntil: Date.now() - 1 }));
    const { cachedSwr } = await load();
    let released: (v: string) => void = () => {};
    const fetcher = vi.fn(() => new Promise<string>((r) => { released = r; }));

    await expect(cachedSwr(KEY, 60, fetcher)).resolves.toBe('stale');
    expect(fetcher).toHaveBeenCalledTimes(1);

    released('refreshed');
    await new Promise((r) => setTimeout(r, 0));
    expect(JSON.parse(store.get(KEY)!).data).toBe('refreshed');
  });

  it('does not start a second refresh while one is in flight', async () => {
    store.set(KEY, JSON.stringify({ data: 'stale', freshUntil: Date.now() - 1 }));
    const { cachedSwr } = await load();
    const fetcher = vi.fn(() => new Promise<string>(() => {})); // never settles

    await cachedSwr(KEY, 60, fetcher);
    await cachedSwr(KEY, 60, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps serving stale data when the background refresh fails', async () => {
    store.set(KEY, JSON.stringify({ data: 'stale', freshUntil: Date.now() - 1 }));
    const { cachedSwr } = await load();

    await expect(
      cachedSwr(KEY, 60, async () => { throw new Error('refresh blew up'); }),
    ).resolves.toBe('stale');
    await new Promise((r) => setTimeout(r, 0));
    // The stale entry survives a failed refresh rather than being cleared.
    expect(JSON.parse(store.get(KEY)!).data).toBe('stale');
  });

  it('blocks and computes on a cold miss, storing the envelope', async () => {
    const { cachedSwr } = await load();
    await expect(cachedSwr(KEY, 60, async () => 'first')).resolves.toBe('first');

    const entry = JSON.parse(store.get(KEY)!);
    expect(entry.data).toBe('first');
    expect(entry.freshUntil).toBeGreaterThan(Date.now());
  });

  it('computes anyway when the Redis read fails', async () => {
    getShouldThrow = true;
    const { cachedSwr } = await load();
    await expect(cachedSwr(KEY, 60, async () => 'computed')).resolves.toBe('computed');
  });

  it('returns the value even when the write-back fails', async () => {
    setShouldThrow = true;
    const { cachedSwr } = await load();
    await expect(cachedSwr(KEY, 60, async () => 'computed')).resolves.toBe('computed');
  });

  it('falls back to the in-memory cache with no Redis configured', async () => {
    delete process.env.REDIS_URL;
    const { cachedSwr } = await load();
    const fetcher = vi.fn().mockResolvedValue('memory');

    await expect(cachedSwr(KEY, 60, fetcher)).resolves.toBe('memory');
    await expect(cachedSwr(KEY, 60, fetcher)).resolves.toBe('memory');
    expect(fetcher).toHaveBeenCalledTimes(1); // second call served from memory
  });
});

describe('cacheSetSwr', () => {
  it('writes an envelope a later cachedSwr will read as fresh', async () => {
    const { cacheSetSwr, cachedSwr } = await load();
    await cacheSetSwr('warm', { a: 1 }, 60);

    const fetcher = vi.fn();
    await expect(cachedSwr('warm', 60, fetcher)).resolves.toEqual({ a: 1 });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('publish and subscribe', () => {
  it('is a no-op without Redis, rather than an error', async () => {
    delete process.env.REDIS_URL;
    const { publish } = await load();
    await expect(publish('chan', 'msg')).resolves.toBeUndefined();
    expect(redisCtor).not.toHaveBeenCalled();
  });

  it('swallows a publish failure, since Postgres is the source of truth', async () => {
    const mod = await load();
    // Force the shared client's publish to fail by breaking the connection first.
    connectShouldThrow = true;
    await expect(mod.publish('chan', 'msg')).resolves.toBeUndefined();
  });

  it('returns null for a subscriber when Redis is absent', async () => {
    delete process.env.REDIS_URL;
    const { createRedisSubscriber } = await load();
    await expect(createRedisSubscriber()).resolves.toBeNull();
  });

  it('gives the subscriber its OWN connection, never the shared client', async () => {
    // A connection in subscribe mode cannot issue ordinary commands. Handing back the shared
    // client would quietly break every other cache user in the process.
    const { cached, createRedisSubscriber, getRedisClient } = await load();
    await cached('k', 60, async () => 1);
    const shared = await getRedisClient();
    const sub = await createRedisSubscriber();

    expect(sub).not.toBeNull();
    expect(sub).not.toBe(shared);
    expect(redisCtor).toHaveBeenCalledTimes(2);
  });
});

describe('hasRedis and getRedis', () => {
  it('reports configuration from the environment', async () => {
    const { hasRedis } = await load();
    expect(hasRedis()).toBe(true);

    delete process.env.REDIS_URL;
    const fresh = await load();
    expect(fresh.hasRedis()).toBe(false);
  });

  it('exposes no client until one has been connected', async () => {
    const { getRedis, cached } = await load();
    expect(getRedis()).toBeNull();

    await cached('k', 60, async () => 1);
    expect(getRedis()).not.toBeNull();
  });
});
