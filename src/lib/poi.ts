import { weiToGRT } from './utils';

// ---------- types ----------

export interface ClosedAllocation {
  id: string;
  poi: string;
  indexer: {
    id: string;
    account: {
      defaultDisplayName: string | null;
      metadata?: { displayName?: string | null; description?: string | null } | null;
    };
  };
  allocatedTokens: string;
  closedAtEpoch: number;
  closedAt: number;
  subgraphDeployment: {
    id: string;
    ipfsHash: string;
    signalledTokens: string;
    stakedTokens: string;
  };
}

export interface POIIndexerEntry {
  indexer: string;
  name: string;
  poi: string;
  stake: number;
  isConsensus: boolean;
  isZeroPoi: boolean;
}

export interface POIEpochGroup {
  epoch: number;
  consensusPoi: string | null;
  totalRealStake: number;
  consensusStake: number;
  consensusPct: number;
  realCount: number;
  zeroCount: number;
  divergentCount: number;
  indexers: POIIndexerEntry[];
}

export interface POIDeploymentSummary {
  deploymentId: string;
  ipfsHash: string;
  signal: number;
  stake: number;
  latestEpoch: number;
  allocationCount: number;
  uniqueIndexers: number;
  consensusPct: number;
  hasDivergence: boolean;
  divergentCount: number;
  hasRealPois: boolean;
}

export interface POIOverview {
  summary: {
    totalAllocations: number;
    deploymentsTracked: number;
    overallConsensusRate: number;
    divergentDeployments: number;
  };
  deployments: POIDeploymentSummary[];
}

export interface POIDeploymentDetail {
  deploymentId: string;
  ipfsHash: string;
  signal: number;
  stake: number;
  totalAllocations: number;
  uniqueIndexers: number;
  epochs: POIEpochGroup[];
}

// ---------- constants ----------

const ZERO_POI = '0x0000000000000000000000000000000000000000000000000000000000000000';

function isZeroPoi(poi: string): boolean {
  return poi === ZERO_POI || poi === '0x' + '0'.repeat(64);
}

// ---------- consensus ----------

function computeEpochConsensus(
  allocations: ClosedAllocation[],
  resolveIndexerName: (alloc: ClosedAllocation) => string,
): POIEpochGroup {
  const epoch = allocations[0].closedAtEpoch;

  // Split into real POIs and zero POIs (allocation closes without proof)
  const realAllocs = allocations.filter((a) => !isZeroPoi(a.poi));
  const zeroCount = allocations.length - realAllocs.length;

  // Tally stake per unique real POI
  const poiStakes = new Map<string, number>();
  for (const alloc of realAllocs) {
    const stake = weiToGRT(alloc.allocatedTokens);
    poiStakes.set(alloc.poi, (poiStakes.get(alloc.poi) ?? 0) + stake);
  }

  // Find consensus POI — highest stake weight among real POIs
  let consensusPoi: string | null = null;
  let maxStake = 0;
  for (const [poi, stake] of poiStakes) {
    if (stake > maxStake) {
      maxStake = stake;
      consensusPoi = poi;
    }
  }

  const totalRealStake = Array.from(poiStakes.values()).reduce((s, v) => s + v, 0);
  const consensusStake = consensusPoi ? (poiStakes.get(consensusPoi) ?? 0) : 0;

  const indexers: POIIndexerEntry[] = allocations.map((alloc) => {
    const zero = isZeroPoi(alloc.poi);
    return {
      indexer: alloc.indexer.id,
      name: resolveIndexerName(alloc),
      poi: alloc.poi,
      stake: weiToGRT(alloc.allocatedTokens),
      isZeroPoi: zero,
      // Zero POIs are neither consensus nor divergent — they're just closes
      isConsensus: !zero && alloc.poi === consensusPoi,
    };
  });

  // Divergent = submitted a real POI that doesn't match consensus
  const divergentCount = realAllocs.filter((a) => a.poi !== consensusPoi).length;

  return {
    epoch,
    consensusPoi,
    totalRealStake,
    consensusStake,
    consensusPct: totalRealStake > 0 ? (consensusStake / totalRealStake) * 100 : 0,
    realCount: realAllocs.length,
    zeroCount,
    divergentCount,
    indexers: indexers.sort((a, b) => {
      // Real POIs first (consensus, then divergent), zero POIs last
      if (a.isZeroPoi !== b.isZeroPoi) return a.isZeroPoi ? 1 : -1;
      return b.stake - a.stake;
    }),
  };
}

