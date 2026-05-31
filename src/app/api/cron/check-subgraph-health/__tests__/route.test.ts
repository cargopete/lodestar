/**
 * Tests for /api/cron/check-subgraph-health — Bearer CRON_SECRET auth, DB/subgraph
 * guards, and the EDGE-TRIGGERED transition logic: a webhook fires only when the
 * computed status DIFFERS from the persisted last_status; an unchanged status only
 * bookkeeps last_status (no webhook). All boundaries are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const hasDbAccess = vi.fn(() => true);
vi.mock('@/lib/db', () => ({ hasDbAccess: () => hasDbAccess() }));

const subgraphQuery = vi.fn();
const hasSubgraphAccess = vi.fn(() => true);
vi.mock('@/lib/subgraph', () => ({
  subgraphQuery: (...a: unknown[]) => subgraphQuery(...a),
  hasSubgraphAccess: () => hasSubgraphAccess(),
}));

const queryIndexerStatus = vi.fn();
const buildIndexerStatus = vi.fn();
vi.mock('@/lib/indexing-status', () => ({
  queryIndexerStatus: (...a: unknown[]) => queryIndexerStatus(...a),
  buildIndexerStatus: (...a: unknown[]) => buildIndexerStatus(...a),
}));

const listEnabledAlerts = vi.fn();
const recordAlertFire = vi.fn();
const updateAlertStatus = vi.fn();
vi.mock('@/lib/studio/db', () => ({
  listEnabledAlerts: (...a: unknown[]) => listEnabledAlerts(...a),
  recordAlertFire: (...a: unknown[]) => recordAlertFire(...a),
  updateAlertStatus: (...a: unknown[]) => updateAlertStatus(...a),
}));

const sendWebhook = vi.fn();
// detectStatus / formatMessage are pure — use the real implementations.
vi.mock('@/lib/studio/alerts', async () => {
  const actual = await vi.importActual<typeof import('@/lib/studio/alerts')>('@/lib/studio/alerts');
  return { ...actual, sendWebhook: (...a: unknown[]) => sendWebhook(...a) };
});

const SECRET = 'health-secret';

async function load() {
  const mod = await import('@/app/api/cron/check-subgraph-health/route');
  return mod.GET as (req: NextRequest) => Promise<Response>;
}

function req(auth?: string) {
  return new NextRequest('http://localhost/api/cron/check-subgraph-health', {
    headers: auth ? { authorization: auth } : {},
  });
}

interface AlertOverrides {
  id?: number;
  deployment_id?: string;
  last_status?: string | null;
  lag_threshold_blocks?: string;
  label?: string | null;
}
function alert(o: AlertOverrides = {}) {
  return {
    id: o.id ?? 1,
    owner_address: '0xabc',
    deployment_id: o.deployment_id ?? 'QmDeploy1',
    label: o.label ?? 'My Subgraph',
    webhook_url: 'https://hooks.example.com/x',
    channel: 'discord',
    lag_threshold_blocks: o.lag_threshold_blocks ?? '5000',
    enabled: true,
    created_at: '2026-01-01',
    last_alerted_at: null,
    last_status: o.last_status === undefined ? 'ok' : o.last_status,
  };
}

/** Make subgraphQuery resolve deployment then return given allocations. */
function mockResolution(indexers: Array<{ id: string; url: string | null; allocatedTokens?: string }>) {
  subgraphQuery
    .mockResolvedValueOnce({ subgraphDeployments: [{ id: '0xdep', ipfsHash: 'QmDeploy1' }] })
    .mockResolvedValueOnce({
      allocations: indexers.map((i) => ({
        indexer: { id: i.id, url: i.url },
        allocatedTokens: i.allocatedTokens ?? '100',
      })),
    });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  process.env.CRON_SECRET = SECRET;
  hasDbAccess.mockReturnValue(true);
  hasSubgraphAccess.mockReturnValue(true);
  sendWebhook.mockResolvedValue({ ok: true, status: 204 });
  recordAlertFire.mockResolvedValue(undefined);
  updateAlertStatus.mockResolvedValue(undefined);
});

describe('check-subgraph-health auth & guards', () => {
  it('401s when no Authorization header', async () => {
    const GET = await load();
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(listEnabledAlerts).not.toHaveBeenCalled();
  });

  it('401s with a wrong secret', async () => {
    const GET = await load();
    const res = await GET(req('Bearer nope'));
    expect(res.status).toBe(401);
  });

  it('503s when DB unavailable', async () => {
    hasDbAccess.mockReturnValue(false);
    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'no db' });
  });

  it('503s when no subgraph access', async () => {
    hasSubgraphAccess.mockReturnValue(false);
    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'no subgraph access' });
  });

  it('short-circuits with checked:0 when there are no enabled alerts', async () => {
    listEnabledAlerts.mockResolvedValue([]);
    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, checked: 0 });
    expect(subgraphQuery).not.toHaveBeenCalled();
  });
});

