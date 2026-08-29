// Rate limiting runs in the Edge runtime where ioredis (TCP) is unavailable.
//
// We use a process-local sliding-window counter. NOTE: this is PER-INSTANCE —
// Vercel may run many edge instances, so the effective global limit is roughly
// (configured limit × instance count). That's an accepted trade-off: it still
// throttles a single IP hammering one warm instance (the common abuse shape)
// with zero external dependencies, and is strictly better than the previous
// always-allow stub. A globally-coordinated limit would need an HTTP-based
// store (e.g. Upstash REST / Vercel KV); revisit if cross-instance accuracy
// becomes necessary.
//
// [path pattern, requests per minute]
const LIMITS: Array<[RegExp, number]> = [
  [/^\/api\/cron\//, 20],
  [/^\/api\/lodie\/chat/, 10],
  [/^\/api\/indexer-status\//, 20],
  [/^\/api\/portfolio/, 30],
  [/^\/api\/feed/, 20],
  [/^\/api\/vote/, 60],
  [/^\/api\/subgraph-playground\//, 20],
  // Source verification spins a sandbox microVM + full build per call — very
  // expensive. Keep it tight; the route also enforces a global Redis-backed cap.
  [/^\/api\/disassembly\/verify/, 4],
  // Scuttlebutt: chatty by nature, but the in-route flood guard is the real
  // throttle. The SSE stream is long-lived (one request), so this mainly bounds
  // POST/GET history calls.
  [/^\/api\/scuttlebutt\//, 60],
  // Keyless x402 relay: each call costs the caller real USDC, so abuse is
  // self-limiting, but the route makes an outbound gateway request per hit.
  [/^\/api\/x402\//, 30],
  // Public SQL. Every call is an analytical query against the Helsinki box, which also runs the
  // Lodestar Oracle, dips-nest and the data-service gateway — so the thing being rationed is not
  // bandwidth but the CPU those depend on. Five a minute is enough to explore a dataset and not
  // enough to lean on it.
  //
  // Read the note at the top of this file before treating that as a hard number: the counter is
  // per-instance, so the real ceiling is 5 × however many edge instances happen to be warm. It
  // throttles one IP hammering one instance, which is the shape abuse usually takes, and it is not
  // a global quota. The query timeout in the route is the harder limit, and the nest's own timeout
  // and row cap are harder still.
  [/^\/api\/sql\/query/, 5],
  [/^\/api\/sql\//, 30],
  [/^\/api\//, 200],
];

const WINDOW_MS = 60_000;

// key -> sorted-ish list of request timestamps (ms) within the current window.
const hits = new Map<string, number[]>();
// Bound the map so a flood of unique IPs can't grow it without limit.
const MAX_KEYS = 10_000;

function limitFor(path: string): number {
  return LIMITS.find(([re]) => re.test(path))?.[1] ?? 200;
}

export async function rateLimit(
  ip: string,
  path: string,
): Promise<{ allowed: boolean; remaining: number; limit: number }> {
  const limit = limitFor(path);
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  // Bucket by the matched limit tier so different paths don't share a counter.
  const tier = LIMITS.find(([re]) => re.test(path))?.[0].source ?? 'default';
  const key = `${ip}:${tier}`;

  const prev = hits.get(key) ?? [];
  // Drop timestamps outside the window.
  const recent = prev.filter((t) => t > windowStart);

  if (recent.length >= limit) {
    hits.set(key, recent);
    return { allowed: false, remaining: 0, limit };
  }

  recent.push(now);
  // Opportunistic eviction to bound memory.
  if (hits.size > MAX_KEYS) {
    for (const [k, ts] of hits) {
      if (ts.length === 0 || ts[ts.length - 1] <= windowStart) hits.delete(k);
      if (hits.size <= MAX_KEYS) break;
    }
  }
  hits.set(key, recent);
  return { allowed: true, remaining: Math.max(0, limit - recent.length), limit };
}
