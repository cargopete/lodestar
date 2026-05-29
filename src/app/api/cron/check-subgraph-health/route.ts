/**
 * Subgraph health cron (Tier 3) — scans enabled webhook alerts and notifies
 * subgraph devs when a deployment falls behind or errors, and again when it
 * recovers.
 *
 * EDGE-TRIGGERED: we only POST a webhook when the computed status DIFFERS from
 * the persisted last_status, so a persistently-lagging subgraph isn't spammed
 * every run. Unchanged transitions only bookkeep last_status (no webhook).
 *
 * DATA SOURCE: the central hosted-service status endpoint is deprecated and no
 * longer answers indexingStatuses queries. We mirror the production
 * /api/indexing-status/[hash] flow instead: resolve the deployment + its
 * active-allocation indexer URLs from the NETWORK SUBGRAPH, then query EACH
 * indexer's own /status endpoint and aggregate the per-indexer results into a
 * single DeploymentHealth verdict before classifying it (see detectStatus).
 *
 * Auth + DB guards mirror /api/cron/check-conversions (Bearer CRON_SECRET).
 */
import { type NextRequest, NextResponse } from 'next/server';
import { hasDbAccess } from '@/lib/db';
import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import {
  queryIndexerStatus,
  buildIndexerStatus,
  type IndexerStatusResult,
} from '@/lib/indexing-status';
import {
  listEnabledAlerts,
  recordAlertFire,
  updateAlertStatus,
  type SubgraphAlert,
} from '@/lib/studio/db';
import {
  detectStatus,
  formatMessage,
  sendWebhook,
  type DeploymentHealth,
} from '@/lib/studio/alerts';

function isAuthorized(req: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  return !cronSecret || req.headers.get('authorization') === `Bearer ${cronSecret}`;
}

// ---------------------------------------------------------------------------
// Network-subgraph resolution (same query shapes as /api/indexing-status/[hash])
// ---------------------------------------------------------------------------

interface DeploymentRow {
  id: string;
  ipfsHash: string;
}

interface AllocationRow {
  indexer: { id: string; url: string | null };
  allocatedTokens: string;
}

function resolveDeploymentQuery(ipfsHash: string): string {
  return `{
    subgraphDeployments(first: 1, where: { ipfsHash: "${ipfsHash}" }) {
      id
      ipfsHash
    }
  }`;
}

function allocationsQuery(deploymentId: string): string {
  return `{
    allocations(
      first: 100
      where: { subgraphDeployment: "${deploymentId}", status: Active }
      orderBy: allocatedTokens
      orderDirection: desc
    ) {
      indexer {
        id
        url
      }
      allocatedTokens
    }
  }`;
}

/**
 * Resolve a deployment id (IPFS hash or bytes32) to its active-allocation
 * indexer statuses, mirroring the indexing-status route, then collapse those
 * per-indexer results into an aggregate DeploymentHealth.
 */
async function fetchDeploymentHealth(deploymentId: string): Promise<DeploymentHealth> {
  // 1. Resolve IPFS hash → bytes32 deployment id (and canonical ipfsHash).
  let resolvedId = deploymentId;
  let ipfsHash = deploymentId;

  if (deploymentId.startsWith('Qm') || deploymentId.startsWith('bafy')) {
    const resolved = await subgraphQuery<{ subgraphDeployments: DeploymentRow[] }>(
      resolveDeploymentQuery(deploymentId),
    );
    const dep = resolved.subgraphDeployments[0];
    if (!dep) {
      // Unknown deployment — no indexers to ask. Treat as a dev signal.
      return { totalIndexers: 0, syncedCount: 0, failedCount: 0 };
    }
    resolvedId = dep.id;
    ipfsHash = dep.ipfsHash;
  }

  // 2. Active allocations → indexer URLs.
  const allocResult = await subgraphQuery<{ allocations: AllocationRow[] }>(
    allocationsQuery(resolvedId),
  );
  const allocations = allocResult.allocations;

  // 3. Query each indexer's /status endpoint in parallel.
  const withUrl = allocations.filter((a) => a.indexer.url);
  const withoutUrl = allocations.filter((a) => !a.indexer.url);

  const statusPromises = withUrl.map(async (alloc) => {
    const raw = await queryIndexerStatus(alloc.indexer.url!, ipfsHash);
    return buildIndexerStatus(
      alloc.indexer.id,
      null,
      alloc.indexer.url!,
      alloc.allocatedTokens,
      raw,
    );
  });

  const noUrlStatuses: IndexerStatusResult[] = withoutUrl.map((alloc) => ({
    indexerId: alloc.indexer.id,
    indexerName: null,
    url: '',
    allocatedTokens: alloc.allocatedTokens,
    status: 'unreachable' as const,
  }));

  const indexers = [...(await Promise.all(statusPromises)), ...noUrlStatuses];

  // 4. Aggregate to a single verdict.
  return aggregateHealth(indexers);
}

