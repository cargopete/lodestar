import { describe, it, expect } from 'vitest';
import {
  computeOverview,
  computeDeploymentDetail,
  type ClosedAllocation,
} from '../poi';

const ZERO_POI = '0x' + '0'.repeat(64);

function makeAllocation(overrides: Partial<ClosedAllocation> & { poi?: string; indexerId?: string; epoch?: number; name?: string } = {}): ClosedAllocation {
  const {
    poi = '0xabc123' + '0'.repeat(58),
    indexerId = '0xindexer1',
    epoch = 100,
    name = null,
    ...rest
  } = overrides;
  return {
    id: `alloc-${Math.random().toString(36).slice(2)}`,
    poi,
    indexer: {
      id: indexerId,
      account: {
        defaultDisplayName: name,
        metadata: null,
      },
    },
    allocatedTokens: '1000000000000000000000000', // 1M GRT
    closedAtEpoch: epoch,
    closedAt: 1700000000,
    subgraphDeployment: {
      id: 'deployment-1',
      ipfsHash: 'QmTest123',
      signalledTokens: '500000000000000000000000',
      stakedTokens: '2000000000000000000000000',
    },
    ...rest,
  };
}

// ---------- computeOverview ----------

describe('computeOverview', () => {
  it('filters out zero POI allocations', () => {
    const allocations = [
      makeAllocation({ poi: '0xabc' + '0'.repeat(61) }),
      makeAllocation({ poi: ZERO_POI }),
    ];
    const overview = computeOverview(allocations);
    expect(overview.summary.totalAllocations).toBe(1);
  });

  it('groups by deployment', () => {
    const allocs = [
      makeAllocation({
        subgraphDeployment: {
          id: 'dep-a', ipfsHash: 'QmA', signalledTokens: '100000000000000000000000', stakedTokens: '100000000000000000000000',
        },
      }),
      makeAllocation({
        subgraphDeployment: {
          id: 'dep-b', ipfsHash: 'QmB', signalledTokens: '200000000000000000000000', stakedTokens: '200000000000000000000000',
        },
      }),
    ];
    const overview = computeOverview(allocs);
    expect(overview.summary.deploymentsTracked).toBe(2);
    expect(overview.deployments).toHaveLength(2);
  });

  it('detects divergence when POIs differ', () => {
    const consensusPoi = '0x' + 'a'.repeat(64);
    const divergentPoi = '0x' + 'b'.repeat(64);

    const allocs = [
      makeAllocation({ poi: consensusPoi, indexerId: '0x1', allocatedTokens: '5000000000000000000000000' }),
      makeAllocation({ poi: consensusPoi, indexerId: '0x2', allocatedTokens: '3000000000000000000000000' }),
      makeAllocation({ poi: divergentPoi, indexerId: '0x3', allocatedTokens: '1000000000000000000000000' }),
    ];

    const overview = computeOverview(allocs);
    expect(overview.summary.divergentDeployments).toBe(1);
    expect(overview.deployments[0].hasDivergence).toBe(true);
    expect(overview.deployments[0].divergentCount).toBe(1);
  });

  it('reports 100% consensus when all POIs match', () => {
    const poi = '0x' + 'a'.repeat(64);
    const allocs = [
      makeAllocation({ poi, indexerId: '0x1' }),
      makeAllocation({ poi, indexerId: '0x2' }),
      makeAllocation({ poi, indexerId: '0x3' }),
    ];

    const overview = computeOverview(allocs);
    expect(overview.deployments[0].consensusPct).toBe(100);
    expect(overview.deployments[0].hasDivergence).toBe(false);
  });

  it('sorts divergent deployments first', () => {
    const poiA = '0x' + 'a'.repeat(64);
    const poiB = '0x' + 'b'.repeat(64);

    const allocs = [
      // Deployment A: no divergence, 3 allocations
      makeAllocation({
        poi: poiA,
        subgraphDeployment: { id: 'dep-a', ipfsHash: 'QmA', signalledTokens: '1', stakedTokens: '1' },
      }),
      makeAllocation({
        poi: poiA,
        subgraphDeployment: { id: 'dep-a', ipfsHash: 'QmA', signalledTokens: '1', stakedTokens: '1' },
      }),
      makeAllocation({
        poi: poiA,
        subgraphDeployment: { id: 'dep-a', ipfsHash: 'QmA', signalledTokens: '1', stakedTokens: '1' },
      }),
      // Deployment B: has divergence, 2 allocations
      makeAllocation({
        poi: poiA,
        subgraphDeployment: { id: 'dep-b', ipfsHash: 'QmB', signalledTokens: '1', stakedTokens: '1' },
      }),
      makeAllocation({
        poi: poiB,
        subgraphDeployment: { id: 'dep-b', ipfsHash: 'QmB', signalledTokens: '1', stakedTokens: '1' },
      }),
    ];

    const overview = computeOverview(allocs);
    expect(overview.deployments[0].deploymentId).toBe('dep-b'); // divergent first
  });

  it('counts unique indexers per deployment', () => {
    const poi = '0x' + 'a'.repeat(64);
    const allocs = [
      makeAllocation({ poi, indexerId: '0x1', epoch: 100 }),
      makeAllocation({ poi, indexerId: '0x1', epoch: 101 }),
      makeAllocation({ poi, indexerId: '0x2', epoch: 100 }),
    ];

    const overview = computeOverview(allocs);
    expect(overview.deployments[0].uniqueIndexers).toBe(2);
  });

  it('handles empty input', () => {
    const overview = computeOverview([]);
    expect(overview.summary.totalAllocations).toBe(0);
    expect(overview.summary.deploymentsTracked).toBe(0);
    expect(overview.deployments).toHaveLength(0);
  });

  it('handles all-zero-POI input', () => {
    const allocs = [
      makeAllocation({ poi: ZERO_POI }),
      makeAllocation({ poi: ZERO_POI }),
    ];
    const overview = computeOverview(allocs);
    expect(overview.summary.totalAllocations).toBe(0);
    expect(overview.deployments).toHaveLength(0);
  });
});

