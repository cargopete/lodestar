import { Redis } from '@upstash/redis';
import { log } from './logger';

let _redis: Redis | null = null;

function getRedis(): Redis {
  if (!_redis) {
    const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
    _redis = new Redis({ url: url!, token: token! });
  }
  return _redis;
}

function hasRedis(): boolean {
  // Treat empty strings as unset. Some deploy targets inject the env keys with
  // empty values when no Redis is provisioned, which would otherwise route
  // every cache read/write through an invalid URL and stall on TCP timeout.
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  return !!(url && token);
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
      const existing = await getRedis().get<T>(key);
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
        refresh.finally(() => memInflight.delete(key));
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
        await getRedis().set(key, fresh, { ex: ttlSeconds });
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
    compute.finally(() => memInflight.delete(key));
  }

  return compute;
}

/**
 * Write directly to Redis (used by cron jobs).
 */
export async function cacheSet<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  await getRedis().set(key, value, { ex: ttlSeconds });
}

/**
 * Read directly from Redis (used by GET endpoints serving pre-computed data).
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  return getRedis().get<T>(key);
}

export { getRedis, hasRedis };
