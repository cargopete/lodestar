import { NextResponse, type NextRequest } from 'next/server';
import { cached } from '@/lib/cache';

// Reuse the same SSRF-safe URL check as the indexer-status route
function isSafeUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost') return false;
    if (/^127\./.test(host)) return false;
    if (/^10\./.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    if (/^192\.168\./.test(host)) return false;
    if (/^169\.254\./.test(host)) return false;
    if (host === '::1' || host === '[::1]') return false;
    if (/^fc|^fd/.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

export interface NodeHealthSummary {
  reachable: boolean;
  totalDeployments: number;
  syncedCount: number;
  worstBlocksBehind?: number;
}

async function fetchNodeHealth(indexerUrl: string): Promise<NodeHealthSummary> {
  const base = indexerUrl.replace(/\/+$/, '');
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
      const chain = s.chains?.[0];
      const chainHead = chain?.chainHeadBlock ? Number(chain.chainHeadBlock.number) : undefined;
      const latest = chain?.latestBlock ? Number(chain.latestBlock.number) : undefined;
      const blocksBehind = chainHead && latest ? Math.max(chainHead - latest, 0) : undefined;
      const synced = blocksBehind !== undefined ? blocksBehind <= 50 : !!s.synced;
      if (synced && s.health !== 'failed') syncedCount++;
      if (blocksBehind !== undefined) worstBlocksBehind = Math.max(worstBlocksBehind, blocksBehind);
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
  if (!isSafeUrl(url)) {
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