describe('edge-triggered transitions', () => {
  it('fires a webhook on a CHANGE to lagging and records the fire', async () => {
    // synced indexer but far behind → lagging
    listEnabledAlerts.mockResolvedValue([alert({ last_status: 'ok' })]);
    mockResolution([{ id: 'ix1', url: 'https://ix1' }]);
    buildIndexerStatus.mockResolvedValue({
      indexerId: 'ix1', indexerName: null, url: 'https://ix1',
      allocatedTokens: '100', status: 'synced', blocksBehind: 99999,
    });

    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, checked: 1, fired: 1 });
    expect(sendWebhook).toHaveBeenCalledTimes(1);
    expect(recordAlertFire).toHaveBeenCalledWith(1, 'lagging', expect.stringContaining('blocks behind'));
  });

  it('does NOT fire when status is UNCHANGED, only bookkeeps if column drifts', async () => {
    // already 'lagging' in DB, still lagging → no webhook. Column matches so no update.
    listEnabledAlerts.mockResolvedValue([alert({ last_status: 'lagging' })]);
    mockResolution([{ id: 'ix1', url: 'https://ix1' }]);
    buildIndexerStatus.mockResolvedValue({
      indexerId: 'ix1', indexerName: null, url: 'https://ix1',
      allocatedTokens: '100', status: 'synced', blocksBehind: 99999,
    });

    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, checked: 1, fired: 0 });
    expect(sendWebhook).not.toHaveBeenCalled();
    // last_status already === computed status → no defensive update
    expect(updateAlertStatus).not.toHaveBeenCalled();
  });

  it('fires a failed alert with the fatal error message', async () => {
    listEnabledAlerts.mockResolvedValue([alert({ last_status: 'ok' })]);
    mockResolution([{ id: 'ix1', url: 'https://ix1' }]);
    buildIndexerStatus.mockResolvedValue({
      indexerId: 'ix1', indexerName: null, url: 'https://ix1',
      allocatedTokens: '100', status: 'failed',
      fatalError: { message: 'handler panicked' },
    });

    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    expect((await res.json()).fired).toBe(1);
    expect(recordAlertFire).toHaveBeenCalledWith(1, 'failed', 'handler panicked');
  });

  it('fires a recovery ping and settles last_status to ok', async () => {
    // previously failed, now a healthy synced near-head indexer → ok transition
    listEnabledAlerts.mockResolvedValue([alert({ last_status: 'failed' })]);
    mockResolution([{ id: 'ix1', url: 'https://ix1' }]);
    buildIndexerStatus.mockResolvedValue({
      indexerId: 'ix1', indexerName: null, url: 'https://ix1',
      allocatedTokens: '100', status: 'synced', blocksBehind: 0,
    });

    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    expect((await res.json()).fired).toBe(1);
    expect(recordAlertFire).toHaveBeenCalledWith(1, 'recovered', expect.any(String));
    expect(updateAlertStatus).toHaveBeenCalledWith(1, 'ok');
  });

  it('treats zero indexers (no allocations) as a lagging "no indexers" signal', async () => {
    listEnabledAlerts.mockResolvedValue([alert({ last_status: 'ok' })]);
    mockResolution([]); // no allocations
    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    expect((await res.json()).fired).toBe(1);
    expect(recordAlertFire).toHaveBeenCalledWith(1, 'lagging', 'no indexers');
    expect(buildIndexerStatus).not.toHaveBeenCalled();
  });

  it('records a webhook delivery failure in the log detail but still records the fire', async () => {
    sendWebhook.mockResolvedValue({ ok: false, status: 500 });
    listEnabledAlerts.mockResolvedValue([alert({ last_status: 'ok' })]);
    mockResolution([{ id: 'ix1', url: 'https://ix1' }]);
    buildIndexerStatus.mockResolvedValue({
      indexerId: 'ix1', indexerName: null, url: 'https://ix1',
      allocatedTokens: '100', status: 'synced', blocksBehind: 99999,
    });
    const GET = await load();
    await GET(req(`Bearer ${SECRET}`));
    expect(recordAlertFire).toHaveBeenCalledWith(
      1, 'lagging', expect.stringContaining('webhook delivery failed'),
    );
  });

  it('skips an alert whose deployment failed to resolve, leaving state untouched', async () => {
    listEnabledAlerts.mockResolvedValue([alert({ last_status: 'ok' })]);
    // first subgraphQuery (deployment resolve) throws → byId has no entry
    subgraphQuery.mockRejectedValue(new Error('boom'));
    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    expect((await res.json())).toMatchObject({ ok: true, checked: 1, fired: 0 });
    expect(sendWebhook).not.toHaveBeenCalled();
    expect(updateAlertStatus).not.toHaveBeenCalled();
  });

  it('resolves a shared deployment once for multiple alerts watching it', async () => {
    listEnabledAlerts.mockResolvedValue([
      alert({ id: 1, last_status: 'ok' }),
      alert({ id: 2, last_status: 'ok' }),
    ]);
    mockResolution([{ id: 'ix1', url: 'https://ix1' }]);
    buildIndexerStatus.mockResolvedValue({
      indexerId: 'ix1', indexerName: null, url: 'https://ix1',
      allocatedTokens: '100', status: 'synced', blocksBehind: 0,
    });
    const GET = await load();
    const res = await GET(req(`Bearer ${SECRET}`));
    // both 'ok' already and stay ok → no fires, deployment resolved exactly once (2 queries)
    expect((await res.json())).toMatchObject({ checked: 2, fired: 0 });
    expect(subgraphQuery).toHaveBeenCalledTimes(2);
  });
});
