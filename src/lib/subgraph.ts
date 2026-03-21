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
