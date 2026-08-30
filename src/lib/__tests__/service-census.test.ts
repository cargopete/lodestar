import { describe, it, expect } from 'vitest';
import {
  CENSUS_SERVICES,
  censusHeadline,
  currentProviders,
  isLying,
  probe,
  summarise,
  type ProviderProbe,
  type RegistryEvent,
} from '../service-census';

const ev = (
  provider: string,
  registered: boolean,
  blockNumber: number,
  logIndex = 0,
  endpoint?: string
): RegistryEvent => ({
  provider,
  endpoint,
  blockNumber: BigInt(blockNumber),
  logIndex,
  registered,
});

describe('currentProviders', () => {
  it('counts a straightforward registration', () => {
    expect(currentProviders([ev('0xAA', true, 100, 0, 'https://a')])).toEqual([
      { address: '0xaa', endpoint: 'https://a' },
    ]);
  });

  it('drops a provider that deregistered', () => {
    expect(
      currentProviders([ev('0xAA', true, 100, 0, 'https://a'), ev('0xAA', false, 200)])
    ).toEqual([]);
  });

  /**
   * The case that makes set subtraction wrong, and it is not hypothetical: on Dispatch,
   * `0x575267eE…` deregistered at block 456,950,409 and registered again at 456,950,419. Removing
   * every address that ever appears in a deregistration reports Dispatch as having one provider.
   * It has two, which is the answer to a question the delivery tracker left open for two days.
   */
  it('keeps a provider that deregistered and then registered again', () => {
    const providers = currentProviders([
      ev('0xAA', true, 456947221, 0, 'https://first'),
      ev('0xAA', false, 456950409),
      ev('0xAA', true, 456950419, 0, 'https://second'),
    ]);
    expect(providers).toEqual([{ address: '0xaa', endpoint: 'https://second' }]);
  });

  /** Two events in one block are ordered by log index, not by which arrived in the array. */
  it('orders events within a block by log index', () => {
    expect(currentProviders([ev('0xAA', true, 100, 5), ev('0xAA', false, 100, 1)])).toEqual([
      { address: '0xaa', endpoint: '' },
    ]);
    expect(currentProviders([ev('0xAA', false, 100, 5), ev('0xAA', true, 100, 1, 'https://a')])).toEqual(
      []
    );
  });

  it('is case-insensitive about addresses, because the two events are not consistent', () => {
    expect(currentProviders([ev('0xAaBb', true, 1, 0, 'https://a'), ev('0xaabb', false, 2)])).toEqual(
      []
    );
  });

  it('counts distinct providers separately', () => {
    expect(
      currentProviders([ev('0xAA', true, 1, 0, 'https://a'), ev('0xBB', true, 2, 0, 'https://b')])
    ).toHaveLength(2);
  });

  /** A re-registration under the same endpoint should not read as two providers. */
  it('does not double-count a provider that registered twice', () => {
    expect(
      currentProviders([ev('0xAA', true, 1, 0, 'https://a'), ev('0xAA', true, 2, 0, 'https://a')])
    ).toHaveLength(1);
  });
});

const res = (status: number) =>
  (async () => new Response(null, { status })) as unknown as typeof fetch;

