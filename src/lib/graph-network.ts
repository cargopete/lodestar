/**
 * The Graph Network subgraph's identity, in one place.
 *
 * **Why this file exists.** The deployment id was once written out in full in five places, and a
 * migration made behind the shared client silently missed the feed, which built its own. The
 * dashboard no longer queries the subgraph at all (nuthatch#1160): the gateway client and the URL
 * helpers left with the key. What remains is the id, for the explorer link on the payments page.
 *
 * A leaf module on purpose: `wallet.ts` already exported the constant, but it pulls in wagmi, viem
 * and connector code, so importing it from a server route would drag a client wallet config into the
 * server bundle to read one string.
 */

/** Graph Network subgraph on Arbitrum One. */
export const GRAPH_NETWORK_SUBGRAPH_ID =
  'DZz4kDTdmzWLWsV373w2bSmoar3umKKH9y82SUKr5qmp';

/** Human-facing explorer page for the same deployment. */
export const GRAPH_NETWORK_EXPLORER_URL = `https://thegraph.com/explorer/subgraphs/${GRAPH_NETWORK_SUBGRAPH_ID}`;
