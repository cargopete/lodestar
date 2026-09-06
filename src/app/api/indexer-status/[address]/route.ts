import { NextResponse, type NextRequest } from 'next/server';
import { cached } from '@/lib/cache';
import { hasNuthatch, nuthatchSqlReady } from '@/lib/nuthatch';
import { indexerDetailSql, indexerActiveAllocationsSql, type NestIndexerDetailRow, type NestActiveAllocationRow } from '@/lib/nest-queries';
import { bytes32ToIpfsHash } from '@/lib/studio/ipfs';

const INDEXERS_BASE_PATH = process.env.NUTHATCH_INDEXERS_BASE_PATH || '/alloc';
import { log } from '@/lib/logger';
import { isSafeUrlString } from '@/lib/ssrf';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Allocation {
  id: string;
  allocatedTokens: string;
  createdAtEpoch: number;
  subgraphDeployment: {
    id: string;
    ipfsHash: string;
    signalledTokens: string;
    stakedTokens: string;
    versions: Array<{ subgraph: { metadata: { displayName: string } | null } | null }>;
  };
}

interface StatusEntry {
  subgraph: string;
  synced: boolean;
  health: 'healthy' | 'unhealthy' | 'failed';
  fatalError?: { message: string; handler?: string | null } | null;
  nonFatalErrors?: Array<{ message: string }>;
  chains?: Array<{
    network?: string;
    chainHeadBlock?: { number: string | number } | null;
    latestBlock?: { number: string | number } | null;
  }>;
  entityCount?: string;
}

export interface IndexerDeploymentStatus {
  deploymentId: string;
  ipfsHash: string;
  displayName: string | null;
  allocatedTokens: string;
  signalledTokens: string;
  stakedTokens: string;
  createdAtEpoch: number;
  status: 'synced' | 'syncing' | 'failed' | 'unreachable';
  health?: 'healthy' | 'unhealthy' | 'failed';
  network?: string;
  chainHeadBlock?: number;
  latestBlock?: number;
  blocksBehind?: number;
  syncProgress?: number;
  entityCount?: string;
  fatalError?: string;
}

export interface IndexerStatusResponse {
  indexerAddress: string;
  indexerUrl: string | null;
  totalAllocations: number;
  syncedCount: number;
  syncingCount: number;
  failedCount: number;
  unreachableCount: number;
  deployments: IndexerDeploymentStatus[];
}

// ---------------------------------------------------------------------------
// Query the indexer's status endpoint for multiple deployments in one request
// ---------------------------------------------------------------------------

