/**
 * The Graph Network subgraph's identity, in one place.
 *
 * **Why this file exists.** The deployment id was written out in full in five places:
 * `lib/subgraph.ts`, `api/feed/route.ts` (which builds its own client rather than importing the
 * shared one), `api/subgraph/route.ts`, an explorer link in `app/payments/page.tsx`, and a dead
 * `SUBGRAPH_ID` export in `lib/wallet.ts` that nothing imported. nightswatchhq/nuthatch#1078 proposes
 * `lib/subgraph.ts` as *the* seam for moving these surfaces onto a nest - and with the id duplicated,
 * a change made behind `subgraphQuery` would have silently missed the feed.
 *
 * A leaf module on purpose: `wallet.ts` already exported the constant, but it pulls in wagmi, viem
 * and connector code, so importing it from a server route would drag a client wallet config into the
 * server bundle to read one string.
 */

/** Graph Network subgraph on Arbitrum One. */
export const GRAPH_NETWORK_SUBGRAPH_ID =
  'DZz4kDTdmzWLWsV373w2bSmoar3umKKH9y82SUKr5qmp';

/** The gateway origin every server-side subgraph read goes through. */
export const GRAPH_GATEWAY = 'https://gateway-arbitrum.network.thegraph.com';

/**
 * The gateway URL for a given deployment. `apiKey` is interpolated verbatim, including the
 * `[api-key]` placeholder `api/subgraph/route.ts` uses for its dev-only proxy template.
 */
export function gatewayUrl(apiKey: string, subgraphId: string): string {
  return `${GRAPH_GATEWAY}/api/${apiKey}/subgraphs/id/${subgraphId}`;
}

/** The Graph Network subgraph specifically, or `null` when no key is configured. */
export function graphNetworkUrl(apiKey: string | undefined): string | null {
  return apiKey ? gatewayUrl(apiKey, GRAPH_NETWORK_SUBGRAPH_ID) : null;
}

/** Human-facing explorer page for the same deployment. */
export const GRAPH_NETWORK_EXPLORER_URL = `https://thegraph.com/explorer/subgraphs/${GRAPH_NETWORK_SUBGRAPH_ID}`;
