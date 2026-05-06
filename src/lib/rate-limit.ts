import { Redis } from '@upstash/redis';

// Standalone Redis instance — does NOT import logger or cache to stay edge-runtime safe.
// When the Upstash env is unset (or set to empty strings, as some deploy targets do),
// `Redis.fromEnv()` would still construct a client pointed at an invalid URL and every
// `incr` call would block on a multi-second TCP timeout before failing open. Skip the
// client construction entirely in that case so middleware short-circuits instantly.
const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const redis = redisUrl && redisToken ? Redis.fromEnv() : null;

// [path pattern, requests per minute]
const LIMITS: Array<[RegExp, number]> = [
  [/^\/api\/cron\//, 20],
  [/^\/api\/lodie\/chat/, 10],
  [/^\/api\/indexer-status\//, 20],
  [/^\/api\/portfolio/, 30],
  [/^\/api\/feed/, 20],
  [/^\/api\/vote/, 60],
  [/^\/api\//, 200],
];

export async function rateLimit(
  ip: string,
  path: string,
): Promise<{ allowed: boolean; remaining: number; limit: number }> {
  const limit = LIMITS.find(([re]) => re.test(path))?.[1] ?? 200;

  if (!redis) {
    // No Redis configured — let every request through. Production deployments
    // are expected to wire up Upstash; local/dev runs without it.
    return { allowed: true, remaining: limit, limit };
  }

  // Fixed 1-minute window keyed by (ip, top-level route segment, minute bucket)
  const bucket = Math.floor(Date.now() / 60_000);
  const segment = path.split('/').slice(0, 3).join('/');
  const key = `rl:${ip}:${segment}:${bucket}`;

  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 120); // expire after 2 windows
    return { allowed: count <= limit, remaining: Math.max(0, limit - count), limit };
  } catch {
    // Redis unavailable — fail open rather than taking the site down
    return { allowed: true, remaining: limit, limit };
  }
}
