import { describe, it, expect } from 'vitest';
import { verifyRateLimit } from '../disassembly/verify-limit';

// No Redis in tests → cacheGet/cacheSet use the process-local in-memory fallback,
// which is enough to exercise the counter logic deterministically.

const HOUR = 3600_000;

describe('verifyRateLimit', () => {
  it('allows up to the per-IP limit then blocks within the window', async () => {
    const ip = 'iphash-a';
    const t = 1_000_000_000_000; // fixed bucket
    for (let i = 0; i < 8; i++) {
      const d = await verifyRateLimit(ip, t);
      expect(d.allowed).toBe(true);
    }
    const blocked = await verifyRateLimit(ip, t);
    expect(blocked.allowed).toBe(false);
    expect(blocked.reason).toMatch(/per hour per IP/);
  });

  it('resets in a new time bucket', async () => {
    const ip = 'iphash-b';
    const t = 2_000_000_000_000;
    for (let i = 0; i < 8; i++) await verifyRateLimit(ip, t);
    expect((await verifyRateLimit(ip, t)).allowed).toBe(false);
    // jump to the next hour bucket
    expect((await verifyRateLimit(ip, t + HOUR)).allowed).toBe(true);
  });

  it('isolates counters per IP', async () => {
    const t = 3_000_000_000_000;
    for (let i = 0; i < 8; i++) await verifyRateLimit('iphash-c', t);
    expect((await verifyRateLimit('iphash-c', t)).allowed).toBe(false);
    // a different IP in the same bucket is unaffected (global cap is 60)
    expect((await verifyRateLimit('iphash-d', t)).allowed).toBe(true);
  });
});
