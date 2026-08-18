import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/logger', () => ({
  log: { api: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } },
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { POST } from '../route';
import { X402_CHAINS } from '@/lib/x402';

const MAINNET = X402_CHAINS.mainnet;
const SUBGRAPH = '5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV';
const DEPLOYMENT = 'QmVXm2E2Ki4RQGGnhpsWJZMKvHkYuTPQzWLmzUXjRJqLMz';

function challengeHeader(overrides: Record<string, unknown> = {}): string {
  const body = {
    x402Version: 2,
    error: 'Payment-Signature header is required',
    resource: { url: 'http://origin.example/subgraphs/id/x' },
    accepts: [
      {
        scheme: 'exact',
        network: MAINNET.network,
        amount: '10000',
        payTo: MAINNET.receiver,
        maxTimeoutSeconds: 300,
        asset: MAINNET.asset,
        extra: { assetTransferMethod: 'eip3009', name: 'USD Coin', version: '2' },
        ...overrides,
      },
    ],
  };
  return Buffer.from(JSON.stringify(body), 'utf8').toString('base64');
}

function req(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL('/api/x402/query', 'http://localhost:3000'), {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function gatewayResponse(
  status: number,
  opts: { headers?: Record<string, string>; json?: unknown } = {},
): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(opts.headers ?? {}),
    json: async () => opts.json ?? {},
  } as unknown as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
  delete process.env.NEXT_PUBLIC_X402_NETWORK;
});

