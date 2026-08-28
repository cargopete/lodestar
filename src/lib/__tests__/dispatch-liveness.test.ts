import { describe, it, expect, vi } from 'vitest';
import {
  buildRegistry,
  isRegistryLying,
  probeEndpoint,
  probeRegistry,
  summarise,
  type ProviderLiveness,
} from '../dispatch-liveness';

const A = '0xaaaa000000000000000000000000000000000000';
const B = '0xbbbb000000000000000000000000000000000000';

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('buildRegistry', () => {
  it('treats registration as a toggle decided by the LATEST event, not the first', () => {
    // The real case: 0x575267ee registered, deregistered, then re-registered ten blocks later.
    const out = buildRegistry(
      [
        { provider: B, endpoint: 'https://one.example', blockNumber: 100n },
        { provider: B, endpoint: 'https://two.example', blockNumber: 120n },
      ],
      [{ provider: B, blockNumber: 110n }],
      []
    );
    expect(out).toHaveLength(1);
    expect(out[0].address).toBe(B);
    expect(out[0].endpoints).toEqual(['https://one.example', 'https://two.example']);
  });

  it('drops a provider whose last event was a deregistration', () => {
    const out = buildRegistry(
      [{ provider: B, endpoint: 'https://one.example', blockNumber: 100n }],
      [{ provider: B, blockNumber: 200n }],
      []
    );
    expect(out).toEqual([]);
  });

  /** Subtracting the deregistered set from the registered set would get the re-registration wrong. */
  it('is not a set subtraction', () => {
    const out = buildRegistry(
      [{ provider: B, endpoint: 'https://x', blockNumber: 300n }],
      [{ provider: B, blockNumber: 200n }],
      []
    );
    expect(out.map((p) => p.address)).toEqual([B]);
  });

  it('collects endpoints and chains from ServiceStarted as well as registration', () => {
    const out = buildRegistry(
      [{ provider: A, endpoint: 'https://reg.example', blockNumber: 1n }],
      [],
      [
        { provider: A, chainId: 42161, endpoint: 'https://svc.example', blockNumber: 2n },
        { provider: A, chainId: 8453, endpoint: 'https://svc.example', blockNumber: 3n },
      ]
    );
    expect(out[0].endpoints).toEqual(['https://reg.example', 'https://svc.example']);
    expect(out[0].chains).toEqual([8453, 42161]);
  });

  it('ignores empty endpoint strings rather than probing the empty string', () => {
    const out = buildRegistry([{ provider: A, endpoint: '', blockNumber: 1n }], [], []);
    expect(out[0].endpoints).toEqual([]);
  });
});

describe('probeEndpoint', () => {
  it('calls /rpc/{chainId} with a real eth_chainId, not a HEAD or a ping', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ result: '0xa4b1' }));
    const p = await probeEndpoint('https://good.example/', 42161, 8000, fetchImpl as never);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://good.example/rpc/42161');
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.method).toBe('eth_chainId');
    expect(p.status).toBe('serving');
    expect(p.reportedChainId).toBe(42161);
  });

  it('flags an endpoint that answers for a different chain', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ result: '0x1' }));
    const p = await probeEndpoint('https://wrong.example', 42161, 8000, fetchImpl as never);
    expect(p.status).toBe('wrong_chain');
    expect(p.detail).toContain('reports 1');
  });

  /** The exact shape both Railway endpoints returned: the host is up, the service is gone. */
  it('separates a live host serving 404 from a host that does not answer', async () => {
    const four04 = vi.fn().mockResolvedValue(jsonResponse({ message: 'Application not found' }, 404));
    expect((await probeEndpoint('https://gone.example', 42161, 8000, four04 as never)).status).toBe(
      'http_error'
    );

    const dead = vi.fn().mockRejectedValue(new Error('tlsv1 alert internal error'));
    const p = await probeEndpoint('https://dead.example', 42161, 8000, dead as never);
    expect(p.status).toBe('unreachable');
    expect(p.detail).toContain('tlsv1');
  });

  it('reports a timeout as a timeout rather than as unreachable', async () => {
    const abort = vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const p = await probeEndpoint('https://slow.example', 42161, 50, abort as never);
    expect(p.status).toBe('timeout');
  });

  /** A 200 that is not JSON-RPC is not evidence of anything. */
  it('does not accept a 200 with no usable result', async () => {
    const html = vi.fn().mockResolvedValue(jsonResponse({ hello: 'world' }));
    expect((await probeEndpoint('https://lb.example', 42161, 8000, html as never)).status).toBe(
      'bad_response'
    );
    const broken = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('not json');
      },
    } as unknown as Response);
    expect((await probeEndpoint('https://lb2.example', 42161, 8000, broken as never)).status).toBe(
      'bad_response'
    );
  });
});

describe('probeRegistry and summarise', () => {
  it('counts a provider as serving only if one of its endpoints actually answered', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes('good') ? jsonResponse({ result: '0xa4b1' }) : jsonResponse({}, 404)
    );
    const out = await probeRegistry(
      [
        { address: A, endpoints: ['https://bad.example', 'https://good.example'], chains: [42161] },
        { address: B, endpoints: ['https://bad2.example'], chains: [42161] },
      ],
      fetchImpl as never
    );
    expect(out.find((p) => p.address === A)!.serving).toBe(true);
    expect(out.find((p) => p.address === B)!.serving).toBe(false);

    const s = summarise(out);
    expect(s).toMatchObject({ registered: 2, serving: 1, lying: 1 });
  });

  it('probes against a chain the provider registered for, not a hardcoded 42161', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ result: '0x2105' })); // 8453
    await probeRegistry([{ address: A, endpoints: ['https://x.example'], chains: [8453] }], fetchImpl as never);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://x.example/rpc/8453');
  });

  /** The situation on 2026-08-28: everything registered, nothing serving. */
  it('reports the whole registry as lying when nothing answers', async () => {
    const dead = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const out = await probeRegistry(
      [
        { address: A, endpoints: ['https://rpc.cargopete.com'], chains: [42161] },
        { address: B, endpoints: ['https://a.up.railway.app', 'https://b.up.railway.app'], chains: [42161] },
      ],
      dead as never
    );
    const s = summarise(out);
    expect(s.registered).toBe(2);
    expect(s.serving).toBe(0);
    expect(s.lying).toBe(2);
  });

  it('a provider advertising no endpoint at all is not counted as lying', () => {
    const p: ProviderLiveness = { address: A, endpoints: [], chains: [42161], serving: false };
    expect(isRegistryLying(p)).toBe(false);
  });
});
