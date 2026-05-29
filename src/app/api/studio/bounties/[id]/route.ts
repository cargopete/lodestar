import { type NextRequest, NextResponse } from 'next/server';
import { hasDbAccess } from '@/lib/db';
import { getBounty, updateBountyStatus } from '@/lib/studio/db';
import { arbitrumClient } from '@/lib/reo-contract';
import { BOUNTY_BOARD_ABI } from '@/lib/bountyBoard';
import { reconcileBountyStatus, needsUpdate } from '@/lib/studio/bounty-reconcile';

const BOUNTY_BOARD = (process.env.NEXT_PUBLIC_BOUNTY_BOARD_ADDRESS ?? '').trim() as `0x${string}`;

/**
 * PATCH — reconcile a single bounty against its on-chain state.
 *
 * Public and unauthenticated by design: the server only ever writes the status
 * the BountyBoard contract reports, so there is nothing for a caller to forge
 * (the old version trusted an `action` field and a studio session, which meant
 * indexers — who rarely have a session — couldn't update the cache at all, and
 * a signed-in user could mark any bounty "claimed").
 *
 * The UI calls this for instant feedback right after a claim/cancel/refund tx
 * confirms; the reconcile-bounties cron is the backstop for changes that never
 * touch the UI.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!hasDbAccess()) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });

  const { id } = await params;
  const numId = parseInt(id, 10);
  if (isNaN(numId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const bounty = await getBounty(numId);
  if (!bounty) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (!bounty.chain_bounty_id) {
    return NextResponse.json({ error: 'Bounty has no on-chain id to reconcile' }, { status: 409 });
  }
  if (!BOUNTY_BOARD || BOUNTY_BOARD.length !== 42) {
    return NextResponse.json({ error: 'BountyBoard not configured' }, { status: 503 });
  }

  let chain: { settled: boolean; winner: string; expiresAt: bigint };
  try {
    const onChain = await arbitrumClient.readContract({
      address: BOUNTY_BOARD,
      abi: BOUNTY_BOARD_ABI,
      functionName: 'getBounty',
      args: [BigInt(bounty.chain_bounty_id)],
    });
    chain = { settled: onChain.settled, winner: onChain.winner, expiresAt: onChain.expiresAt };
  } catch {
    return NextResponse.json({ error: 'Failed to read on-chain bounty' }, { status: 502 });
  }

  const desired = reconcileBountyStatus(chain, Math.floor(Date.now() / 1000));
  if (needsUpdate(bounty, desired)) {
    await updateBountyStatus(numId, desired.status, desired.claimedBy);
  }

  return NextResponse.json({ ok: true, status: desired.status, claimedBy: desired.claimedBy ?? null });
}
