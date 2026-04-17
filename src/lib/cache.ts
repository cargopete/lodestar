import { Redis } from '@upstash/redis';
import { log } from './logger';

let _redis: Redis | null = null;

function getRedis(): Redis {
  if (!_redis) _redis = Redis.fromEnv();
  return _redis;
}

function hasRedis(): boolean {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

/**
 * Fetch from Redis cache or compute and store.
 * Returns cached value if available, otherwise runs fetcher and caches the result.
 * If Redis is not configured, falls through to the fetcher directly.
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
  }

  const fresh = await fetcher();

  if (hasRedis()) {
    try {
      await getRedis().set(key, fresh, { ex: ttlSeconds });
    } catch (e) {
      log.cache.warn({ err: e, key }, 'Redis write failed');
    }
  }

  return fresh;
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
