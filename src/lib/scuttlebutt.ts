import { getRedisClient, hasRedis } from '@/lib/cache';

/**
 * Shared Scuttlebutt constants, types, and the per-IP flood guard.
 */

export const SB_ROOM = 'main';
export const SB_CHANNEL = 'scuttlebutt:main';
export const MAX_BODY = 2000;
export const HISTORY_LIMIT = 50;

export interface SbMessage {
  id: number;
  room: string;
  name: string | null;
  tripcode: string | null;
  body: string;
  created_at: string;
}

export type SbEvent =
  | { type: 'message'; message: SbMessage }
  | { type: 'delete'; id: number };

// Flood thresholds — coarser than the middleware rate-limit, tuned for "human
// typing in a chat" rather than "API abuse".
const MIN_GAP_MS = 2_000; // minimum spacing between two posts from one IP
const WINDOW_SEC = 30; // burst window
const MAX_IN_WINDOW = 10; // max posts within the burst window

export interface FloodResult {
  ok: boolean;
  reason?: string;
}

/**
 * Per-IP flood guard backed by Redis. Enforces a minimum gap between posts and
 * a burst ceiling. Never blocks on a Redis hiccup (fails open — the middleware
 * rate-limiter is the hard backstop).
 */
export async function floodCheck(ipHash: string): Promise<FloodResult> {
  if (!hasRedis()) return { ok: true };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any;
  try {
    client = await getRedisClient();
  } catch {
    return { ok: true };
  }
  try {
    const gap = await client.set(`sb:gap:${ipHash}`, '1', 'PX', MIN_GAP_MS, 'NX');
    if (gap === null) return { ok: false, reason: 'Posting too fast — slow down a touch.' };

    const winKey = `sb:win:${ipHash}`;
    const count = await client.incr(winKey);
    if (count === 1) await client.expire(winKey, WINDOW_SEC);
    if (count > MAX_IN_WINDOW) return { ok: false, reason: 'Too many messages — take a breather.' };

    return { ok: true };
  } catch {
    return { ok: true };
  }
}
