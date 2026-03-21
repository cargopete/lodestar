/**
 * Indexing status types and helpers.
 * Queries individual indexer /status endpoints (graph-node status API proxy)
 * to aggregate sync state, health, and error data for a given deployment.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IndexerStatusResult {
  indexerId: string;
  indexerName: string | null;
  url: string;
  allocatedTokens: string;
  status: 'synced' | 'syncing' | 'failed' | 'unreachable';
  health?: 'healthy' | 'unhealthy' | 'failed';
  synced?: boolean;
  chainHeadBlock?: number;
  latestBlock?: number;
  network?: string;
  entityCount?: string;
  fatalError?: { message: string; handler?: string | null };
  nonFatalErrors?: string[];
  nonFatalErrorCount?: number;
  syncProgress?: number; // 0-100
  blocksBehind?: number;
}

export interface DeploymentIndexingStatus {
  deploymentId: string;
  ipfsHash: string;
  signalledTokens: string;
  stakedTokens: string;
  indexers: IndexerStatusResult[];
  totalIndexers: number;
  totalAllocations: number;
  syncedCount: number;
  healthyCount: number;
  unhealthyCount: number;
  failedCount: number;
  unreachableCount: number;
}

// ---------------------------------------------------------------------------
// Graph-node status API query
// ---------------------------------------------------------------------------

function statusQuery(deploymentHash: string) {
  return `{
  indexingStatuses(subgraphs: ["${deploymentHash}"]) {
    subgraph
    synced
    health
    fatalError {
      message
      handler
    }
    nonFatalErrors {
      message
    }
    chains {
      ... on EthereumIndexingStatus {
        network
        chainHeadBlock {
          number
        }
        latestBlock {
          number
        }
      }
    }
    entityCount
  }
}`;
}

interface StatusAPIResponse {
  data?: {
    indexingStatuses?: Array<{
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
    }>;
  };
}

// ---------------------------------------------------------------------------
// Query a single indexer's /status endpoint
// ---------------------------------------------------------------------------

export async function queryIndexerStatus(
  indexerUrl: string,
  deploymentHash: string,
  timeoutMs = 3000,
): Promise<StatusAPIResponse | null> {
  const baseUrl = indexerUrl.replace(/\/+$/, '');
  const url = `${baseUrl}/status`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: statusQuery(deploymentHash) }),
      signal: controller.signal,
    });

    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Build a normalised status result from the raw response
// ---------------------------------------------------------------------------

export function buildIndexerStatus(
  indexerId: string,
  indexerName: string | null,
  url: string,
  allocatedTokens: string,
  raw: StatusAPIResponse | null,
): IndexerStatusResult {
  if (!raw?.data?.indexingStatuses?.length) {
    return { indexerId, indexerName, url, allocatedTokens, status: 'unreachable' };
  }

  const s = raw.data.indexingStatuses[0];
  const chain = s.chains?.[0];
  const chainHead = chain?.chainHeadBlock ? Number(chain.chainHeadBlock.number) : undefined;
  const latest = chain?.latestBlock ? Number(chain.latestBlock.number) : undefined;

  let syncProgress: number | undefined;
  let blocksBehind: number | undefined;

  if (chainHead && latest) {
    syncProgress = chainHead > 0 ? Math.min((latest / chainHead) * 100, 100) : 0;
    blocksBehind = Math.max(chainHead - latest, 0);
  }

  let status: IndexerStatusResult['status'] = 'syncing';
  if (s.health === 'failed' || s.fatalError) {
    status = 'failed';
  } else if (s.synced) {
    status = 'synced';
  }

  return {
    indexerId,
    indexerName,
    url,
    allocatedTokens,
    status,
    health: s.health,
    synced: s.synced,
    chainHeadBlock: chainHead,
    latestBlock: latest,
    network: chain?.network ?? undefined,
    entityCount: s.entityCount,
    fatalError: s.fatalError ?? undefined,
    nonFatalErrors: s.nonFatalErrors?.length
      ? s.nonFatalErrors.slice(-5).map((e) => e.message)
      : undefined,
    nonFatalErrorCount: s.nonFatalErrors?.length ?? 0,
    syncProgress,
    blocksBehind,
  };
}
