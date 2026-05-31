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

// Mock the node socket/dns boundaries so the endpoint-set probe path can be
// exercised without opening real sockets. resolve4 + a tcp socket that emits
// 'error' lets us drive DNS-ok / TCP-fail / TLS-skipped deterministically.
const resolve4 = vi.fn();
vi.mock('node:dns/promises', () => ({
  resolve4: (...a: unknown[]) => resolve4(...a),
}));

// A Socket whose connect() schedules an 'error' emit on next tick.
class FakeSocket {
  private handlers: Record<string, (arg?: unknown) => void> = {};
  on(ev: string, cb: (arg?: unknown) => void) { this.handlers[ev] = cb; return this; }
  setTimeout() { /* noop */ }
  destroy() { /* noop */ }
  connect() {
    queueMicrotask(() => this.handlers['error']?.(new Error('ECONNREFUSED')));
  }
}
vi.mock('node:net', () => ({
  Socket: class { constructor() { return new FakeSocket(); } },
}));
vi.mock('node:tls', () => ({
  connect: () => { throw new Error('TLS should not be reached when TCP fails'); },
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

  it('runs DNS+TCP probes when AMP_ENDPOINT is set; TLS/ping/query skipped on TCP failure', async () => {
    process.env.AMP_ENDPOINT = 'https://amp.example.com:8443';
    resolve4.mockResolvedValue(['203.0.113.5']);
    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = await res.json();

    // env reflects the configured endpoint (token still unset → "(not set)")
    expect(body.env.AMP_ENDPOINT).toBe('https://amp.example.com:8443');

    // DNS resolved against the parsed hostname
    expect(resolve4).toHaveBeenCalledWith('amp.example.com');
    expect(body.dns).toEqual(['203.0.113.5']);

    // TCP probe ran (our fake socket emits an error → ok:false), TLS skipped
    expect(body.tcp.ok).toBe(false);
    expect(body.tcp.error).toBe('ECONNREFUSED');
    expect(body.tls).toMatchObject({ ok: false, error: 'TCP failed' });

    // hasAmpAccess is false → ping reports missing config; query never runs
    expect(body.ping).toBe('AMP_ENDPOINT or AMP_TOKEN not set');
    expect(body.query).toBe('skipped');
    expect(ampQuery).not.toHaveBeenCalled();
  });

  it('surfaces a DNS resolution failure as a string in the dns field', async () => {
    process.env.AMP_ENDPOINT = 'https://broken.example.com';
    resolve4.mockRejectedValue(new Error('ENOTFOUND'));
    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    const body = await res.json();
    expect(typeof body.dns).toBe('string');
    expect(body.dns).toContain('DNS error');
    expect(body.dns).toContain('ENOTFOUND');
  });

  it('masks the AMP_TOKEN to its first 8 chars when set', async () => {
    process.env.AMP_ENDPOINT = 'https://amp.example.com';
    process.env.AMP_TOKEN = 'supersecrettoken1234';
    resolve4.mockResolvedValue(['198.51.100.7']);
    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    const body = await res.json();
    expect(body.env.AMP_TOKEN).toBe('supersec…');
    expect(body.env.AMP_TOKEN).not.toContain('token1234');
  });
});
