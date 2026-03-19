import { NextRequest, NextResponse } from 'next/server';

// Rewards Eligibility Oracle — Heuristic Assessment
//
// The on-chain REO contract (GIP-0079) isn't deployed on mainnet yet.
// We replicate its logic using subgraph data:
//   1. Active allocations — indexer must be actively indexing
//   2. Recent POI submissions — must be submitting proofs of indexing
//   3. Provisioned stake — must have provisioned to Horizon data services
//   4. Sufficient stake — must have meaningful self-stake
//
// When the contract deploys, we can switch to on-chain calls via
// REO_CONTRACT_ADDRESS env var.

const SUBGRAPH_URL = process.env.GRAPH_API_KEY
  ? `https://gateway-arbitrum.network.thegraph.com/api/${process.env.GRAPH_API_KEY}/subgraphs/id/DZz4kDTdmzWLWsV373w2bSmoar3umKKH9y82SUKr5qmp`
  : null;

interface REOStatus {
  address: string;
  status: 'eligible' | 'warning' | 'ineligible' | 'unknown';
  isEligible: boolean;
  reasons: string[];
  checks: {
    hasAllocations: boolean;
    hasRecentPOIs: boolean;
    hasProvisions: boolean;
    hasSufficientStake: boolean;
  };
}

// Minimum self-stake threshold (100K GRT in wei)
const MIN_STAKE_WEI = '100000000000000000000000';

async function subgraphQuery(query: string) {
  if (!SUBGRAPH_URL) return null;
  const res = await fetch(SUBGRAPH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  if (json.errors) return null;
  return json.data;
}

async function assessEligibility(address: string): Promise<REOStatus> {
  const addr = address.toLowerCase();

  // Fetch all signals in parallel
  const [indexerData, poiData, provisionData] = await Promise.all([
    subgraphQuery(`{
      indexer(id: "${addr}") {
        stakedTokens
        allocationCount
        allocatedTokens
      }
    }`),
    subgraphQuery(`{
      allocations(
        first: 10,
        where: { indexer: "${addr}", status: Active }
      ) {
        id
        poi
      }
    }`),
    subgraphQuery(`{
      provisions(
        first: 5,
        where: { indexer: "${addr}", tokensProvisioned_gt: "0" }
      ) {
        id
        tokensProvisioned
      }
    }`),
  ]);

  const indexer = indexerData?.indexer;
  if (!indexer) {
    return {
      address: addr,
      status: 'unknown',
      isEligible: false,
      reasons: ['Indexer not found'],
      checks: { hasAllocations: false, hasRecentPOIs: false, hasProvisions: false, hasSufficientStake: false },
    };
  }

  // Run checks
  const hasAllocations = (indexer.allocationCount ?? 0) > 0;
  const allocations = poiData?.allocations ?? [];
  const hasRecentPOIs = allocations.length > 0;
  const provisions = provisionData?.provisions ?? [];
  const hasProvisions = provisions.length > 0;

  const stakedBigInt = BigInt(indexer.stakedTokens?.split('.')[0] || '0');
  const minStakeBigInt = BigInt(MIN_STAKE_WEI);
  const hasSufficientStake = stakedBigInt >= minStakeBigInt;

  const checks = { hasAllocations, hasRecentPOIs, hasProvisions, hasSufficientStake };

  // Determine status
  const reasons: string[] = [];
  if (!hasSufficientStake) reasons.push('Stake below 100K GRT');
  if (!hasAllocations) reasons.push('No active allocations');
  if (!hasRecentPOIs) reasons.push('No active allocations with POIs');
  if (!hasProvisions) reasons.push('No Horizon service provisions');

  const passCount = [hasAllocations, hasRecentPOIs, hasSufficientStake].filter(Boolean).length;

  let status: REOStatus['status'];
  if (passCount === 3) {
    status = 'eligible';
  } else if (passCount >= 2) {
    status = 'warning';
  } else {
    status = 'ineligible';
  }

  return {
    address: addr,
    status,
    isEligible: status === 'eligible',
    reasons,
    checks,
  };
}

// In-memory cache
const cache = new Map<string, { data: REOStatus; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000;

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get('address');
  if (!address) {
    return NextResponse.json({ error: 'address parameter required' }, { status: 400 });
  }

  if (!SUBGRAPH_URL) {
    return NextResponse.json({
      status: { address, status: 'unknown', isEligible: false, reasons: ['No API key configured'], checks: {} },
      source: 'none',
    });
  }

  const cacheKey = address.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return NextResponse.json({ status: cached.data, source: 'heuristic' });
  }

  try {
    const reoStatus = await assessEligibility(address);
    cache.set(cacheKey, { data: reoStatus, timestamp: Date.now() });
    return NextResponse.json({ status: reoStatus, source: 'heuristic' });
  } catch {
    return NextResponse.json({
      status: { address, status: 'unknown', isEligible: false, reasons: ['Assessment failed'], checks: {} },
      source: 'heuristic',
      error: 'Failed to assess eligibility',
    });
  }
}
