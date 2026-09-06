/**
 * `api/payments` from two nests (nightswatchhq/nuthatch#1078). Pinned here: the flag off changes
 * nothing; the nest path never consults the gateway key; the ids come back in the subgraph's own
 * encoding so a consumer keyed on them sees no change; the aggregate is the same one the gateway
 * path computes; and an unready nest is a 503 with its reason, not a stale page.
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

const PAYER = '0xdde4cffd3d9052a9cb618fc05a1cd02be1f2f467';
const COLLECTOR = '0x8f69f5c07477ac46fbc491b1e6d91e2bb0111a9e';
const RECEIVER = '0xf92f430dd8567b0d466358c79594ab58d919a6d4';
const TX = '0x2ddfa4e9ed5f9800062f3570a95fcd2dc0f5f2dfe0a75ee1551a2c734bb5e3df';
const CID = '0x0000000000000000000000001b4a6c9695132f4bcd554100ca86c8dc94dbf444';

const ok = (rows: unknown[]) => ({ ok: true, data: { count: rows.length, rows, truncated: false } });
const account = { payer: PAYER, collector: COLLECTOR, receiver: RECEIVER, balance: '1672741823882184387287295', thawing: '0', thaw_end: '0' };
const tx = { tx_hash: TX, log_index: 43, block_timestamp: 1788447655, payer: PAYER, receiver: RECEIVER, amount: '327932886083708863119', type: 'redeem', allocation_id: '0x8FFF2ea29cf6f950dd3011f98c2cc550b04832d6' };
const tally = { payer: PAYER, receiver: RECEIVER, collection_id: CID, tokens: '322989711771578521226747' };

const req = (qs = '') => new NextRequest(`http://localhost/api/payments${qs}`);

describe('api/payments from the nests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NUTHATCH_PAYMENTS', 'true');
    nuthatchConfigured = true;
  });
  afterEach(() => vi.unstubAllEnvs());

  it('is off by default, so the gateway path and its key gate are unchanged', async () => {
    vi.stubEnv('NUTHATCH_PAYMENTS', 'false');
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'No API key configured' });
    expect(nuthatchSqlReady).not.toHaveBeenCalled();
  });

  it('never consults the gateway key on the nest path', async () => {
    nuthatchSqlReady.mockResolvedValueOnce(ok([])).mockResolvedValueOnce(ok([])).mockResolvedValueOnce(ok([]));
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(hasSubgraphAccess).not.toHaveBeenCalled();
    expect(subgraphQuery).not.toHaveBeenCalled();
  });

  it('still refuses a malformed receiver before touching anything', async () => {
    const res = await GET(req('?receiver=0xnope'));
    expect(res.status).toBe(400);
    expect(nuthatchSqlReady).not.toHaveBeenCalled();
  });

  it('reads the escrow folds and the tally from the allocations nest', async () => {
    nuthatchSqlReady.mockResolvedValueOnce(ok([account])).mockResolvedValueOnce(ok([tx])).mockResolvedValueOnce(ok([tally]));
    const res = await GET(req());
    expect(res.status).toBe(200);
    const paths = nuthatchSqlReady.mock.calls.map((c) => c[1]);
    expect(paths).toEqual(['/alloc', '/alloc', '/alloc']);
    const sqls = nuthatchSqlReady.mock.calls.map((c) => String(c[0]));
    expect(sqls[0]).toMatch(/escrow__deposit/);
    expect(sqls[0]).toMatch(/HAVING SUM\(mv\.d\) > 0/);
    expect(sqls[1]).toMatch(/'redeem'/);
    expect(sqls[2]).toMatch(/tally__payment_collected/);
  });

  it('rebuilds every id in the subgraph encoding and aggregates exactly as the gateway path does', async () => {
    nuthatchSqlReady.mockResolvedValueOnce(ok([account])).mockResolvedValueOnce(ok([tx])).mockResolvedValueOnce(ok([tally]));
    const body = await (await GET(req())).json();
    expect(body.source).toBe('nuthatch');
    const d = body.data;
    expect(d.escrowAccounts[0]).toEqual({
      id: `${PAYER}${COLLECTOR.slice(2)}${RECEIVER.slice(2)}`,
      payer: { id: PAYER }, receiver: { id: RECEIVER },
      balance: '1672741823882184387287295', totalAmountThawing: '0', thawEndTimestamp: '0',
    });
    expect(d.recentTransactions[0]).toEqual({
      id: `${TX}2c000000`, type: 'redeem', payer: { id: PAYER }, receiver: { id: RECEIVER },
      allocationId: '0x8fff2ea29cf6f950dd3011f98c2cc550b04832d6', amount: '327932886083708863119', timestamp: '1788447655',
    });
    expect(d.topCollectors[0]).toEqual({
      id: `${PAYER}${RECEIVER.slice(2)}${CID.slice(2)}`,
      payer: { id: PAYER }, receiver: { id: RECEIVER }, collectionId: CID, tokens: '322989711771578521226747',
    });
    expect(d).toMatchObject({
      totalEscrowBalance: '1672741823882184387287295', totalThawing: '0', totalCollected: '322989711771578521226747',
      activePayers: 1, activeReceivers: 1,
    });
  });

  it('filters all three reads by receiver, with the wider transaction window the gateway path uses', async () => {
    nuthatchSqlReady.mockResolvedValueOnce(ok([])).mockResolvedValueOnce(ok([])).mockResolvedValueOnce(ok([]));
    const res = await GET(req(`?receiver=${RECEIVER.toUpperCase().replace('0X', '0x')}`));
    expect(res.status).toBe(200);
    const sqls = nuthatchSqlReady.mock.calls.map((c) => String(c[0]));
    expect(sqls.every((q) => q.includes(`LOWER(receiver) = '${RECEIVER}'`))).toBe(true);
    expect(sqls[0]).not.toMatch(/HAVING/);
    expect(sqls[1]).toMatch(/LIMIT 100\)/);
  });

  it('is a 503 with the nest reason when a nest is not ready, not a stale page', async () => {
    nuthatchSqlReady.mockResolvedValueOnce(ok([])).mockResolvedValueOnce({ ok: false, error: 'nest not ready', reason: 'lag', status: 503 }).mockResolvedValueOnce(ok([]));
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Failed to load payment data from Nuthatch' });
  });

  it('refuses when no nest origin is configured rather than falling back to the gateway', async () => {
    nuthatchConfigured = false;
    const res = await GET(req());
    expect(res.status).toBe(503);
    expect(nuthatchSqlReady).not.toHaveBeenCalled();
    expect(subgraphQuery).not.toHaveBeenCalled();
  });
});
