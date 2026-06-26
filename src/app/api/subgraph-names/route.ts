import { NextResponse, type NextRequest } from 'next/server';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import { log } from '@/lib/logger';

interface Row {
  ipfsHash: string;
  versions: { subgraph: { metadata: { displayName: string | null } | null } }[];
}

/**
 * Batch-resolve deployment IPFS hashes → subgraph display names.
 * POST { hashes: string[] } → { data: { [ipfsHash]: displayName } }.
 * Used by the Foghorn needs-attention surface, where many erroring deployments
 * are unsignalled and so never appear in the top-N signalled list.
 */
export async function POST(request: NextRequest) {
  if (!hasSubgraphAccess()) return NextResponse.json({ data: {} });

  let hashes: string[] = [];
  try {
    const body = await request.json();
    hashes = Array.isArray(body?.hashes)
      ? body.hashes.filter((h: unknown): h is string => typeof h === 'string')
      : [];
  } catch {
    hashes = [];
  }

  const unique = Array.from(
    new Set(hashes.filter((h) => h.startsWith('Qm') || h.startsWith('baf'))),
  ).slice(0, 500);
  if (unique.length === 0) return NextResponse.json({ data: {} });

  const list = unique.map((h) => `"${h}"`).join(',');
  const query = `{
    subgraphDeployments(where: { ipfsHash_in: [${list}] }, first: ${unique.length}) {
      ipfsHash
      versions(first: 1, orderBy: createdAt, orderDirection: desc) {
        subgraph { metadata { displayName } }
      }
    }
  }`;

  try {
    const result = await subgraphQuery<{ subgraphDeployments: Row[] }>(query);
    const map: Record<string, string> = {};
    for (const d of result.subgraphDeployments) {
      const name = d.versions?.[0]?.subgraph?.metadata?.displayName;
      if (name) map[d.ipfsHash] = name;
    }
    return NextResponse.json({ data: map });
  } catch (error) {
    log.api.error({ err: error }, 'Subgraph names lookup error');
    return NextResponse.json({ data: {} });
  }
}
