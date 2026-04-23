import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockIncr = vi.fn();
const mockExpire = vi.fn();

vi.mock('@upstash/redis', () => ({
  Redis: {
    fromEnv: vi.fn(() => ({
      incr: mockIncr,
      expire: mockExpire,
    })),
  },
}));

// Import after mock is set up
const { rateLimit } = await import('../rate-limit');

describe('rateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExpire.mockResolvedValue(1);
  });

  it('allows request when under limit', async () => {
    mockIncr.mockResolvedValue(1);
    const result = await rateLimit('1.2.3.4', '/api/feed');
    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(20);
    expect(result.remaining).toBe(19);
  });

  it('sets expiry on first request (count === 1)', async () => {
    mockIncr.mockResolvedValue(1);
    await rateLimit('1.2.3.4', '/api/feed');
    expect(mockExpire).toHaveBeenCalledOnce();
  });

  it('does not set expiry on subsequent requests', async () => {
    mockIncr.mockResolvedValue(2);
    await rateLimit('1.2.3.4', '/api/feed');
    expect(mockExpire).not.toHaveBeenCalled();
  });

  it('blocks request when over limit', async () => {
    mockIncr.mockResolvedValue(21);
    const result = await rateLimit('1.2.3.4', '/api/feed');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('allows exactly at limit', async () => {
    mockIncr.mockResolvedValue(20);
    const result = await rateLimit('1.2.3.4', '/api/feed');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it('applies correct limit for /api/lodie/chat (10 rpm)', async () => {
    mockIncr.mockResolvedValue(1);
    const result = await rateLimit('1.2.3.4', '/api/lodie/chat');
    expect(result.limit).toBe(10);
  });

  it('applies correct limit for /api/cron/ routes (20 rpm)', async () => {
    mockIncr.mockResolvedValue(1);
    const result = await rateLimit('1.2.3.4', '/api/cron/refresh');
    expect(result.limit).toBe(20);
  });

  it('applies correct limit for /api/portfolio (30 rpm)', async () => {
    mockIncr.mockResolvedValue(1);
    const result = await rateLimit('1.2.3.4', '/api/portfolio');
    expect(result.limit).toBe(30);
  });

  it('applies correct limit for /api/vote (60 rpm)', async () => {
    mockIncr.mockResolvedValue(1);
    const result = await rateLimit('1.2.3.4', '/api/vote');
    expect(result.limit).toBe(60);
  });

  it('applies fallback limit of 200 rpm for unmatched routes', async () => {
    mockIncr.mockResolvedValue(1);
    const result = await rateLimit('1.2.3.4', '/api/epochs');
    expect(result.limit).toBe(200);
  });

  it('fails open when Redis is unavailable', async () => {
    mockIncr.mockRejectedValue(new Error('Redis connection failed'));
    const result = await rateLimit('1.2.3.4', '/api/feed');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(20);
    expect(result.limit).toBe(20);
  });

  it('isolates keys by IP, path segment, and time bucket', async () => {
    mockIncr.mockResolvedValue(1);
    await rateLimit('10.0.0.1', '/api/feed');
    await rateLimit('10.0.0.2', '/api/feed');
    expect(mockIncr).toHaveBeenCalledTimes(2);
    const [key1] = mockIncr.mock.calls[0];
    const [key2] = mockIncr.mock.calls[1];
    expect(key1).toContain('10.0.0.1');
    expect(key2).toContain('10.0.0.2');
    expect(key1).not.toBe(key2);
  });
});
