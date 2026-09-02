/**
 * QoS Oracle daily ingestion.
 *
 * The load-bearing rule is the one the module's own comment spends a paragraph on: an oracle that
 * published no figure for a day must land as NULL, and an indexer that genuinely served zero 200s
 * must land as 0. `Number(null)` is 0, so getting this wrong turns "we know nothing about this
 * day" into "everything failed that day", and the scorer downstream cannot tell them apart
 * afterwards. It is unrecoverable once written, which is why it is pinned hard here.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { DbClient } from '../../db';

const getIngestionState = vi.fn();
const updateIngestionState = vi.fn();
const qosOracleQuery = vi.fn();

vi.mock('../../db', () => ({
  getIngestionState: (...a: unknown[]) => getIngestionState(...a),
  updateIngestionState: (...a: unknown[]) => updateIngestionState(...a),
}));
vi.mock('../../subgraph', () => ({
  qosOracleQuery: (...a: unknown[]) => qosOracleQuery(...a),
}));
vi.mock('../../logger', () => ({
  log: { ingest: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } },
}));

import { ingestQos } from '../qos';

const GRAPH_EPOCH_DAYS = 18613;
/** A fixed clock, so `currentDayNumber()` is not a moving target. */
const NOW = Date.UTC(2026, 8, 2);
const TODAY = Math.floor(NOW / 86_400_000) - GRAPH_EPOCH_DAYS;

function makeSql() {
  const queries: { text: string; values: unknown[] }[] = [];
  const fn = ((...args: unknown[]) => {
    const first = args[0];
    if (Array.isArray(first) && 'raw' in (first as object)) {
      queries.push({ text: (first as string[]).join('?'), values: args.slice(1) });
      return Promise.resolve([]);
    }
    return { embedded: first };
  }) as unknown as DbClient & { queries: { text: string; values: unknown[] }[] };
  (fn as unknown as { queries: unknown }).queries = queries;
  return fn as DbClient & { queries: { text: string; values: unknown[] }[] };
}

function rowsInto(sql: { queries: { text: string; values: unknown[] }[] }, table: string) {
  return sql.queries
    .filter((q) => q.text.includes(`INSERT INTO ${table}`))
    .flatMap((q) => (q.values[0] as { embedded: Record<string, unknown>[] }).embedded);
}

function alloc(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'a1',
    dayNumber: String(TODAY),
    indexer_wallet: '0xINDEXER',
    subgraph_deployment_ipfs_hash: 'QmDeploy',
    query_count: '100',
    num_indexer_200_responses: '95',
    proportion_indexer_200_responses: '0.95',
    avg_indexer_latency_ms: '250',
    avg_indexer_blocks_behind: '2',
    total_query_fees: '1.5',
    gateway_id: 'gw1',
    chain_id: '42161',
    ...over,
  };
}

function queryDaily(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'q1',
    dayNumber: String(TODAY),
    subgraphDeployment: { id: 'QmDeploy' },
    query_count: '1000',
    gateway_query_success_rate: '0.99',
    gateway_id: 'gw1',
    chain_id: '42161',
    ...over,
  };
}

