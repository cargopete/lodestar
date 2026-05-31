/**
 * Tests for /api/studio/keys — SIWE-gated API-key management. Covers requireAuth
 * gating + DB guard on both verbs, GET listing with per-key/owner usage and the
 * remaining-quota maths, and POST mint (optional/normalised label, plaintext
 * returned once). Auth, DB, api-keys generator and studio/db are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireAuth = vi.fn();
vi.mock('@/lib/studio/auth', () => ({ requireAuth: (...a: unknown[]) => requireAuth(...a) }));

const hasDbAccess = vi.fn(() => true);
vi.mock('@/lib/db', () => ({ hasDbAccess: () => hasDbAccess() }));

const generateApiKey = vi.fn();
vi.mock('@/lib/studio/api-keys', () => ({ generateApiKey: () => generateApiKey() }));

const createApiKey = vi.fn();
const getKeyUsage = vi.fn();
const getOwnerUsage = vi.fn();
const listApiKeys = vi.fn();
vi.mock('@/lib/studio/db', () => ({
  createApiKey: (...a: unknown[]) => createApiKey(...a),
  getKeyUsage: (...a: unknown[]) => getKeyUsage(...a),
  getOwnerUsage: (...a: unknown[]) => getOwnerUsage(...a),
  listApiKeys: (...a: unknown[]) => listApiKeys(...a),
}));

const ADDR = '0xowner';

async function load() {
  const mod = await import('@/app/api/studio/keys/route');
  return { GET: mod.GET as (r: NextRequest) => Promise<Response>, POST: mod.POST as (r: NextRequest) => Promise<Response> };
}

function get() {
  return new NextRequest('http://localhost/api/studio/keys');
}
function post(body?: unknown) {
  return new NextRequest('http://localhost/api/studio/keys', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  delete process.env.GATEWAY_FREE_TIER_PER_USER;
  requireAuth.mockReturnValue({ address: ADDR });
  hasDbAccess.mockReturnValue(true);
  listApiKeys.mockResolvedValue([]);
  getKeyUsage.mockResolvedValue(0);
  getOwnerUsage.mockResolvedValue(0);
  generateApiKey.mockReturnValue({ plaintext: 'lod_live_abc', hash: 'h', prefix: 'lod_live_ab' });
  createApiKey.mockResolvedValue({ id: 7, label: null, key_prefix: 'lod_live_ab', created_at: 'now' });
});

describe('GET /api/studio/keys', () => {
  it('returns the auth NextResponse (401) when unauthenticated', async () => {
    requireAuth.mockReturnValue(NextResponse.json({ error: 'Unauthorised' }, { status: 401 }));
    const { GET } = await load();
    expect((await GET(get())).status).toBe(401);
    expect(listApiKeys).not.toHaveBeenCalled();
  });

  it('503s when DB unavailable', async () => {
    hasDbAccess.mockReturnValue(false);
    const { GET } = await load();
    expect((await GET(get())).status).toBe(503);
  });

  it('lists keys with usage and computes the remaining quota', async () => {
    listApiKeys.mockResolvedValue([{
      id: 1, label: 'main', key_prefix: 'lod_live_aa', status: 'active',
      created_at: 'c', last_used_at: 'u', revoked_at: null,
    }]);
    getKeyUsage.mockResolvedValue(120);
    getOwnerUsage.mockResolvedValue(1500);
    const { GET } = await load();
    const res = await GET(get());
    const body = await res.json();
    expect(listApiKeys).toHaveBeenCalledWith(ADDR);
    expect(body.keys[0]).toMatchObject({ id: 1, keyPrefix: 'lod_live_aa', usageThisMonth: 120 });
    expect(body.perUserLimit).toBe(5000);
    expect(body.usageThisMonth).toBe(1500);
    expect(body.remaining).toBe(3500);
    expect(body.period).toMatch(/^\d{4}-\d{2}$/);
  });

  it('clamps remaining to zero when over the cap', async () => {
    getOwnerUsage.mockResolvedValue(9999);
    const { GET } = await load();
    const body = await (await GET(get())).json();
    expect(body.remaining).toBe(0);
  });

  it('respects the env-configurable per-user cap', async () => {
    process.env.GATEWAY_FREE_TIER_PER_USER = '100';
    const { GET } = await load();
    const body = await (await GET(get())).json();
    expect(body.perUserLimit).toBe(100);
  });
});

describe('POST /api/studio/keys', () => {
  it('returns the auth NextResponse (401) when unauthenticated', async () => {
    requireAuth.mockReturnValue(NextResponse.json({ error: 'Unauthorised' }, { status: 401 }));
    const { POST } = await load();
    expect((await POST(post({ label: 'x' }))).status).toBe(401);
    expect(createApiKey).not.toHaveBeenCalled();
  });

  it('503s when DB unavailable', async () => {
    hasDbAccess.mockReturnValue(false);
    const { POST } = await load();
    expect((await POST(post({}))).status).toBe(503);
  });

  it('mints a key and returns the plaintext once', async () => {
    const { POST } = await load();
    const res = await POST(post({ label: '  My Key  ' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.key).toBe('lod_live_abc');
    expect(body).toMatchObject({ id: 7, keyPrefix: 'lod_live_ab' });
    expect(createApiKey).toHaveBeenCalledWith(ADDR, 'My Key', 'h', 'lod_live_ab');
  });

  it('mints with a null label when body is empty/invalid', async () => {
    const { POST } = await load();
    await POST(post('{bad'));
    expect(createApiKey).toHaveBeenCalledWith(ADDR, null, 'h', 'lod_live_ab');
  });

  it('truncates an over-long label to 120 chars', async () => {
    const { POST } = await load();
    await POST(post({ label: 'a'.repeat(200) }));
    const passedLabel = createApiKey.mock.calls[0][1] as string;
    expect(passedLabel.length).toBe(120);
  });
});
