/**
 * `api/curators` from `graph-allocations-nest` (nightswatchhq/nuthatch#1160). Pinned here: the flag
 * off changes nothing; the nest path never consults the gateway key; rows arrive in the
 * `CuratorLeaderboardEntry` shape with wei as strings; the GNS contract's own row is excluded in the
 * SQL and the subgraph's filters (signalled > 0, active > 0) are applied there too; and an unready
 * nest is a 503 with no fallback to the gateway.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/cache', () => ({
  cached: vi.fn((_k: string, _t: number, f: () => Promise<unknown>) => f()),
}));
const hasSubgraphAccess = vi.fn(() => false);
const subgraphQuery = vi.fn();
vi.mock('@/lib/subgraph', () => ({
  hasSubgraphAccess: () => hasSubgraphAccess(),
  subgraphQuery: (...a: unknown[]) => subgraphQuery(...a),
}));
const nuthatchSqlReady = vi.fn();
let nuthatchConfigured = true;
vi.mock('@/lib/nuthatch', () => ({
  hasNuthatch: () => nuthatchConfigured,
  nuthatchEnabled: (flag: string) => nuthatchConfigured && process.env[flag] === 'true',
  nuthatchSqlReady: (...a: unknown[]) => nuthatchSqlReady(...a),
}));
vi.mock('@/lib/logger', () => ({ log: { api: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } }));

import { GET } from '../route';

const ok = (rows: unknown[]) => ({ ok: true, data: { count: rows.length, rows, truncated: false } });
// The top curator on 8107 on 2026-09-05, as the view returns it.
const row = {
  id: '0xacbdc195a79ea9766204ad7e082f1b36a32c0db5',
  total_signalled_tokens: '2349605726515838646100000',
  total_unsignalled_tokens: '2574000000000000000000',
  realized_rewards: '0',
  signal_count: 669,
  active_signal_count: 665,
};
const req = (qs = '') => new NextRequest(`http://localhost/api/curators${qs}`);

describe('api/curators from the nest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nuthatchConfigured = true;
    process.env.NUTHATCH_CURATORS = 'true';
  });
  afterEach(() => {
    delete process.env.NUTHATCH_CURATORS;
  });

  it('on the nest path the key is not consulted and rows arrive in the leaderboard shape', async () => {
    nuthatchSqlReady.mockResolvedValue(ok([row]));
    const res = await GET(req('?first=20&skip=40'));
    expect(res.status).toBe(200);
    expect(hasSubgraphAccess).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.source).toBe('nuthatch');
    expect(body.data).toEqual([
      {
        id: row.id,
        totalSignalledTokens: row.total_signalled_tokens,
        totalUnsignalledTokens: row.total_unsignalled_tokens,
        realizedRewards: '0',
        signalCount: 669,
        activeSignalCount: 665,
      },
    ]);
    const sql = nuthatchSqlReady.mock.calls[0][0] as string;
    expect(sql).toContain('FROM lodestar_curators');
    expect(sql).toContain('NOT c.is_gns');
    expect(sql).toContain('c.total_signalled_tokens > 0 AND c.active_signal_count > 0');
    expect(sql).toContain('LIMIT 20 OFFSET 40');
    expect(nuthatchSqlReady.mock.calls[0][1]).toBe('/alloc');
  });

  it('an unready nest is a 503 with no fallback to the gateway', async () => {
    nuthatchSqlReady.mockResolvedValue({ ok: false, status: 503, error: 'nest is not ready: stalled', reason: 'stalled' });
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(subgraphQuery).not.toHaveBeenCalled();
  });
});