async function queryBatchStatus(
  indexerUrl: string,
  ipfsHashes: string[],
  timeoutMs = 5000,
): Promise<Map<string, StatusEntry>> {
  const baseUrl = indexerUrl.replace(/\/+$/, '');
  const url = `${baseUrl}/status`;

  // Build a single query for all deployments
  const hashList = ipfsHashes.map((h) => `"${h}"`).join(', ');
  const query = `{
    indexingStatuses(subgraphs: [${hashList}]) {
      subgraph
      synced
      health
      fatalError { message handler }
      nonFatalErrors { message }
      chains {
        ... on EthereumIndexingStatus {
          network
          chainHeadBlock { number }
          latestBlock { number }
        }
      }
      entityCount
    }
  }`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });

    if (!res.ok) return new Map();
    const json = await res.json();

    const map = new Map<string, StatusEntry>();
    for (const s of json.data?.indexingStatuses ?? []) {
      map.set(s.subgraph, s);
    }
    return map;
  } catch {
    return new Map();
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> },
) {
  // The URL and the allocations come from the nest (nuthatch#1160); the gateway path this once fell
  // back to left with the key. The indexers' own /status endpoints are probed as before.
  if (!hasNuthatch()) {
    return NextResponse.json({ error: 'Nuthatch is not configured' }, { status: 503 });
  }

  const { address } = await params;
  const addr = address.toLowerCase();

  if (!/^0x[0-9a-f]{40}$/.test(addr)) {
    return NextResponse.json({ error: 'Invalid address format' }, { status: 400 });
  }

  try {
    const data = await cached<IndexerStatusResponse>(
      `lodestar:indexer-status:${addr}`,
      60,
      async () => {
        // 1. Fetch indexer URL and all active allocations with ipfsHash
        let allAllocations: Allocation[] = [];
        let indexerUrl: string | null = null;
        {
          const [me, active] = await Promise.all([
            nuthatchSqlReady<NestIndexerDetailRow>(indexerDetailSql(addr), INDEXERS_BASE_PATH),
            nuthatchSqlReady<NestActiveAllocationRow>(indexerActiveAllocationsSql(addr), INDEXERS_BASE_PATH),
          ]);
          if (!me.ok) throw Object.assign(new Error(me.error), { nest: me });
          if (!active.ok) throw Object.assign(new Error(active.error), { nest: active });
          indexerUrl = me.data.rows[0]?.url ?? null;
          allAllocations = active.data.rows.map((a) => {
            let ipfsHash = a.subgraph_deployment;
            try { ipfsHash = bytes32ToIpfsHash(a.subgraph_deployment); } catch { /* keep the id */ }
            return {
              id: a.id, allocatedTokens: a.allocated_tokens, createdAtEpoch: Number(a.created_at_epoch),
              subgraphDeployment: { id: a.subgraph_deployment, ipfsHash, signalledTokens: a.signalled_tokens, stakedTokens: a.deployment_staked_tokens ?? '0', versions: [] },
            };
          });
        }

        if (allAllocations.length === 0) {
          return {
            indexerAddress: addr,
            indexerUrl,
            totalAllocations: 0,
            syncedCount: 0,
            syncingCount: 0,
            failedCount: 0,
            unreachableCount: 0,
            deployments: [],
          };
        }

        // 2. Query the indexer's status endpoint for all deployments at once
        const ipfsHashes = allAllocations.map((a) => a.subgraphDeployment.ipfsHash);
        const statusMap = indexerUrl && isSafeUrlString(indexerUrl)
          ? await queryBatchStatus(indexerUrl, ipfsHashes)
          : new Map<string, StatusEntry>();

        // 3. Merge allocation data with status data
        const deployments: IndexerDeploymentStatus[] = allAllocations.map((alloc) => {
          const dep = alloc.subgraphDeployment;
          const s = statusMap.get(dep.ipfsHash);

          const displayName = dep.versions?.[0]?.subgraph?.metadata?.displayName ?? null;

          if (!s) {
            return {
              deploymentId: dep.id,
              ipfsHash: dep.ipfsHash,
              displayName,
              allocatedTokens: alloc.allocatedTokens,
              signalledTokens: dep.signalledTokens,
              stakedTokens: dep.stakedTokens,
              createdAtEpoch: alloc.createdAtEpoch,
              status: 'unreachable' as const,
            };
          }

          const chain = s.chains?.[0];
          const chainHead = chain?.chainHeadBlock ? Number(chain.chainHeadBlock.number) : undefined;
          const latest = chain?.latestBlock ? Number(chain.latestBlock.number) : undefined;

          let syncProgress: number | undefined;
          let blocksBehind: number | undefined;

          if (chainHead && latest) {
            syncProgress = chainHead > 0 ? Math.min((latest / chainHead) * 100, 100) : 0;
            blocksBehind = Math.max(chainHead - latest, 0);
          }

          const effectivelySynced = blocksBehind !== undefined ? blocksBehind <= 50 : !!s.synced;

          let status: IndexerDeploymentStatus['status'] = 'syncing';
          if (s.health === 'failed' || s.fatalError) {
            status = 'failed';
          } else if (effectivelySynced) {
            status = 'synced';
          }

          return {
            deploymentId: dep.id,
            ipfsHash: dep.ipfsHash,
            displayName,
            allocatedTokens: alloc.allocatedTokens,
            signalledTokens: dep.signalledTokens,
            stakedTokens: dep.stakedTokens,
            createdAtEpoch: alloc.createdAtEpoch,
            status,
            health: s.health,
            network: chain?.network,
            chainHeadBlock: chainHead,
            latestBlock: latest,
            blocksBehind,
            syncProgress,
            entityCount: s.entityCount,
            fatalError: s.fatalError?.message,
          };
        });

        // Sort: failed first, then syncing, then synced, then unreachable
        const statusOrder = { failed: 0, syncing: 1, synced: 2, unreachable: 3 };
        deployments.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

        return {
          indexerAddress: addr,
          indexerUrl,
          totalAllocations: deployments.length,
          syncedCount: deployments.filter((d) => d.status === 'synced').length,
          syncingCount: deployments.filter((d) => d.status === 'syncing').length,
          failedCount: deployments.filter((d) => d.status === 'failed').length,
          unreachableCount: deployments.filter((d) => d.status === 'unreachable').length,
          deployments,
        };
      },
    );

    return NextResponse.json(
      { data },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' } },
    );
  } catch (error) {
    log.api.error({ err: error }, 'Indexer status error');
    return NextResponse.json({ error: 'Failed to fetch indexer status' }, { status: 500 });
  }
}
