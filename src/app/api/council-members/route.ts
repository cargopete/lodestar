import { NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { ensQuery, hasSubgraphAccess } from '@/lib/subgraph';

const SNAPSHOT_GRAPHQL = 'https://hub.snapshot.org/graphql';
const SNAPSHOT_SPACE = 'council.graphprotocol.eth';
const PROPOSALS_FOR_STATS = 10;

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
  // 1. Fetch space config
  const spaceData = await snapshotPost<{
    space: { admins: string[]; members: string[] };
  }>(`{
    space(id: "${SNAPSHOT_SPACE}") { admins members }
  }`);

  // 2. Fetch recent proposals for participation stats
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

  // 4. Build canonical voter universe
  const allAddresses = new Set<string>([
    ...spaceData.space.admins.map((a) => a.toLowerCase()),
    ...spaceData.space.members.map((m) => m.toLowerCase()),
  ]);
  for (const { votes } of votesByProposal) {
    for (const v of votes) allAddresses.add(v.voter.toLowerCase());
  }

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

  // 7. Assemble final list — only addresses that have actually voted, sorted by participation desc
  const members = addresses
    .filter((address) => (statsMap.get(address)?.proposalsVoted ?? 0) > 0)
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

  return { members, totalProposals: proposals.length };
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
