import { createPublicClient, http, type Address } from 'viem';
import { arbitrum } from 'viem/chains';

// Rewards Eligibility Oracle (GIP-0079) on Arbitrum One
export const REO_ADDRESS = '0x8ec2767a9d9ba02b4e09e8ff4fac2e14a340f304' as const;

// Minimal ABI — view functions only (no writes, no admin)
export const REO_ABI = [
  {
    name: 'isEligible',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'indexer', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'getEligibilityRenewalTime',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'indexer', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getEligibilityPeriod',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getEligibilityValidation',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'getLastOracleUpdateTime',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

// Server-side public client for Arbitrum One
// Uses custom RPC if provided, otherwise Dispatch gateway (dogfooding!)
const rpcUrl = process.env.ARBITRUM_RPC_URL ?? 'https://gateway.lodestar-dashboard.com/rpc/42161';
export const arbitrumClient = createPublicClient({
  chain: arbitrum,
  transport: http(rpcUrl),
});

export interface OracleEligibility {
  address: string;
  isEligible: boolean;
  renewalTimestamp: number;   // unix seconds — when eligibility was last renewed
  eligibilityPeriod: number;  // seconds — how long eligibility lasts (typically 14 days)
  expiresAt: number;          // unix seconds — renewalTimestamp + eligibilityPeriod
  daysRemaining: number;      // days until expiry (can be negative if expired)
}

/**
 * Check a single indexer's eligibility directly from the oracle contract.
 */
export async function checkOracleEligibility(indexer: string): Promise<OracleEligibility> {
  const addr = indexer as Address;

  const [isElig, renewalTime, period] = await Promise.all([
    arbitrumClient.readContract({
      address: REO_ADDRESS,
      abi: REO_ABI,
      functionName: 'isEligible',
      args: [addr],
    }),
    arbitrumClient.readContract({
      address: REO_ADDRESS,
      abi: REO_ABI,
      functionName: 'getEligibilityRenewalTime',
      args: [addr],
    }),
    arbitrumClient.readContract({
      address: REO_ADDRESS,
      abi: REO_ABI,
      functionName: 'getEligibilityPeriod',
    }),
  ]);

  const renewalSec = Number(renewalTime);
  const periodSec = Number(period);
  const expiresAt = renewalSec + periodSec;
  const now = Math.floor(Date.now() / 1000);
  const daysRemaining = (expiresAt - now) / 86400;

  return {
    address: indexer.toLowerCase(),
    isEligible: isElig,
    renewalTimestamp: renewalSec,
    eligibilityPeriod: periodSec,
    expiresAt,
    daysRemaining: Math.round(daysRemaining * 10) / 10,
  };
}

/**
 * Batch-check eligibility for many indexers via multicall.
 * Groups all reads into minimal RPC round-trips.
 */
export async function batchCheckEligibility(
  indexers: string[]
): Promise<Map<string, OracleEligibility>> {
  if (indexers.length === 0) return new Map();

  // First, fetch the global eligibility period (one call, shared across all indexers)
  const period = await arbitrumClient.readContract({
    address: REO_ADDRESS,
    abi: REO_ABI,
    functionName: 'getEligibilityPeriod',
  });
  const periodSec = Number(period);

  // Build multicall contracts: isEligible + getEligibilityRenewalTime per indexer
  const contracts = indexers.flatMap((addr) => [
    {
      address: REO_ADDRESS,
      abi: REO_ABI,
      functionName: 'isEligible' as const,
      args: [addr as Address],
    },
    {
      address: REO_ADDRESS,
      abi: REO_ABI,
      functionName: 'getEligibilityRenewalTime' as const,
      args: [addr as Address],
    },
  ]);

  // Multicall batches everything into a single RPC call
  const results = await arbitrumClient.multicall({ contracts });

  const now = Math.floor(Date.now() / 1000);
  const map = new Map<string, OracleEligibility>();

  for (let i = 0; i < indexers.length; i++) {
    const eligResult = results[i * 2];
    const renewalResult = results[i * 2 + 1];

    // multicall returns { result, status } — skip failures
    if (eligResult.status !== 'success' || renewalResult.status !== 'success') continue;

    const isElig = eligResult.result as boolean;
    const renewalSec = Number(renewalResult.result as bigint);
    const expiresAt = renewalSec + periodSec;
    const daysRemaining = (expiresAt - now) / 86400;

    map.set(indexers[i].toLowerCase(), {
      address: indexers[i].toLowerCase(),
      isEligible: isElig,
      renewalTimestamp: renewalSec,
      eligibilityPeriod: periodSec,
      expiresAt,
      daysRemaining: Math.round(daysRemaining * 10) / 10,
    });
  }

  return map;
}

/**
 * Check if REO enforcement is currently active and oracle is healthy.
 */
export async function getOracleStatus() {
  const [validationEnabled, lastUpdate, timeout] = await Promise.all([
    arbitrumClient.readContract({
      address: REO_ADDRESS,
      abi: REO_ABI,
      functionName: 'getEligibilityValidation',
    }),
    arbitrumClient.readContract({
      address: REO_ADDRESS,
      abi: REO_ABI,
      functionName: 'getLastOracleUpdateTime',
    }),
    // Re-use the period call to keep this self-contained
    arbitrumClient.readContract({
      address: REO_ADDRESS,
      abi: REO_ABI,
      functionName: 'getEligibilityPeriod',
    }),
  ]);

  const lastUpdateSec = Number(lastUpdate);
  const now = Math.floor(Date.now() / 1000);

  return {
    validationEnabled: validationEnabled as boolean,
    lastOracleUpdate: lastUpdateSec,
    secondsSinceUpdate: now - lastUpdateSec,
    eligibilityPeriodDays: Number(timeout) / 86400,
  };
}
