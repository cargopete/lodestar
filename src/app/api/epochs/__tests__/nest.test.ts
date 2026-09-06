/**
 * `api/epochs` from `lodestar_epochs` (nightswatchhq/nuthatch#1160). Pinned here: the flag off
 * changes nothing; the nest path never consults the gateway key; rows arrive in the `Epoch` shape
 * newest first with wei as strings; `totalQueryFees` is gross less the protocol cut, rebuilt from the view's
 * three parts; `count` reaches the SQL; and an unready nest is a 503.
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

import { GET, epochFromNest } from '../route';

const ok = (rows: unknown[]) => ({ ok: true, data: { count: rows.length, rows, truncated: false } });
// Epoch 1370 on 8107, 2026-09-05: the protocol tax is exactly 1% of gross fees, floored per event.
const row = {
  id: 1370, start_block: 500973867, end_block: '501318401',
  signalled_tokens: '12000000000000000000000', stake_deposited: '833629619839755706006138',
  total_rewards: '623938173497377541559976', total_indexer_rewards: '500000000000000000000000',
  total_delegator_rewards: '123938173497377541559976',
  query_fees_collected: '48900414869281127752048', curator_query_fees: '5494406165099003102700', taxed_query_fees: '549440616509900311573',
};
const req = (qs = '') => new NextRequest(`http://localhost/api/epochs${qs}`);

describe('api/epochs from the nest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nuthatchConfigured = true;
    process.env.NUTHATCH_EPOCHS = 'true';
  });
  afterEach(() => {
    delete process.env.NUTHATCH_EPOCHS;
  });

  it('rows arrive in the Epoch shape, gross fees rebuilt, key not consulted, count in the SQL', async () => {
    nuthatchSqlReady.mockResolvedValue(ok([row]));
    const res = await GET(req('?count=7'));
    expect(res.status).toBe(200);
    expect(hasSubgraphAccess).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.source).toBe('nuthatch');
    expect(body.data.epoches).toEqual([
      {
        id: '1370', startBlock: 500973867, endBlock: 501318401,
        signalledTokens: row.signalled_tokens, stakeDeposited: row.stake_deposited,
        totalQueryFees: (BigInt(row.query_fees_collected) + BigInt(row.curator_query_fees)).toString(),
        totalRewards: row.total_rewards, totalIndexerRewards: row.total_indexer_rewards, totalDelegatorRewards: row.total_delegator_rewards,
      },
    ]);
    const sql = nuthatchSqlReady.mock.calls[0][0] as string;
    expect(sql).toContain('FROM lodestar_epochs');
    expect(sql).toContain('ORDER BY id DESC LIMIT 7');
    expect(nuthatchSqlReady.mock.calls[0][1]).toBe('/alloc');
  });

  it('fees are the indexers\' net plus the curators\' share (gross less the protocol cut), in wei, not through a double', () => {
    const e = epochFromNest(row as never);
    expect(BigInt(e.totalQueryFees)).toBe(BigInt(row.query_fees_collected) + BigInt(row.curator_query_fees));
  });

  it('an unready nest is a 503 with no fallback to the gateway', async () => {
    nuthatchSqlReady.mockResolvedValue({ ok: false, status: 503, error: 'nest is not ready: stalled' });
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(subgraphQuery).not.toHaveBeenCalled();
  });
});
