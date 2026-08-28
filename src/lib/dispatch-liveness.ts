/**
 * Does the registry match reality?
 *
 * On 2026-08-28 Dispatch had two providers registered and active on-chain and zero endpoints that
 * answered, and had done for 39 days. Nobody noticed because every health signal we had was
 * on-chain, and `isRegistered()` returning true says precisely nothing about whether an HTTP
 * endpoint accepts a connection. This module closes that gap: it reads what the registry tells a
 * consumer to call, then calls it.
 *
 * The distinction that matters throughout is **registered** versus **serving**. A registry entry
 * is a promise; only a response is evidence.
 */

import { createPublicClient, http, parseAbiItem, type PublicClient } from 'viem';
import { arbitrum } from 'viem/chains';

/** RPCDataService proxy on Arbitrum One — the address to integrate against. */
export const RPC_DATA_SERVICE = '0x7101d5c1a5c89c3647f5118da118e56c023ba0b9' as const;

const PROVIDER_REGISTERED = parseAbiItem(
  'event ProviderRegistered(address indexed provider, string endpoint, string geoHash)'
);
const PROVIDER_DEREGISTERED = parseAbiItem(
  'event ProviderDeregistered(address indexed provider)'
);
const SERVICE_STARTED = parseAbiItem(
  'event ServiceStarted(address indexed provider, uint64 indexed chainId, uint8 tier, string endpoint)'
);

/** Why an endpoint is not serving. Each is a different conversation. */
export type LivenessStatus =
  /** Answered a real JSON-RPC call with the expected chain. */
  | 'serving'
  /** Answered, but reported a different chain than it is registered for. */
  | 'wrong_chain'
  /** Answered with a non-2xx. The host is up; the service is not. */
  | 'http_error'
  /** Answered 2xx but the body was not a usable JSON-RPC result. */
  | 'bad_response'
  /** No connection at all: DNS, TLS or refused. This is what a dead host looks like. */
  | 'unreachable'
  | 'timeout';

export interface EndpointProbe {
  endpoint: string;
  status: LivenessStatus;
  httpStatus: number | null;
  latencyMs: number | null;
  /** Chain id the endpoint reported, when it reported one. */
  reportedChainId: number | null;
  detail: string;
}

export interface ProviderLiveness {
  address: string;
  /** Every endpoint this provider has advertised on-chain. */
  endpoints: EndpointProbe[];
  chains: number[];
  /** True only if at least one advertised endpoint actually answered correctly. */
  serving: boolean;
}

/** `true` when this provider is telling consumers to call something that does not answer. */
export function isRegistryLying(p: ProviderLiveness): boolean {
  return p.endpoints.length > 0 && !p.serving;
}

