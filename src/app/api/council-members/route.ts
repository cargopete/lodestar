import { NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { ensQuery, hasSubgraphAccess } from '@/lib/subgraph';

const SNAPSHOT_GRAPHQL = 'https://hub.snapshot.org/graphql';
const SNAPSHOT_SPACE = 'council.graphprotocol.eth';
const PROPOSALS_FOR_STATS = 10;

// Canonical council seats — multisig owners as of April 2026
// Multisig: 0x48301Fe520f72994d32eAd72E2B6A8447873CF50
const COUNCIL_SEATS = [
  '0xDc524F119a00CaB2BE368388f55Edb9Cb7071397',
  '0x4c5f34ab5833D2C8099FB64e28FaFCE5e446649a',
  '0x3252567A834c05B756f5562b13158e398e14ad8e',
  '0xeDE524607B9722Fac121F20ef433fF978C2A0334',
  '0xCCd92AC3B11Bd39C1B0fB92639ba24BD80efA8a5',
  '0x97DD367671b77a47AC9867C3203dC7829020C789',
  '0xF53F07d48b08483330b57F029a9f1369158D4011',
  '0x7EAbE4F636B937628A7Fe503bD7F06772C047FEe',
  '0xB02ce52E8B7344d306b60CB1E0d4Db1EF86b80b0',
  '0x17118dB8DdD04eFA661ce81ff181cf2807Ee2C21',
  '0x68AfAbC57e048b29E0741816167777c148a02b57',
].map((a) => a.toLowerCase());

async function snapshotPost<T>(query: string): Promise<T> {
  const res = await fetch(SNAPSHOT_GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Snapshot error ${res.status}`);
  const json = await res.json();
  return json.data as T;
}

async function resolveEns(address: string): Promise<string | null> {
  if (!hasSubgraphAccess()) return null;
  try {
    const result = await cached(`ens:${address}`, 86400, async () => {
      const data = await ensQuery<{ domains: Array<{ name: string }> }>(`{
        domains(first: 5, where: { resolvedAddress: "${address}", name_not: null }) {
          name
        }
      }`);
      const names = data.domains.map((d) => d.name).sort((a, b) => a.length - b.length);
      return { ensName: names[0] ?? null };
    });
    return result.ensName;
  } catch {
    return null;
  }
}

async function fetchCouncilMembers() {
  const canonicalSeats = COUNCIL_SEATS;

  // 1. Fetch recent proposals for participation stats
  const proposalsData = await snapshotPost<{
    proposals: Array<{ id: string; title: string; choices: string[]; state: string; end: number }>;
  }>(`{
    proposals(
      first: ${PROPOSALS_FOR_STATS},
      where: { space: "${SNAPSHOT_SPACE}" },
      orderBy: "created",
      orderDirection: desc
    ) { id title choices state end }
  }`);

  const proposals = proposalsData.proposals;

  // 3. Batch fetch votes for every proposal
  const votesByProposal = await Promise.all(
    proposals.map(async (p) => {
      const data = await snapshotPost<{
        votes: Array<{ voter: string; choice: number; created: number }>;
      }>(`{
        votes(
          first: 100,
          where: { space: "${SNAPSHOT_SPACE}", proposal: "${p.id}" }
          orderBy: "created"
          orderDirection: asc
        ) { voter choice created }
      }`);
      return { proposal: p, votes: data.votes };
    })
  );

  // 4. Use multisig seats as the canonical set
  const allAddresses = new Set<string>(canonicalSeats);

  // 5. Compute per-address participation stats
  type Stats = {
    proposalsVoted: number;
    lastVote: { proposalTitle: string; choice: string; timestamp: number } | null;
  };
  const statsMap = new Map<string, Stats>();
  for (const addr of allAddresses) statsMap.set(addr, { proposalsVoted: 0, lastVote: null });

  for (const { proposal, votes } of votesByProposal) {
    for (const vote of votes) {
      const addr = vote.voter.toLowerCase();
      const s = statsMap.get(addr);
      if (!s) continue;
      s.proposalsVoted++;
      const choiceLabel = proposal.choices[vote.choice - 1] ?? 'Unknown';
      if (!s.lastVote || vote.created > s.lastVote.timestamp) {
        s.lastVote = { proposalTitle: proposal.title, choice: choiceLabel, timestamp: vote.created };
      }
    }
  }

  // 6. Resolve ENS names in parallel
  const addresses = [...allAddresses];
  const ensResults = await Promise.all(addresses.map((addr) => resolveEns(addr)));
  const ensMap = new Map(addresses.map((addr, i) => [addr, ensResults[i]]));

  // 7. Assemble final list — all multisig seats, sorted by participation desc
  const members = addresses
    .map((address) => {
      const s = statsMap.get(address)!;
      return {
        address,
        ensName: ensMap.get(address) ?? null,
        proposalsVoted: s.proposalsVoted,
        proposalsTotal: proposals.length,
        participationRate: proposals.length > 0
          ? Math.round((s.proposalsVoted / proposals.length) * 100)
          : 0,
        lastVote: s.lastVote,
      };
    })
    .sort((a, b) => b.proposalsVoted - a.proposalsVoted);

  return { members, totalProposals: proposals.length, seatCount: canonicalSeats.length };
}

export async function GET() {
  try {
    const data = await cached('lodestar:council-members', 1800, fetchCouncilMembers);
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800' },
    });
  } catch {
    return NextResponse.json({ members: [], totalProposals: 0 }, { status: 500 });
  }
}
