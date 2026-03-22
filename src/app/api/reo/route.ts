import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { checkOracleEligibility, type OracleEligibility } from '@/lib/reo-contract';

// Rewards Eligibility Oracle — Direct Contract Read
//
// Reads from the on-chain REO contract (GIP-0079) at 0x8ec2...f304 on Arbitrum One.
// Falls back to subgraph heuristics if the contract call fails.

const SUBGRAPH_URL = process.env.GRAPH_API_KEY
  ? `https://gateway-arbitrum.network.thegraph.com/api/${process.env.GRAPH_API_KEY}/subgraphs/id/DZz4kDTdmzWLWsV373w2bSmoar3umKKH9y82SUKr5qmp`
  : null;

interface REOResponse {
  address: string;
  status: 'eligible' | 'ineligible' | 'unknown';
  isEligible: boolean;
  source: 'oracle' | 'heuristic';
  // Oracle-sourced fields (only present when source === 'oracle')
  renewalTimestamp?: number;
  eligibilityPeriod?: number;
  expiresAt?: number;
  daysRemaining?: number;
  // Heuristic-sourced fields (only present when source === 'heuristic')
  checks?: {
    hasAllocations: boolean;
    hasRecentPOIs: boolean;
    hasProvisions: boolean;
    hasSufficientStake: boolean;
  };
  reasons?: string[];
}

// --- Oracle path ---

async function assessFromOracle(address: string): Promise<REOResponse> {
  const result: OracleEligibility = await checkOracleEligibility(address);
  return {
    address: result.address,
    status: result.isEligible ? 'eligible' : 'ineligible',
    isEligible: result.isEligible,
    source: 'oracle',
    renewalTimestamp: result.renewalTimestamp,
    eligibilityPeriod: result.eligibilityPeriod,
    expiresAt: result.expiresAt,
    daysRemaining: result.daysRemaining,
  };
}

// --- Heuristic fallback (subgraph-based, same as before) ---

const MIN_STAKE_WEI = '100000000000000000000000'; // 100K GRT

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

async function assessFromHeuristics(address: string): Promise<REOResponse> {
  const addr = address.toLowerCase();

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
      source: 'heuristic',
      reasons: ['Indexer not found'],
      checks: { hasAllocations: false, hasRecentPOIs: false, hasProvisions: false, hasSufficientStake: false },
    };
  }

  const hasAllocations = (indexer.allocationCount ?? 0) > 0;
  const hasRecentPOIs = (poiData?.allocations ?? []).length > 0;
  const hasProvisions = (provisionData?.provisions ?? []).length > 0;
  const stakedBigInt = BigInt(indexer.stakedTokens?.split('.')[0] || '0');
  const hasSufficientStake = stakedBigInt >= BigInt(MIN_STAKE_WEI);

  const checks = { hasAllocations, hasRecentPOIs, hasProvisions, hasSufficientStake };
  const reasons: string[] = [];
  if (!hasSufficientStake) reasons.push('Stake below 100K GRT');
  if (!hasAllocations) reasons.push('No active allocations');
  if (!hasRecentPOIs) reasons.push('No active allocations with POIs');
  if (!hasProvisions) reasons.push('No Horizon service provisions');

  const passCount = [hasAllocations, hasRecentPOIs, hasSufficientStake].filter(Boolean).length;
  const isEligible = passCount === 3;

  return {
    address: addr,
    status: isEligible ? 'eligible' : 'ineligible',
    isEligible,
    source: 'heuristic',
    checks,
    reasons,
  };
}

// --- Combined: oracle first, heuristic fallback ---

async function assessEligibility(address: string): Promise<REOResponse> {
  try {
    return await assessFromOracle(address);
  } catch (err) {
    console.warn(`REO oracle call failed for ${address}, falling back to heuristics:`, err);
    return assessFromHeuristics(address);
  }
}

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get('address');
  if (!address) {
    return NextResponse.json({ error: 'address parameter required' }, { status: 400 });
  }

  try {
    // Cache for 5 minutes — oracle data doesn't change more often than daily renewals
    const reoStatus = await cached(
      `lodestar:reo:${address.toLowerCase()}`,
      300,
      () => assessEligibility(address)
    );
    return NextResponse.json({ status: reoStatus });
  } catch {
    return NextResponse.json({
      status: {
        address: address.toLowerCase(),
        status: 'unknown',
        isEligible: false,
        source: 'heuristic',
        reasons: ['Assessment failed'],
      },
    });
  }
}
