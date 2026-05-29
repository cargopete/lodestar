import { NextResponse, type NextRequest } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import { log } from '@/lib/logger';

interface RawVersion {
  version: number;
  createdAt: number;
  metadata: { label: string | null; description: string | null } | null;
  subgraphDeployment: {
    ipfsHash: string;
    signalledTokens: string;
    stakedTokens: string;
  } | null;
}

const IPFS_HASH_RE = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ hash: string }> },
) {
  const { hash } = await params;

  if (!IPFS_HASH_RE.test(hash)) {
    return NextResponse.json({ error: 'Invalid deployment hash' }, { status: 400 });
  }

  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  // Resolve the deployment to its parent subgraph, then list ALL that subgraph's
  // versions (each version points at its own deployment + semver label).
  const query = `{
    subgraphDeployments(where: { ipfsHash: "${hash}" }, first: 1) {
      versions(first: 1, orderBy: createdAt, orderDirection: desc) {
        subgraph {
          id
          versions(first: 100, orderBy: version, orderDirection: desc) {
            version
            createdAt
            metadata { label description }
            subgraphDeployment {
              ipfsHash
              signalledTokens
              stakedTokens
            }
          }
        }
      }
    }
  }`;

  const cacheKey = `lodestar:versions:${hash}`;

  try {
    const data = await cached(cacheKey, 600, async () => {
      const result = await subgraphQuery<{
        subgraphDeployments: Array<{
          versions: Array<{ subgraph: { id: string; versions: RawVersion[] } | null }>;
        }>;
      }>(query);

      const subgraph = result.subgraphDeployments[0]?.versions[0]?.subgraph ?? null;
      if (!subgraph) return { subgraphId: null, versions: [] };

      const versions = subgraph.versions
        .filter((v) => v.subgraphDeployment != null)
        .map((v) => ({
          version: v.version,
          label: v.metadata?.label ?? null,
          createdAt: v.createdAt,
          ipfsHash: v.subgraphDeployment!.ipfsHash,
          signalledTokens: v.subgraphDeployment!.signalledTokens,
          stakedTokens: v.subgraphDeployment!.stakedTokens,
          isCurrent: v.subgraphDeployment!.ipfsHash === hash,
        }));

      return { subgraphId: subgraph.id, versions };
    });

    return NextResponse.json({ data }, {
      headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=1200' },
    });
  } catch (error) {
    log.api.error({ err: error }, 'Subgraph versions error');
    return NextResponse.json({ error: 'Failed to fetch version history' }, { status: 500 });
  }
}
