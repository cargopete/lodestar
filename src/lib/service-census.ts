/**
 * How many providers has each data service actually got, read from chain rather than from us?
 *
 * G-1 in the delivery tracker is the top programme risk: every service in this stack has a provider
 * list that reads "us", and a data service with one provider is a contract address rather than a
 * market. The tracker recorded those counts by hand, and hand-written counts drift: it carried
 * Seahorn at 0 while the registry held two registrations, and left "what is the actual Dispatch
 * provider count?" open as a question when it is four RPC calls to settle.
 *
 * So this reads the registries. Every one of these contracts is a fork of the same Horizon
 * `DataService` base and emits the same two events, which is what makes one reader work across all
 * of them.
 *
 * The distinction that runs through the whole module, inherited from `dispatch-liveness.ts` and
 * worth repeating: **registered** is a promise and **serving** is evidence. Dispatch had two
 * registered providers and zero answering endpoints for 39 days, and nothing we monitored noticed,
 * because everything we monitored was on-chain and on-chain state stayed green throughout.
 */

import { createPublicClient, http, parseAbiItem, type PublicClient } from 'viem';
import { arbitrum } from 'viem/chains';

const PROVIDER_REGISTERED = parseAbiItem(
  'event ProviderRegistered(address indexed provider, string endpoint, string geoHash)'
);
const PROVIDER_DEREGISTERED = parseAbiItem('event ProviderDeregistered(address indexed provider)');

/**
 * What a healthy answer looks like, which is not the same question for every service.
 *
 * `paywall` exists because the Nuthatch Data Service's entire product is a paywall: it answers
 * `402 TAP-Receipt header required` when it is working perfectly. A checker that treated 2xx as up
 * would mark the one service in this stack that *is* serving as down, and the one that returns a
 * cheerful 404 from a dead Railway container as fine.
 */
export type ProbeKind = 'http' | 'paywall' | 'jsonrpc';

export interface ServiceUnderCensus {
  /** Matches the `id` in `src/data/data-services.ts` so the page can join the two. */
  id: string;
  name: string;
  /** The DataService contract on Arbitrum One. */
  address: `0x${string}`;
  probe: ProbeKind;
}

/**
 * Only services whose contract is deployed and which follow the register/deregister shape. A
 * service missing from here has no registry to read, and saying "0 providers" about it would be a
 * measurement we did not take.
 */
export const CENSUS_SERVICES: ServiceUnderCensus[] = [
  {
    id: 'dispatch',
    name: 'Dispatch',
    address: '0x7101d5c1a5c89c3647f5118da118e56c023ba0b9',
    probe: 'jsonrpc',
  },
  {
    id: 'seahorn',
    name: 'Seahorn',
    address: '0xdDE3F913cb6D1332Bc018Eb63647020a87dD7B37',
    probe: 'http',
  },
  {
    id: 'sdsce',
    name: 'SDSCE',
    address: '0x1c3e9cca124ad19b9ed3c202d2e6cd106944640c',
    probe: 'http',
  },
  {
    id: 'nuthatch-data-service',
    name: 'Nuthatch Data Service',
    address: '0x647D1Fd14AF2DE3947522B74F1de5B99d317c10A',
    probe: 'paywall',
  },
  {
    id: 'mainline-firehose',
    name: 'Mainline',
    address: '0x12C722149804a8C1Bb5924374e675956315B4456',
    probe: 'http',
  },
];

export interface RegistryEvent {
  provider: string;
  endpoint?: string;
  blockNumber: bigint;
  logIndex: number;
  registered: boolean;
}

export interface CensusProvider {
  address: string;
  endpoint: string;
}

/**
 * Which providers are registered right now, from the event log.
 *
 * **Last event wins; this is not set subtraction.** On Dispatch, `0x575267eE…` deregistered at
 * block 456,950,409 and registered again at 456,950,419, ten blocks later. Removing every address
 * that appears in a deregistration would report that provider as gone and the service as having
 * one provider rather than two, which is exactly the wrong answer to the question the tracker left
 * open. Sorting by (block, logIndex) and keeping the last state is the only version that survives
 * a provider changing its mind.
 */
export function currentProviders(events: RegistryEvent[]): CensusProvider[] {
  const latest = new Map<string, { registered: boolean; endpoint: string }>();
  const ordered = [...events].sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? a.logIndex - b.logIndex
      : a.blockNumber < b.blockNumber
        ? -1
        : 1
  );
  for (const e of ordered) {
    const key = e.provider.toLowerCase();
    latest.set(key, {
      registered: e.registered,
      // A deregistration carries no endpoint, so keep the last one advertised rather than blanking
      // it: if the provider registers again without changing it, that is still the address to call.
      endpoint: e.endpoint ?? latest.get(key)?.endpoint ?? '',
    });
  }
  return [...latest.entries()]
    .filter(([, v]) => v.registered)
    .map(([address, v]) => ({ address, endpoint: v.endpoint }));
}

export type ProbeVerdict =
  /** Answered in the way this service is supposed to answer. */
  | 'serving'
  /** Answered `402`, which for a TAP-gated service is the door working, not the door shut. */
  | 'paywalled'
  /** Answered, but not with anything a consumer could use. A dead container still returns 404. */
  | 'http_error'
  | 'unreachable'
  | 'timeout'
  /** The provider registered without advertising anywhere to call. */
  | 'no_endpoint';

