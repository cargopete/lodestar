/**
 * TAP escrow provisioning cron.
 *
 * Ensures the dashboard's TAP signer has >= 1 GRT escrow with every indexer
 * that has a claimed bounty on the BountyBoard. Runs on a schedule (vercel.json).
 *
 * Flow:
 *   DB claimed bounties → chain: BountyBoard + SubgraphService → indexer addresses
 *   → PaymentsEscrow.getBalance → deposit if < 1 GRT
 *
 * After a deposit the indexer-service refreshes its escrow cache within ~60 s,
 * so the playground becomes usable shortly after this cron completes.
 */
import { NextRequest, NextResponse } from 'next/server';
import { hasDbAccess, db } from '@/lib/db';
import { arbitrumClient } from '@/lib/reo-contract';
import { BOUNTY_BOARD_ABI } from '@/lib/bountyBoard';
import { hasTapSigner, ensureEscrow, getEscrowBalance, MIN_ESCROW_WEI } from '@/lib/tap';
import { log } from '@/lib/logger';

const BOUNTY_BOARD = (process.env.NEXT_PUBLIC_BOUNTY_BOARD_ADDRESS ?? '').trim() as `0x${string}`;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

/** Resolve the indexer address for a given on-chain bounty ID. */
async function resolveIndexer(chainBountyId: string): Promise<string | null> {
  try {
    const bountyData = await arbitrumClient.readContract({
      address: BOUNTY_BOARD,
      abi: BOUNTY_BOARD_ABI,
      functionName: 'getBounty',
      args: [BigInt(chainBountyId)],
    });
    // The BountyBoard resolves the allocation to the indexer address internally
    // and stores it directly as `winner`.
    const winner = (bountyData.winner as string).toLowerCase();
    return winner === ZERO_ADDRESS ? null : winner;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!hasTapSigner()) {
    return NextResponse.json({ skipped: true, reason: 'TAP_SIGNER_PRIVATE_KEY not configured' });
  }

  if (!BOUNTY_BOARD || BOUNTY_BOARD === ZERO_ADDRESS) {
    return NextResponse.json({ skipped: true, reason: 'NEXT_PUBLIC_BOUNTY_BOARD_ADDRESS not configured' });
  }

  if (!hasDbAccess()) {
    return NextResponse.json({ error: 'DB unavailable' }, { status: 503 });
  }

  const bounties = await db!<{ chain_bounty_id: string }[]>`
    SELECT chain_bounty_id
    FROM sync_bounties
    WHERE status = 'claimed'
      AND chain_bounty_id IS NOT NULL
  `;

  if (bounties.length === 0) {
    return NextResponse.json({ provisioned: {}, note: 'no claimed bounties' });
  }

  // Resolve all indexer addresses in parallel (one chain call per bounty).
  const resolved = await Promise.all(
    bounties.map(async (b: { chain_bounty_id: string }) => ({
      chainBountyId: b.chain_bounty_id,
      indexer: await resolveIndexer(b.chain_bounty_id),
    })),
  );

  // Deduplicate indexer addresses.
  const indexers = [...new Set(
    resolved
      .map((r: { chainBountyId: string; indexer: string | null }) => r.indexer)
      .filter((v): v is string => v !== null),
  )];

  const results: Record<string, string> = {};

  for (const indexer of indexers) {
    try {
      const balance = await getEscrowBalance(indexer);
      if (balance >= MIN_ESCROW_WEI) {
        results[indexer] = 'sufficient';
        continue;
      }
      log.cron.info({ indexer, balance: balance.toString() }, 'TAP: provisioning escrow');
      await ensureEscrow(indexer);
      results[indexer] = 'deposited';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.cron.warn({ indexer, err: msg }, 'TAP: escrow provisioning failed');
      results[indexer] = `error: ${msg}`;
    }
  }

  return NextResponse.json({ provisioned: results });
}
