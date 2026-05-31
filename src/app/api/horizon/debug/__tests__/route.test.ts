/**
 * Tests for /api/horizon/debug — Bearer CRON_SECRET auth + the amp diagnostic
 * report shape. @/lib/amp is mocked at the boundary. AMP_ENDPOINT is left unset
 * so the TCP/TLS/DNS probes are skipped (no real sockets opened in tests).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const hasAmpAccess = vi.fn(() => false);
const ampQuery = vi.fn();
vi.mock('@/lib/amp', () => ({
  hasAmpAccess: () => hasAmpAccess(),
  ampQuery: (...a: unknown[]) => ampQuery(...a),
  AmpError: class AmpError extends Error {},
  HORIZON_STAKING: '0xstaking',
  AMP_DATASET: '"_/arbitrum_one@1.0.0"',
  hexLit: (h: string) => `x'${h}'`,
}));

const SECRET = 'debug-secret';

async function load() {
  const mod = await import('@/app/api/horizon/debug/route');
  return mod.GET as (req: NextRequest) => Promise<Response>;
}

function req(auth?: string) {
  return new NextRequest('http://localhost/api/horizon/debug', {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  process.env.CRON_SECRET = SECRET;
  // unset endpoint/token so probes are skipped — no real network in tests
  delete process.env.AMP_ENDPOINT;
  delete process.env.AMP_TOKEN;
  hasAmpAccess.mockReturnValue(false);
});

describe('horizon/debug auth', () => {
  it('401s with no Authorization header', async () => {
    const GET = await load();
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it('401s with a wrong secret', async () => {
    const GET = await load();
    expect((await GET(req('Bearer nope'))).status).toBe(401);
  });

  it('401s when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET;
    const GET = await load();
    expect((await GET(req('Bearer anything'))).status).toBe(401);
  });
});

describe('horizon/debug report', () => {
  it('returns the diagnostic envelope and skips probes when no endpoint is set', async () => {
    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.env).toMatchObject({ AMP_ENDPOINT: '(not set)', AMP_TOKEN: '(not set)' });
    expect(body.dns).toBe('(skipped)');
    expect(body.tcp).toMatchObject({ ok: false, error: 'no endpoint' });
    // ping reports access missing; query never runs
    expect(body.ping).toBe('AMP_ENDPOINT or AMP_TOKEN not set');
    expect(body.query).toBe('skipped');
    expect(ampQuery).not.toHaveBeenCalled();
  });
});