function defaultNameResolver(alloc: ClosedAllocation): string {
  const acc = alloc.indexer.account;
  if (acc?.defaultDisplayName) return acc.defaultDisplayName;
  if (acc?.metadata?.displayName) return acc.metadata.displayName;
  const addr = alloc.indexer.id;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// ---------- public API ----------

export function computeOverview(allocations: ClosedAllocation[]): POIOverview {
  // Filter out zero POIs entirely — they're just allocation closes, not proofs
  const realAllocations = allocations.filter((a) => !isZeroPoi(a.poi));

  // Group by deployment (real POIs only)
  const byDeployment = new Map<string, ClosedAllocation[]>();
  for (const alloc of realAllocations) {
    const key = alloc.subgraphDeployment.id;
    if (!byDeployment.has(key)) byDeployment.set(key, []);
    byDeployment.get(key)!.push(alloc);
  }

  const deployments: POIDeploymentSummary[] = [];
  let totalDivergent = 0;
  let totalConsensusWeighted = 0;
  let totalStakeWeighted = 0;

  for (const [deploymentId, allocs] of byDeployment) {
    // Group by epoch
    const byEpoch = new Map<number, ClosedAllocation[]>();
    for (const alloc of allocs) {
      if (!byEpoch.has(alloc.closedAtEpoch)) byEpoch.set(alloc.closedAtEpoch, []);
      byEpoch.get(alloc.closedAtEpoch)!.push(alloc);
    }

    // Compute consensus for latest epoch
    const latestEpoch = Math.max(...byEpoch.keys());
    const latestAllocs = byEpoch.get(latestEpoch)!;
    const consensus = computeEpochConsensus(latestAllocs, defaultNameResolver);

    const uniqueIndexers = new Set(allocs.map((a) => a.indexer.id)).size;
    const hasDivergence = consensus.divergentCount > 0;

    if (hasDivergence) totalDivergent++;
    totalConsensusWeighted += consensus.consensusStake;
    totalStakeWeighted += consensus.totalRealStake;

    const first = allocs[0].subgraphDeployment;

    deployments.push({
      deploymentId,
      ipfsHash: first.ipfsHash,
      signal: weiToGRT(first.signalledTokens),
      stake: weiToGRT(first.stakedTokens),
      latestEpoch,
      allocationCount: allocs.length,
      uniqueIndexers,
      consensusPct: consensus.consensusPct,
      hasDivergence,
      divergentCount: consensus.divergentCount,
      hasRealPois: true,
    });
  }

  // Sort: divergent first, then by allocation count
  deployments.sort((a, b) => {
    if (a.hasDivergence !== b.hasDivergence) return a.hasDivergence ? -1 : 1;
    return b.allocationCount - a.allocationCount;
  });

  return {
    summary: {
      totalAllocations: realAllocations.length,
      deploymentsTracked: deployments.length,
      overallConsensusRate: totalStakeWeighted > 0
        ? (totalConsensusWeighted / totalStakeWeighted) * 100
        : 100,
      divergentDeployments: totalDivergent,
    },
    deployments,
  };
}

export function computeDeploymentDetail(allocations: ClosedAllocation[]): POIDeploymentDetail | null {
  if (allocations.length === 0) return null;

  const first = allocations[0].subgraphDeployment;

  // Group by epoch (include all allocations so detail page shows zero POIs too)
  const byEpoch = new Map<number, ClosedAllocation[]>();
  for (const alloc of allocations) {
    if (!byEpoch.has(alloc.closedAtEpoch)) byEpoch.set(alloc.closedAtEpoch, []);
    byEpoch.get(alloc.closedAtEpoch)!.push(alloc);
  }

  const epochs: POIEpochGroup[] = [];
  for (const [, allocs] of byEpoch) {
    const group = computeEpochConsensus(allocs, defaultNameResolver);
    // Only include epochs that have at least one real POI
    if (group.realCount > 0) {
      epochs.push(group);
    }
  }

  // Sort epochs descending
  epochs.sort((a, b) => b.epoch - a.epoch);

  const uniqueIndexers = new Set(allocations.map((a) => a.indexer.id)).size;

  return {
    deploymentId: first.id,
    ipfsHash: first.ipfsHash,
    signal: weiToGRT(first.signalledTokens),
    stake: weiToGRT(first.stakedTokens),
    totalAllocations: allocations.length,
    uniqueIndexers,
    epochs,
  };
}
