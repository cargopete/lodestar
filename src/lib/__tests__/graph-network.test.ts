import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  GRAPH_NETWORK_SUBGRAPH_ID,
  GRAPH_NETWORK_EXPLORER_URL,
  gatewayUrl,
  graphNetworkUrl,
} from '../graph-network';

/**
 * nightswatchhq/nuthatch#1078 proposes `lib/subgraph.ts` as the seam for moving these surfaces onto
 * a nest. That only works if the deployment id has one home. It had five, and `api/feed/route.ts`
 * builds its own client rather than importing the shared one - so a change made behind
 * `subgraphQuery` would have silently missed the feed.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(name) ? [p] : [];
  });
}

describe('the Graph Network subgraph id has exactly one home', () => {
  it('appears as a literal only in graph-network.ts', () => {
    const offenders = sourceFiles('src')
      .filter((p) => !p.endsWith(join('lib', 'graph-network.ts')))
      .filter((p) => !p.includes('__tests__'))
      .filter((p) => readFileSync(p, 'utf8').includes(GRAPH_NETWORK_SUBGRAPH_ID));

    expect(
      offenders,
      'a second copy of the deployment id defeats the seam: a migration made behind subgraphQuery ' +
        'would miss whichever surface holds the duplicate, which is exactly how api/feed was missed'
    ).toEqual([]);
  });

  it('builds the gateway url the four call sites used to build by hand', () => {
    expect(gatewayUrl('KEY', GRAPH_NETWORK_SUBGRAPH_ID)).toBe(
      `https://gateway-arbitrum.network.thegraph.com/api/KEY/subgraphs/id/${GRAPH_NETWORK_SUBGRAPH_ID}`
    );
    // The dev-only proxy template in api/subgraph/route.ts keeps its placeholder verbatim.
    expect(gatewayUrl('[api-key]', GRAPH_NETWORK_SUBGRAPH_ID)).toContain('/api/[api-key]/');
  });

  it('returns null without a key, so hasSubgraphAccess stays false rather than 200-ing on absence', () => {
    expect(graphNetworkUrl(undefined)).toBeNull();
    expect(graphNetworkUrl('')).toBeNull();
    expect(graphNetworkUrl('k')).toContain('/api/k/');
  });

  it('points the explorer link at the same deployment', () => {
    expect(GRAPH_NETWORK_EXPLORER_URL).toBe(
      `https://thegraph.com/explorer/subgraphs/${GRAPH_NETWORK_SUBGRAPH_ID}`
    );
  });
});
