/**
 * Tests for /api/scuttlebutt/messages — GET history + POST submit.
 * Mocks the db tagged-template, Redis publish, ban check, and (via hasRedis:false)
 * the flood guard so it short-circuits to ok.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockDb = vi.fn();
vi.mock('@/lib/db', () => ({
  get db() {
    return (...args: unknown[]) => (mockDb as (...a: unknown[]) => unknown)(...args);
  },
}));

const mockPublish = vi.fn();
vi.mock('@/lib/cache', () => ({
  publish: (...args: unknown[]) => mockPublish(...args),
  getRedisClient: vi.fn(),
  hasRedis: () => false, // floodCheck fails open -> ok
}));

const mockIsBanned = vi.fn();
vi.mock('@/lib/scuttlebutt-bans', () => ({
  isBanned: (...args: unknown[]) => mockIsBanned(...args),
}));

import { GET, POST } from '@/app/api/scuttlebutt/messages/route';

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/scuttlebutt/messages', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SCUTTLEBUTT_TRIP_SALT = 'salt';
  process.env.SCUTTLEBUTT_IP_PEPPER = 'pepper';
  mockDb.mockResolvedValue([]);
  mockIsBanned.mockResolvedValue(false);
});

describe('GET', () => {
  it('returns messages', async () => {
    mockDb.mockResolvedValue([{ id: 2 }, { id: 1 }]);
    const res = await GET(new NextRequest('http://localhost/api/scuttlebutt/messages'));
    expect(res.status).toBe(200);
    expect((await res.json()).messages).toHaveLength(2);
  });
});

describe('POST', () => {
  it('400s when the body is missing', async () => {
    expect((await POST(postReq({}))).status).toBe(400);
  });

  it('400s on an empty (whitespace) body', async () => {
    expect((await POST(postReq({ body: '   ' }))).status).toBe(400);
  });

  it('posts a message and publishes it', async () => {
    mockDb.mockResolvedValue([
      { id: 1, room: 'main', name: 'Pete', tripcode: null, body: 'ahoy', created_at: 't' },
    ]);
    const res = await POST(postReq({ name: 'Pete', body: 'ahoy' }));
    expect(res.status).toBe(200);
    expect((await res.json()).message.id).toBe(1);
    expect(mockPublish).toHaveBeenCalled();
  });

  it('403s a banned poster and does not insert', async () => {
    mockIsBanned.mockResolvedValue(true);
    const res = await POST(postReq({ body: 'ahoy' }));
    expect(res.status).toBe(403);
    expect(mockDb).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('400s an over-long body', async () => {
    const res = await POST(postReq({ body: 'x'.repeat(2001) }));
    expect(res.status).toBe(400);
  });
});
