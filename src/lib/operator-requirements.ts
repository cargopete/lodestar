/**
 * What does it actually cost to run one of these?
 *
 * The data-services page has said "Built and unclaimed, could be yours to run" since 30 August,
 * which is an invitation without a price on it. Everybody who has been near The Graph assumes the
 * bar is the indexer bar, 100,000 GRT and a 28-day thawing period, because that is what the
 * Subgraph Service demands and the Subgraph Service is the one people have heard of.
 *
 * It is not the bar for these. Every Horizon data service sets its own range through
 * `ProvisionManager`, and reading them off Arbitrum One on 2026-08-30 gives Dispatch and Seahorn at
 * **555 GRT**, and three others at **nothing at all**. That is the difference between an invitation
 * and an offer, and it was sitting on chain the whole time.
 *
 * Read rather than transcribed, for the same reason the provider counts are: a number typed into a
 * catalogue is a number that will be wrong later, and this one is load-bearing enough that being
 * wrong about it wastes somebody's afternoon or, worse, puts them off entirely.
 */

import { type PublicClient } from 'viem';

const PROVISION_MANAGER_ABI = [
  {
    type: 'function',
    name: 'getProvisionTokensRange',
    inputs: [],
    outputs: [{ type: 'uint256' }, { type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getThawingPeriodRange',
    inputs: [],
    outputs: [{ type: 'uint64' }, { type: 'uint64' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getVerifierCutRange',
    inputs: [],
    outputs: [{ type: 'uint32' }, { type: 'uint32' }],
    stateMutability: 'view',
  },
] as const;

/** The protocol's own ceiling, from `getMaxThawingPeriod()` on Arbitrum One: exactly 28 days. */
export const PROTOCOL_MAX_THAWING_SECONDS = 2_419_200n;

/** `type(uint256).max` and `type(uint64).max`, which is how a service says "no upper limit". */
const UINT256_MAX = (1n << 256n) - 1n;
const UINT64_MAX = (1n << 64n) - 1n;

export interface OperatorRequirements {
  /** Minimum provision, in wei. */
  minTokens: bigint;
  /** `null` when the service sets no upper limit. */
  maxTokens: bigint | null;
  minThawingSeconds: bigint;
  /**
   * The binding maximum: the smaller of what the service allows and the protocol's 28 days. A
   * service that leaves its own maximum unbounded has not removed the protocol's, and an operator
   * reading only the service's range would pick a period the protocol refuses.
   */
  maxThawingSeconds: bigint;
  minVerifierCutPpm: number;
  maxVerifierCutPpm: number;
  /**
   * True when the service accepts a provision of zero. Reported rather than advertised as free:
   * on SDSCE both the token floor and the thawing floor are zero, which reads more like parameters
   * nobody set than like a deliberate offer, and telling somebody a service is free to run when the
   * truth is that it is unconfigured is the wrong kind of encouragement.
   */
  noMinimum: boolean;
}

/** A whole-token count for display. These are 18-decimal amounts and never fractional in practice. */
export function grtWhole(wei: bigint): number {
  return Number(wei / 10n ** 18n);
}

export function days(seconds: bigint): number {
  return Number(seconds) / 86_400;
}

export function interpret(
  minTokens: bigint,
  maxTokens: bigint,
  minThawing: bigint,
  maxThawing: bigint,
  minCut: number,
  maxCut: number
): OperatorRequirements {
  const serviceMax = maxThawing >= UINT64_MAX ? PROTOCOL_MAX_THAWING_SECONDS : maxThawing;
  return {
    minTokens,
    maxTokens: maxTokens >= UINT256_MAX ? null : maxTokens,
    minThawingSeconds: minThawing,
    maxThawingSeconds:
      serviceMax < PROTOCOL_MAX_THAWING_SECONDS ? serviceMax : PROTOCOL_MAX_THAWING_SECONDS,
    minVerifierCutPpm: minCut,
    maxVerifierCutPpm: maxCut,
    noMinimum: minTokens === 0n && minThawing === 0n,
  };
}

/**
 * Read one service's requirements.
 *
 * Returns `null` rather than zeroes when the calls fail, because a service that does not answer and
 * a service that asks for nothing must not look the same. Zero is a real and meaningful answer
 * here, which is exactly why it cannot double as "we could not tell".
 */
export async function readRequirements(
  client: PublicClient,
  address: `0x${string}`
): Promise<OperatorRequirements | null> {
  try {
    const [tokens, thawing, cut] = await Promise.all([
      client.readContract({
        address,
        abi: PROVISION_MANAGER_ABI,
        functionName: 'getProvisionTokensRange',
      }),
      client.readContract({
        address,
        abi: PROVISION_MANAGER_ABI,
        functionName: 'getThawingPeriodRange',
      }),
      client.readContract({
        address,
        abi: PROVISION_MANAGER_ABI,
        functionName: 'getVerifierCutRange',
      }),
    ]);
    return interpret(tokens[0], tokens[1], thawing[0], thawing[1], cut[0], cut[1]);
  } catch {
    return null;
  }
}

/**
 * The sentence to put next to "could be yours to run".
 *
 * Deliberately says the thawing *window* rather than a single number. Our own operator write-up
 * recommends 14 days and explains it as "comfortably inside", which happens to be right for
 * Dispatch and is right for the wrong reason: 14 days is that service's floor, and 13 would be
 * refused. Somebody told "comfortably inside" who reasons downward from it walks into a revert.
 */
export function requirementSummary(r: OperatorRequirements): string {
  const stake =
    r.minTokens === 0n ? 'No minimum provision' : `${grtWhole(r.minTokens).toLocaleString('en-GB')} GRT`;
  const lo = days(r.minThawingSeconds);
  const hi = days(r.maxThawingSeconds);
  const window = lo === 0 ? `up to ${hi} days` : `${lo} to ${hi} days`;
  return `${stake}, thawing period ${window}.`;
}

/**
 * The JSON-safe shape, because these values are `bigint` and an API route cannot serialise one.
 *
 * This is a real hazard rather than a tidiness point: `NextResponse.json` throws on a bigint, so a
 * route carrying the raw struct returns a 500 in production while every unit test that never
 * stringifies it stays green. The shape a page needs is display values anyway.
 */
export interface RequirementsJson {
  minTokensGrt: number;
  maxTokensGrt: number | null;
  minThawingDays: number;
  maxThawingDays: number;
  minVerifierCutPpm: number;
  maxVerifierCutPpm: number;
  noMinimum: boolean;
  summary: string;
}

export function toJson(r: OperatorRequirements): RequirementsJson {
  return {
    minTokensGrt: grtWhole(r.minTokens),
    maxTokensGrt: r.maxTokens === null ? null : grtWhole(r.maxTokens),
    minThawingDays: days(r.minThawingSeconds),
    maxThawingDays: days(r.maxThawingSeconds),
    minVerifierCutPpm: r.minVerifierCutPpm,
    maxVerifierCutPpm: r.maxVerifierCutPpm,
    noMinimum: r.noMinimum,
    summary: requirementSummary(r),
  };
}