/** Answer each of the two paged queries by which entity it names. */
function serve(allocPages: unknown[][], queryPages: unknown[][] = [[]]) {
  const a = [...allocPages];
  const q = [...queryPages];
  qosOracleQuery.mockReset();
  qosOracleQuery.mockImplementation(async (text: string) => {
    if (text.includes('allocationDailyDataPoints')) {
      return { allocationDailyDataPoints: a.shift() ?? [] };
    }
    return { queryDailyDataPoints: q.shift() ?? [] };
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  getIngestionState.mockReset().mockResolvedValue({ last_block: TODAY - 3 });
  updateIngestionState.mockReset().mockResolvedValue(undefined);
  qosOracleQuery.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('successCount, via ingestQos', () => {
  it('keeps a genuine zero as zero', async () => {
    // An indexer really serving no 200s must score as a zero, not as an absence.
    serve([[alloc({ num_indexer_200_responses: '0', proportion_indexer_200_responses: '0' })]]);
    const sql = makeSql();
    await ingestQos(sql);
    expect(rowsInto(sql, 'qos_daily')[0].success_count).toBe(0);
  });

  it('records an absent figure as null rather than as zero', async () => {
    serve([
      [alloc({ num_indexer_200_responses: null, proportion_indexer_200_responses: null })],
    ]);
    const sql = makeSql();
    await ingestQos(sql);
    expect(rowsInto(sql, 'qos_daily')[0].success_count).toBeNull();
  });

  it('treats an empty string as absent too', async () => {
    serve([[alloc({ num_indexer_200_responses: '', proportion_indexer_200_responses: '' })]]);
    const sql = makeSql();
    await ingestQos(sql);
    expect(rowsInto(sql, 'qos_daily')[0].success_count).toBeNull();
  });

  it('prefers the published count over proportion times query count', async () => {
    // The count is what the gateway observed; the product is that number round-tripped
    // through a division. They disagree here on purpose.
    serve([
      [
        alloc({
          query_count: '100',
          num_indexer_200_responses: '93',
          proportion_indexer_200_responses: '0.95',
        }),
      ],
    ]);
    const sql = makeSql();
    await ingestQos(sql);
    expect(rowsInto(sql, 'qos_daily')[0].success_count).toBe(93);
  });

  it('falls back to proportion times query count when no count is published', async () => {
    serve([
      [
        alloc({
          query_count: '200',
          num_indexer_200_responses: null,
          proportion_indexer_200_responses: '0.5',
        }),
      ],
    ]);
    const sql = makeSql();
    await ingestQos(sql);
    expect(rowsInto(sql, 'qos_daily')[0].success_count).toBe(100);
  });

  it('falls back rather than trusting a non-numeric count', async () => {
    serve([
      [
        alloc({
          query_count: '200',
          num_indexer_200_responses: 'not-a-number',
          proportion_indexer_200_responses: '0.25',
        }),
      ],
    ]);
    const sql = makeSql();
    await ingestQos(sql);
    expect(rowsInto(sql, 'qos_daily')[0].success_count).toBe(50);
  });

  it('lands null when the fallback proportion is not numeric either', async () => {
    serve([
      [
        alloc({
          num_indexer_200_responses: null,
          proportion_indexer_200_responses: 'rubbish',
        }),
      ],
    ]);
    const sql = makeSql();
    await ingestQos(sql);
    expect(rowsInto(sql, 'qos_daily')[0].success_count).toBeNull();
  });
});

describe('ingestQos', () => {
  it('re-scans one day of overlap on a delta run', async () => {
    getIngestionState.mockResolvedValue({ last_block: TODAY - 3 });
    serve([[alloc()]]);
    await ingestQos(makeSql());
    expect(qosOracleQuery.mock.calls[0][0]).toContain(`dayNumber_gte: ${TODAY - 4}`);
  });

  it('never asks for a negative day', async () => {
    getIngestionState.mockResolvedValue({ last_block: 0 });
    serve([[]]);
    await ingestQos(makeSql());
    expect(qosOracleQuery.mock.calls[0][0]).toContain('dayNumber_gte: 0');
  });

  it('reads a default window on a backfill', async () => {
    serve([[]]);
    await ingestQos(makeSql(), { backfill: true });
    expect(qosOracleQuery.mock.calls[0][0]).toContain(`dayNumber_gte: ${TODAY - 120}`);
  });

  it('honours an explicit backfill window', async () => {
    serve([[]]);
    await ingestQos(makeSql(), { backfill: true, days: 7 });
    expect(qosOracleQuery.mock.calls[0][0]).toContain(`dayNumber_gte: ${TODAY - 7}`);
  });

  it('advances the cursor to today', async () => {
    serve([[alloc()]]);
    await ingestQos(makeSql());
    expect(updateIngestionState).toHaveBeenCalledWith(expect.anything(), 'qos', {
      last_block: TODAY,
    });
  });

  it('shapes an allocation row, lower-casing the indexer and dating the day', async () => {
    serve([[alloc({ dayNumber: String(TODAY), query_count: '100.4' })]]);
    const sql = makeSql();
    await ingestQos(sql);

    expect(rowsInto(sql, 'qos_daily')[0]).toMatchObject({
      indexer_address: '0xindexer',
      deployment_id: 'QmDeploy',
      day_number: TODAY,
      day: new Date((TODAY + GRAPH_EPOCH_DAYS) * 86_400_000).toISOString().slice(0, 10),
      query_count: 100, // rounded
      avg_latency_ms: 250,
      stdev_latency_ms: null, // V1 does not expose it at daily grain
      blocks_behind: 2,
      gateway_id: 'gw1',
      chain_id: '42161',
    });
  });

  it('defaults a missing gateway to empty and a missing chain to null', async () => {
    serve([[alloc({ gateway_id: null, chain_id: null })]]);
    const sql = makeSql();
    await ingestQos(sql);
    expect(rowsInto(sql, 'qos_daily')[0]).toMatchObject({ gateway_id: '', chain_id: null });
  });

  it('skips a query datapoint with no deployment to attribute it to', async () => {
    serve(
      [[]],
      [[queryDaily({ id: 'q1' }), queryDaily({ id: 'q2', subgraphDeployment: null })]],
    );
    const sql = makeSql();
    const r = await ingestQos(sql);

    expect(rowsInto(sql, 'deployment_daily')).toHaveLength(1);
    // The skipped row still counts as read, so the page cursor stays honest.
    expect(r.ingested).toBe(2);
  });

  it('pages both queries on id and stops on a short page', async () => {
    const full = Array.from({ length: 1000 }, (_, i) => alloc({ id: `a${String(i).padStart(4, '0')}` }));
    serve([full, [alloc({ id: 'zz' })]]);
    const sql = makeSql();
    const r = await ingestQos(sql);

    expect(qosOracleQuery.mock.calls[1][0]).toContain('id_gt: "a0999"');
    expect(r.ingested).toBe(1001);
  });

  it('chunks a large batch into separate inserts', async () => {
    serve([Array.from({ length: 450 }, (_, i) => alloc({ id: `a${i}` }))]);
    const sql = makeSql();
    await ingestQos(sql);

    const inserts = sql.queries.filter((q) => q.text.includes('INSERT INTO qos_daily'));
    expect(inserts).toHaveLength(3); // 200 + 200 + 50
  });

  it('writes nothing and still advances the cursor when the oracle is empty', async () => {
    serve([[]], [[]]);
    const sql = makeSql();
    const r = await ingestQos(sql);

    expect(r.ingested).toBe(0);
    expect(sql.queries).toEqual([]);
    expect(updateIngestionState).toHaveBeenCalled();
  });

  it('survives the oracle omitting the entity list entirely', async () => {
    qosOracleQuery.mockReset().mockResolvedValue({});
    const sql = makeSql();
    await expect(ingestQos(sql)).resolves.toEqual({ ingested: 0 });
  });
});
