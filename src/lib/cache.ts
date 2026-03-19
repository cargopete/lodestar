import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

/**
 * Fetch from Redis cache or compute and store.
 * Returns cached value if available, otherwise runs fetcher and caches the result.
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  try {
    const existing = await redis.get<T>(key);
    if (existing !== null && existing !== undefined) return existing;
  } catch (e) {
    console.warn(`Redis read failed for ${key}:`, e);
  }

  const fresh = await fetcher();

  try {
    await redis.set(key, fresh, { ex: ttlSeconds });
  } catch (e) {
    console.warn(`Redis write failed for ${key}:`, e);
  }

  return fresh;
}

/**
 * Write directly to Redis (used by cron jobs).
 */
export async function cacheSet<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  await redis.set(key, value, { ex: ttlSeconds });
}

/**
 * Read directly from Redis (used by GET endpoints serving pre-computed data).
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  return redis.get<T>(key);
}

export { redis };
