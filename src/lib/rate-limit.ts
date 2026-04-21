import { Redis } from '@upstash/redis';

// Standalone Redis instance — does NOT import logger or cache to stay edge-runtime safe.
const redis = Redis.fromEnv();

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
