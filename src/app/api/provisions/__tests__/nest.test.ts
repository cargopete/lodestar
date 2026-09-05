/**
 * `api/provisions` from `lodestar_provisions` (nightswatchhq/nuthatch#1160). Pinned here: the flag
 * off changes nothing; the nest path never consults the gateway key or the ENS subgraph; the indexer
 * form carries each data service's totals and the protocol thawing ceiling; the service form carries
 * the indexer's stake beside each provision with names null; paging reaches the SQL; an unready
 * nest is a 503.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/cache', () => ({
  cached: vi.fn((_k: string, _t: number, f: () => Promise<unknown>) => f()),
}));
const hasSubgraphAccess = vi.fn(() => false);
const subgraphQuery = vi.fn();
const ensQuery = vi.fn();
vi.mock('@/lib/subgraph', () => ({
  hasSubgraphAccess: () => hasSubgraphAccess(),
  subgraphQuery: (...a: unknown[]) => subgraphQuery(...a),
  ensQuery: (...a: unknown[]) => ensQuery(...a),
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

const IX = '0x6f9bb7e454f5b3eb2310343f0e99269dc2bb8a1d';
const SS = '0xb2bb92d0de618878e438b55d5846cfecd9301105';
const ok = (rows: unknown[]) => ({ ok: true, data: { count: rows.length, rows, truncated: false } });
const prov = {
  id: `${IX}-${SS}`, indexer: IX, data_service: SS, tokens_provisioned: '3611876178000000000000000', tokens_allocated: '5408653283000000000000000',
  tokens_thawing: '0', max_verifier_cut: 1000000, thawing_period: 2419200, created_at: 1764392235, allocation_count: 19,
  rewards_earned: '100', query_fees_collected: '7', indexer_staked_tokens: '3611876178485616456931049', indexer_delegated_tokens: '1796777000000000000000000',
};
const answer = (sql: string) => {
  if (sql.includes('lodestar_network_params')) return Promise.resolve(ok([{ max_thawing_period_seconds: 2419200 }]));
  if (sql.includes('GROUP BY 1')) return Promise.resolve(ok([{ data_service: SS, total_tokens_provisioned: '9000', total_tokens_allocated: '8000' }]));
  return Promise.resolve(ok([prov]));
};
const req = (qs: string) => GET(new NextRequest(`http://localhost/api/provisions${qs}`));

describe('api/provisions from the nest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nuthatchConfigured = true;
    process.env.NUTHATCH_PROVISIONS = 'true';
  });
  afterEach(() => {
    delete process.env.NUTHATCH_PROVISIONS;
  });

  it('with the flag off, the gateway path is untouched', async () => {
    delete process.env.NUTHATCH_PROVISIONS;
    hasSubgraphAccess.mockReturnValue(true);
    subgraphQuery.mockResolvedValue({ provisions: [] });
    const res = await req(`?indexer=${IX}`);
    expect(res.status).toBe(200);
    expect(subgraphQuery).toHaveBeenCalledTimes(1);
    expect(nuthatchSqlReady).not.toHaveBeenCalled();
  });

  it('indexer form: provisions with data-service totals and the thawing ceiling; no key, no ENS', async () => {
    nuthatchSqlReady.mockImplementation(answer);
    const res = await req(`?indexer=${IX}`);
    expect(res.status).toBe(200);
    expect(hasSubgraphAccess).not.toHaveBeenCalled();
    expect(ensQuery).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.source).toBe('nuthatch');
    expect(body.data.provisions).toEqual([
      {
        id: prov.id, tokensProvisioned: prov.tokens_provisioned, tokensAllocated: prov.tokens_allocated, tokensThawing: '0',
        maxVerifierCut: '1000000', thawingPeriod: '2419200', createdAt: '1764392235', allocationCount: 19,
        rewardsEarned: '100', queryFeesCollected: '7',
        dataService: { id: SS, totalTokensProvisioned: '9000', totalTokensAllocated: '8000', minimumThawingPeriod: '2419200', maximumThawingPeriod: '2419200' },
      },
    ]);
    expect(nuthatchSqlReady.mock.calls.every((c) => c[1] === '/alloc')).toBe(true);
  });

  it('service form: the indexer beside each provision, names null, paging in the SQL', async () => {
    nuthatchSqlReady.mockImplementation(answer);
    const res = await req(`?service=${SS}&first=25&skip=50`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.provisions[0]).toMatchObject({
      id: prov.id, tokensProvisioned: prov.tokens_provisioned,
      indexer: { id: IX, account: { defaultDisplayName: null, metadata: null }, stakedTokens: prov.indexer_staked_tokens, delegatedTokens: prov.indexer_delegated_tokens },
    });
    expect(body.data.provisions[0].dataService).toBeUndefined();
    const sql = nuthatchSqlReady.mock.calls[0][0] as string;
    expect(sql).toContain(`p.data_service = '${SS}'`);
    expect(sql).toContain('LIMIT 25 OFFSET 50');
    expect(ensQuery).not.toHaveBeenCalled();
  });

  it('an unready nest is a 503 with no fallback to the gateway', async () => {
    nuthatchSqlReady.mockResolvedValue({ ok: false, status: 503, error: 'nest is not ready: stalled' });
    const res = await req(`?indexer=${IX}`);
    expect(res.status).toBe(503);
    expect(subgraphQuery).not.toHaveBeenCalled();
  });
});
