/**
 * Tests for Scuttlebutt admin auth: login route + bans route authorization.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/scuttlebutt-bans', () => ({
  listBans: vi.fn().mockResolvedValue([]),
  addBan: vi.fn().mockResolvedValue({ id: 1 }),
  removeBan: vi.fn().mockResolvedValue(undefined),
}));

import { POST as login } from '@/app/api/scuttlebutt/admin/login/route';
import { GET as listBansRoute, POST as addBanRoute } from '@/app/api/scuttlebutt/bans/route';
import { createAdminToken } from '@/lib/scuttlebutt-admin';

beforeAll(() => {
  process.env.SESSION_SECRET = 'y'.repeat(40);
  process.env.SCUTTLEBUTT_ADMIN_SECRET = 'open-sesame';
});

beforeEach(() => vi.clearAllMocks());

function jsonReq(method: string, body: unknown, opts: { cookie?: string; csrf?: boolean } = {}) {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers.cookie = `sb_admin=${opts.cookie}`;
  if (opts.csrf) headers['x-sb-admin'] = '1';
  const init: { method: string; headers: Record<string, string>; body?: string } = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') init.body = JSON.stringify(body);
  return new NextRequest('http://localhost/api/scuttlebutt/bans', init);
}

describe('admin login', () => {
  it('401s on the wrong password', async () => {
    const res = await login(jsonReq('POST', { password: 'nope' }));
    expect(res.status).toBe(401);
  });

  it('sets a cookie on the correct password', async () => {
    const res = await login(jsonReq('POST', { password: 'open-sesame' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('sb_admin=');
  });
});

describe('bans route authorization', () => {
  it('401s the list without an admin cookie', async () => {
    const res = await listBansRoute(jsonReq('GET', {}));
    expect(res.status).toBe(401);
  });

  it('lists bans with a valid admin cookie', async () => {
    const res = await listBansRoute(jsonReq('GET', {}, { cookie: createAdminToken() }));
    expect(res.status).toBe(200);
  });

  it('403s an add without the CSRF header', async () => {
    const res = await addBanRoute(jsonReq('POST', { ipHash: 'h' }, { cookie: createAdminToken() }));
    expect(res.status).toBe(403);
  });

  it('adds a ban with cookie + CSRF header', async () => {
    const res = await addBanRoute(
      jsonReq('POST', { ipHash: 'h' }, { cookie: createAdminToken(), csrf: true }),
    );
    expect(res.status).toBe(200);
  });

  it('400s an add with neither ipHash nor tripcode', async () => {
    const res = await addBanRoute(jsonReq('POST', {}, { cookie: createAdminToken(), csrf: true }));
    expect(res.status).toBe(400);
  });
});
