import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock viem's verifyMessage at the module boundary — we never want real ECDSA.
const verifyMessage = vi.fn();
vi.mock('viem', () => ({
  verifyMessage: (...args: unknown[]) =>
    (verifyMessage as (...a: unknown[]) => unknown)(...args),
}));

const VALID_SECRET = 'a'.repeat(64); // 64-char secret, well over the 32 min
const ENV = process.env;

beforeEach(() => {
  vi.resetModules();
  verifyMessage.mockReset();
  process.env = { ...ENV, SESSION_SECRET: VALID_SECRET };
});

afterEach(() => {
  process.env = ENV;
  vi.useRealTimers();
});

describe('createSession / parseSession', () => {
  it('round-trips: a freshly minted session parses back to the lowercased address', async () => {
    const { createSession, parseSession } = await import('@/lib/studio/auth');
    const token = createSession('0xABCDEF0000000000000000000000000000000001');
    expect(parseSession(token)).toBe('0xabcdef0000000000000000000000000000000001');
  });

  it('rejects a token whose signature has been tampered with', async () => {
    const { createSession, parseSession } = await import('@/lib/studio/auth');
    const token = createSession('0xabc');
    // Flip the last hex char of the signature.
    const last = token.slice(-1);
    const tampered = token.slice(0, -1) + (last === 'f' ? 'e' : 'f');
    expect(parseSession(tampered)).toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const { createSession } = await import('@/lib/studio/auth');
    const token = createSession('0xabc');

    // Re-import the module under a different secret to verify it parses null.
    vi.resetModules();
    process.env.SESSION_SECRET = 'b'.repeat(64);
    const { parseSession } = await import('@/lib/studio/auth');
    expect(parseSession(token)).toBeNull();
  });

  it('rejects a session older than SESSION_TTL (7 days)', async () => {
    vi.useFakeTimers();
    const t0 = new Date('2026-01-01T00:00:00Z');
    vi.setSystemTime(t0);
    const { createSession, parseSession } = await import('@/lib/studio/auth');
    const token = createSession('0xabc');

    // Jump 8 days forward — past the 7-day TTL.
    vi.setSystemTime(new Date(t0.getTime() + 8 * 24 * 60 * 60 * 1000));
    expect(parseSession(token)).toBeNull();

    // Still valid at 6 days.
    vi.setSystemTime(new Date(t0.getTime() + 6 * 24 * 60 * 60 * 1000));
    expect(parseSession(token)).toBe('0xabc');
  });

  it('returns null on a malformed token (no colon / wrong part count)', async () => {
    const { parseSession } = await import('@/lib/studio/auth');
    expect(parseSession('not-a-token')).toBeNull();
    expect(parseSession('only:two')).toBeNull(); // payload "only" splits to 1 part
    expect(parseSession('addr:notanumber:sig')).toBeNull();
  });

  it('throws if SESSION_SECRET is shorter than 32 chars', async () => {
    process.env.SESSION_SECRET = 'tooshort';
    const { createSession } = await import('@/lib/studio/auth');
    expect(() => createSession('0xabc')).toThrow(/at least 32 characters/);
  });

  it('throws if SESSION_SECRET is unset', async () => {
    delete process.env.SESSION_SECRET;
    const { createSession } = await import('@/lib/studio/auth');
    expect(() => createSession('0xabc')).toThrow(/SESSION_SECRET env var not set/);
  });
});

describe('deploy key helpers', () => {
  it('generateDeployKey yields 64 hex chars and is random', async () => {
    const { generateDeployKey } = await import('@/lib/studio/auth');
    const a = generateDeployKey();
    const b = generateDeployKey();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });

  it('hashKey is a deterministic sha256 hex digest', async () => {
    const { hashKey } = await import('@/lib/studio/auth');
    expect(hashKey('secret')).toBe(hashKey('secret'));
    expect(hashKey('secret')).toMatch(/^[0-9a-f]{64}$/);
    expect(hashKey('secret')).not.toBe(hashKey('other'));
  });
});

describe('verifySignIn', () => {
  const NOW = 1_800_000_000; // fixed epoch seconds

  function msg(ts: number, address = '0xabc') {
    return `Sign in to Lodestar Studio\n\nAddress: ${address}\nTimestamp: ${ts}`;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW * 1000);
  });

  it('returns false when the message lacks a Timestamp', async () => {
    const { verifySignIn } = await import('@/lib/studio/auth');
    expect(await verifySignIn('0xabc', 'no timestamp here', '0xsig')).toBe(false);
    expect(verifyMessage).not.toHaveBeenCalled();
  });

  it('rejects a stale message outside the AUTH_WINDOW (replay protection)', async () => {
    const { verifySignIn } = await import('@/lib/studio/auth');
    // 301s in the past — just past the 300s window.
    const out = await verifySignIn('0xabc', msg(NOW - 301), '0xsig');
    expect(out).toBe(false);
    expect(verifyMessage).not.toHaveBeenCalled();
  });

  it('rejects a message timestamped too far in the future', async () => {
    const { verifySignIn } = await import('@/lib/studio/auth');
    expect(await verifySignIn('0xabc', msg(NOW + 301), '0xsig')).toBe(false);
    expect(verifyMessage).not.toHaveBeenCalled();
  });

  it('delegates to viem.verifyMessage for a fresh message and returns its result', async () => {
    verifyMessage.mockResolvedValue(true);
    const { verifySignIn } = await import('@/lib/studio/auth');
    const message = msg(NOW - 10, '0xdeadbeef');
    const out = await verifySignIn('0xdeadbeef', message, '0xsignature');
    expect(out).toBe(true);
    expect(verifyMessage).toHaveBeenCalledWith({
      address: '0xdeadbeef',
      message,
      signature: '0xsignature',
    });
  });

  it('returns false when viem reports a bad signature', async () => {
    verifyMessage.mockResolvedValue(false);
    const { verifySignIn } = await import('@/lib/studio/auth');
    expect(await verifySignIn('0xabc', msg(NOW), '0xbad')).toBe(false);
  });

  it('swallows a throwing verifyMessage and returns false', async () => {
    verifyMessage.mockRejectedValue(new Error('invalid signature length'));
    const { verifySignIn } = await import('@/lib/studio/auth');
    expect(await verifySignIn('0xabc', msg(NOW), '0xsig')).toBe(false);
  });
});

describe('buildSignInMessage', () => {
  it('embeds the address and timestamp in the canonical format', async () => {
    const { buildSignInMessage } = await import('@/lib/studio/auth');
    const m = buildSignInMessage('0xABC', 12345);
    expect(m).toContain('Address: 0xABC');
    expect(m).toContain('Timestamp: 12345');
    expect(m.startsWith('Sign in to Lodestar Studio')).toBe(true);
  });
});
