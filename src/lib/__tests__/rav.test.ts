import { describe, it, expect } from 'vitest';
import { getIndexerRevenue } from '../rav';
import type { DbClient } from '../db';

/**
 * Minimal mock of the postgres.js tagged-template client: each query call returns
 * the next queued result array, in call order. getIndexerRevenue issues queries in
 * a fixed order (ravDaily, rewardsDaily, [ravByDep, rewardsByDep]).
 */
function mockSql(queue: unknown[][]): DbClient {
  let i = 0;
  const fn = () => Promise.resolve(queue[i++] ?? []);
  return fn as unknown as DbClient;
}

describe('getIndexerRevenue', () => {
  it('lowercases the address and passes the window through', async () => {
    const sql = mockSql([[], []]);
    const r = await getIndexerRevenue(sql, '0xABCDEF', { windowDays: 90 });
    expect(r.indexer).toBe('0xabcdef');
    expect(r.windowDays).toBe(90);
    expect(r.total_grt).toBe(0);
    expect(r.byDeployment).toBeUndefined();
  });

  it('merges the two daily series across overlapping and disjoint dates', async () => {
    const ravDaily = [
      { date: '2026-06-01', grt: 10 },
      { date: '2026-06-03', grt: 5 },
    ];
    const rewardsDaily = [
      { date: '2026-06-01', grt: 20 },
      { date: '2026-06-02', grt: 7 },
    ];
    const sql = mockSql([ravDaily, rewardsDaily]);

    const r = await getIndexerRevenue(sql, '0xabc', { windowDays: 30 });

    expect(r.rav_grt).toBe(15);
    expect(r.indexing_rewards_grt).toBe(27);
    expect(r.total_grt).toBe(42);
    expect(r.daily).toEqual([
      { date: '2026-06-01', rav_grt: 10, indexing_rewards_grt: 20, total_grt: 30 },
      { date: '2026-06-02', rav_grt: 0, indexing_rewards_grt: 7, total_grt: 7 },
      { date: '2026-06-03', rav_grt: 5, indexing_rewards_grt: 0, total_grt: 5 },
    ]);
  });

  it('merges per-deployment revenue (incl. the unattributed/null bucket), sorted by total desc', async () => {
    const ravByDep = [
      { deployment_id: 'QmA', grt: 10 },
      { deployment_id: null, grt: 3 },
    ];
    const rewardsByDep = [
      { deployment_id: 'QmA', grt: 20 },
      { deployment_id: 'QmB', grt: 5 },
    ];
    const sql = mockSql([[], [], ravByDep, rewardsByDep]);

    const r = await getIndexerRevenue(sql, '0xabc', { windowDays: 30, byDeployment: true });

    expect(r.byDeployment).toEqual([
      { deployment_id: 'QmA', rav_grt: 10, indexing_rewards_grt: 20, total_grt: 30 },
      { deployment_id: 'QmB', rav_grt: 0, indexing_rewards_grt: 5, total_grt: 5 },
      { deployment_id: null, rav_grt: 3, indexing_rewards_grt: 0, total_grt: 3 },
    ]);
  });
});
