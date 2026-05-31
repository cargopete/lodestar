/**
 * Tests for /api/studio/alerts/[id] — owner-scoped per-id alert ops. Covers
 * requireAuth gating + DB guard on both verbs, bad-id 400, DELETE happy path,
 * PATCH invalid-JSON 400, PATCH non-boolean `enabled` 400, and PATCH toggle
 * happy path. Ownership is enforced inside the (mocked) DB calls, which are
 * asserted to receive the caller address.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireAuth = vi.fn();
vi.mock('@/lib/studio/auth', () => ({ requireAuth: (...a: unknown[]) => requireAuth(...a) }));

const hasDbAccess = vi.fn(() => true);
vi.mock('@/lib/db', () => ({ hasDbAccess: () => hasDbAccess() }));

const deleteAlert = vi.fn();
const setAlertEnabled = vi.fn();
vi.mock('@/lib/studio/db', () => ({
  deleteAlert: (...a: unknown[]) => deleteAlert(...a),
  setAlertEnabled: (...a: unknown[]) => setAlertEnabled(...a),
}));

const ADDR = '0xowner';

async function load() {
  const mod = await import('@/app/api/studio/alerts/[id]/route');
  return {
    DELETE: mod.DELETE as (r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response>,
    PATCH: mod.PATCH as (r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response>,
  };
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}
function del() {
  return new NextRequest('http://localhost/api/studio/alerts/1', { method: 'DELETE' });
}
function patch(body: unknown) {
  return new NextRequest('http://localhost/api/studio/alerts/1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  requireAuth.mockReturnValue({ address: ADDR });
  hasDbAccess.mockReturnValue(true);
  deleteAlert.mockResolvedValue(undefined);
  setAlertEnabled.mockResolvedValue(undefined);
});

describe('DELETE /api/studio/alerts/[id]', () => {
  it('returns the auth NextResponse (401) when unauthenticated', async () => {
    requireAuth.mockReturnValue(NextResponse.json({ error: 'Unauthorised' }, { status: 401 }));
    const { DELETE } = await load();
    expect((await DELETE(del(), ctx('1'))).status).toBe(401);
    expect(deleteAlert).not.toHaveBeenCalled();
  });

  it('503s when DB unavailable', async () => {
    hasDbAccess.mockReturnValue(false);
    const { DELETE } = await load();
    expect((await DELETE(del(), ctx('1'))).status).toBe(503);
  });

  it('400s on a non-numeric id', async () => {
    const { DELETE } = await load();
    expect((await DELETE(del(), ctx('abc'))).status).toBe(400);
    expect(deleteAlert).not.toHaveBeenCalled();
  });

  it('deletes the alert scoped to the caller address (happy path)', async () => {
    const { DELETE } = await load();
    const res = await DELETE(del(), ctx('5'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(deleteAlert).toHaveBeenCalledWith(5, ADDR);
  });
});

describe('PATCH /api/studio/alerts/[id]', () => {
  it('returns the auth NextResponse (401) when unauthenticated', async () => {
    requireAuth.mockReturnValue(NextResponse.json({ error: 'Unauthorised' }, { status: 401 }));
    const { PATCH } = await load();
    expect((await PATCH(patch({ enabled: true }), ctx('1'))).status).toBe(401);
    expect(setAlertEnabled).not.toHaveBeenCalled();
  });

  it('503s when DB unavailable', async () => {
    hasDbAccess.mockReturnValue(false);
    const { PATCH } = await load();
    expect((await PATCH(patch({ enabled: true }), ctx('1'))).status).toBe(503);
  });

  it('400s on a non-numeric id', async () => {
    const { PATCH } = await load();
    expect((await PATCH(patch({ enabled: true }), ctx('abc'))).status).toBe(400);
  });

  it('400s on invalid JSON body', async () => {
    const { PATCH } = await load();
    const res = await PATCH(patch('{bad'), ctx('1'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid body');
  });

  it('400s when enabled is not a boolean', async () => {
    const { PATCH } = await load();
    const res = await PATCH(patch({ enabled: 'yes' }), ctx('1'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('boolean');
    expect(setAlertEnabled).not.toHaveBeenCalled();
  });

  it('toggles the alert scoped to the caller address (happy path)', async () => {
    const { PATCH } = await load();
    const res = await PATCH(patch({ enabled: false }), ctx('9'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(setAlertEnabled).toHaveBeenCalledWith(9, ADDR, false);
  });
});
