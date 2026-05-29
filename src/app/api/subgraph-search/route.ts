import { NextResponse, type NextRequest } from 'next/server';
import { cached } from '@/lib/cache';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import { log } from '@/lib/logger';

interface SubgraphResult {
  id: string;
  metadata: { displayName: string; description: string | null } | null;
  currentVersion: {
    subgraphDeployment: {
      ipfsHash: string;
      signalledTokens: string;
      stakedTokens: string;
    };
  } | null;
}

export async function GET(request: NextRequest) {
  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  const q = request.nextUrl.searchParams.get('q')?.trim();
  if (!q || q.length < 2) {
    return NextResponse.json({ data: [] });
  }
  if (q.length > 100) {
    return NextResponse.json({ data: [] });
  }

  // Allowlist: alphanumeric, spaces, hyphens, underscores, dots (covers names + CIDv0/CIDv1 hashes)
  if (!/^[a-zA-Z0-9\s\-_.]+$/.test(q)) {
    return NextResponse.json({ data: [] });
  }
  const safe = q;

  try {
    const isHash = safe.startsWith('Qm') && safe.length >= 8;
    // Contract address: 0x + 40 hex. The network subgraph has no indexed data-source
    // address field, but every deployment's raw manifest YAML is queryable as a string,
    // and contract addresses appear verbatim inside it — so substring-match the manifest.
    const isAddress = /^0x[a-fA-F0-9]{40}$/.test(safe);

    const data = await cached(
      `lodestar:subgraph-search:${safe.toLowerCase()}`,
      300, // 5 min — subgraph names don't change often
      async () => {
        if (isAddress) {
          // Find deployments whose manifest references this contract address.
          const manifests = await subgraphQuery<{
            subgraphDeploymentManifests: Array<{
              deployment: {
                ipfsHash: string;
                signalledTokens: string;
                stakedTokens: string;
                versions: Array<{
                  subgraph: {
                    id: string;
                    metadata: { displayName: string; description: string | null } | null;
                  };
                }>;
              } | null;
            }>;
          }>(`{
            subgraphDeploymentManifests(
              first: 20
              where: { manifest_contains_nocase: "${safe}" }
            ) {
              deployment {
                ipfsHash
                signalledTokens
                stakedTokens
                versions(first: 1, orderBy: createdAt, orderDirection: desc) {
                  subgraph {
                    id
                    metadata { displayName description }
                  }
                }
              }
            }
          }`);
          // Dedupe by deployment, drop manifests with no live deployment, sort by signal desc.
          const seen = new Set<string>();
          const mapped = manifests.subgraphDeploymentManifests
            .map((m) => m.deployment)
            .filter((d): d is NonNullable<typeof d> => {
              if (!d || seen.has(d.ipfsHash)) return false;
              seen.add(d.ipfsHash);
              return true;
            })
            .sort((a, b) => {
              const sa = BigInt(a.signalledTokens || '0');
              const sb = BigInt(b.signalledTokens || '0');
              return sa < sb ? 1 : sa > sb ? -1 : 0;
            })
            .map((d) => ({
              id: d.versions[0]?.subgraph?.id ?? d.ipfsHash,
              metadata: d.versions[0]?.subgraph?.metadata ?? null,
              currentVersion: {
                subgraphDeployment: {
                  ipfsHash: d.ipfsHash,
                  signalledTokens: d.signalledTokens,
                  stakedTokens: d.stakedTokens,
                },
              },
            }));
          return { subgraphs: mapped };
        }

        if (isHash) {
          // Search by IPFS hash — query deployments directly, then find parent subgraphs
          const deployments = await subgraphQuery<{
            subgraphDeployments: Array<{
              id: string;
              ipfsHash: string;
              signalledTokens: string;
              stakedTokens: string;
              versions: Array<{
                subgraph: {
                  id: string;
                  metadata: { displayName: string; description: string | null } | null;
                };
              }>;
            }>;
          }>(`{
            subgraphDeployments(
              first: 10
              where: { ipfsHash_starts_with: "${safe}" }
              orderBy: signalledTokens
              orderDirection: desc
            ) {
              id
              ipfsHash
              signalledTokens
              stakedTokens
              versions(first: 1, orderBy: createdAt, orderDirection: desc) {
                subgraph {
                  id
                  metadata { displayName description }
                }
              }
            }
          }`);
          // Map to same shape as name search results
          return {
            subgraphs: deployments.subgraphDeployments.map((d) => ({
              id: d.versions[0]?.subgraph?.id ?? d.id,
              metadata: d.versions[0]?.subgraph?.metadata ?? null,
              currentVersion: {
                subgraphDeployment: {
                  ipfsHash: d.ipfsHash,
                  signalledTokens: d.signalledTokens,
                  stakedTokens: d.stakedTokens,
                },
              },
            })),
          };
        }

        // Name search
        return subgraphQuery<{ subgraphs: SubgraphResult[] }>(`{
          subgraphs(
            first: 10
            orderBy: signalledTokens
            orderDirection: desc
            where: { metadata_: { displayName_contains_nocase: "${safe}" }, currentVersion_not: null }
          ) {
            id
            metadata { displayName description }
            currentVersion {
              subgraphDeployment {
                ipfsHash
                signalledTokens
                stakedTokens
              }
            }
          }
        }`);
      },
    );

    return NextResponse.json(
      { data: data.subgraphs },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        },
      },
    );
  } catch (error) {
    log.api.error({ err: error }, 'Subgraph search error');
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
