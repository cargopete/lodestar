/**
 * Contract tests for the public SQL surface: /api/sql/catalog and /api/sql/query.
 *
 * The behaviours worth pinning are the ones that would be quietly wrong rather than loudly broken:
 * a dataset that stops answering must stay visible as unavailable rather than vanish, a query must
 * never reach the nest unless the dataset was named on the allowlist, and the provenance stamp must
 * survive the trip, because an answer nobody can date is an answer nobody can cite.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/cache', () => ({
  cached: vi.fn((_key: string, _ttl: number, fetcher: () => Promise<unknown>) => fetcher()),
}));

vi.mock('@/lib/logger', () => ({
  log: { api: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } },
}));

const mockHasNuthatch = vi.fn(() => true);
const mockTables = vi.fn();
const mockSqlFull = vi.fn();
vi.mock('@/lib/nuthatch', () => ({
  hasNuthatch: () => mockHasNuthatch(),
  nuthatchTables: (...args: unknown[]) => mockTables(...args),
  nuthatchSqlFull: (...args: unknown[]) => mockSqlFull(...args),
}));

import { GET as catalogGET } from '../sql/catalog/route';
import { GET as namedGET, POST as namedPOST } from '../sql/named/route';
import { POST as queryPOST } from '../sql/query/route';
import { SQL_DATASETS } from '@/lib/sql-datasets';

const post = (body: unknown) =>
  queryPOST(
    new Request('http://localhost/api/sql/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  );

const TABLE = {
  alias: 'staking',
  table: 'staking__delegated',
  event: 'Delegated(address,address,uint256,uint256)',
  columns: [
    { name: 'block_number', sol_type: 'implicit', storage: 'u64', indexed: false },
    { name: 'delegator', sol_type: 'address', storage: 'address', indexed: true },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockHasNuthatch.mockReturnValue(true);
});

describe('/api/sql/catalog', () => {
  it('reports tables and columns for each dataset', async () => {
    mockTables.mockResolvedValue([TABLE]);
    const body = await (await catalogGET()).json();

    expect(body.available).toBe(true);
    expect(body.datasets).toHaveLength(SQL_DATASETS.length);
    const first = body.datasets[0];
    expect(first.available).toBe(true);
    expect(first.tableCount).toBe(1);
    expect(first.tables[0].name).toBe('staking__delegated');
    // `implicit` is a nuthatch internal; a caller wants the storage type they can compare against.
    expect(first.tables[0].columns[0]).toEqual({ name: 'block_number', type: 'u64', indexed: false });
    expect(first.tables[0].columns[1].type).toBe('address');
  });

  // A catalogue that drops a broken dataset is indistinguishable from one that never had it, which
  // is the failure mode that let three data services sit dead for 39 days.
  it('keeps a dataset that will not answer, marked unavailable', async () => {
    mockTables.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const body = await (await catalogGET()).json();

    expect(body.datasets).toHaveLength(SQL_DATASETS.length);
    expect(body.datasets.every((d: { available: boolean }) => d.available === false)).toBe(true);
    expect(body.datasets[0].error).toBeTruthy();
  });

  it('does not claim a broken dataset is fine just because a sibling answered', async () => {
    mockTables.mockImplementation((basePath: string) =>
      basePath === '' ? Promise.resolve([TABLE]) : Promise.reject(new Error('down'))
    );
    const body = await (await catalogGET()).json();
    const byId = Object.fromEntries(
      body.datasets.map((d: { id: string; available: boolean }) => [d.id, d.available])
    );
    expect(byId.staking).toBe(true);
    expect(byId.dips).toBe(false);
  });

  it('says so plainly when no nest is configured at all', async () => {
    mockHasNuthatch.mockReturnValue(false);
    const res = await catalogGET();
    expect(res.status).toBe(503);
    expect((await res.json()).available).toBe(false);
  });
});

describe('/api/sql/query', () => {
  const okResult = {
    ok: true as const,
    data: {
      count: 1,
      rows: [{ block_number: 42 }],
      truncated: false,
      provenance: { as_of: 12345, sealed_through: 12000, source: 'hot+sealed', nid: 'abc' },
    },
  };

  it('runs a query against the named dataset and returns rows with provenance', async () => {
    mockSqlFull.mockResolvedValue(okResult);
    const res = await post({ dataset: 'staking', q: 'SELECT block_number FROM staking__delegated LIMIT 1' });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.rows).toEqual([{ block_number: 42 }]);
    // The stamp is the reason to prefer this over a screenshot of someone's terminal.
    expect(body.provenance.as_of).toBe(12345);
  });

  it('routes to the dataset base path, not to whatever the caller fancies', async () => {
    mockSqlFull.mockResolvedValue(okResult);
    await post({ dataset: 'dips', q: 'SELECT 1' });
    expect(mockSqlFull).toHaveBeenCalledWith('SELECT 1', '/dips', expect.any(Number));
  });

  it('refuses a dataset that is not on the allowlist, without calling the nest', async () => {
    const res = await post({ dataset: '../admin', q: 'SELECT 1' });
    expect(res.status).toBe(400);
    expect(mockSqlFull).not.toHaveBeenCalled();
  });

  it('refuses a write before it reaches the network', async () => {
    const res = await post({ dataset: 'staking', q: 'DROP TABLE staking__delegated' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.stringContaining('DROP') });
    expect(mockSqlFull).not.toHaveBeenCalled();
  });

  it('relays the nest own error text, which is already sanitised there', async () => {
    mockSqlFull.mockResolvedValue({ ok: false, status: 400, error: 'no such column: tokns' });
    const res = await post({ dataset: 'staking', q: 'SELECT tokns FROM staking__delegated' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('no such column: tokns');
  });

  it('turns a timeout into advice rather than a stack trace', async () => {
    const err = new Error('timed out');
    err.name = 'TimeoutError';
    mockSqlFull.mockRejectedValue(err);
    const res = await post({ dataset: 'staking', q: 'SELECT * FROM staking__delegated' });
    expect(res.status).toBe(504);
    expect((await res.json()).error).toMatch(/LIMIT/);
  });

  it('rejects a body that is not JSON', async () => {
    const res = await post('not json at all');
    expect(res.status).toBe(400);
  });

  it('surfaces truncation, because a silently short answer is a wrong answer', async () => {
    mockSqlFull.mockResolvedValue({
      ok: true,
      data: { count: 500, rows: [], truncated: true, degraded_tables: ['staking__delegated'], degraded: true },
    });
    const body = await (await post({ dataset: 'staking', q: 'SELECT 1' })).json();
    expect(body.truncated).toBe(true);
    expect(body.degraded).toBe(true);
    expect(body.degradedTables).toEqual(['staking__delegated']);
  });
});

const postNamed = (body: unknown) =>
  namedPOST(
    new Request('http://localhost/api/sql/named', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  );

describe('/api/sql/named', () => {
  const okResult = {
    ok: true as const,
    data: { count: 1, rows: [{ tokens: '5000' }], truncated: false, provenance: { as_of: 9 } },
  };

  it('lists what may be asked', async () => {
    const body = await (await namedGET()).json();
    expect(body.queries.length).toBeGreaterThan(0);
    expect(body.queries[0]).toHaveProperty('params');
  });

  it('renders the declared statement and sends it to the right nest', async () => {
    mockSqlFull.mockResolvedValue(okResult);
    const res = await postNamed({
      name: 'issuance_rate_changes',
      args: { before_block: 497000000 },
    });
    expect(res.status).toBe(200);
    const [sql, basePath] = mockSqlFull.mock.calls[0];
    expect(sql).toContain('block_number <= 497000000');
    expect(basePath).toBe('/dips');
    // Returned so a receipt can record the statement, not only the name.
    expect((await res.json()).sql).toContain('497000000');
  });

  // A refusal that only says "no" leaves a caller guessing, and guessing at an endpoint is how you
  // get a thousand probing requests.
  it('names the allowed set when the query is unknown', async () => {
    const res = await postNamed({ name: 'drop_everything', args: {} });
    expect(res.status).toBe(400);
    expect((await res.json()).allowed).toContain('issuance_rate_changes');
    expect(mockSqlFull).not.toHaveBeenCalled();
  });

  it('refuses a bad argument before touching the network', async () => {
    const res = await postNamed({
      name: 'delegations_to_indexer',
      args: { indexer: "0x' OR 1=1 --", before_block: 1 },
    });
    expect(res.status).toBe(400);
    expect(mockSqlFull).not.toHaveBeenCalled();
  });

  it('refuses a missing pin, because an unpinned answer cannot be reproduced', async () => {
    const res = await postNamed({
      name: 'delegations_to_indexer',
      args: { indexer: '0x' + 'a'.repeat(40) },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('before_block');
    expect(mockSqlFull).not.toHaveBeenCalled();
  });

  it('accepts no SQL from the caller at all', async () => {
    mockSqlFull.mockResolvedValue(okResult);
    await postNamed({
      name: 'issuance_rate_changes',
      args: { before_block: 1 },
      q: 'SELECT * FROM secrets',
      sql: 'SELECT * FROM secrets',
    });
    // Whatever else was in the body, the statement is the declared one.
    expect(mockSqlFull.mock.calls[0][0]).not.toContain('secrets');
  });
});

/**
 * The counter.
 *
 * The behaviour that must never regress is the first one: **free unless configured**. A paywall
 * that switches itself on would start charging for something that was free, silently, and the only
 * signal would be somebody's client breaking.
 */