describe('probe', () => {
  it('calls a 2xx serving', async () => {
    const p = await probe({ address: '0xa', endpoint: 'https://x' }, 'http', 100, res(200));
    expect(p.verdict).toBe('serving');
    expect(p.httpStatus).toBe(200);
  });

  /**
   * The Nuthatch Data Service's entire product is a paywall: `402 TAP-Receipt header required` is
   * the door working. Treating 2xx as the only healthy answer would mark the one service in this
   * stack that is actually serving as down, while a dead Railway container returning a cheerful
   * 404 would read as merely unhealthy.
   */
  it('reads 402 as the paywall working, but only where there is a paywall', async () => {
    const paid = await probe({ address: '0xa', endpoint: 'https://x' }, 'paywall', 100, res(402));
    expect(paid.verdict).toBe('paywalled');
    expect(isLying(paid)).toBe(false);

    const free = await probe({ address: '0xa', endpoint: 'https://x' }, 'http', 100, res(402));
    expect(free.verdict).toBe('http_error');
  });

  it('calls a 404 an http error rather than unreachable', async () => {
    const p = await probe({ address: '0xa', endpoint: 'https://x' }, 'http', 100, res(404));
    expect(p.verdict).toBe('http_error');
    expect(isLying(p)).toBe(true);
  });

  it('reports a refused connection as unreachable', async () => {
    const boom = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const p = await probe({ address: '0xa', endpoint: 'https://x' }, 'http', 100, boom);
    expect(p.verdict).toBe('unreachable');
    expect(p.httpStatus).toBeNull();
  });

  it('separates a timeout from a refusal', async () => {
    const hang = (async () => {
      const e = new Error('aborted');
      e.name = 'AbortError';
      throw e;
    }) as unknown as typeof fetch;
    expect((await probe({ address: '0xa', endpoint: 'https://x' }, 'http', 10, hang)).verdict).toBe(
      'timeout'
    );
  });

  /**
   * A provider registered without an endpoint is not lying to anybody. It has told consumers
   * nothing, which is a different failure from telling them to call a dead host.
   */
  it('does not call a provider with no endpoint a liar', async () => {
    const p = await probe({ address: '0xa', endpoint: '' }, 'http', 100, res(200));
    expect(p.verdict).toBe('no_endpoint');
    expect(isLying(p)).toBe(false);
  });
});

const pp = (verdict: ProviderProbe['verdict']): ProviderProbe => ({
  address: '0xa',
  endpoint: 'https://x',
  verdict,
  httpStatus: null,
  latencyMs: null,
});

describe('summarise', () => {
  it('counts registered, serving and lying apart', () => {
    const s = summarise(CENSUS_SERVICES[0], [pp('serving'), pp('http_error'), pp('unreachable')]);
    expect(s).toMatchObject({ registered: 3, serving: 1, lying: 2 });
  });

  it('counts a paywalled provider as serving', () => {
    expect(summarise(CENSUS_SERVICES[0], [pp('paywalled')])).toMatchObject({
      registered: 1,
      serving: 1,
      lying: 0,
    });
  });
});

describe('censusHeadline', () => {
  const svc = (id: string, registered: number, serving: number) => ({
    id,
    name: id,
    address: '0x0',
    registered,
    serving,
    lying: registered - serving,
    providers: [],
  });

  it('separates services that have a provider from ones where any of them answer', () => {
    expect(censusHeadline([svc('a', 2, 0), svc('b', 2, 0), svc('c', 1, 1), svc('d', 0, 0)])).toEqual(
      { services: 4, withAnyProvider: 3, withAnyServing: 1, registered: 5, serving: 1 }
    );
  });

  /**
   * A service whose registry could not be read is excluded rather than counted as zero. Reporting
   * "0 providers" for a service nobody managed to ask is the same class of mistake as the catalogue
   * reading "Live · Production" for a service that stopped answering in July.
   */
  it('excludes a service it could not read rather than calling it empty', () => {
    const withError = [svc('a', 2, 1), { ...svc('b', 0, 0), error: 'RPC timeout' }];
    expect(censusHeadline(withError)).toEqual({
      services: 1,
      withAnyProvider: 1,
      withAnyServing: 1,
      registered: 2,
      serving: 1,
    });
  });
});

describe('CENSUS_SERVICES', () => {
  it('has unique ids and lower-case-comparable addresses', () => {
    const ids = CENSUS_SERVICES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of CENSUS_SERVICES) expect(s.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  /** The paywall probe is a claim about a specific service, so it should not spread by accident. */
  it('only treats the Nuthatch Data Service as a paywall', () => {
    expect(CENSUS_SERVICES.filter((s) => s.probe === 'paywall').map((s) => s.id)).toEqual([
      'nuthatch-data-service',
    ]);
  });
});
