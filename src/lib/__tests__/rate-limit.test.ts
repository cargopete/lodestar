import { describe, it, expect } from 'vitest';
import { rateLimit } from '../rate-limit';

describe('rateLimit', () => {
  it('always allows requests (fail open — no Edge-compatible Redis)', async () => {
    const result = await rateLimit('1.2.3.4', '/api/feed');
    expect(result.allowed).toBe(true);
  });

  it('returns correct limit for /api/feed (20 rpm)', async () => {
    const result = await rateLimit('1.2.3.4', '/api/feed');
    expect(result.limit).toBe(20);
    expect(result.remaining).toBe(20);
  });

  it('returns correct limit for /api/lodie/chat (10 rpm)', async () => {
    const result = await rateLimit('1.2.3.4', '/api/lodie/chat');
    expect(result.limit).toBe(10);
  });

  it('returns correct limit for /api/cron/ routes (20 rpm)', async () => {
    const result = await rateLimit('1.2.3.4', '/api/cron/refresh');
    expect(result.limit).toBe(20);
  });

  it('returns correct limit for /api/portfolio (30 rpm)', async () => {
    const result = await rateLimit('1.2.3.4', '/api/portfolio');
    expect(result.limit).toBe(30);
  });

  it('returns correct limit for /api/vote (60 rpm)', async () => {
    const result = await rateLimit('1.2.3.4', '/api/vote');
    expect(result.limit).toBe(60);
  });

  it('returns correct limit for /api/subgraph-playground/ (20 rpm)', async () => {
    const result = await rateLimit('1.2.3.4', '/api/subgraph-playground/QmFoo');
    expect(result.limit).toBe(20);
  });

  it('returns fallback limit of 200 rpm for unmatched routes', async () => {
    const result = await rateLimit('1.2.3.4', '/api/epochs');
    expect(result.limit).toBe(200);
  });
});
