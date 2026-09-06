import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GRAPH_NETWORK_SUBGRAPH_ID, GRAPH_NETWORK_EXPLORER_URL } from '../graph-network';

/**
 * The deployment id has one home. It had five, and a migration made behind the shared client
 * silently missed the feed, which built its own. The dashboard no longer queries the subgraph
 * (nuthatch#1160); the id remains for the explorer link, and a second copy would still be a second
 * thing to keep in step.
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
      'a second copy of the deployment id is a second thing to keep in step, which is exactly how ' +
        'api/feed was once missed'
    ).toEqual([]);
  });


  it('points the explorer link at the same deployment', () => {
    expect(GRAPH_NETWORK_EXPLORER_URL).toBe(
      `https://thegraph.com/explorer/subgraphs/${GRAPH_NETWORK_SUBGRAPH_ID}`
    );
  });
});
