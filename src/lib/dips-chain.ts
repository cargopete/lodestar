import { createPublicClient, http, type Address, type PublicClient } from 'viem';
import { arbitrum } from 'viem/chains';

// Reading the DIPS issuance split straight from the IssuanceAllocator, as a second opinion on the
// nest that normally answers for it.
//
// `/api/dips` is event-derived and has no fallback, deliberately: nothing else indexes these
// contracts, and a fallback would only be a way of inventing numbers. The cost of that decision is
// that the surface has no second opinion at all. `/ready` catches a nest that has stopped. Nothing
// catches a nest that is running happily and merely missed a log, and that failure renders as a
// plausible number rather than as an error.
//
// The allocator will answer the same questions directly, and the answer comes with an exact
// invariant rather than a fuzzy one: the per-target allocations must sum to `getIssuancePerBlock()`.
// Every comparison here is done in wei as BigInt, never in floating point, so "equal" means equal.

export const ISSUANCE_ALLOCATOR = '0xb64f29b2d81140ffc3a135e319561a1bd03b1a7e' as const;

/**
 * `Allocation` has THREE fields. A two-field ABI decodes without complaint and returns every value
 * shifted by one position, which is a wrong answer wearing the costume of a right one. Confirmed
 * against `abis/issuance_allocator.json` in nightswatchhq/dips-nest, not against a reading of docs.
 */
const ALLOCATION = {
  type: 'tuple',
  components: [
    { name: 'totalAllocationRate', type: 'uint256' },
    { name: 'allocatorMintingRate', type: 'uint256' },
    { name: 'selfMintingRate', type: 'uint256' },
  ],
} as const;

export const ALLOCATOR_ABI = [
  {
    name: 'getTargets',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address[]' }],
  },
  {
    name: 'getIssuancePerBlock',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getTargetAllocation',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [ALLOCATION],
  },
] as const;

const rpcUrl = process.env.ARBITRUM_RPC_URL ?? 'https://gateway.lodestar-dashboard.com/rpc/42161';

export const allocatorClient = createPublicClient({
  chain: arbitrum,
  transport: http(rpcUrl),
});

/** One target's allocation as the contract reports it, in wei. */
export interface ChainAllocation {
  target: string;
  total: bigint;
  allocatorMinting: bigint;
  selfMinting: bigint;
}

export interface ChainState {
  issuancePerBlock: bigint;
  targets: ChainAllocation[];
}

/** One row of `dips_current_allocation`, as the nest returns it. */
export interface NestAllocationRow {
  target: string;
  self_minting_rate_dec: string | null;
  allocator_minting_rate_dec: string | null;
}

/** Read the allocator's own view of the split. */
export async function readChainState(
  client: PublicClient = allocatorClient as PublicClient,
): Promise<ChainState> {
  const [issuancePerBlock, targets] = await Promise.all([
    client.readContract({
      address: ISSUANCE_ALLOCATOR,
      abi: ALLOCATOR_ABI,
      functionName: 'getIssuancePerBlock',
    }),
    client.readContract({
      address: ISSUANCE_ALLOCATOR,
      abi: ALLOCATOR_ABI,
      functionName: 'getTargets',
    }),
  ]);

  const allocations = await Promise.all(
    (targets as readonly Address[]).map(async (target) => {
      const a = await client.readContract({
        address: ISSUANCE_ALLOCATOR,
        abi: ALLOCATOR_ABI,
        functionName: 'getTargetAllocation',
        args: [target],
      });
      return {
        target: target.toLowerCase(),
        total: a.totalAllocationRate,
        allocatorMinting: a.allocatorMintingRate,
        selfMinting: a.selfMintingRate,
      };
    }),
  );

  return { issuancePerBlock: issuancePerBlock as bigint, targets: allocations };
}

export type DivergenceKind =
  /** The chain knows a target the nest has never recorded. A missed log, or a nest behind. */
  | 'missing_from_nest'
  /** The nest carries a target the allocator no longer lists. */
  | 'unknown_to_chain'
  /** Both know the target and disagree on its allocation. */
  | 'rate_mismatch'
  /** The allocator's own targets do not sum to its issuance per block. */
  | 'chain_sum_mismatch';

export interface Divergence {
  kind: DivergenceKind;
  target: string;
  /** Wei, as decimal strings, so a log line can be read without a calculator lying to it. */
  chain?: string;
  nest?: string;
  detail: string;
}

const GRT = 10n ** 18n;

/** Wei to a short GRT string. Integer division plus three decimals, never a float. */
function grt(wei: bigint): string {
  const whole = wei / GRT;
  const frac = ((wei % GRT) * 1000n) / GRT;
  return `${whole}.${frac.toString().padStart(3, '0')}`;
}

function nestTotal(r: NestAllocationRow): bigint {
  return BigInt(r.allocator_minting_rate_dec || '0') + BigInt(r.self_minting_rate_dec || '0');
}

/**
 * Compare the allocator against the nest, exactly.
 *
 * Pure, and takes both sides as arguments, so the interesting cases can be tested without an RPC
 * endpoint or a nest. A target with a zero allocation on both sides is not a divergence; a target
 * the nest has never heard of is, even at zero, because it means a log went missing.
 */
export function compareAllocations(chain: ChainState, nestRows: NestAllocationRow[]): Divergence[] {
  const divergences: Divergence[] = [];
  const nest = new Map(nestRows.map((r) => [r.target.toLowerCase(), r]));
  const seen = new Set<string>();

  // The allocator's internal invariant first. If this fails, the chain is telling us something
  // about itself and the nest comparison below is the lesser story.
  const chainSum = chain.targets.reduce((acc, t) => acc + t.total, 0n);
  if (chainSum !== chain.issuancePerBlock) {
    divergences.push({
      kind: 'chain_sum_mismatch',
      target: ISSUANCE_ALLOCATOR,
      chain: chainSum.toString(),
      nest: chain.issuancePerBlock.toString(),
      detail:
        `allocator targets sum to ${grt(chainSum)} GRT/block but getIssuancePerBlock() ` +
        `reports ${grt(chain.issuancePerBlock)}`,
    });
  }

  for (const t of chain.targets) {
    seen.add(t.target);
    const row = nest.get(t.target);

    if (!row) {
      divergences.push({
        kind: 'missing_from_nest',
        target: t.target,
        chain: t.total.toString(),
        detail:
          `allocator lists ${t.target} at ${grt(t.total)} GRT/block; the nest has no ` +
          `allocation row for it`,
      });
      continue;
    }

    const observed = nestTotal(row);
    if (observed !== t.total) {
      divergences.push({
        kind: 'rate_mismatch',
        target: t.target,
        chain: t.total.toString(),
        nest: observed.toString(),
        detail:
          `${t.target}: allocator says ${grt(t.total)} GRT/block, nest says ${grt(observed)}`,
      });
    }
  }

  for (const [target, row] of nest) {
    if (seen.has(target)) continue;
    divergences.push({
      kind: 'unknown_to_chain',
      target,
      nest: nestTotal(row).toString(),
      detail:
        `nest carries ${target} at ${grt(nestTotal(row))} GRT/block; the allocator does not ` +
        `list it as a target`,
    });
  }

  return divergences;
}