export interface ProviderProbe extends CensusProvider {
  verdict: ProbeVerdict;
  httpStatus: number | null;
  latencyMs: number | null;
}

/** `true` when a provider is telling consumers to call something that does not answer. */
export function isLying(p: ProviderProbe): boolean {
  return p.verdict !== 'serving' && p.verdict !== 'paywalled' && p.verdict !== 'no_endpoint';
}

export async function probe(
  p: CensusProvider,
  kind: ProbeKind,
  timeoutMs = 8000,
  fetchImpl: typeof fetch = fetch
): Promise<ProviderProbe> {
  if (!p.endpoint) {
    return { ...p, verdict: 'no_endpoint', httpStatus: null, latencyMs: null };
  }
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(p.endpoint, {
      method: 'GET',
      signal: controller.signal,
      redirect: 'manual',
    });
    const latencyMs = Date.now() - started;
    // 402 first, and only where the service is meant to charge. Reading it as an error elsewhere
    // would be reading a payment demand from a service that has nothing to sell.
    if (res.status === 402) {
      return {
        ...p,
        verdict: kind === 'paywall' ? 'paywalled' : 'http_error',
        httpStatus: 402,
        latencyMs,
      };
    }
    const ok = res.status >= 200 && res.status < 400;
    return {
      ...p,
      verdict: ok ? 'serving' : 'http_error',
      httpStatus: res.status,
      latencyMs,
    };
  } catch (e) {
    const latencyMs = Date.now() - started;
    const aborted = e instanceof Error && e.name === 'AbortError';
    return {
      ...p,
      verdict: aborted ? 'timeout' : 'unreachable',
      httpStatus: null,
      latencyMs,
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface ServiceCensus {
  id: string;
  name: string;
  address: string;
  registered: number;
  /** Answering in the way this service is supposed to answer. */
  serving: number;
  /** Registered, advertising an endpoint, and that endpoint does not answer. */
  lying: number;
  providers: ProviderProbe[];
  /** Set when the registry itself could not be read, so 0 is never mistaken for "we checked". */
  error?: string;
}

export function summarise(
  s: ServiceUnderCensus,
  providers: ProviderProbe[]
): ServiceCensus {
  return {
    id: s.id,
    name: s.name,
    address: s.address,
    registered: providers.length,
    serving: providers.filter((p) => p.verdict === 'serving' || p.verdict === 'paywalled').length,
    lying: providers.filter(isLying).length,
    providers,
  };
}

function client(): PublicClient {
  const url = process.env.ARBITRUM_RPC_URL;
  if (!url) throw new Error('ARBITRUM_RPC_URL is not set');
  return createPublicClient({ chain: arbitrum, transport: http(url) }) as PublicClient;
}

async function readRegistry(
  c: PublicClient,
  address: `0x${string}`
): Promise<RegistryEvent[]> {
  const [reg, dereg] = await Promise.all([
    c.getLogs({ address, event: PROVIDER_REGISTERED, fromBlock: 0n }),
    c.getLogs({ address, event: PROVIDER_DEREGISTERED, fromBlock: 0n }),
  ]);
  return [
    ...reg.map((l) => ({
      provider: l.args.provider as string,
      endpoint: l.args.endpoint as string,
      blockNumber: l.blockNumber ?? 0n,
      logIndex: l.logIndex ?? 0,
      registered: true,
    })),
    ...dereg.map((l) => ({
      provider: l.args.provider as string,
      blockNumber: l.blockNumber ?? 0n,
      logIndex: l.logIndex ?? 0,
      registered: false,
    })),
  ];
}

/**
 * Read every registry and call every endpoint they advertise.
 *
 * One service failing does not fail the census: a census that returns nothing because one RPC call
 * timed out tells a reader less than one that says which service it could not read.
 */
export async function runCensus(
  services: ServiceUnderCensus[] = CENSUS_SERVICES
): Promise<ServiceCensus[]> {
  const c = client();
  return Promise.all(
    services.map(async (s) => {
      try {
        const providers = currentProviders(await readRegistry(c, s.address));
        return summarise(s, await Promise.all(providers.map((p) => probe(p, s.probe))));
      } catch (e) {
        return {
          id: s.id,
          name: s.name,
          address: s.address,
          registered: 0,
          serving: 0,
          lying: 0,
          providers: [],
          error: e instanceof Error ? e.message : String(e),
        };
      }
    })
  );
}

/** The one number G-1 is about: services with at least one provider that actually answers. */
export function censusHeadline(all: ServiceCensus[]): {
  services: number;
  withAnyProvider: number;
  withAnyServing: number;
  registered: number;
  serving: number;
} {
  const measured = all.filter((s) => !s.error);
  return {
    services: measured.length,
    withAnyProvider: measured.filter((s) => s.registered > 0).length,
    withAnyServing: measured.filter((s) => s.serving > 0).length,
    registered: measured.reduce((n, s) => n + s.registered, 0),
    serving: measured.reduce((n, s) => n + s.serving, 0),
  };
}
