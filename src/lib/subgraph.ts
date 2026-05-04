/**
 * Server-side subgraph query helper.
 * Used by API routes and cron jobs — NOT for client-side use.
 */

const SUBGRAPH_URL = process.env.GRAPH_API_KEY
  ? `https://gateway-arbitrum.network.thegraph.com/api/${process.env.GRAPH_API_KEY}/subgraphs/id/DZz4kDTdmzWLWsV373w2bSmoar3umKKH9y82SUKr5qmp`
  : null;

// Paolo Diomede's delegation events subgraph (discrete delegation/undelegation/withdrawal events)
const DELEGATION_EVENTS_URL = process.env.GRAPH_API_KEY
  ? `https://gateway-arbitrum.network.thegraph.com/api/${process.env.GRAPH_API_KEY}/subgraphs/id/4LLzwGxX6iBgXzAe4Sp9pEUg6n5h3UTMviAYKPmuUWds`
  : null;

export function hasSubgraphAccess(): boolean {
  return SUBGRAPH_URL !== null;
}

export async function subgraphQuery<T = Record<string, unknown>>(query: string): Promise<T> {
  if (!SUBGRAPH_URL) {
    throw new Error('GRAPH_API_KEY not configured');
  }

  const res = await fetch(SUBGRAPH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    throw new Error(`Subgraph request failed: ${res.status}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  return json.data as T;
}

// ENS subgraph (Ethereum mainnet names — reverse-resolves addresses to .eth names)
const ENS_SUBGRAPH_URL = process.env.GRAPH_API_KEY
  ? `https://gateway-arbitrum.network.thegraph.com/api/${process.env.GRAPH_API_KEY}/subgraphs/id/5XqPmWe6gjyrJtFn9cLy237i4cWw2j9HcUJEXsP5qGtH`
  : null;

export async function ensQuery<T = Record<string, unknown>>(query: string): Promise<T> {
  if (!ENS_SUBGRAPH_URL) {
    throw new Error('GRAPH_API_KEY not configured');
  }

  const res = await fetch(ENS_SUBGRAPH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    throw new Error(`ENS subgraph request failed: ${res.status}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  return json.data as T;
}

// Horizon Indexer Performance subgraph (community — supplementary timeseries data)
// https://thegraph.com/explorer/subgraphs/eD1TVayj2NtmCjWFr4hZhc1APHQs9iR2Xah6KNE8Y4h
const HORIZON_PERF_URL = process.env.GRAPH_API_KEY
  ? `https://gateway-arbitrum.network.thegraph.com/api/${process.env.GRAPH_API_KEY}/subgraphs/id/eD1TVayj2NtmCjWFr4hZhc1APHQs9iR2Xah6KNE8Y4h`
  : null;

export async function horizonPerfQuery<T = Record<string, unknown>>(query: string): Promise<T> {
  if (!HORIZON_PERF_URL) {
    throw new Error('GRAPH_API_KEY not configured');
  }

  const res = await fetch(HORIZON_PERF_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    throw new Error(`Horizon performance subgraph request failed: ${res.status}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  return json.data as T;
}

// Dispatch JSON-RPC indexer registry (tracks Dispatch-registered indexers + supported chains)
// https://thegraph.com/explorer/subgraphs/6qhppfDgeQkQPdCeH297kD82FMYoya3BLYV7rNTkiJz1
const DISPATCH_REGISTRY_URL = process.env.GRAPH_API_KEY
  ? `https://gateway-arbitrum.network.thegraph.com/api/${process.env.GRAPH_API_KEY}/subgraphs/id/6qhppfDgeQkQPdCeH297kD82FMYoya3BLYV7rNTkiJz1`
  : null;

export async function dispatchRegistryQuery<T = Record<string, unknown>>(query: string): Promise<T> {
  if (!DISPATCH_REGISTRY_URL) {
    throw new Error('GRAPH_API_KEY not configured');
  }

  const res = await fetch(DISPATCH_REGISTRY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    throw new Error(`Dispatch registry subgraph request failed: ${res.status}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  return json.data as T;
}

// Gateway QoS Oracle subgraph (Edge & Node — indexer quality of service timeseries)
// https://thegraph.com/explorer/subgraphs/Dtr9rETvwokot4BSXaD5tECanXfqfJKcvHuaaEgPDD2D
const QOS_ORACLE_URL = process.env.GRAPH_API_KEY
  ? `https://gateway-arbitrum.network.thegraph.com/api/${process.env.GRAPH_API_KEY}/subgraphs/id/Dtr9rETvwokot4BSXaD5tECanXfqfJKcvHuaaEgPDD2D`
  : null;

export async function qosOracleQuery<T = Record<string, unknown>>(query: string): Promise<T> {
  if (!QOS_ORACLE_URL) {
    throw new Error('GRAPH_API_KEY not configured');
  }

  const res = await fetch(QOS_ORACLE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    throw new Error(`QoS oracle subgraph request failed: ${res.status}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  return json.data as T;
}

export async function delegationEventsQuery<T = Record<string, unknown>>(query: string): Promise<T> {
  if (!DELEGATION_EVENTS_URL) {
    throw new Error('GRAPH_API_KEY not configured');
  }

  const res = await fetch(DELEGATION_EVENTS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    throw new Error(`Delegation events subgraph request failed: ${res.status}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  return json.data as T;
}