describe('POST /api/x402/query — request validation', () => {
  it('rejects a body that is not JSON', async () => {
    const res = await POST(req('not json'));
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects neither target', async () => {
    const res = await POST(req({ query: '{a}' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/exactly one/);
  });

  it('rejects both targets', async () => {
    const res = await POST(req({ subgraphId: SUBGRAPH, deployment: DEPLOYMENT, query: '{a}' }));
    expect(res.status).toBe(400);
  });

  it('rejects a deployment id that is not a CIDv0', async () => {
    const res = await POST(req({ deployment: '../../etc/passwd', query: '{a}' }));
    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects a missing query', async () => {
    const res = await POST(req({ subgraphId: SUBGRAPH }));
    expect(res.status).toBe(400);
  });

  it('accepts a base58 subgraph id', async () => {
    mockFetch.mockResolvedValue(gatewayResponse(200, { json: { data: { ok: true } } }));
    const res = await POST(req({ subgraphId: SUBGRAPH, query: '{a}' }));
    expect(res.status).toBe(200);
    expect(mockFetch.mock.calls[0][0]).toBe(
      `${MAINNET.gateway}/api/x402/subgraphs/id/${SUBGRAPH}`,
    );
  });
});

describe('POST /api/x402/query — the 402 challenge', () => {
  it('decodes the challenge and returns it with a display price', async () => {
    mockFetch.mockResolvedValue(
      gatewayResponse(402, { headers: { 'payment-required': challengeHeader() } }),
    );
    const res = await POST(req({ subgraphId: SUBGRAPH, query: '{a}' }));
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.needsPayment).toBe(true);
    expect(body.priceTag.payTo).toBe(MAINNET.receiver);
    expect(body.priceUsdc).toBe('0.01');
    // Relayed verbatim so a caller's x402 client parses it as it would from
    // the gateway directly.
    expect(body.challengeHeader).toBe(challengeHeader());
  });

  it('502s when the challenge header is absent', async () => {
    mockFetch.mockResolvedValue(gatewayResponse(402));
    const res = await POST(req({ subgraphId: SUBGRAPH, query: '{a}' }));
    expect(res.status).toBe(502);
  });

  it('502s when the challenge is not decodable', async () => {
    mockFetch.mockResolvedValue(
      gatewayResponse(402, { headers: { 'payment-required': 'not-base64-json' } }),
    );
    const res = await POST(req({ subgraphId: SUBGRAPH, query: '{a}' }));
    expect(res.status).toBe(502);
  });
});

describe('POST /api/x402/query — payment policy', () => {
  it('refuses to relay a challenge paying an unexpected address', async () => {
    mockFetch.mockResolvedValue(
      gatewayResponse(402, {
        headers: {
          'payment-required': challengeHeader({
            payTo: '0xAttacker00000000000000000000000000000000',
          }),
        },
      }),
    );
    const res = await POST(req({ subgraphId: SUBGRAPH, query: '{a}' }));
    expect(res.status).toBe(502);
    expect((await res.json()).detail).toMatch(/unexpected payTo/);
  });

  it('refuses an unexpected asset', async () => {
    mockFetch.mockResolvedValue(
      gatewayResponse(402, {
        headers: {
          'payment-required': challengeHeader({
            asset: '0x0000000000000000000000000000000000000bad',
          }),
        },
      }),
    );
    const res = await POST(req({ subgraphId: SUBGRAPH, query: '{a}' }));
    expect((await res.json()).detail).toMatch(/unexpected asset/);
  });

  it('refuses an amount above the sanity bound', async () => {
    mockFetch.mockResolvedValue(
      gatewayResponse(402, {
        headers: { 'payment-required': challengeHeader({ amount: '999999999' }) },
      }),
    );
    const res = await POST(req({ subgraphId: SUBGRAPH, query: '{a}' }));
    expect((await res.json()).detail).toMatch(/outside accepted bounds/);
  });

  it('refuses a challenge with no tag for our chain', async () => {
    mockFetch.mockResolvedValue(
      gatewayResponse(402, {
        headers: { 'payment-required': challengeHeader({ network: 'eip155:1' }) },
      }),
    );
    const res = await POST(req({ subgraphId: SUBGRAPH, query: '{a}' }));
    expect((await res.json()).detail).toMatch(/no price tag/);
  });
});

describe('POST /api/x402/query — paid request', () => {
  it('forwards the payment header verbatim under the name the gateway reads', async () => {
    mockFetch.mockResolvedValue(gatewayResponse(200, { json: { data: { n: 1 } } }));
    await POST(req({ subgraphId: SUBGRAPH, query: '{a}' }, { 'Payment-Signature': 'SIGNED' }));
    const sent = mockFetch.mock.calls[0][1].headers;
    expect(sent['Payment-Signature']).toBe('SIGNED');
    // The gateway ignores x-payment; sending it would be a silent no-op.
    expect(sent['x-payment']).toBeUndefined();
  });

  it('omits the payment header entirely when the caller sent none', async () => {
    mockFetch.mockResolvedValue(gatewayResponse(200, { json: { data: {} } }));
    await POST(req({ subgraphId: SUBGRAPH, query: '{a}' }));
    expect(mockFetch.mock.calls[0][1].headers['Payment-Signature']).toBeUndefined();
  });

  it('surfaces the settlement receipt header to the caller', async () => {
    mockFetch.mockResolvedValue(
      gatewayResponse(200, {
        headers: { 'payment-response': 'SETTLED' },
        json: { data: { n: 1 } },
      }),
    );
    const res = await POST(req({ subgraphId: SUBGRAPH, query: '{a}' }, { 'Payment-Signature': 'x' }));
    expect(res.headers.get('payment-response')).toBe('SETTLED');
  });

  it('passes a GraphQL error body through rather than reporting success', async () => {
    mockFetch.mockResolvedValue(
      gatewayResponse(200, { json: { errors: [{ message: 'no indexers found' }] } }),
    );
    const res = await POST(req({ subgraphId: SUBGRAPH, query: '{a}' }, { 'Payment-Signature': 'x' }));
    const body = await res.json();
    expect(body.errors[0].message).toBe('no indexers found');
  });

  it('502s and does not leak the upstream URL when the fetch throws', async () => {
    mockFetch.mockRejectedValue(new Error(`connect ECONNREFUSED ${MAINNET.gateway}`));
    const res = await POST(req({ subgraphId: SUBGRAPH, query: '{a}' }));
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain('gateway.thegraph.com');
  });
});

describe('network selection', () => {
  it('targets the testnet gateway when configured', async () => {
    process.env.NEXT_PUBLIC_X402_NETWORK = 'testnet';
    mockFetch.mockResolvedValue(gatewayResponse(200, { json: { data: {} } }));
    await POST(req({ subgraphId: SUBGRAPH, query: '{a}' }));
    expect(mockFetch.mock.calls[0][0]).toContain('gateway.testnet.thegraph.com');
  });
});
