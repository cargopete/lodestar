import { describe, it, expect } from 'vitest';
import {
  aggregateIndexerMetrics,
  scoreIndexers,
  type QosDailyRow,
} from '../qos-aggregate';

const row = (o: Partial<QosDailyRow> & Pick<QosDailyRow, 'indexer_address' | 'deployment_id' | 'day_number'>): QosDailyRow => ({
  query_count: 0,
  success_count: 0,
  avg_latency_ms: 0,
  blocks_behind: 0,
  chain_id: 'arbitrum-one',
  ...o,
});

describe('aggregateIndexerMetrics', () => {
  const today = 100;

  it('applies EWMA day-decay and query-weights latency/blocks', () => {
    const rows: QosDailyRow[] = [
      row({ indexer_address: '0xa', deployment_id: 'X', day_number: 100, query_count: 1000, success_count: 1000, avg_latency_ms: 50, blocks_behind: 10 }),
      // 10 days old → EWMA weight 0.5 (half-life 10)
      row({ indexer_address: '0xa', deployment_id: 'X', day_number: 90, query_count: 1000, success_count: 500, avg_latency_ms: 150, blocks_behind: 10 }),
    ];
    const metrics = aggregateIndexerMetrics(rows, [{ deployment_id: 'X', total_query_count: 5000 }], { todayDayNumber: today });
    const a = metrics.get('0xa')![0];

    expect(a.n).toBeCloseTo(1500, 6); // 1000 + 0.5*1000
    expect(a.successes).toBeCloseTo(1250, 6); // 1000 + 0.5*500
    expect(a.avgLatencyMs).toBeCloseTo(83.333, 2); // (1000*50 + 500*150)/1500
    expect(a.servedShare).toBeCloseTo(0.4, 6); // raw 2000 / 5000
    expect(a.timeBehindSec).toBeCloseTo(2.5, 6); // 10 blocks * 0.25s (arbitrum-one)
  });

  it('computes per-deployment cohort latency τ = median across indexers', () => {
    const rows: QosDailyRow[] = [
      row({ indexer_address: '0xa', deployment_id: 'X', day_number: 100, query_count: 1000, success_count: 1000, avg_latency_ms: 50 }),
      row({ indexer_address: '0xb', deployment_id: 'X', day_number: 100, query_count: 1000, success_count: 1000, avg_latency_ms: 150 }),
      row({ indexer_address: '0xc', deployment_id: 'X', day_number: 100, query_count: 1000, success_count: 1000, avg_latency_ms: 250 }),
    ];
    const metrics = aggregateIndexerMetrics(rows, [], { todayDayNumber: today });
    // median(50,150,250) = 150 → every indexer on X gets τ=150
    for (const m of metrics.values()) {
      expect(m[0].latencyTauMs).toBeCloseTo(150, 6);
    }
  });

  it('servedShare is 0 when the deployment total is unknown', () => {
    const rows = [row({ indexer_address: '0xa', deployment_id: 'Z', day_number: 100, query_count: 500, success_count: 500 })];
    const metrics = aggregateIndexerMetrics(rows, [], { todayDayNumber: today });
    expect(metrics.get('0xa')![0].servedShare).toBe(0);
  });

  it('groups multiple deployments under one indexer', () => {
    const rows = [
      row({ indexer_address: '0xa', deployment_id: 'X', day_number: 100, query_count: 100, success_count: 100 }),
      row({ indexer_address: '0xa', deployment_id: 'Y', day_number: 100, query_count: 100, success_count: 100 }),
    ];
    const metrics = aggregateIndexerMetrics(rows, [], { todayDayNumber: today });
    expect(metrics.get('0xa')).toHaveLength(2);
  });
});

describe('scoreIndexers', () => {
  it('returns one quality result per indexer', () => {
    const rows: QosDailyRow[] = [
      row({ indexer_address: '0xgood', deployment_id: 'X', day_number: 100, query_count: 10000, success_count: 9990, avg_latency_ms: 40, blocks_behind: 4 }),
      row({ indexer_address: '0xleech', deployment_id: 'X', day_number: 100, query_count: 12, success_count: 12, avg_latency_ms: 3000, blocks_behind: 200000 }),
    ];
    const totals = [{ deployment_id: 'X', total_query_count: 10012 }];
    const results = scoreIndexers(rows, totals, { todayDayNumber: 100 });

    expect(results).toHaveLength(2);
    const good = results.find((r) => r.indexer === '0xgood')!;
    const leech = results.find((r) => r.indexer === '0xleech')!;
    // The workhorse must out-score the leech end-to-end through the real pipeline.
    expect(good.qScore).toBeGreaterThan(leech.qScore);
    expect(leech.qScore).toBeLessThan(20);
  });
});