// ---------- computeDeploymentDetail ----------

describe('computeDeploymentDetail', () => {
  it('returns null for empty input', () => {
    expect(computeDeploymentDetail([])).toBeNull();
  });

  it('groups allocations by epoch', () => {
    const poi = '0x' + 'a'.repeat(64);
    const allocs = [
      makeAllocation({ poi, epoch: 100 }),
      makeAllocation({ poi, epoch: 100 }),
      makeAllocation({ poi, epoch: 101 }),
    ];

    const detail = computeDeploymentDetail(allocs);
    expect(detail).not.toBeNull();
    // Only epochs with real POIs are included
    expect(detail!.epochs.length).toBeGreaterThanOrEqual(2);
  });

  it('sorts epochs descending', () => {
    const poi = '0x' + 'a'.repeat(64);
    const allocs = [
      makeAllocation({ poi, epoch: 98 }),
      makeAllocation({ poi, epoch: 100 }),
      makeAllocation({ poi, epoch: 99 }),
    ];

    const detail = computeDeploymentDetail(allocs);
    expect(detail!.epochs[0].epoch).toBe(100);
    expect(detail!.epochs[1].epoch).toBe(99);
    expect(detail!.epochs[2].epoch).toBe(98);
  });

  it('identifies consensus POI per epoch', () => {
    const consensusPoi = '0x' + 'a'.repeat(64);
    const divergentPoi = '0x' + 'b'.repeat(64);

    const allocs = [
      makeAllocation({ poi: consensusPoi, indexerId: '0x1', allocatedTokens: '5000000000000000000000000' }),
      makeAllocation({ poi: consensusPoi, indexerId: '0x2', allocatedTokens: '3000000000000000000000000' }),
      makeAllocation({ poi: divergentPoi, indexerId: '0x3', allocatedTokens: '1000000000000000000000000' }),
    ];

    const detail = computeDeploymentDetail(allocs);
    const epoch = detail!.epochs[0];
    expect(epoch.consensusPoi).toBe(consensusPoi);
    expect(epoch.divergentCount).toBe(1);
  });

  it('excludes epochs with only zero POIs', () => {
    const realPoi = '0x' + 'a'.repeat(64);
    const allocs = [
      makeAllocation({ poi: realPoi, epoch: 100 }),
      makeAllocation({ poi: ZERO_POI, epoch: 101 }),
    ];

    const detail = computeDeploymentDetail(allocs);
    expect(detail!.epochs).toHaveLength(1);
    expect(detail!.epochs[0].epoch).toBe(100);
  });

  it('includes zero POI indexers in epoch detail but marks them', () => {
    const realPoi = '0x' + 'a'.repeat(64);
    const allocs = [
      makeAllocation({ poi: realPoi, indexerId: '0x1', epoch: 100 }),
      makeAllocation({ poi: ZERO_POI, indexerId: '0x2', epoch: 100 }),
    ];

    const detail = computeDeploymentDetail(allocs);
    const epoch = detail!.epochs[0];
    expect(epoch.indexers).toHaveLength(2);

    const zeroEntry = epoch.indexers.find(i => i.isZeroPoi);
    expect(zeroEntry).toBeDefined();
    expect(zeroEntry!.isConsensus).toBe(false);
  });

  it('sorts indexers: real POIs first (by stake), zero POIs last', () => {
    const realPoi = '0x' + 'a'.repeat(64);
    const allocs = [
      makeAllocation({ poi: ZERO_POI, indexerId: '0x1', allocatedTokens: '9000000000000000000000000' }),
      makeAllocation({ poi: realPoi, indexerId: '0x2', allocatedTokens: '1000000000000000000000000' }),
    ];

    const detail = computeDeploymentDetail(allocs);
    const epoch = detail!.epochs[0];
    // Real POI first despite lower stake
    expect(epoch.indexers[0].indexer).toBe('0x2');
    expect(epoch.indexers[1].indexer).toBe('0x1');
  });

  it('counts total allocations including zeros', () => {
    const realPoi = '0x' + 'a'.repeat(64);
    const allocs = [
      makeAllocation({ poi: realPoi }),
      makeAllocation({ poi: ZERO_POI }),
      makeAllocation({ poi: realPoi }),
    ];

    const detail = computeDeploymentDetail(allocs);
    expect(detail!.totalAllocations).toBe(3);
  });
});
