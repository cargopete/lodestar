import { describe, it, expect } from 'vitest';
import { computeIndexerPnl } from '../pnl';
import type { IndexerRevenue } from '../rav';
import type { CostModel } from '../infra-cost';

function revenue(overrides: Partial<IndexerRevenue> = {}): IndexerRevenue {
  return {
    indexer: '0xabc',
    windowDays: 30,
    rav_grt: 400,
    indexing_rewards_grt: 600,
    total_grt: 1000,
    daily: [],
    ...overrides,
  };
}

function cost(totalMonthlyUsd: number): CostModel {
  return { lines: [], baseOverheadUsd: totalMonthlyUsd, totalMonthlyUsd };
}

describe('computeIndexerPnl', () => {
  it('prorates monthly cost to the window length', () => {
    const p = computeIndexerPnl({ revenue: revenue(), costModel: cost(3000), grtPrice: null, windowDays: 90 });
    expect(p.infra_monthly_usd).toBe(3000);
    expect(p.infra_cost_usd).toBe(9000); // 3000 * 90/30
  });

  it('leaves USD fields null when no GRT price is given', () => {
    const p = computeIndexerPnl({ revenue: revenue(), costModel: cost(2000), grtPrice: null, windowDays: 30 });
    expect(p.revenue_grt).toBe(1000);
    expect(p.revenue_usd).toBeNull();
    expect(p.net_usd).toBeNull();
    expect(p.margin_pct).toBeNull();
  });

  it('computes USD revenue, net, and margin when priced', () => {
    const p = computeIndexerPnl({ revenue: revenue(), costModel: cost(50), grtPrice: 0.1, windowDays: 30 });
    expect(p.revenue_usd).toBeCloseTo(100, 9); // 1000 * 0.1
    expect(p.net_usd).toBeCloseTo(50, 9); // 100 - 50
    expect(p.margin_pct).toBeCloseTo(50, 9); // 50/100
  });

  it('reports the break-even GRT price where net is zero', () => {
    const p = computeIndexerPnl({ revenue: revenue(), costModel: cost(2000), grtPrice: 0.1, windowDays: 30 });
    // breakeven = cost / revenue_grt = 2000 / 1000 = 2.0
    expect(p.breakeven_grt_price).toBeCloseTo(2, 9);
    // sanity: at the break-even price, net is ~0
    const atBreakeven = computeIndexerPnl({
      revenue: revenue(),
      costModel: cost(2000),
      grtPrice: p.breakeven_grt_price!,
      windowDays: 30,
    });
    expect(atBreakeven.net_usd).toBeCloseTo(0, 6);
  });

  it('handles zero revenue without dividing by zero', () => {
    const p = computeIndexerPnl({
      revenue: revenue({ rav_grt: 0, indexing_rewards_grt: 0, total_grt: 0 }),
      costModel: cost(1000),
      grtPrice: 0.1,
      windowDays: 30,
    });
    expect(p.revenue_usd).toBe(0);
    expect(p.margin_pct).toBeNull(); // no revenue to take a margin against
    expect(p.breakeven_grt_price).toBeNull(); // undefined break-even with no revenue
    expect(p.net_usd).toBeCloseTo(-1000, 9);
  });

  it('maps per-deployment revenue, with USD only when priced', () => {
    const rev = revenue({
      byDeployment: [
        { deployment_id: 'QmA', rav_grt: 100, indexing_rewards_grt: 200, total_grt: 300 },
        { deployment_id: null, rav_grt: 50, indexing_rewards_grt: 0, total_grt: 50 },
      ],
    });
    const priced = computeIndexerPnl({ revenue: rev, costModel: cost(0), grtPrice: 0.2, windowDays: 30 });
    expect(priced.perDeployment).toHaveLength(2);
    expect(priced.perDeployment[0]).toMatchObject({ deployment_id: 'QmA', revenue_grt: 300 });
    expect(priced.perDeployment[0].revenue_usd).toBeCloseTo(60, 9);
    expect(priced.perDeployment[1].deployment_id).toBeNull();

    const unpriced = computeIndexerPnl({ revenue: rev, costModel: cost(0), grtPrice: null, windowDays: 30 });
    expect(unpriced.perDeployment[0].revenue_usd).toBeNull();
  });
});
