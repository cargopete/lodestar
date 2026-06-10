import { describe, it, expect } from 'vitest';
import { jaccard, detectClusters, type ClusterInput } from '../clustering';

describe('jaccard', () => {
  it('computes intersection over union', () => {
    expect(jaccard(new Set(['a', 'b', 'c']), new Set(['a', 'b']))).toBeCloseTo(2 / 3, 9);
    expect(jaccard(new Set(['a']), new Set(['b']))).toBe(0);
    expect(jaccard(new Set(), new Set())).toBe(0);
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
  });
});

const node = (o: Partial<ClusterInput> & Pick<ClusterInput, 'address' | 'deployments'>): ClusterInput => ({
  createdAtEpoch: 100,
  rewardCut: 100000,
  queryFeeCut: 100000,
  allocationCount: 10,
  ...o,
});

describe('detectClusters', () => {
  it('clusters indexers with high overlap + shared registration epoch', () => {
    const deps = ['d1', 'd2', 'd3', 'd4'];
    const clusters = detectClusters([
      node({ address: '0xA', deployments: deps, createdAtEpoch: 500 }),
      node({ address: '0xB', deployments: deps, createdAtEpoch: 500 }),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].members).toEqual(['0xa', '0xb']);
    expect(clusters[0].tier).toBe(2);
    expect(clusters[0].sharedEpoch).toBe(500);
    expect(clusters[0].signals.some((s) => s.includes('registration epoch'))).toBe(true);
  });

  it('does NOT cluster on high overlap ALONE (optimizer false-positive guard)', () => {
    // Jaccard 0.6 but different epoch AND different cuts → no corroborating signal.
    const clusters = detectClusters([
      node({ address: '0xA', deployments: ['d1', 'd2', 'd3', 'd4'], createdAtEpoch: 100, rewardCut: 10, queryFeeCut: 5 }),
      node({ address: '0xB', deployments: ['d1', 'd2', 'd3', 'd5'], createdAtEpoch: 200, rewardCut: 20, queryFeeCut: 15 }),
    ]);
    expect(clusters).toHaveLength(0);
  });

  it('clusters on high overlap + identical cuts (different epochs)', () => {
    const deps = ['d1', 'd2', 'd3', 'd4'];
    const clusters = detectClusters([
      node({ address: '0xA', deployments: deps, createdAtEpoch: 100, rewardCut: 50000, queryFeeCut: 50000 }),
      node({ address: '0xB', deployments: deps, createdAtEpoch: 200, rewardCut: 50000, queryFeeCut: 50000 }),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].sharedEpoch).toBeNull();
    expect(clusters[0].signals.some((s) => s.includes('Identical cut'))).toBe(true);
  });

  it('does NOT cluster on shared epoch with LOW overlap (network-event guard)', () => {
    const clusters = detectClusters([
      node({ address: '0xA', deployments: ['d1', 'd2'], createdAtEpoch: 500 }),
      node({ address: '0xB', deployments: ['d3', 'd4'], createdAtEpoch: 500 }),
    ]);
    expect(clusters).toHaveLength(0); // jaccard 0 < threshold
  });

  it('excludes SaaS-allowlisted addresses', () => {
    const deps = ['d1', 'd2', 'd3', 'd4'];
    const clusters = detectClusters(
      [
        node({ address: '0xSaaS', deployments: deps, createdAtEpoch: 500 }),
        node({ address: '0xB', deployments: deps, createdAtEpoch: 500 }),
      ],
      { allowlist: new Set(['0xsaas']) },
    );
    expect(clusters).toHaveLength(0);
  });

  it('ignores tiny operators below the allocation noise floor', () => {
    const deps = ['d1', 'd2', 'd3', 'd4'];
    const clusters = detectClusters([
      node({ address: '0xA', deployments: deps, createdAtEpoch: 500, allocationCount: 2 }),
      node({ address: '0xB', deployments: deps, createdAtEpoch: 500, allocationCount: 2 }),
    ]);
    expect(clusters).toHaveLength(0);
  });

  it('merges a transitive chain into a single cluster', () => {
    const deps = ['d1', 'd2', 'd3', 'd4'];
    const clusters = detectClusters([
      node({ address: '0xA', deployments: deps, createdAtEpoch: 500 }),
      node({ address: '0xB', deployments: deps, createdAtEpoch: 500 }),
      node({ address: '0xC', deployments: deps, createdAtEpoch: 500 }),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].size).toBe(3);
  });
});
