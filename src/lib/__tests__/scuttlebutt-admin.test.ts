import { describe, it, expect, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import {
  checkAdminPassword,
  createAdminToken,
  verifyAdminToken,
  requireAdmin,
} from '@/lib/scuttlebutt-admin';

beforeAll(() => {
  process.env.SESSION_SECRET = 'x'.repeat(40);
  process.env.SCUTTLEBUTT_ADMIN_SECRET = 'open-sesame';
});

function reqWith(opts: { cookie?: string; csrf?: boolean } = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = `sb_admin=${opts.cookie}`;
  if (opts.csrf) headers['x-sb-admin'] = '1';
  return new NextRequest('http://localhost/api/scuttlebutt/bans', { headers });
}

describe('checkAdminPassword', () => {
  it('accepts the correct password', () => {
    expect(checkAdminPassword('open-sesame')).toBe(true);
  });
  it('rejects the wrong password', () => {
    expect(checkAdminPassword('nope')).toBe(false);
  });
  it('fails closed when the secret is unset', () => {
    const saved = process.env.SCUTTLEBUTT_ADMIN_SECRET;
    delete process.env.SCUTTLEBUTT_ADMIN_SECRET;
    expect(checkAdminPassword('anything')).toBe(false);
    process.env.SCUTTLEBUTT_ADMIN_SECRET = saved;
  });
});

describe('admin token', () => {
  it('round-trips a freshly issued token', () => {
    expect(verifyAdminToken(createAdminToken())).toBe(true);
  });
  it('rejects a tampered signature', () => {
    const t = createAdminToken();
    expect(verifyAdminToken(t.slice(0, -1) + (t.endsWith('a') ? 'b' : 'a'))).toBe(false);
  });
  it('rejects garbage and empty tokens', () => {
    expect(verifyAdminToken('')).toBe(false);
    expect(verifyAdminToken('not-a-token')).toBe(false);
    expect(verifyAdminToken('user:123:deadbeef')).toBe(false);
  });
});

describe('requireAdmin', () => {
  it('401s with no cookie', () => {
    expect(requireAdmin(reqWith())?.status).toBe(401);
  });
  it('403s when authed but missing the CSRF header on a mutation', () => {
    const res = requireAdmin(reqWith({ cookie: createAdminToken() }), { mutation: true });
    expect(res?.status).toBe(403);
  });
  it('passes a read with a valid cookie and no CSRF header', () => {
    const res = requireAdmin(reqWith({ cookie: createAdminToken() }), { mutation: false });
    expect(res).toBeNull();
  });
  it('passes a mutation with cookie + CSRF header', () => {
    const res = requireAdmin(reqWith({ cookie: createAdminToken(), csrf: true }), { mutation: true });
    expect(res).toBeNull();
  });
});
