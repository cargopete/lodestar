/**
 * POST /api/data-services/query — the live playground proxy for Horizon data services.
 *
 * The route exists so a browser can hit a provider without CORS and without ever seeing a key,
 * which makes it a server-side fetcher driven by client input. Two things follow, and they are
 * what these tests are about.
 *
 * The registry must stay server-authoritative. The client sends a slug and nothing else; if an
 * arbitrary URL could reach `fetch` from here this becomes an open proxy on the deployment's
 * network, so the 404 for an unknown slug is a security boundary rather than a nicety.
 *
 * And the answer must stay honest about the provider. A 500 from Camp has to arrive as
 * `ok: false` with Camp's own status, not as a 200 wrapping a body the page renders as a
 * successful query. The playground's whole claim is "this is what the provider actually said".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { POST } from '../route';

const mockFetch = vi.fn();

function post(body: unknown) {
  return new Request('http://localhost/api/data-services/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const call = (slug: unknown) => POST(post({ slug }));
const body = async (slug: unknown) => (await call(slug)).json();

/** A provider response, as `fetch` would hand it back. */
function reply(text: string, { ok = true, status = 200 } = {}) {
  mockFetch.mockResolvedValue({ ok, status, text: async () => text });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mockFetch);
  reply('{"result":"0x1"}');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the request envelope', () => {
  it('400s on a body that is not JSON, without fetching', async () => {
    const res = await POST(post('{ not json'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid request body');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('404s an unknown slug rather than treating it as a URL', async () => {
    const res = await call('https://169.254.169.254/latest/meta-data/');
    expect(res.status).toBe(404);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('404s a slug that is not a string', async () => {
    expect((await call(42)).status).toBe(404);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  for (const key of ['constructor', '__proto__', 'toString']) {
    it(`does not let the prototype key "${key}" masquerade as a registry entry`, async () => {
      // `REGISTRY['constructor']` is a truthy function on any object literal, so a bare lookup
      // walked straight past the 404 and into the signing path. Own-property check only.
      const res = await call(key);
      expect(res.status).toBe(404);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  }
});

describe('the JSON-RPC provider (dispatch)', () => {
  it('POSTs the registry body with the consumer header and no receipt', async () => {
    await call('dispatch');

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://rpc.cargopete.com/rpc/42161');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Consumer-Address']).toBe('0xB70781305939A39e74Aa918416Df1b893e1Bd904');
    expect(init.headers['TAP-Receipt']).toBeUndefined();
    expect(JSON.parse(init.body)).toEqual({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] });
  });
});

describe('the TAP-gated providers', () => {
  for (const slug of ['camp-data-service', 'seahorn']) {
    it(`${slug} carries a signed receipt naming that provider`, async () => {
      await call(slug);

      const [, init] = mockFetch.mock.calls[0];
      const receipt = JSON.parse(init.headers['TAP-Receipt']);

      expect(receipt.signature).toMatch(/^0x[0-9a-f]{130}$/i);
      expect(receipt.receipt.data_service).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(receipt.receipt.service_provider).toMatch(/^0x[0-9a-fA-F]{40}$/);
      // 4e-6 GRT, one compute unit — declared here, settled nowhere.
      expect(receipt.receipt.value).toBe(4_000_000_000_000);
      // The payer is the ephemeral signer, carried in the metadata field.
      expect(receipt.receipt.metadata).toMatch(/^0x[0-9a-f]{40}$/);
    });
  }

  it('signs with a fresh key each time, so two requests never share a payer', async () => {
    await call('seahorn');
    await call('seahorn');

    const first = JSON.parse(mockFetch.mock.calls[0][1].headers['TAP-Receipt']);
    const second = JSON.parse(mockFetch.mock.calls[1][1].headers['TAP-Receipt']);
    expect(first.receipt.metadata).not.toBe(second.receipt.metadata);
    expect(first.signature).not.toBe(second.signature);
  });

  it('sends no body and no consumer header — the receipt is the whole credential', async () => {
    await call('camp-data-service');
    const [, init] = mockFetch.mock.calls[0];
    expect(init.body).toBeUndefined();
    expect(init.headers['X-Consumer-Address']).toBeUndefined();
  });
});

describe('the shim providers', () => {
  for (const slug of ['sdsce', 'mainline-firehose']) {
    it(`${slug} is a plain GET with neither receipt nor body`, async () => {
      await call(slug);
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain('/sample');
      expect(init.method).toBeUndefined();
      expect(init.headers).toBeUndefined();
    });
  }
});

describe('the answer', () => {
  it('parses a JSON body and reports the endpoint it came from', async () => {
    reply('{"jsonrpc":"2.0","result":"0x1234"}');

    const data = await body('dispatch');
    expect(data.ok).toBe(true);
    expect(data.status).toBe(200);
    expect(data.result).toEqual({ jsonrpc: '2.0', result: '0x1234' });
    expect(data.endpoint).toBe('https://rpc.cargopete.com/rpc/42161');
    expect(typeof data.durationMs).toBe('number');
  });

  it('passes a non-JSON body through as text rather than failing', async () => {
    // A provider erroring in HTML is still the provider's answer, and seeing it is the point.
    reply('<html>502 Bad Gateway</html>', { ok: false, status: 502 });

    const data = await body('dispatch');
    expect(data.result).toBe('<html>502 Bad Gateway</html>');
  });

  it('reports the provider\'s failure as a failure, not as a successful query', async () => {
    reply('{"error":"no escrow"}', { ok: false, status: 402 });

    const res = await call('seahorn');
    const data = await res.json();
    // The route itself answered fine; the payload says the provider did not.
    expect(res.status).toBe(200);
    expect(data.ok).toBe(false);
    expect(data.status).toBe(402);
    expect(data.result).toEqual({ error: 'no escrow' });
  });
});

describe('transport failures', () => {
  it('502s with the underlying message', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const res = await call('dispatch');
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.ok).toBe(false);
    expect(data.error).toBe('ECONNREFUSED');
    expect(typeof data.durationMs).toBe('number');
  });

  it('renders a timeout in words the reader can act on', async () => {
    mockFetch.mockRejectedValue(new Error('The operation was aborted due to timeout'));

    const data = await body('sdsce');
    expect(data.error).toBe('request timed out');
  });

  it('handles a thrown non-Error', async () => {
    mockFetch.mockRejectedValue('provider exploded');

    const res = await call('dispatch');
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe('provider exploded');
  });
});
