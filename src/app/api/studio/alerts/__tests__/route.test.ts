/**
 * Tests for /api/studio/alerts — SIWE-gated CRUD. Covers requireAuth gating,
 * DB guard, GET listing/mapping, and POST validation (deploymentId required,
 * https-only webhook, label/channel/lagThreshold normalisation) plus the
 * create happy path. requireAuth + DB are mocked at the boundary.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireAuth = vi.fn();
vi.mock('@/lib/studio/auth', () => ({ requireAuth: (...a: unknown[]) => requireAuth(...a) }));

const hasDbAccess = vi.fn(() => true);
vi.mock('@/lib/db', () => ({ hasDbAccess: () => hasDbAccess() }));

const createAlert = vi.fn();
const listAlerts = vi.fn();
vi.mock('@/lib/studio/db', () => ({
  createAlert: (...a: unknown[]) => createAlert(...a),
  listAlerts: (...a: unknown[]) => listAlerts(...a),
}));

const ADDR = '0xowner';

async function load() {
  const mod = await import('@/app/api/studio/alerts/route');
  return { GET: mod.GET as (r: NextRequest) => Promise<Response>, POST: mod.POST as (r: NextRequest) => Promise<Response> };
}

function get() {
  return new NextRequest('http://localhost/api/studio/alerts');
}
function post(body: unknown) {
  return new NextRequest('http://localhost/api/studio/alerts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  requireAuth.mockReturnValue({ address: ADDR });
  hasDbAccess.mockReturnValue(true);
});

describe('GET /api/studio/alerts', () => {
  it('returns the auth NextResponse when unauthenticated', async () => {
    requireAuth.mockReturnValue(NextResponse.json({ error: 'Unauthorised' }, { status: 401 }));
    const { GET } = await load();
    const res = await GET(get());
    expect(res.status).toBe(401);
    expect(listAlerts).not.toHaveBeenCalled();
  });

  it('503s when DB unavailable', async () => {
    hasDbAccess.mockReturnValue(false);
    const { GET } = await load();
    expect((await GET(get())).status).toBe(503);
  });

  it('lists and maps the caller alerts to the API shape', async () => {
    listAlerts.mockResolvedValue([{
      id: 5, deployment_id: 'QmX', label: 'lbl', webhook_url: 'https://h',
      channel: 'discord', lag_threshold_blocks: '7000', enabled: true,
      created_at: 'now', last_alerted_at: null, last_status: 'ok',
    }]);
    const { GET } = await load();
    const res = await GET(get());
    const body = await res.json();
    expect(listAlerts).toHaveBeenCalledWith(ADDR);
    expect(body.alerts[0]).toMatchObject({
      id: 5, deploymentId: 'QmX', webhookUrl: 'https://h',
      lagThreshold: 7000, lastStatus: 'ok',
    });
    expect(typeof body.alerts[0].lagThreshold).toBe('number');
  });
});

describe('POST /api/studio/alerts', () => {
  beforeEach(() => {
    createAlert.mockResolvedValue({
      id: 9, deployment_id: 'QmX', label: null, webhook_url: 'https://h',
      channel: 'webhook', lag_threshold_blocks: '5000', enabled: true, created_at: 'now',
    });
  });

  it('returns the auth NextResponse when unauthenticated', async () => {
    requireAuth.mockReturnValue(NextResponse.json({ error: 'Unauthorised' }, { status: 401 }));
    const { POST } = await load();
    expect((await POST(post({ deploymentId: 'QmX', webhookUrl: 'https://h' }))).status).toBe(401);
  });

  it('400s on malformed JSON', async () => {
    const { POST } = await load();
    const res = await POST(post('{bad'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid body');
  });

  it('400s when deploymentId is missing', async () => {
    const { POST } = await load();
    const res = await POST(post({ webhookUrl: 'https://h' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('deploymentId');
  });

  it('400s when webhookUrl is not https', async () => {
    const { POST } = await load();
    const res = await POST(post({ deploymentId: 'QmX', webhookUrl: 'http://insecure' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('https');
  });

  it('400s when webhookUrl is not a valid URL', async () => {
    const { POST } = await load();
    const res = await POST(post({ deploymentId: 'QmX', webhookUrl: 'not a url' }));
    expect(res.status).toBe(400);
  });

  it('creates an alert with normalised defaults (channel/lagThreshold)', async () => {
    const { POST } = await load();
    const res = await POST(post({
      deploymentId: '  QmX  ', webhookUrl: 'https://h',
      channel: 'bogus', lagThreshold: -5,
    }));
    expect(res.status).toBe(200);
    expect(createAlert).toHaveBeenCalledWith(
      ADDR, 'QmX', null, 'https://h', 'webhook', 5000,
    );
    expect((await res.json())).toMatchObject({ id: 9, lagThreshold: 5000 });
  });

  it('passes through a valid channel, trimmed label, and floored lagThreshold', async () => {
    const { POST } = await load();
    await POST(post({
      deploymentId: 'QmX', webhookUrl: 'https://h',
      channel: 'slack', label: '  My Alert  ', lagThreshold: 1234.9,
    }));
    expect(createAlert).toHaveBeenCalledWith(
      ADDR, 'QmX', 'My Alert', 'https://h', 'slack', 1234,
    );
  });
});
