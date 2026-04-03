import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { recoverVoteSigner, getCurrentPeriod, VOTE_DOMAIN, VOTE_TYPES } from '@/lib/voting';
import type { VoteMessage, VotesResponse, VoteTally, CommunityVote } from '@/lib/voting';

/**
 * GET /api/vote?period=2026-03&voter=0x...
 * Returns vote tallies, voter list, and the caller's existing vote (if any).
 */
export async function GET(request: NextRequest) {
  if (!db) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const PERIOD_RE = /^\d{4}-\d{2}$/;
  const ETH_ADDRESS_RE = /^0x[0-9a-f]{40}$/;

  const { searchParams } = request.nextUrl;
  const periodRaw = searchParams.get('period');
  const period = periodRaw && PERIOD_RE.test(periodRaw) ? periodRaw : getCurrentPeriod();
  const voterRaw = searchParams.get('voter')?.toLowerCase() || null;
  const voter = voterRaw && ETH_ADDRESS_RE.test(voterRaw) ? voterRaw : null;

  // Vote tallies per indexer
  const tallies = await db`
    SELECT indexer_address,
      SUM(vote_weight)::int as weighted_votes,
      COUNT(*)::int as voter_count
    FROM community_votes
    WHERE period = ${period}
    GROUP BY indexer_address
    ORDER BY weighted_votes DESC
  ` as unknown as VoteTally[];

  // All voters for this period
  const voters = await db`
    SELECT voter_address, indexer_address, is_delegator, vote_weight, created_at
    FROM community_votes
    WHERE period = ${period}
    ORDER BY created_at DESC
  ` as unknown as CommunityVote[];

  // Check if the requesting user already voted
  let userVote: string | null = null;
  if (voter) {
    const existing = await db`
      SELECT indexer_address FROM community_votes
      WHERE period = ${period} AND voter_address = ${voter}
    `;
    if (existing.length > 0) {
      userVote = existing[0].indexer_address;
    }
  }

  const response: VotesResponse = { period, tallies, voters, userVote };

  return NextResponse.json(response, {
    headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' },
  });
}

/**
 * POST /api/vote
 * Cast a vote — requires EIP-712 signature proving wallet ownership.
 */
export async function POST(request: NextRequest) {
  if (!db) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  let body: { message: VoteMessage; signature: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { message, signature } = body;

  // Validate required fields
  if (!message?.indexer || !message?.period || !message?.voter || !signature) {
    return NextResponse.json({ error: 'Missing required fields: message.indexer, message.period, message.voter, signature' }, { status: 400 });
  }

  // Validate period is current month (can't vote for past/future months)
  const currentPeriod = getCurrentPeriod();
  if (message.period !== currentPeriod) {
    return NextResponse.json({ error: `Can only vote for current period (${currentPeriod})` }, { status: 400 });
  }

  // Validate addresses are hex
  if (!/^0x[0-9a-fA-F]{40}$/.test(message.indexer) || !/^0x[0-9a-fA-F]{40}$/.test(message.voter)) {
    return NextResponse.json({ error: 'Invalid address format' }, { status: 400 });
  }

  // Verify the EIP-712 signature
  let recoveredAddress: string;
  try {
    recoveredAddress = await recoverVoteSigner(
      message as VoteMessage,
      signature as `0x${string}`
    );
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  // Ensure the recovered signer matches the claimed voter
  if (recoveredAddress.toLowerCase() !== message.voter.toLowerCase()) {
    return NextResponse.json({ error: 'Signature does not match voter address' }, { status: 403 });
  }

  const voterAddr = message.voter.toLowerCase();
  const indexerAddr = message.indexer.toLowerCase();

  // Check if this address already voted this period
  const existing = await db`
    SELECT id FROM community_votes
    WHERE period = ${currentPeriod} AND voter_address = ${voterAddr}
  `;
  if (existing.length > 0) {
    return NextResponse.json({ error: 'Already voted this period' }, { status: 409 });
  }

  // Check if voter is an active delegator (has delegation positions)
  const delegatorCheck = await db`
    SELECT 1 FROM delegation_events
    WHERE delegator = ${voterAddr}
      AND event_type = 'delegation'
      AND timestamp >= NOW() - INTERVAL '90 days'
    LIMIT 1
  `;
  const isDelegator = delegatorCheck.length > 0;
  const voteWeight = isDelegator ? 5 : 1;

  // Store the vote
  await db`
    INSERT INTO community_votes (period, voter_address, indexer_address, is_delegator, vote_weight, signature, message)
    VALUES (${currentPeriod}, ${voterAddr}, ${indexerAddr}, ${isDelegator}, ${voteWeight}, ${signature}, ${JSON.stringify({
      domain: VOTE_DOMAIN,
      types: VOTE_TYPES,
      message,
    })})
  `;

  return NextResponse.json({
    success: true,
    vote: {
      voter: voterAddr,
      indexer: indexerAddr,
      isDelegator,
      voteWeight,
      period: currentPeriod,
    },
  });
}
