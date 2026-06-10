/**
 * Indexer P&L ("financial statements").
 *
 * Pure netting of revenue (indexing rewards + RAV query fees) against the modeled
 * infra cost. USD-dependent fields are null when no GRT price is supplied, so the
 * GRT-denominated view always works even without a price feed.
 */
import type { IndexerRevenue } from './rav';
import type { CostModel } from './infra-cost';

export interface DeploymentPnl {
  deployment_id: string | null;
  revenue_grt: number;
  revenue_usd: number | null;
}

export interface IndexerPnl {
  windowDays: number;
  grtPrice: number | null;
  revenue_grt: number;
  revenue_usd: number | null;
  /** Infra cost prorated from monthly to the window length. */
  infra_cost_usd: number;
  infra_monthly_usd: number;
  net_usd: number | null;
  margin_pct: number | null;
  /** GRT price at which net == 0 over this window. */
  breakeven_grt_price: number | null;
  perDeployment: DeploymentPnl[];
}

export function computeIndexerPnl(params: {
  revenue: IndexerRevenue;
  costModel: CostModel;
  grtPrice: number | null;
  windowDays: number;
}): IndexerPnl {
  const { revenue, costModel, grtPrice, windowDays } = params;

  const infra_cost_usd = costModel.totalMonthlyUsd * (windowDays / 30);
  const revenue_grt = revenue.total_grt;
  const revenue_usd = grtPrice != null ? revenue_grt * grtPrice : null;
  const net_usd = revenue_usd != null ? revenue_usd - infra_cost_usd : null;
  const margin_pct =
    revenue_usd != null && revenue_usd > 0 ? (net_usd! / revenue_usd) * 100 : null;
  const breakeven_grt_price = revenue_grt > 0 ? infra_cost_usd / revenue_grt : null;

  const perDeployment: DeploymentPnl[] = (revenue.byDeployment ?? []).map((d) => ({
    deployment_id: d.deployment_id,
    revenue_grt: d.total_grt,
    revenue_usd: grtPrice != null ? d.total_grt * grtPrice : null,
  }));

  return {
    windowDays,
    grtPrice,
    revenue_grt,
    revenue_usd,
    infra_cost_usd,
    infra_monthly_usd: costModel.totalMonthlyUsd,
    net_usd,
    margin_pct,
    breakeven_grt_price,
    perDeployment,
  };
}
