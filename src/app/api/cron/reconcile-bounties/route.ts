/**
 * Bounty reconciliation cron.
 *
 * The BountyBoard contract is the source of truth; the `sync_bounties` table is
 * only a cache. On-chain state can change WITHOUT touching our UI — an indexer
 * claims via Arbiscan, a developer cancels directly, or anyone refunds an
 * expired bounty. The UI's PATCH is best-effort and requires a studio session,
 * which indexers typically don't have, so claims frequently never reach the DB.
 *
 * This cron reads the on-chain state of every non-terminal bounty and brings the
 * cache back in line. Runs on a schedule (vercel.json).
 */
import { NextRequest, NextResponse } from 'next/server';
import { hasDbAccess } from '@/lib/db';
import { arbitrumClient } from '@/lib/reo-contract';
import { BOUNTY_BOARD_ABI } from '@/lib/bountyBoard';
import { listReconcilableBounties, updateBountyStatus } from '@/lib/studio/db';
import { reconcileBountyStatus, needsUpdate } from '@/lib/studio/bounty-reconcile';
import { log } from '@/lib/logger';

const BOUNTY_BOARD = (process.env.NEXT_PUBLIC_BOUNTY_BOARD_ADDRESS ?? '').trim() as `0x${string}`;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasDbAccess()) return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });
  if (!BOUNTY_BOARD || BOUNTY_BOARD.length !== 42) {
    return NextResponse.json({ error: 'BountyBoard not configured' }, { status: 503 });
  }

  const bounties = await listReconcilableBounties();
  const nowSec = Math.floor(Date.now() / 1000);
  const changes: Array<{ id: number; from: string; to: string }> = [];

  for (const b of bounties) {
    if (!b.chain_bounty_id) continue;

    let chain: { settled: boolean; winner: string; expiresAt: bigint };
    try {
      const onChain = await arbitrumClient.readContract({
        address: BOUNTY_BOARD,
        abi: BOUNTY_BOARD_ABI,
        functionName: 'getBounty',
        args: [BigInt(b.chain_bounty_id)],
      });
      chain = { settled: onChain.settled, winner: onChain.winner, expiresAt: onChain.expiresAt };
    } catch (err) {
      log.api.warn({ err, bountyId: b.id, chainBountyId: b.chain_bounty_id }, 'reconcile-bounties: getBounty failed');
      continue;
    }

    const desired = reconcileBountyStatus(chain, nowSec);
    if (needsUpdate(b, desired)) {
      await updateBountyStatus(b.id, desired.status, desired.claimedBy);
      changes.push({ id: b.id, from: b.status, to: desired.status });
    }
  }

  if (changes.length > 0) {
    log.api.info({ scanned: bounties.length, changes }, 'reconcile-bounties: applied changes');
  }

  return NextResponse.json({ scanned: bounties.length, updated: changes.length, changes });
}
