import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../logger', () => ({
  log: {
    cron: { warn: vi.fn(), info: vi.fn() },
  },
  default: { info: vi.fn() },
}));

import { recordCronRun, withCronTracking } from '../cron-runs';

function makeSql(response: unknown = []) {
  return vi.fn(() => Promise.resolve(response));
}

describe('recordCronRun', () => {
  it('inserts a successful cron run record', async () => {
    const sql = makeSql();
    await recordCronRun(sql as never, {
      step: 'indexers',
      startedAt: new Date('2026-04-01T10:00:00Z'),
      durationMs: 1234,
      rowsAffected: 99,
      success: true,
    });
    expect(sql).toHaveBeenCalledOnce();
  });

  it('inserts a failed cron run record with error message', async () => {
    const sql = makeSql();
    await recordCronRun(sql as never, {
      step: 'epochs',
      startedAt: new Date(),
      durationMs: 500,
      success: false,
      errorMessage: 'DB timeout',
    });
    expect(sql).toHaveBeenCalledOnce();
  });

  it('does not throw when the insert fails', async () => {
    const sql = vi.fn(() => Promise.reject(new Error('connection refused')));
    // Should swallow the error
    await expect(
      recordCronRun(sql as never, {
        step: 'test',
        startedAt: new Date(),
        durationMs: 0,
        success: false,
      })
    ).resolves.toBeUndefined();
  });
});

describe('withCronTracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns result with durationMs when fn succeeds', async () => {
    const sql = makeSql();
    const result = await withCronTracking(sql as never, 'test-step', async () => ({
      ingested: 42,
    }));
    expect(result.ingested).toBe(42);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('records success with rowsAffected from ingested', async () => {
    const sql = makeSql();
    await withCronTracking(sql as never, 'ingest', async () => ({ ingested: 10 }));
    expect(sql).toHaveBeenCalled();
  });

  it('records success with rowsAffected from count', async () => {
    const sql = makeSql();
    await withCronTracking(sql as never, 'ingest', async () => ({ count: 5 }));
    expect(sql).toHaveBeenCalled();
  });

  it('records failure and rethrows when fn throws', async () => {
    const sql = makeSql();
    const err = new Error('boom');
    await expect(
      withCronTracking(sql as never, 'fail-step', async () => {
        throw err;
      })
    ).rejects.toThrow('boom');
    // Should have called recordCronRun with success=false
    expect(sql).toHaveBeenCalled();
  });

  it('handles result with neither ingested nor count (rowsAffected = undefined)', async () => {
    const sql = makeSql();
    const result = await withCronTracking(sql as never, 'snapshot', async () => ({
      written: true, // no ingested or count key
    }));
    expect(result).toHaveProperty('durationMs');
    expect(sql).toHaveBeenCalled();
  });

  it('records failure even when recordCronRun insert fails', async () => {
    const sql = vi.fn(() => Promise.reject(new Error('db down')));
    await expect(
      withCronTracking(sql as never, 'fail-step', async () => {
        throw new Error('task failed');
      })
    ).rejects.toThrow('task failed');
  });
});
