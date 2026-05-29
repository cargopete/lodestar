/**
 * Pure reconciliation logic for sync bounties.
 *
 * The BountyBoard contract is the source of truth; the `sync_bounties` table is
 * only a cache used to render the UI. State changes can happen on-chain WITHOUT
 * going through our UI (an indexer claims via Arbiscan, a developer cancels
 * directly, anyone refunds an expired bounty), so we periodically read the
 * on-chain state and bring the cache back in line.
 *
 * This module is intentionally free of any RPC/DB dependency so it can be
 * exhaustively unit-tested. The cron route supplies the on-chain state.
 */

export type BountyStatus = 'open' | 'claimed' | 'cancelled' | 'expired';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/** The subset of the on-chain Bounty struct that determines status. */
export interface ChainBountyState {
  settled: boolean;
  winner: string; // address; ZERO when no winner
  expiresAt: bigint; // unix seconds; 0n = no expiry
}

export interface ReconcileResult {
  status: BountyStatus;
  /** Set only when status === 'claimed' — the winning indexer (lowercased). */
  claimedBy?: string;
}

/**
 * Compute what the cached status SHOULD be, given the live on-chain state.
 * Always returns the canonical desired state; the caller diffs it against the
 * stored row to decide whether a write is needed (see `needsUpdate`).
 *
 * @param chain   on-chain bounty state from BountyBoard.getBounty()
 * @param nowSec  current unix time in seconds
 */
export function reconcileBountyStatus(chain: ChainBountyState, nowSec: number): ReconcileResult {
  const hasExpiry = chain.expiresAt > 0n;
  const isPastExpiry = hasExpiry && BigInt(Math.floor(nowSec)) > chain.expiresAt;
  const hasWinner = chain.winner.toLowerCase() !== ZERO_ADDRESS;

  if (chain.settled) {
    if (hasWinner) {
      // claim() succeeded — a winner was paid.
      return { status: 'claimed', claimedBy: chain.winner.toLowerCase() };
    }
    // cancel() or refundExpired() returned the GRT to the developer. Both zero
    // the winner; distinguish for the cache by whether it had expired.
    return { status: isPastExpiry ? 'expired' : 'cancelled' };
  }

  if (isPastExpiry) {
    // Not settled but past expiry: no longer claimable on-chain (claim() would
    // revert), and the developer can still call refundExpired().
    return { status: 'expired' };
  }

  return { status: 'open' };
}

/**
 * Whether the cached row needs updating to match the desired on-chain state.
 * Compares status and, for claims, the recorded winner (the old optimistic
 * PATCH may have stored the studio session address rather than the true winner).
 */
export function needsUpdate(
  current: { status: string; claimed_by?: string | null },
  desired: ReconcileResult,
): boolean {
  if (current.status !== desired.status) return true;
  if (desired.status === 'claimed') {
    return (current.claimed_by ?? '').toLowerCase() !== (desired.claimedBy ?? '');
  }
  return false;
}