/** Collapse per-indexer status results into a single DeploymentHealth. */
function aggregateHealth(indexers: IndexerStatusResult[]): DeploymentHealth {
  const syncedCount = indexers.filter((s) => s.status === 'synced').length;
  const failedCount = indexers.filter((s) => s.status === 'failed').length;

  // Closest-to-head reachable indexer (ignore those that never reported blocks).
  const behindValues = indexers
    .map((s) => s.blocksBehind)
    .filter((b): b is number => typeof b === 'number');
  const bestBlocksBehind = behindValues.length ? Math.min(...behindValues) : undefined;

  const fatalErrorMessage = indexers.find((s) => s.fatalError?.message)?.fatalError?.message;

  return {
    totalIndexers: indexers.length,
    syncedCount,
    failedCount,
    bestBlocksBehind,
    fatalErrorMessage,
  };
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!hasDbAccess()) {
    return NextResponse.json({ ok: false, error: 'no db' }, { status: 503 });
  }
  if (!hasSubgraphAccess()) {
    return NextResponse.json({ ok: false, error: 'no subgraph access' }, { status: 503 });
  }

  const alerts = await listEnabledAlerts();
  if (alerts.length === 0) {
    return NextResponse.json({ ok: true, checked: 0 });
  }

  // Resolve aggregate health once per distinct deployment id (multiple alerts
  // can watch the same deployment). A resolution failure for one deployment is
  // recorded as a miss — the per-alert loop just skips it.
  const ids = [...new Set(alerts.map((a) => a.deployment_id))];
  const byId = new Map<string, DeploymentHealth>();
  await Promise.all(
    ids.map(async (id) => {
      try {
        byId.set(id, await fetchDeploymentHealth(id));
      } catch (e) {
        console.error('[check-subgraph-health] health resolve failed', id, e);
      }
    }),
  );

  let fired = 0;

  for (const alert of alerts) {
    try {
      const health = byId.get(alert.deployment_id);
      if (!health) {
        // Couldn't resolve this deployment this run — leave state untouched.
        continue;
      }

      const threshold = Number(alert.lag_threshold_blocks) || 5000;
      const status = detectStatus(health, threshold);
      const prev = alert.last_status ?? 'ok';

      if (status === prev) {
        // No transition — nothing to send. Keep the column in sync defensively.
        if (alert.last_status !== status) await updateAlertStatus(alert.id, status);
        continue;
      }

      if (status === 'ok') {
        // Recovered from a bad state → send a recovery ping. We log it as
        // 'recovered' but settle last_status to 'ok' so we don't re-fire next
        // run (detectStatus only ever returns 'ok', never 'recovered').
        await fireAlert(alert, 'recovered', formatMessage('recovered', alert.deployment_id, alert.label), 'recovered');
        await updateAlertStatus(alert.id, 'ok');
        fired++;
      } else if (status === 'failed') {
        const errorMsg = health.fatalErrorMessage ?? 'fatal error';
        await fireAlert(
          alert,
          'failed',
          formatMessage('failed', alert.deployment_id, alert.label, undefined, errorMsg),
          errorMsg,
        );
        fired++;
      } else {
        // lagging
        const lag = health.bestBlocksBehind;
        const detail =
          health.totalIndexers === 0 ? 'no indexers' : `${lag ?? 0} blocks behind`;
        await fireAlert(
          alert,
          'lagging',
          formatMessage('lagging', alert.deployment_id, alert.label, lag ?? 0),
          detail,
        );
        fired++;
      }
    } catch (e) {
      // One bad webhook must not kill the batch.
      console.error('[check-subgraph-health] alert failed', alert.id, e);
    }
  }

  return NextResponse.json({ ok: true, checked: alerts.length, fired });
}

/** Send the webhook then record the fire (last_status + log row). */
async function fireAlert(
  alert: SubgraphAlert,
  status: 'lagging' | 'failed' | 'recovered',
  payload: { content: string; text: string },
  detail: string,
): Promise<void> {
  const result = await sendWebhook(alert.webhook_url, payload);
  // Record regardless of webhook outcome so last_status reflects the observed
  // condition (avoids re-firing every run on a dead webhook). The log detail
  // notes a delivery failure.
  await recordAlertFire(
    alert.id,
    status,
    result.ok ? detail : `${detail} (webhook delivery failed, http ${result.status ?? 'n/a'})`,
  );
}
