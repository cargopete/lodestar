// Subgraph Disassembly — verify endpoint rate limiter (Phase 2).
//
// Each verification spins up a Vercel Sandbox microVM and runs a full subgraph
// build — minutes of real compute. The middleware's per-instance limiter is the
// first line; this adds a cross-instance Redis-backed cap so a single IP (or the
// world) can't run up an unbounded build bill. Fixed-window counters keyed by
// time bucket — slightly approximate under concurrency, which is fine here.
//
// Resilient by design: when Redis is unavailable (local dev / tests) it falls
// back to a process-local counter rather than throwing — a missing cache must
// never take the endpoint down, only weaken the cap to per-instance.

import { cacheGet, cacheSet } from '@/lib/cache';

const PER_IP = { limit: 8, windowSec: 3600 }; // 8 builds / hour / IP
const GLOBAL = { limit: 60, windowSec: 3600 }; // 60 builds / hour total — cost ceiling

export interface RateDecision {
  allowed: boolean;
  reason?: string;
}

function bucketKey(scope: string, nowSec: number, windowSec: number): string {
  return `lodestar:verify-rl:${scope}:${Math.floor(nowSec / windowSec)}`;
}

const IP_DENIED = `Rate limit: max ${PER_IP.limit} source builds per hour per IP. Try again later.`;
const GLOBAL_DENIED = 'Source verification is busy (global hourly build limit reached). Try again shortly.';

/**
 * Check (and on success, consume) one build slot for this IP and globally.
 * `nowMs` is injected for deterministic testing.
 */
export async function verifyRateLimit(ipHash: string, nowMs: number): Promise<RateDecision> {
  if (process.env.REDIS_URL) {
    try {
      return await redisLimit(ipHash, nowMs);
    } catch {
      /* Redis hiccup — fall back to the per-instance counter below. */
    }
  }
  return memLimit(ipHash, nowMs);
}

async function redisLimit(ipHash: string, nowMs: number): Promise<RateDecision> {
  const nowSec = Math.floor(nowMs / 1000);
  const ipKey = bucketKey(`ip:${ipHash}`, nowSec, PER_IP.windowSec);
  const globalKey = bucketKey('global', nowSec, GLOBAL.windowSec);

  const ipCount = (await cacheGet<number>(ipKey)) ?? 0;
  if (ipCount >= PER_IP.limit) return { allowed: false, reason: IP_DENIED };

  const globalCount = (await cacheGet<number>(globalKey)) ?? 0;
  if (globalCount >= GLOBAL.limit) return { allowed: false, reason: GLOBAL_DENIED };

  // TTL slightly outlives the window so the bucket expires on its own.
  await Promise.all([
    cacheSet(ipKey, ipCount + 1, PER_IP.windowSec + 60),
    cacheSet(globalKey, globalCount + 1, GLOBAL.windowSec + 60),
  ]);
  return { allowed: true };
}

// ---- process-local fallback ------------------------------------------------

const mem = new Map<string, number>();

function memLimit(ipHash: string, nowMs: number): RateDecision {
  const nowSec = Math.floor(nowMs / 1000);
  const ipKey = bucketKey(`ip:${ipHash}`, nowSec, PER_IP.windowSec);
  const globalKey = bucketKey('global', nowSec, GLOBAL.windowSec);

  // Opportunistically drop stale buckets (keys embed the current bucket index,
  // so anything not matching the live keys is from a past window).
  if (mem.size > 5_000) mem.clear();

  const ipCount = mem.get(ipKey) ?? 0;
  if (ipCount >= PER_IP.limit) return { allowed: false, reason: IP_DENIED };

  const globalCount = mem.get(globalKey) ?? 0;
  if (globalCount >= GLOBAL.limit) return { allowed: false, reason: GLOBAL_DENIED };

  mem.set(ipKey, ipCount + 1);
  mem.set(globalKey, globalCount + 1);
  return { allowed: true };
}
