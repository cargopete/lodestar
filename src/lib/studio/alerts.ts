// ---------------------------------------------------------------------------
// Subgraph health alerting (Tier 3) — status detection + webhook delivery.
//
// detectStatus / formatMessage are PURE (no imports beyond types) so the cron's
// alerting decision is unit-testable in isolation. sendWebhook does the I/O and
// never throws — it returns { ok, status } so the cron can keep going.
//
// Data source: the cron queries EACH indexer's own /status endpoint (there is
// no working central index-node) and aggregates the per-indexer results into a
// single DeploymentHealth verdict, which is what detectStatus classifies.
// ---------------------------------------------------------------------------

export type AlertStatus = 'ok' | 'lagging' | 'failed';

/**
 * Aggregate health for a single deployment, summarised from the per-indexer
 * status results (see IndexerStatusResult in @/lib/indexing-status). The cron
 * computes this across all indexers with an active allocation on the
 * deployment; detectStatus then classifies it against the lag threshold.
 */
export interface DeploymentHealth {
  /** Total indexers we attempted to query (incl. unreachable / no-url). */
  totalIndexers: number;
  /** Indexers currently synced (at / near chain head). */
  syncedCount: number;
  /** Indexers reporting a fatal error / failed health. */
  failedCount: number;
  /** Smallest blocksBehind across reachable indexers (undefined if none). */
  bestBlocksBehind?: number;
  /** First fatal-error message we saw, for the failed-alert detail. */
  fatalErrorMessage?: string;
}

/**
 * Classify an aggregate DeploymentHealth against a lag threshold.
 *
 * Rule (operates on the aggregate, never a single central entry):
 *   - ZERO indexers          → 'lagging' (detail "no indexers"): a deployment
 *                              with no active allocations is a real dev signal,
 *                              not "ok".
 *   - 'failed'  : at least one indexer reports a fatal error AND none are
 *                 synced (failedCount > 0 && syncedCount === 0). If something
 *                 is still serving synced data we prefer the softer signal.
 *   - 'lagging' : no indexer is fully synced, OR the best (closest) indexer is
 *                 further behind than the threshold.
 *   - 'ok'      : at least one indexer is synced and within the threshold.
 */
export function detectStatus(h: DeploymentHealth, lagThreshold: number): AlertStatus {
  if (h.totalIndexers === 0) return 'lagging';
  if (h.failedCount > 0 && h.syncedCount === 0) return 'failed';
  if (h.syncedCount === 0) return 'lagging';
  if (h.bestBlocksBehind !== undefined && h.bestBlocksBehind > lagThreshold) return 'lagging';
  return 'ok';
}

const fmtNum = (n: number) => n.toLocaleString('en-US');

/** Short, human form of the deployment id for messages: Qm…wxyz. */
function shortId(deploymentId: string): string {
  return deploymentId.length > 12
    ? `${deploymentId.slice(0, 6)}…${deploymentId.slice(-4)}`
    : deploymentId;
}

/**
 * Build a webhook body that works for BOTH Discord (`content`) and Slack
 * (`text`) — we send both keys so a single payload fits either endpoint.
 */
export function formatMessage(
  status: AlertStatus | 'recovered',
  deploymentId: string,
  label: string | null,
  lagBlocks?: number,
  errorMsg?: string,
): { content: string; text: string } {
  const name = label && label.trim() ? label.trim() : 'subgraph';
  const id = shortId(deploymentId);
  let msg: string;
  if (status === 'failed') {
    msg = `❌ Subgraph "${name}" (${id}) has a fatal error: ${errorMsg ?? 'unknown error'}`;
  } else if (status === 'lagging') {
    msg = `⚠️ Subgraph "${name}" (${id}) is lagging — ${fmtNum(lagBlocks ?? 0)} blocks behind`;
  } else {
    // 'recovered' (or any ok transition)
    msg = `✅ Subgraph "${name}" (${id}) has recovered`;
  }
  return { content: msg, text: msg };
}

/**
 * POST a JSON payload to an incoming-webhook URL with a 10s timeout.
 * Never throws — network/HTTP failures resolve to { ok:false }.
 */
export async function sendWebhook(
  url: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; status?: number }> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false };
  }
}
