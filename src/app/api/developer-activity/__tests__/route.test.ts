/**
 * GET /api/developer-activity — subgraphs published per week, from the graph-gns-nest.
 *
 * The quiet failures are all in the shaping. A missing week silently dropped would make the chart
 * lie about a gap; the current week counted as a complete one would read as a crash every Monday;
 * and a nest that is merely unready must produce an error rather than a convincing flat line,
 * because this route has no second source to disagree with it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const hasNuthatch = vi.fn(() => true);
const nuthatchSqlReady = vi.fn();

vi.mock('@/lib/nuthatch', () => ({
  hasNuthatch: () => hasNuthatch(),
  nuthatchSqlReady: (...a: unknown[]) => nuthatchSqlReady(...a),
}));
vi.mock('@/lib/cache', () => ({
  cached: (_k: string, _t: number, f: () => Promise<unknown>) => f(),
}));
vi.mock('@/lib/logger', () => ({ log: { api: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } } }));

import { GET } from '../route';

/** A Wednesday, so the containing week is genuinely in progress. */
const NOW = Date.UTC(2026, 8, 2, 12, 0, 0);
const MONDAY_THIS_WEEK = '2026-08-31';

const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/** Serve these publication timestamps as nest rows. */
function published(...isoDates: string[]) {
  nuthatchSqlReady.mockResolvedValue({
    ok: true,
    data: { count: isoDates.length, rows: isoDates.map((d) => ({ createdAt: unix(d) })) },
  });
}

const body = async () => (await GET()).json();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  hasNuthatch.mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('/api/developer-activity', () => {
  it('503s when nuthatch is not configured, without querying', async () => {
    hasNuthatch.mockReturnValue(false);
    const res = await GET();

    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/not configured/i);
    expect(nuthatchSqlReady).not.toHaveBeenCalled();
  });

  it('passes the nest reason through when the nest is not ready', async () => {
    // #1080: a stalled nest must surface as an error, not as a plausible chart.
    nuthatchSqlReady.mockResolvedValue({
      ok: false,
      status: 503,
      error: 'nest is not ready: stalled',
      reason: 'stalled: it is running but no longer following the chain',
    });

    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(503);
    expect(json.error).toMatch(/not ready/);
    expect(json.reason).toMatch(/stalled/);
    expect(json.data).toBeUndefined();
  });

  it('500s without leaking internals on an unexpected failure', async () => {
    nuthatchSqlReady.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:8103'));
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to load developer activity');
    expect(JSON.stringify(json)).not.toContain('127.0.0.1');
  });

  it('queries the gns nest over a twelve-month window', async () => {
    published('2026-08-03T00:00:00Z');
    await body();

    const [sql, basePath] = nuthatchSqlReady.mock.calls[0];
    expect(basePath).toBe('/gns');
    expect(sql).toContain('gns__subgraph_published');
    const cutoff = Math.floor(NOW / 1000) - 12 * 30 * 86400;
    expect(sql).toContain(`block_timestamp >= ${cutoff}`);
  });

  it('buckets a publication into the Monday of its ISO week', async () => {
    // A Sunday belongs to the week that started the preceding Monday, not the next one.
    published('2026-08-09T23:00:00Z'); // Sunday
    const { data } = await body();

    expect(data.weeks[0].weekStart).toBe('2026-08-03');
  });

  it('fills empty weeks with zero rather than omitting them', async () => {
    // Omitting a quiet week would draw a continuous line across it and hide the gap.
    published('2026-08-03T00:00:00Z', '2026-08-24T00:00:00Z');
    const { data } = await body();

    expect(data.weeks.map((w: { weekStart: string }) => w.weekStart)).toEqual([
      '2026-08-03',
      '2026-08-10',
      '2026-08-17',
      '2026-08-24',
    ]);
    expect(data.weeks.map((w: { count: number }) => w.count)).toEqual([1, 0, 0, 1]);
  });

  it('runs a cumulative total across the window', async () => {
    published(
      '2026-08-03T00:00:00Z',
      '2026-08-03T01:00:00Z',
      '2026-08-10T00:00:00Z',
      '2026-08-17T00:00:00Z',
    );
    const { data } = await body();

    expect(data.weeks.map((w: { cumulative: number }) => w.cumulative)).toEqual([2, 3, 4]);
    expect(data.totalInWindow).toBe(4);
  });

  it('marks the in-progress week partial and keeps it out of the headline', async () => {
    // Counting a Wednesday's worth of a week as a full one reads as a collapse every Monday.
    published('2026-08-24T00:00:00Z', '2026-08-31T00:00:00Z', '2026-09-01T00:00:00Z');
    const { data } = await body();

    const current = data.weeks.find(
      (w: { weekStart: string }) => w.weekStart === MONDAY_THIS_WEEK,
    );
    expect(current.partial).toBe(true);
    expect(current.count).toBe(2);

    // The last COMPLETE week is the one before it.
    expect(data.lastWeekCount).toBe(1);
  });

  it('computes week-over-week between the last two complete weeks', async () => {
    published(
      '2026-08-17T00:00:00Z',
      '2026-08-17T01:00:00Z', // 2 in the prior complete week
      '2026-08-24T00:00:00Z',
      '2026-08-24T01:00:00Z',
      '2026-08-24T02:00:00Z', // 3 in the last complete week
      '2026-09-01T00:00:00Z', // partial, must be ignored
    );
    const { data } = await body();

    expect(data.lastWeekCount).toBe(3);
    expect(data.weekOverWeekPct).toBeCloseTo(50, 6);
  });

  it('reports a null week-over-week rather than dividing by an empty week', async () => {
    published('2026-08-24T00:00:00Z');
    const { data } = await body();
    expect(data.weekOverWeekPct).toBeNull();
  });

  it('returns an empty series rather than inventing weeks when nothing was published', async () => {
    published();
    const { data } = await body();

    expect(data.weeks).toEqual([]);
    expect(data.totalInWindow).toBe(0);
    expect(data.lastWeekCount).toBe(0);
    expect(data.weekOverWeekPct).toBeNull();
    expect(data.source).toBe('nuthatch');
  });

  it('names its source and window so a reader can cite the answer', async () => {
    published('2026-08-03T00:00:00Z');
    const { data } = await body();

    expect(data.source).toBe('nuthatch');
    expect(data.windowMonths).toBe(12);
  });
});
