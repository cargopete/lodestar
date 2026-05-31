/**
 * Tests for /api/push/subscribe — GET status, signed POST opt-in, signed DELETE opt-out.
 * Mocks the db tagged-template and viem verifyMessage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockDb = vi.fn();
vi.mock('@/lib/db', () => ({
  // The route uses `db` as a SQL tagged template: db`...`
  get db() {
    return (...args: unknown[]) => (mockDb as (...a: unknown[]) => unknown)(...args);
  },
}));

const mockVerify = vi.fn();
vi.mock('viem', () => ({
  verifyMessage: (...args: unknown[]) => (mockVerify as (...a: unknown[]) => unknown)(...args),
}));

import { GET, POST, DELETE } from '@/app/api/push/subscribe/route';

const ADDR = '0x' + 'a'.repeat(40);

function getReq(qs: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/push/subscribe${qs}`);
}
function bodyReq(method: string, body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/push/subscribe', {
    method,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.mockResolvedValue([]);
  mockVerify.mockResolvedValue(true);
});

describe('GET /api/push/subscribe', () => {
  it('400s on a missing/invalid address', async () => {
    const res = await GET(getReq('?address=nope'));
    expect(res.status).toBe(400);
  });

  it('returns subscribed:true when an active row exists', async () => {
    mockDb.mockResolvedValue([{ is_active: true }]);
    const res = await GET(getReq(`?address=${ADDR}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ subscribed: true });
  });

  it('returns subscribed:false when no row exists', async () => {
    mockDb.mockResolvedValue([]);
    const res = await GET(getReq(`?address=${ADDR}`));
    expect(await res.json()).toEqual({ subscribed: false });
  });

  it('returns subscribed:false when the row is inactive', async () => {
    mockDb.mockResolvedValue([{ is_active: false }]);
    const res = await GET(getReq(`?address=${ADDR}`));
    expect(await res.json()).toEqual({ subscribed: false });
  });
});

describe('POST /api/push/subscribe', () => {
  it('400s on invalid JSON', async () => {
    const res = await POST(bodyReq('POST', 'not json'));
    expect(res.status).toBe(400);
  });

  it('400s on a bad address', async () => {
    const res = await POST(bodyReq('POST', { address: '0xshort', signature: '0xsig' }));
    expect(res.status).toBe(400);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it('400s when the signature is missing', async () => {
    const res = await POST(bodyReq('POST', { address: ADDR }));
    expect(res.status).toBe(400);
  });

  it('subscribes on a valid signature and writes the row', async () => {
    mockVerify.mockResolvedValue(true);
    const res = await POST(bodyReq('POST', { address: '0x' + 'A'.repeat(40), signature: '0xsig' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ subscribed: true });
    expect(mockDb).toHaveBeenCalled();
  });

  it('403s when the signature does not match the address', async () => {
    mockVerify.mockResolvedValue(false);
    const res = await POST(bodyReq('POST', { address: ADDR, signature: '0xsig' }));
    expect(res.status).toBe(403);
  });

  it('400s when verifyMessage throws (malformed signature)', async () => {
    mockVerify.mockRejectedValue(new Error('bad sig'));
    const res = await POST(bodyReq('POST', { address: ADDR, signature: '0xsig' }));
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/push/subscribe', () => {
  it('400s on a bad address', async () => {
    const res = await DELETE(bodyReq('DELETE', { address: '0xshort', signature: '0xsig' }));
    expect(res.status).toBe(400);
  });

  it('unsubscribes on a valid signature', async () => {
    mockVerify.mockResolvedValue(true);
    const res = await DELETE(bodyReq('DELETE', { address: ADDR, signature: '0xsig' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ subscribed: false });
    expect(mockDb).toHaveBeenCalled();
  });

  it('403s when the signature does not match', async () => {
    mockVerify.mockResolvedValue(false);
    const res = await DELETE(bodyReq('DELETE', { address: ADDR, signature: '0xsig' }));
    expect(res.status).toBe(403);
  });
});
