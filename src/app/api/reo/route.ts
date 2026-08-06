import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { checkOracleEligibility, type OracleEligibility } from '@/lib/reo-contract';
import { log } from '@/lib/logger';

// Rewards Eligibility Oracle — Direct Contract Read
//
// Reads from the on-chain REO contract (GIP-0079) at 0x8ec2...f304 on Arbitrum
// One. The oracle's `isEligible` bool is the SOLE source of truth. If the
// contract read fails we report an explicit "unavailable" state — we never
// fabricate an eligibility verdict from on-chain heuristics, because a
// homegrown guess that contradicts the oracle is worse than an honest "unknown".

interface REOResponse {
  address: string;
  status: 'eligible' | 'ineligible' | 'unknown';
  isEligible: boolean;
  source: 'oracle';
  // True when the oracle read succeeded. When false, status is 'unknown' and
  // the eligibility fields are absent — the oracle could not be reached.
  available: boolean;
  renewalTimestamp?: number;
  eligibilityPeriod?: number;
  expiresAt?: number;
  daysRemaining?: number;
}

async function assessFromOracle(address: string): Promise<REOResponse> {
  const result: OracleEligibility = await checkOracleEligibility(address);
  return {
    address: result.address,
    status: result.isEligible ? 'eligible' : 'ineligible',
    isEligible: result.isEligible,
    source: 'oracle',
    available: true,
    renewalTimestamp: result.renewalTimestamp,
    eligibilityPeriod: result.eligibilityPeriod,
    expiresAt: result.expiresAt,
    daysRemaining: result.daysRemaining,
  };
}

function unavailable(address: string): REOResponse {
  return {
    address: address.toLowerCase(),
    status: 'unknown',
    isEligible: false,
    source: 'oracle',
    available: false,
  };
}

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get('address');
  if (!address) {
    return NextResponse.json({ error: 'address parameter required' }, { status: 400 });
  }

  try {
    // Cache successful reads for 5 minutes — oracle data only changes on the
    // ~14-day renewal cycle. `cached()` only stores on success: if the oracle
    // read throws, nothing is cached and the next request retries immediately.
    const reoStatus = await cached(
      `lodestar:reo:${address.toLowerCase()}`,
      300,
      () => assessFromOracle(address)
    );
    return NextResponse.json({ status: reoStatus });
  } catch (err) {
    log.api.warn({ err, address }, 'REO oracle read failed, reporting unavailable');
    return NextResponse.json({ status: unavailable(address) });
  }
}
