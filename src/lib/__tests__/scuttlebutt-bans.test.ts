import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = vi.fn();
vi.mock('@/lib/db', () => ({
  get db() {
    return (...args: unknown[]) => (mockDb as (...a: unknown[]) => unknown)(...args);
  },
}));

import { isBanned, addBan, listBans, removeBan } from '@/lib/scuttlebutt-bans';

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.mockResolvedValue([]);
});

describe('isBanned', () => {
  it('returns true when a matching active ban exists', async () => {
    mockDb.mockResolvedValue([{ ok: 1 }]);
    expect(await isBanned('iphash', null)).toBe(true);
  });

  it('returns false when no ban matches', async () => {
    mockDb.mockResolvedValue([]);
    expect(await isBanned('iphash', null)).toBe(false);
  });

  it('also checks the tripcode when provided', async () => {
    mockDb.mockResolvedValue([]);
    await isBanned('iphash', '!trip');
    expect(mockDb).toHaveBeenCalled();
  });
});

describe('addBan', () => {
  it('returns the inserted ban', async () => {
    const ban = { id: 1, ip_hash: 'h', tripcode: null, reason: 'spam', created_at: 't', expires_at: null };
    mockDb.mockResolvedValue([ban]);
    expect(await addBan({ ipHash: 'h', reason: 'spam' })).toEqual(ban);
  });
});

describe('listBans', () => {
  it('returns the rows', async () => {
    mockDb.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    expect(await listBans()).toHaveLength(2);
  });
});

describe('removeBan', () => {
  it('issues a delete', async () => {
    await removeBan(5);
    expect(mockDb).toHaveBeenCalled();
  });
});