/** Probes one endpoint with a real JSON-RPC call. `eth_chainId` costs nothing and proves plenty. */
export async function probeEndpoint(
  endpoint: string,
  chainId: number,
  timeoutMs = 8000,
  fetchImpl: typeof fetch = fetch
): Promise<EndpointProbe> {
  const url = `${endpoint.replace(/\/$/, '')}/rpc/${chainId}`;
  const started = Date.now();
  const controller = new AbortController();
  // Cleared in `finally`. Left dangling, each probe leaks a timer and can hold a serverless
  // invocation open past the work it was doing.
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;

    if (!res.ok) {
      return {
        endpoint,
        status: 'http_error',
        httpStatus: res.status,
        latencyMs,
        reportedChainId: null,
        detail: `HTTP ${res.status}`,
      };
    }

    const body = (await res.json().catch(() => null)) as { result?: string } | null;
    const raw = body?.result;
    if (typeof raw !== 'string') {
      return {
        endpoint,
        status: 'bad_response',
        httpStatus: res.status,
        latencyMs,
        reportedChainId: null,
        detail: '2xx with no usable JSON-RPC result',
      };
    }

    const reported = Number.parseInt(raw, 16);
    if (!Number.isFinite(reported)) {
      return {
        endpoint,
        status: 'bad_response',
        httpStatus: res.status,
        latencyMs,
        reportedChainId: null,
        detail: `unparseable chain id ${raw}`,
      };
    }
    if (reported !== chainId) {
      return {
        endpoint,
        status: 'wrong_chain',
        httpStatus: res.status,
        latencyMs,
        reportedChainId: reported,
        detail: `registered for ${chainId}, reports ${reported}`,
      };
    }
    return {
      endpoint,
      status: 'serving',
      httpStatus: res.status,
      latencyMs,
      reportedChainId: reported,
      detail: `${latencyMs}ms`,
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const aborted = err instanceof Error && err.name === 'AbortError';
    return {
      endpoint,
      status: aborted ? 'timeout' : 'unreachable',
      httpStatus: null,
      latencyMs,
      reportedChainId: null,
      // A dead host and a broken TLS config look identical from here, and both mean the same
      // thing to a consumer: the endpoint the registry named does not answer.
      detail: aborted ? `no response in ${timeoutMs}ms` : (err as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function arbitrumClient(): PublicClient {
  const url = process.env.ARBITRUM_RPC_URL;
  // Deliberately no fallback to the Lodestar gateway here. Other modules do that as
  // dogfooding, and it is exactly how a probe would end up asking a dead service whether
  // things are alive.
  return createPublicClient({
    chain: arbitrum,
    transport: http(url),
  }) as PublicClient;
}

/** Reads the registry from chain: who is registered, and what they tell consumers to call. */
export async function fetchRegistry(
  client: PublicClient
): Promise<{ address: string; endpoints: string[]; chains: number[] }[]> {
  const [registered, deregistered, started] = await Promise.all([
    client.getLogs({ address: RPC_DATA_SERVICE, event: PROVIDER_REGISTERED, fromBlock: 0n }),
    client.getLogs({ address: RPC_DATA_SERVICE, event: PROVIDER_DEREGISTERED, fromBlock: 0n }),
    client.getLogs({ address: RPC_DATA_SERVICE, event: SERVICE_STARTED, fromBlock: 0n }),
  ]);
  return buildRegistry(
    registered.map((l) => ({
      provider: String(l.args.provider).toLowerCase(),
      endpoint: String(l.args.endpoint ?? ''),
      blockNumber: l.blockNumber ?? 0n,
    })),
    deregistered.map((l) => ({
      provider: String(l.args.provider).toLowerCase(),
      blockNumber: l.blockNumber ?? 0n,
    })),
    started.map((l) => ({
      provider: String(l.args.provider).toLowerCase(),
      chainId: Number(l.args.chainId ?? 0),
      endpoint: String(l.args.endpoint ?? ''),
      blockNumber: l.blockNumber ?? 0n,
    }))
  );
}

/**
 * Folds the three event streams into the current registry.
 *
 * Registration is a toggle, so the *latest* event per provider decides, not the first. A provider
 * that deregistered and re-registered ten blocks later is registered; taking the first event, or
 * simply subtracting sets, gets that backwards.
 */
export function buildRegistry(
  registered: { provider: string; endpoint: string; blockNumber: bigint }[],
  deregistered: { provider: string; blockNumber: bigint }[],
  started: { provider: string; chainId: number; endpoint: string; blockNumber: bigint }[]
): { address: string; endpoints: string[]; chains: number[] }[] {
  const lastEvent = new Map<string, { block: bigint; active: boolean }>();
  const note = (provider: string, block: bigint, active: boolean) => {
    const prev = lastEvent.get(provider);
    if (!prev || block >= prev.block) lastEvent.set(provider, { block, active });
  };
  for (const r of registered) note(r.provider, r.blockNumber, true);
  for (const d of deregistered) note(d.provider, d.blockNumber, false);

  const endpoints = new Map<string, Set<string>>();
  const chains = new Map<string, Set<number>>();
  const add = (provider: string, endpoint: string, chainId?: number) => {
    if (endpoint) {
      if (!endpoints.has(provider)) endpoints.set(provider, new Set());
      endpoints.get(provider)!.add(endpoint);
    }
    if (chainId) {
      if (!chains.has(provider)) chains.set(provider, new Set());
      chains.get(provider)!.add(chainId);
    }
  };
  for (const r of registered) add(r.provider, r.endpoint);
  for (const s of started) add(s.provider, s.endpoint, s.chainId);

  return [...lastEvent.entries()]
    .filter(([, v]) => v.active)
    .map(([address]) => ({
      address,
      endpoints: [...(endpoints.get(address) ?? [])].sort(),
      chains: [...(chains.get(address) ?? [])].sort((a, b) => a - b),
    }))
    .sort((a, b) => a.address.localeCompare(b.address));
}

/** Probes every advertised endpoint of every registered provider. */
export async function probeRegistry(
  entries: { address: string; endpoints: string[]; chains: number[] }[],
  fetchImpl: typeof fetch = fetch
): Promise<ProviderLiveness[]> {
  return Promise.all(
    entries.map(async (e) => {
      // Probe against a chain the provider actually registered for; 42161 is the payment chain and
      // the common case, but never assume it.
      const chainId = e.chains[0] ?? 42161;
      const endpoints = await Promise.all(
        e.endpoints.map((url) => probeEndpoint(url, chainId, 8000, fetchImpl))
      );
      return {
        address: e.address,
        endpoints,
        chains: e.chains,
        serving: endpoints.some((p) => p.status === 'serving'),
      };
    })
  );
}

export interface LivenessSummary {
  registered: number;
  serving: number;
  /** Registered providers whose advertised endpoints all fail. The number that matters. */
  lying: number;
  providers: ProviderLiveness[];
  checkedAt: number;
}

export function summarise(providers: ProviderLiveness[]): LivenessSummary {
  return {
    registered: providers.length,
    serving: providers.filter((p) => p.serving).length,
    lying: providers.filter(isRegistryLying).length,
    providers,
    checkedAt: Math.floor(Date.now() / 1000),
  };
}
