/**
 * POST /api/sql/receipt — signed receipts for declared queries.
 *
 * A receipt is a claim about an answer, so every guard here exists to stop us signing something
 * that is not one. The refusals matter more than the happy path: signing a truncated result would
 * put our name on a partial answer presented as complete, and signing an answer with no
 * `sealed_through` would attest to something nobody can reproduce. Both are worse than issuing no
 * receipt at all, which is why they are 409 and 502 rather than a best effort.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const hasNuthatch = vi.fn(() => true);
const nuthatchSqlFull = vi.fn();

vi.mock('@/lib/nuthatch', () => ({
  hasNuthatch: () => hasNuthatch(),
  nuthatchSqlFull: (...a: unknown[]) => nuthatchSqlFull(...a),
}));
vi.mock('@/lib/logger', () => ({ log: { api: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } } }));

import { POST } from '../receipt/route';
import { NAMED_QUERIES } from '@/lib/named-queries';

const QUERY = NAMED_QUERIES[0];
const INDEXER = '0x1234567890abcdef1234567890abcdef12345678';

const post = (body: unknown) =>
  POST(
    new Request('http://localhost/api/sql/receipt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );

/** A well-formed request for the first declared query. */
const validBody = () => ({
  name: QUERY.name,
  args: { indexer: INDEXER, before_block: 500_000_000 },
});

/** A nest answer that is complete and reproducible. */
function nestAnswers(over: Record<string, unknown> = {}) {
  nuthatchSqlFull.mockResolvedValue({
    ok: true,
    data: {
      count: 1,
      rows: [{ block_number: 1 }],
      provenance: { sealed_through: 499_000_000, nid: 'nid1', registry_hash: 'rh1' },
      ...over,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  hasNuthatch.mockReturnValue(true);
  process.env.TATTLER_ISSUER_KEY = 'a'.repeat(64);
});

afterEach(() => {
  delete process.env.TATTLER_ISSUER_KEY;
});

describe('/api/sql/receipt refusals', () => {
  it('503s when this deployment holds no issuer key, and says what to do instead', async () => {
    delete process.env.TATTLER_ISSUER_KEY;
    const res = await post(validBody());

    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/tattler attest-named/);
    expect(nuthatchSqlFull).not.toHaveBeenCalled();
  });

  it('503s when the SQL surface is not configured', async () => {
    hasNuthatch.mockReturnValue(false);
    const res = await post(validBody());

    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/not configured/i);
  });

  it('400s on a body that is not JSON', async () => {
    const res = await post('{definitely not json');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/JSON body/i);
  });

  it('refuses a query that is not declared, and lists the ones that are', async () => {
    // A receipt over arbitrary SQL attests to an answer nobody can agree the question for.
    const res = await post({ name: 'SELECT * FROM anything', args: {} });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/declared queries only/i);
    expect(json.allowed).toEqual(NAMED_QUERIES.map((q) => q.name));
    expect(nuthatchSqlFull).not.toHaveBeenCalled();
  });

  it('refuses a missing name the same way as an unknown one', async () => {
    const res = await post({ args: {} });
    expect(res.status).toBe(400);
    expect((await res.json()).allowed).toBeDefined();
  });

  it('refuses arguments that do not parse, and says which are expected', async () => {
    const res = await post({ name: QUERY.name, args: { indexer: 'not-an-address' } });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.params).toEqual(QUERY.params);
    expect(nuthatchSqlFull).not.toHaveBeenCalled();
  });

  it('treats a non-object args as absent rather than coercing it', async () => {
    const res = await post({ name: QUERY.name, args: [1, 2, 3] });
    expect(res.status).toBe(400);
  });

  it('REFUSES TO SIGN a truncated answer', async () => {
    // The single thing a receipt must never do: put our name on a partial result presented as
    // complete. Better no receipt than a confident one.
    nestAnswers({ truncated: true });
    const res = await post(validBody());

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/truncated or incomplete/i);
  });

  it('REFUSES TO SIGN a degraded answer', async () => {
    nestAnswers({ degraded: true, degraded_tables: ['staking__tokens_delegated'] });
    const res = await post(validBody());

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/truncated or incomplete/i);
  });

  it('refuses when the dataset reports no sealed_through, since nothing could reproduce it', async () => {
    nestAnswers({ provenance: { sealed_through: null, nid: 'nid1' } });
    const res = await post(validBody());

    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/sealed_through/);
  });

  it('refuses when provenance is missing entirely', async () => {
    nestAnswers({ provenance: undefined });
    const res = await post(validBody());
    expect(res.status).toBe(502);
  });

  it('refuses a query with no before_block to pin the answer to', async () => {
    // Without a pin the receipt attests to "whatever was true when you asked", which next year
    // means nothing.
    nestAnswers();
    const res = await post({ name: QUERY.name, args: { indexer: INDEXER } });

    // The pin is a declared parameter, so this is caught at render time.
    expect(res.status).toBe(400);
  });

  it('passes a nest 400 through as a 400 and anything else as a 502', async () => {
    nuthatchSqlFull.mockResolvedValue({ ok: false, status: 400, error: 'no such column: tokns' });
    const bad = await post(validBody());
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe('no such column: tokns');

    nuthatchSqlFull.mockResolvedValue({ ok: false, status: 500, error: 'nest exploded' });
    const boom = await post(validBody());
    expect(boom.status).toBe(502);
  });

  it('502s without leaking internals when the nest throws', async () => {
    nuthatchSqlFull.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8100'));
    const res = await post(validBody());
    const json = await res.json();

    expect(res.status).toBe(502);
    expect(json.error).toBe('Could not issue a receipt right now.');
    expect(JSON.stringify(json)).not.toContain('127.0.0.1');
  });

  it('queries the dataset the declared query names, with a timeout', async () => {
    nestAnswers();
    await post(validBody());

    const [sql, basePath, timeout] = nuthatchSqlFull.mock.calls[0];
    expect(sql).toContain(INDEXER);
    expect(typeof basePath).toBe('string');
    expect(timeout).toBe(6_000);
  });
});