describe('/api/sql/named — x402', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('is free when no receiving address is configured', async () => {
    delete process.env.X402_SELL_PAY_TO;
    mockSqlFull.mockResolvedValue({
      ok: true,
      data: { count: 0, rows: [], truncated: false, provenance: {} },
    });
    const res = await postNamed({ name: 'issuance_rate_changes', args: { before_block: 1 } });
    expect(res.status).toBe(200);
  });

  it('asks for payment once an address is set, and the challenge is payable', async () => {
    process.env.X402_SELL_PAY_TO = '0x1111111111111111111111111111111111111111';
    process.env.X402_SELL_PRICE = '1000';
    const res = await postNamed({ name: 'issuance_rate_changes', args: { before_block: 1 } });
    expect(res.status).toBe(402);

    // A 402 a caller cannot read is a 402 they cannot pay. The challenge must arrive in both places
    // and name a price, a recipient and an asset.
    const header = res.headers.get('payment-required');
    expect(header, 'the challenge must be in the header').toBeTruthy();
    const decoded = JSON.parse(Buffer.from(header!, 'base64').toString('utf8'));
    expect(decoded.accepts[0].payTo).toBe(process.env.X402_SELL_PAY_TO);
    expect(decoded.accepts[0].amount).toBe('1000');
    expect(decoded.accepts[0].asset).toBeTruthy();

    const body = await res.json();
    expect(body.accepts[0].payTo).toBe(process.env.X402_SELL_PAY_TO);
    // Browsers cannot read a response header they were not told about, which is the exact wall our
    // own buyer-side code hit against The Graph's gateway.
    expect(res.headers.get('Access-Control-Expose-Headers')).toContain('payment-required');
    expect(mockSqlFull).not.toHaveBeenCalled();
  });

  // Charging for a request that was going to be refused would take money for an error.
  it('validates the query before quoting a price', async () => {
    process.env.X402_SELL_PAY_TO = '0x1111111111111111111111111111111111111111';
    const res = await postNamed({ name: 'nonexistent_query', args: {} });
    expect(res.status).toBe(400);
  });

  it('refuses to run at all when the price has nowhere to go', async () => {
    process.env.X402_SELL_PAY_TO = 'not-an-address';
    mockSqlFull.mockResolvedValue({
      ok: true,
      data: { count: 0, rows: [], truncated: false, provenance: {} },
    });
    // A half-configured paywall serves free rather than charging into the void, and says so in the
    // log. The alternative — charging with no recipient — loses money invisibly.
    const res = await postNamed({ name: 'issuance_rate_changes', args: { before_block: 1 } });
    expect(res.status).toBe(200);
  });
});
