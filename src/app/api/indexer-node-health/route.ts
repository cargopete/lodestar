import { NextResponse, type NextRequest } from 'next/server';
import { cached } from '@/lib/cache';
import { isSafeUrlString } from '@/lib/ssrf';

export interface NodeHealthSummary {
  reachable: boolean;
  totalDeployments: number;
  syncedCount: number;
  // worstBlocksBehind is only set for deployments the node itself reports as not-synced,
  // and is capped at 10,000 to filter out stale/cross-chain noise.
  worstBlocksBehind?: number;
}

async function fetchNodeHealth(indexerUrl: string): Promise<NodeHealthSummary> {
  const base = indexerUrl.replace(/\/+$/, '');
  // Ask the node for all deployment statuses. We trust the node's own `synced` flag
  // as the primary signal — computing blocksBehind ourselves from raw chain numbers
  // produces false positives when the node hosts stale or cross-chain deployments.
  const query = `{
    indexingStatuses {
      synced
      health
      chains {
        ... on EthereumIndexingStatus {
          chainHeadBlock { number }
          latestBlock { number }
        }
      }
    }
  }`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const res = await fetch(`${base}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });

    if (!res.ok) return { reachable: false, totalDeployments: 0, syncedCount: 0 };

    const json = await res.json();
    const statuses: Array<{
      synced: boolean;
      health: string;
      chains?: Array<{ chainHeadBlock?: { number: string | number } | null; latestBlock?: { number: string | number } | null }>;
    }> = json.data?.indexingStatuses ?? [];

    if (!statuses.length) return { reachable: true, totalDeployments: 0, syncedCount: 0 };

    let syncedCount = 0;
    let worstBlocksBehind = 0;

    for (const s of statuses) {
      // Trust the node's own synced flag — it applies the right chain-specific threshold
      const nodeConsidersSynced = s.synced && s.health !== 'failed';
      if (nodeConsidersSynced) {
        syncedCount++;
      } else if (s.health !== 'failed') {
        // For lagging (not failed) deployments, record blocksBehind as supplementary info.
        // Cap at 10,000 to discard stale/abandoned deployments that inflate the number.
        const chain = s.chains?.[0];
        const chainHead = chain?.chainHeadBlock ? Number(chain.chainHeadBlock.number) : undefined;
        const latest = chain?.latestBlock ? Number(chain.latestBlock.number) : undefined;
        if (chainHead && latest) {
          const behind = Math.max(chainHead - latest, 0);
          if (behind <= 10_000) {
            worstBlocksBehind = Math.max(worstBlocksBehind, behind);
          }
        }
      }
    }

    return {
      reachable: true,
      totalDeployments: statuses.length,
      syncedCount,
      worstBlocksBehind: worstBlocksBehind > 0 ? worstBlocksBehind : undefined,
    };
  } catch {
    return { reachable: false, totalDeployments: 0, syncedCount: 0 };
  } finally {
    clearTimeout(timeout);
  }
}

// GET /api/indexer-node-health?url=<indexer-url>&addr=<address>
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const url = searchParams.get('url');
  const addr = searchParams.get('addr');

  if (!url || !addr) {
    return NextResponse.json({ error: 'Missing url or addr' }, { status: 400 });
  }
  if (!isSafeUrlString(url)) {
    return NextResponse.json(
      { data: { reachable: false, totalDeployments: 0, syncedCount: 0 } as NodeHealthSummary },
      { headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=240' } },
    );
  }

  const data = await cached<NodeHealthSummary>(
    `lodestar:node-health:${url}`,
    120,
    () => fetchNodeHealth(url),
  );

  return NextResponse.json(
    { data },
    { headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=240' } },
  );
}
