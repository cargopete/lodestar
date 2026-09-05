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
import { subgraphQuery } from '@/lib/subgraph';
import { hasNuthatch, nuthatchEnabled, nuthatchSql } from '@/lib/nuthatch';
import { indexerUrlSql, deploymentServingIndexersSql, type NestIndexerUrlRow } from '@/lib/nest-queries';
import { ipfsHashToBytes32 } from '@/lib/studio/ipfs';
import { log } from '@/lib/logger';

const BOUNTY_BOARD = (process.env.NEXT_PUBLIC_BOUNTY_BOARD_ADDRESS ?? '').trim() as `0x${string}`;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ALLOC_BASE_PATH = process.env.NUTHATCH_INDEXERS_BASE_PATH || '/alloc';
const nestEnabled = () => nuthatchEnabled('NUTHATCH_INDEXERS') && hasNuthatch();

// Behind NUTHATCH_INDEXERS (nuthatch#1160) both lookups read graph-allocations-nest instead of the
// network subgraph: an indexer's registered URL from `lodestar_indexers`, and the indexers with an
// active allocation on the deployment from `lodestar_allocations`. Same fall-through as before.
async function indexerUrl(indexer: string): Promise<string | null> {
  if (nestEnabled()) {
    const rows = await nuthatchSql<NestIndexerUrlRow>(indexerUrlSql(indexer), ALLOC_BASE_PATH);
    return rows[0]?.url ?? null;
  }
  const data = await subgraphQuery<{ indexer: { url: string | null } | null }>(`{ indexer(id: "${indexer}") { url } }`);
  return data.indexer?.url ?? null;
}
async function servingIndexers(deploymentHex: string): Promise<Array<{ id: string; url: string | null }>> {
  if (nestEnabled()) {
    const rows = await nuthatchSql<NestIndexerUrlRow>(deploymentServingIndexersSql(deploymentHex, 10), ALLOC_BASE_PATH);
    return rows.map((r) => ({ id: r.id ?? '', url: r.url }));
  }
  const allocData = await subgraphQuery<{ allocations: Array<{ indexer: { id: string; url: string | null } }> }>(`{
    allocations(
      where: { subgraphDeployment: "${deploymentHex}", status: Active }
      first: 10
      orderBy: allocatedTokens
      orderDirection: desc
    ) { indexer { id url } }
  }`);
  return (allocData.allocations ?? []).map((a) => a.indexer);
}

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

/**
 * Resolve all indexer addresses to provision escrow with for a given bounty.
 * Returns the winner if they have a registered URL, otherwise falls back to
 * any active indexers serving the deployment (same logic as bounty-query route).
 */
async function resolveIndexers(chainBountyId: string, deploymentId: string): Promise<string[]> {
  let winner: string | null = null;
  try {
    const bountyData = await arbitrumClient.readContract({
      address: BOUNTY_BOARD,
      abi: BOUNTY_BOARD_ABI,
      functionName: 'getBounty',
      args: [BigInt(chainBountyId)],
    });
    const w = (bountyData.winner as string).toLowerCase();
    if (w !== ZERO_ADDRESS) winner = w;
  } catch {
    return [];
  }

  if (!winner) return [];

  // Check if the winner has a URL in the network subgraph.
  try {
    if (await indexerUrl(winner)) return [winner];
  } catch {
    // fall through to active allocation scan
  }

  // Winner has no URL — scan active allocations for any indexer serving this deployment.
  try {
    const deploymentHex = ipfsHashToBytes32(deploymentId);
    const addresses = (await servingIndexers(deploymentHex))
      .filter((a) => a?.url)
      .map((a) => a.id.toLowerCase());
    if (addresses.length > 0) return addresses;
  } catch {
    // ignore
  }

  // No URL found anywhere — still provision the winner so we're ready if they register one.
  return [winner];
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

  const bounties = await db!<{ chain_bounty_id: string; deployment_id: string }[]>`
    SELECT chain_bounty_id, deployment_id
    FROM sync_bounties
    WHERE status = 'claimed'
      AND chain_bounty_id IS NOT NULL
  `;

  if (bounties.length === 0) {
    return NextResponse.json({ provisioned: {}, note: 'no claimed bounties' });
  }

  // Resolve all indexer addresses in parallel (winner + fallback active indexers).
  const resolved = await Promise.all(
    bounties.map((b: { chain_bounty_id: string; deployment_id: string }) =>
      resolveIndexers(b.chain_bounty_id, b.deployment_id),
    ),
  );

  // Deduplicate indexer addresses across all bounties.
  const indexers = [...new Set(resolved.flat())];

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
