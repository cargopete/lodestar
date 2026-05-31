import { log } from './logger';

// ioredis is dynamically imported to avoid bundling TCP socket code into the
// Edge runtime (used by opengraph-image and middleware routes).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _redis: any | null = null;
// Cache the in-flight connect promise so concurrent first-callers share one
// client and all await the same (TLS) handshake instead of racing it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _redisConnecting: Promise<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getRedisClient(): Promise<any> {
  if (_redis) return _redis;
  if (_redisConnecting) return _redisConnecting;

  _redisConnecting = (async () => {
    const { default: Redis } = await import('ioredis');
    const url = process.env.REDIS_URL!;
    // For rediss:// with a self-signed cert (self-hosted VPS Redis), skip CA
    // verification — the AUTH password + TLS still encrypt the channel, we just
    // don't have a public CA chain. Managed providers (Upstash) verify fine, but
    // rejectUnauthorized:false is harmless there too.
    const tls = url.startsWith('rediss://') ? { tls: { rejectUnauthorized: false } } : {};
    // lazyConnect + explicit connect(): the first caller awaits the full
    // (TLS) handshake before issuing a command, so the very first ping()
    // doesn't race the connection. enableOfflineQueue stays false so later
    // commands against a dropped connection fail fast (fall back to memory).
    const client = new Redis(url, { lazyConnect: true, enableOfflineQueue: false, ...tls });
    try {
      await client.connect();
      _redis = client;
      return client;
    } catch (e) {
      log.cache.warn({ err: String(e) }, 'Redis connect failed — falling back to in-memory cache');
      try { client.disconnect(); } catch { /* noop */ }
      throw e;
    } finally {
      _redisConnecting = null;
    }
  })();

  return _redisConnecting;
}

// Sync accessor for health endpoint (it awaits ping() itself).
function getRedis() {
  return _redis;
}

function hasRedis(): boolean {
  return !!process.env.REDIS_URL;
}

async function redisGet<T>(key: string): Promise<T | null> {
  const client = await getRedisClient();
  const raw = await client.get(key);
  if (raw === null) return null;
  return JSON.parse(raw) as T;
}

async function redisSet<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  const client = await getRedisClient();
  await client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
}

// In-memory cache fallback. Used when Redis isn't configured (typical for
// local dev). Without this, every page reload re-runs the directory fan-out
// from scratch — and that's an 80-second wait on cold cache. The map is
// process-scoped, so each Next dev worker gets its own copy; that's fine
// for a single-user dev session.
//
// Also de-dupes concurrent fetches: if a second request arrives while the
// first is still computing, both wait on the same in-flight promise instead
// of issuing a parallel fan-out.
interface MemEntry<T> {
  value: T;
  // When the entry should be considered fresh until.
  expiresAt: number;
  // Hard cap: after this we refuse to serve the value even as stale. Set to
  // 4× ttlSeconds — long enough to cover a slow refresh cycle, short enough
  // to bail out on truly abandoned data.
  hardExpiresAt: number;
}
const memCache = new Map<string, MemEntry<unknown>>();
const memInflight = new Map<string, Promise<unknown>>();

