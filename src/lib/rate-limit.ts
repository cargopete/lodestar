// Rate limiting runs in the Edge runtime where ioredis (TCP) is unavailable.
// Without a Redis backend, all requests pass through (fail open).
// [path pattern, requests per minute]
const LIMITS: Array<[RegExp, number]> = [
  [/^\/api\/cron\//, 20],
  [/^\/api\/lodie\/chat/, 10],
  [/^\/api\/indexer-status\//, 20],
  [/^\/api\/portfolio/, 30],
  [/^\/api\/feed/, 20],
  [/^\/api\/vote/, 60],
  [/^\/api\/subgraph-playground\//, 20],
  [/^\/api\//, 200],
];

export async function rateLimit(
  ip: string,
  path: string,
): Promise<{ allowed: boolean; remaining: number; limit: number }> {
  const limit = LIMITS.find(([re]) => re.test(path))?.[1] ?? 200;
  return { allowed: true, remaining: limit, limit };
}
