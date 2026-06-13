import { type Address } from 'viem';
import { arbitrumClient } from './reo-contract';
import { CONTRACTS } from './wallet';
import { weiToGRT } from './utils';

/**
 * On-chain cross-check for the delegation pool — the bit that makes Lodestar
 * authoritative rather than merely assertive. We read the canonical
 * DelegationPool struct straight from the HorizonStaking proxy and compare its
 * active-earning base (tokens − tokensThawing) against the network subgraph.
 *
 * Why a single subtraction is exact: the contract keeps fully-thawed-but-not-
 * withdrawn tokens inside BOTH `tokens` and `tokensThawing` until `withdraw()`
 * fires (there is no time-triggered transition at thawingUntil). So
 * `tokens − tokensThawing` isolates only the active, reward-earning capital —
 * the on-chain analog of `delegatedTokens − delegatedThawingTokens`. The two
 * should match block-for-block; any drift is subgraph indexing lag, not a
 * semantic difference.
 */

// HorizonStaking.getDelegationPool(serviceProvider, verifier) → DelegationPool
// Struct field order per IHorizonStakingTypes (graphprotocol/contracts, packages/horizon).
export const DELEGATION_POOL_ABI = [
  {
    name: 'getDelegationPool',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'serviceProvider', type: 'address' },
      { name: 'verifier', type: 'address' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'tokens', type: 'uint256' },
          { name: 'shares', type: 'uint256' },
          { name: 'tokensThawing', type: 'uint256' },
          { name: 'sharesThawing', type: 'uint256' },
          { name: 'thawingNonce', type: 'uint256' },
        ],
      },
    ],
  },
] as const;

export interface OnchainDelegationPool {
  /** Total tokens backing the pool (wei) */
  tokens: bigint;
  /** Total shares minted (wei) */
  shares: bigint;
  /** Tokens thawing — incl. fully-thawed-not-withdrawn (wei) */
  tokensThawing: bigint;
  /** Shares representing thawing tokens (wei) */
  sharesThawing: bigint;
  /** Bumped on slashing to invalidate stale thaw requests */
  thawingNonce: bigint;
}

/**
 * Read the live delegation pool for an indexer's subgraph-service provision.
 * Returns null if the call reverts (e.g. provision doesn't exist).
 */
export async function getDelegationPoolOnchain(
  indexer: string
): Promise<OnchainDelegationPool | null> {
  try {
    const pool = await arbitrumClient.readContract({
      address: CONTRACTS.staking as Address,
      abi: DELEGATION_POOL_ABI,
      functionName: 'getDelegationPool',
      args: [indexer as Address, CONTRACTS.subgraphService as Address],
    });
    return {
      tokens: pool.tokens,
      shares: pool.shares,
      tokensThawing: pool.tokensThawing,
      sharesThawing: pool.sharesThawing,
      thawingNonce: pool.thawingNonce,
    };
  } catch {
    return null;
  }
}

export interface PoolReconciliation {
  /** True when chain and subgraph active bases agree within tolerance */
  verified: boolean;
  /** chain active base − subgraph active base (GRT); positive ⇒ subgraph trails chain */
  driftGRT: number;
  /** Drift as a fraction of the chain active base (0–1) */
  driftPct: number;
  chain: { tokens: number; thawing: number; active: number };
  subgraph: { tokens: number; thawing: number; active: number };
}

/**
 * Compare the on-chain delegation pool against subgraph-reported figures.
 * `epsilonPct` is the tolerance below which drift is treated as indexing lag
 * rather than a discrepancy (default 0.5%).
 */
export async function reconcileDelegationPool(
  indexer: string,
  subgraphDelegatedTokensWei: string,
  subgraphThawingTokensWei: string,
  epsilonPct = 0.005
): Promise<PoolReconciliation | null> {
  const pool = await getDelegationPoolOnchain(indexer);
  if (!pool) return null;

  const chainTokens = weiToGRT(pool.tokens.toString());
  const chainThawing = weiToGRT(pool.tokensThawing.toString());
  const chainActive = chainTokens - chainThawing;

  const sgTokens = weiToGRT(subgraphDelegatedTokensWei || '0');
  const sgThawing = weiToGRT(subgraphThawingTokensWei || '0');
  const sgActive = sgTokens - sgThawing;

  const driftGRT = chainActive - sgActive;
  const driftPct = chainActive > 0 ? Math.abs(driftGRT) / chainActive : (sgActive > 0 ? 1 : 0);

  return {
    verified: driftPct <= epsilonPct,
    driftGRT,
    driftPct,
    chain: { tokens: chainTokens, thawing: chainThawing, active: chainActive },
    subgraph: { tokens: sgTokens, thawing: sgThawing, active: sgActive },
  };
}
