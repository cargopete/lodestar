import { NextResponse } from 'next/server';
import { cached } from '@/lib/cache';

const SNAPSHOT_GRAPHQL = 'https://hub.snapshot.org/graphql';
const SNAPSHOT_SPACE = 'council.graphprotocol.eth';

async function fetchProposals() {
  const query = `{
    proposals(
      first: 20,
      where: { space: "${SNAPSHOT_SPACE}" },
      orderBy: "created",
      orderDirection: desc
    ) {
      id title state start end choices scores scores_total votes
    }
  }`;

  const res = await fetch(SNAPSHOT_GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) return [];
  const json = await res.json();
  return json?.data?.proposals ?? [];
}

export async function GET() {
  const proposals = await cached('lodestar:snapshot-proposals', 300, fetchProposals);

  return NextResponse.json(
    { proposals },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    }
  );
}