/**
 * Fetch from Redis cache or compute and store.
 * Returns cached value if available, otherwise runs fetcher and caches the result.
 * Falls back to a process-local in-memory cache when Redis isn't configured.
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  if (hasRedis()) {
    try {
      const existing = await redisGet<T>(key);
      if (existing !== null && existing !== undefined) return existing;
    } catch (e) {
      log.cache.warn({ err: e, key }, 'Redis read failed');
    }
  } else {
    const entry = memCache.get(key) as MemEntry<T> | undefined;
    const now = Date.now();
    if (entry && entry.expiresAt > now) return entry.value;
    // Stale-while-revalidate: an expired-but-not-hard-expired entry serves
    // immediately while we kick off a refresh in the background. Without
    // this, a TTL miss makes the user wait the full cold-load duration
    // (~80s for the directory). The first cold load still blocks because
    // there's no stale value to serve yet.
    if (entry && entry.hardExpiresAt > now) {
      if (!memInflight.has(key)) {
        const refresh = (async () => {
          try {
            const fresh = await fetcher();
            memCache.set(key, {
              value: fresh,
              expiresAt: Date.now() + ttlSeconds * 1000,
              hardExpiresAt: Date.now() + ttlSeconds * 1000 * 4,
            });
            return fresh;
          } catch (e) {
            log.cache.warn({ err: e, key }, 'background refresh failed; keeping stale entry');
            throw e;
          }
        })();
        memInflight.set(key, refresh);
        // Detach safely: the refresh rejection is already logged inside the IIFE,
        // and we return the stale `entry.value` (not `refresh`) — so swallow here
        // to avoid an unhandled promise rejection crashing the process.
        refresh.catch(() => {}).finally(() => memInflight.delete(key));
      }
      return entry.value;
    }
    const inflight = memInflight.get(key) as Promise<T> | undefined;
    if (inflight) return inflight;
  }

  const compute = (async () => {
    const fresh = await fetcher();
    if (hasRedis()) {
      try {
        await redisSet(key, fresh, ttlSeconds);
      } catch (e) {
        log.cache.warn({ err: e, key }, 'Redis write failed');
      }
    } else {
      memCache.set(key, {
        value: fresh,
        expiresAt: Date.now() + ttlSeconds * 1000,
        hardExpiresAt: Date.now() + ttlSeconds * 1000 * 4,
      });
    }
    return fresh;
  })();

  if (!hasRedis()) {
    memInflight.set(key, compute);
    // The returned `compute` propagates rejection to the caller; this detached
    // bookkeeping chain must swallow it so it isn't an unhandled rejection.
    compute.catch(() => {}).finally(() => memInflight.delete(key));
  }

  return compute;
}

/**
 * Write directly to Redis (used by cron jobs).
 */
export async function cacheSet<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  await redisSet(key, value, ttlSeconds);
}

/**
 * Read directly from Redis (used by GET endpoints serving pre-computed data).
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  return redisGet<T>(key);
}

// ---------------------------------------------------------------------------
// Stale-while-revalidate cache (Redis-backed)
//
// Stores { data, freshUntil } envelopes. A request after the soft TTL expires
// gets the stale value immediately while a background refresh runs. The Redis
// key itself is kept alive for 4× the soft TTL so stale data is available
// during a slow refresh cycle or a cron hiccup.
// ---------------------------------------------------------------------------

interface SwrEntry<T> {
  data: T;
  freshUntil: number; // epoch ms
}

const swrInflight = new Set<string>();

export async function cachedSwr<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const hardTtl = ttlSeconds * 4;

  if (hasRedis()) {
    try {
      const entry = await redisGet<SwrEntry<T>>(key);
      if (entry != null) {
        if (entry.freshUntil > Date.now()) return entry.data;
        // Stale — serve immediately, kick off background refresh
        if (!swrInflight.has(key)) {
          swrInflight.add(key);
          (async () => {
            try {
              const fresh = await fetcher();
              await redisSet(key, { data: fresh, freshUntil: Date.now() + ttlSeconds * 1000 }, hardTtl);
            } catch (e) {
              log.cache.warn({ err: e, key }, 'SWR background refresh failed');
            } finally {
              swrInflight.delete(key);
            }
          })();
        }
        return entry.data;
      }
    } catch (e) {
      log.cache.warn({ err: e, key }, 'Redis SWR read failed');
    }
    // Cold miss — block and compute
    const fresh = await fetcher();
    try {
      await redisSet(key, { data: fresh, freshUntil: Date.now() + ttlSeconds * 1000 }, hardTtl);
    } catch (e) {
      log.cache.warn({ err: e, key }, 'Redis SWR write failed');
    }
    return fresh;
  }

  // No Redis — fall back to the in-memory cached() which already has SWR
  return cached(key, ttlSeconds, fetcher);
}

/**
 * Write a SWR-formatted entry directly to Redis (used by warmup cron jobs).
 */
export async function cacheSetSwr<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  const entry: SwrEntry<T> = { data: value, freshUntil: Date.now() + ttlSeconds * 1000 };
  await redisSet(key, entry, ttlSeconds * 4);
}

export { getRedis, getRedisClient, hasRedis };
