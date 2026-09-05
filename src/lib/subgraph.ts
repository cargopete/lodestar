/**
 * Server-side subgraph query helper.
 * Used by API routes and cron jobs — NOT for client-side use.
 */

import { graphNetworkUrl } from './graph-network';

const SUBGRAPH_URL = graphNetworkUrl(process.env.GRAPH_API_KEY);

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
