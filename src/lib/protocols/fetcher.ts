import type { ProtocolConfig } from './config';

export interface ProtocolDaySnapshot {
  timestamp: number; // unix seconds
  tvlUSD: number;
  volumeUSD: number;
  feesUSD: number;
}

export interface ProtocolSummary {
  slug: string;
  tvlUSD: number;
  cumulativeVolumeUSD: number;
  cumulativeFeesUSD: number;
  volume30dUSD: number;
  fees30dUSD: number;
  totalBorrowUSD?: number;
  stakingAPR?: number;
}

export interface ProtocolDetail {
  summary: ProtocolSummary;
  snapshots: ProtocolDaySnapshot[];
}

// --- Generic gateway query ---

async function queryProtocolSubgraph<T>(subgraphId: string, query: string): Promise<T> {
  const apiKey = process.env.GRAPH_API_KEY;
  if (!apiKey) throw new Error('GRAPH_API_KEY not configured');
  const url = `https://gateway-arbitrum.network.thegraph.com/api/${apiKey}/subgraphs/id/${subgraphId}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Protocol subgraph request failed: ${res.status}`);
  const json = await res.json();
  if (json.errors) throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  return json.data as T;
}

// --- Messari DEX schema ---

interface MessariDexData {
  dexAmmProtocols: Array<{
    totalValueLockedUSD: string;
    cumulativeVolumeUSD: string;
    cumulativeTotalRevenueUSD: string;
  }>;
  financialsDailySnapshots: Array<{
    timestamp: string;
    totalValueLockedUSD: string;
    dailyVolumeUSD: string;
    dailyTotalRevenueUSD: string;
  }>;
}

const MESSARI_DEX_QUERY = `{
  dexAmmProtocols(first: 1) {
    totalValueLockedUSD
    cumulativeVolumeUSD
    cumulativeTotalRevenueUSD
  }
  financialsDailySnapshots(first: 90, orderBy: timestamp, orderDirection: desc) {
    timestamp
    totalValueLockedUSD
    dailyVolumeUSD
    dailyTotalRevenueUSD
  }
}`;

// --- Messari Lending schema ---

interface MessariLendingData {
  lendingProtocols: Array<{
    totalValueLockedUSD: string;
    totalBorrowBalanceUSD: string;
    cumulativeBorrowUSD: string;
    cumulativeTotalRevenueUSD: string;
  }>;
  financialsDailySnapshots: Array<{
    timestamp: string;
    totalValueLockedUSD: string;
    dailyBorrowUSD: string;
    dailyTotalRevenueUSD: string;
  }>;
}

const MESSARI_LENDING_QUERY = `{
  lendingProtocols(first: 1) {
    totalValueLockedUSD
    totalBorrowBalanceUSD
    cumulativeBorrowUSD
    cumulativeTotalRevenueUSD
  }
  financialsDailySnapshots(first: 90, orderBy: timestamp, orderDirection: desc) {
    timestamp
    totalValueLockedUSD
    dailyBorrowUSD
    dailyTotalRevenueUSD
  }
}`;

// --- Messari Staking / Yield schema (used by the Messari Lido subgraph).
//
// Same `protocols` + `financialsDailySnapshots` shape as the other Messari templates,
// but volume / fee semantics are different: dailySupplySideRevenueUSD is yield earned
// by stakers and the protocol's cut is captured cumulatively but not split daily.
//
// Most Messari staking deployments (including Lido) write `dailyProtocolSideRevenueUSD = 0`
// across every snapshot while still maintaining a non-zero `cumulativeProtocolSideRevenueUSD`.
// To produce a usable daily-fees series we estimate it as a constant fraction of supply-side
// revenue, derived from the protocol-level cumulative ratio.

interface MessariStakingData {
  protocols: Array<{
    totalValueLockedUSD: string;
    cumulativeSupplySideRevenueUSD: string;
    cumulativeProtocolSideRevenueUSD: string;
    cumulativeTotalRevenueUSD: string;
  }>;
  financialsDailySnapshots: Array<{
    timestamp: string;
    totalValueLockedUSD: string;
    dailySupplySideRevenueUSD: string;
    dailyProtocolSideRevenueUSD: string;
  }>;
}

const MESSARI_STAKING_QUERY = `{
  protocols(first: 1) {
    totalValueLockedUSD
    cumulativeSupplySideRevenueUSD
    cumulativeProtocolSideRevenueUSD
    cumulativeTotalRevenueUSD
  }
  financialsDailySnapshots(first: 90, orderBy: timestamp, orderDirection: desc) {
    timestamp
    totalValueLockedUSD
    dailySupplySideRevenueUSD
    dailyProtocolSideRevenueUSD
  }
}`;

// --- Uniswap V2 native schema ---
//
// V2 has no fees field on either the factory or the daily snapshot. Every swap
// pays a flat 0.30% to LPs, so fees are derived from volume at query time.

const UNISWAP_V2_FEE_RATE = 0.003;
const UNISWAP_V2_FACTORY_ETH = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';

interface UniswapV2Data {
  uniswapFactory: {
    totalVolumeUSD: string;
    totalLiquidityUSD: string;
  } | null;
  uniswapDayDatas: Array<{
    date: string;
    dailyVolumeUSD: string;
    totalLiquidityUSD: string;
  }>;
}

const UNISWAP_V2_QUERY = `{
  uniswapFactory(id: "${UNISWAP_V2_FACTORY_ETH}") {
    totalVolumeUSD
    totalLiquidityUSD
  }
  uniswapDayDatas(first: 90, orderBy: date, orderDirection: desc) {
    date
    dailyVolumeUSD
    totalLiquidityUSD
  }
}`;

// --- Uniswap V3 native schema ---

interface UniswapV3Data {
  factories: Array<{
    totalVolumeUSD: string;
    totalValueLockedUSD: string;
    totalFeesUSD: string;
    txCount: string;
  }>;
  uniswapDayDatas: Array<{
    date: string;
    volumeUSD: string;
    feesUSD: string;
    tvlUSD: string;
  }>;
}

const UNISWAP_V3_QUERY = `{
  factories(first: 1) {
    totalVolumeUSD
    totalValueLockedUSD
    totalFeesUSD
    txCount
  }
  uniswapDayDatas(first: 90, orderBy: date, orderDirection: desc) {
    date
    volumeUSD
    feesUSD
    tvlUSD
  }
}`;

// --- Shared normalisation ---

function filterFeeOutliers(snapshots: ProtocolDaySnapshot[]): ProtocolDaySnapshot[] {
  if (snapshots.length < 3) return snapshots;
  const fees = snapshots.map((s) => s.feesUSD).sort((a, b) => a - b);
  const median = fees[Math.floor(fees.length / 2)];
  if (median === 0) return snapshots;
  return snapshots.filter((s) => s.feesUSD <= median * 50);
}

function computeSummary(
  slug: string,
  tvlUSD: number,
  cumulativeVolumeUSD: number,
  cumulativeFeesUSD: number,
  snapshots: ProtocolDaySnapshot[],
  extras: Partial<ProtocolSummary> = {},
): ProtocolSummary {
  const thirtyDaysAgo = Date.now() / 1000 - 30 * 86400;
  const recent = snapshots.filter((s) => s.timestamp >= thirtyDaysAgo);
  return {
    slug,
    tvlUSD,
    cumulativeVolumeUSD,
    cumulativeFeesUSD,
    volume30dUSD: recent.reduce((s, d) => s + d.volumeUSD, 0),
    fees30dUSD: recent.reduce((s, d) => s + d.feesUSD, 0),
    ...extras,
  };
}

function parseF(v: string | null | undefined): number {
  return parseFloat(v ?? '0') || 0;
}

// Some Messari subgraphs (Curve mainnet, certain Aave snapshots) leak unscaled
// integer values into USD fields, producing impossible numbers like 3.7e20.
// Anything north of $1 quadrillion (1e15) is a data-quality artefact, not a
// real protocol metric. Clamp it to a snapshot-derived fallback so the UI
// never renders "$ 376424613377.91B" and breaks card layout.
const SANE_USD_CEILING = 1e15;

function sanitizeCumulative(raw: number, snapshotSum: number): number {
  if (!Number.isFinite(raw) || raw < 0 || raw > SANE_USD_CEILING) {
    return Number.isFinite(snapshotSum) && snapshotSum >= 0 ? snapshotSum : 0;
  }
  return raw;
}

function normalizeMessariDex(slug: string, data: MessariDexData): ProtocolDetail {
  const p = data.dexAmmProtocols[0];
  const snapshots: ProtocolDaySnapshot[] = data.financialsDailySnapshots
    .map((s) => ({
      timestamp: parseInt(s.timestamp),
      tvlUSD: parseF(s.totalValueLockedUSD),
      volumeUSD: parseF(s.dailyVolumeUSD),
      feesUSD: parseF(s.dailyTotalRevenueUSD),
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

  const clean = filterFeeOutliers(snapshots);
  const snapshotVolumeSum = clean.reduce((acc, s) => acc + s.volumeUSD, 0);
  const snapshotFeesSum = clean.reduce((acc, s) => acc + s.feesUSD, 0);

  return {
    summary: computeSummary(
      slug,
      parseF(p?.totalValueLockedUSD),
      sanitizeCumulative(parseF(p?.cumulativeVolumeUSD), snapshotVolumeSum),
      sanitizeCumulative(parseF(p?.cumulativeTotalRevenueUSD), snapshotFeesSum),
      clean,
    ),
    snapshots: clean,
  };
}

function normalizeMessariLending(slug: string, data: MessariLendingData): ProtocolDetail {
  const p = data.lendingProtocols[0];
  const snapshots: ProtocolDaySnapshot[] = data.financialsDailySnapshots
    .map((s) => ({
      timestamp: parseInt(s.timestamp),
      tvlUSD: parseF(s.totalValueLockedUSD),
      volumeUSD: parseF(s.dailyBorrowUSD),
      feesUSD: parseF(s.dailyTotalRevenueUSD),
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

  const clean = filterFeeOutliers(snapshots);
  const snapshotVolumeSum = clean.reduce((acc, s) => acc + s.volumeUSD, 0);
  const snapshotFeesSum = clean.reduce((acc, s) => acc + s.feesUSD, 0);

  return {
    summary: computeSummary(
      slug,
      parseF(p?.totalValueLockedUSD),
      sanitizeCumulative(parseF(p?.cumulativeBorrowUSD), snapshotVolumeSum),
      sanitizeCumulative(parseF(p?.cumulativeTotalRevenueUSD), snapshotFeesSum),
      clean,
      { totalBorrowUSD: parseF(p?.totalBorrowBalanceUSD) },
    ),
    snapshots: clean,
  };
}

function normalizeMessariStaking(slug: string, data: MessariStakingData): ProtocolDetail {
  const p = data.protocols[0];

  // Estimate the daily fee from the cumulative protocol/supply-side ratio. Most
  // staking deployments leave dailyProtocolSideRevenueUSD at 0 even though the
  // cumulative is correct, so we back-derive it for a continuous fees chart.
  const cumulativeSupply = parseF(p?.cumulativeSupplySideRevenueUSD);
  const cumulativeProtocol = parseF(p?.cumulativeProtocolSideRevenueUSD);
  const protocolFeeRatio = cumulativeSupply > 0
    ? cumulativeProtocol / cumulativeSupply
    : 0;

  const snapshots: ProtocolDaySnapshot[] = data.financialsDailySnapshots
    .map((s) => {
      const supply = parseF(s.dailySupplySideRevenueUSD);
      const reportedProtocol = parseF(s.dailyProtocolSideRevenueUSD);
      // Use the reported daily fee if present, else estimate from the ratio.
      const fees = reportedProtocol > 0 ? reportedProtocol : supply * protocolFeeRatio;
      return {
        timestamp: parseInt(s.timestamp),
        tvlUSD: parseF(s.totalValueLockedUSD),
        volumeUSD: supply,
        feesUSD: fees,
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);

  const clean = filterFeeOutliers(snapshots);
  const snapshotVolumeSum = clean.reduce((acc, s) => acc + s.volumeUSD, 0);
  const snapshotFeesSum = clean.reduce((acc, s) => acc + s.feesUSD, 0);

  // Estimate APR from the most recent 30 days of supply-side revenue vs current TVL.
  const tvl = parseF(p?.totalValueLockedUSD);
  const last30 = clean.slice(-30);
  const last30Yield = last30.reduce((sum, d) => sum + d.volumeUSD, 0);
  const stakingAPR = tvl > 0 && last30.length > 0
    ? (last30Yield / tvl) * (365 / last30.length) * 100
    : 0;

  return {
    summary: computeSummary(
      slug,
      tvl,
      sanitizeCumulative(cumulativeSupply, snapshotVolumeSum),
      sanitizeCumulative(cumulativeProtocol, snapshotFeesSum),
      clean,
      { stakingAPR },
    ),
    snapshots: clean,
  };
}

function normalizeUniswapV2(slug: string, data: UniswapV2Data): ProtocolDetail {
  const f = data.uniswapFactory;
  const totalVolume = parseF(f?.totalVolumeUSD);
  const snapshots: ProtocolDaySnapshot[] = data.uniswapDayDatas
    .map((s) => {
      const volumeUSD = parseF(s.dailyVolumeUSD);
      return {
        timestamp: parseInt(s.date),
        tvlUSD: parseF(s.totalLiquidityUSD),
        volumeUSD,
        feesUSD: volumeUSD * UNISWAP_V2_FEE_RATE,
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);

  const clean = filterFeeOutliers(snapshots);
  return {
    summary: computeSummary(
      slug,
      parseF(f?.totalLiquidityUSD),
      totalVolume,
      totalVolume * UNISWAP_V2_FEE_RATE,
      clean,
    ),
    snapshots: clean,
  };
}

function normalizeUniswapV3(slug: string, data: UniswapV3Data): ProtocolDetail {
  const f = data.factories[0];
  const snapshots: ProtocolDaySnapshot[] = data.uniswapDayDatas
    .map((s) => ({
      timestamp: parseInt(s.date),
      tvlUSD: parseF(s.tvlUSD),
      volumeUSD: parseF(s.volumeUSD),
      feesUSD: parseF(s.feesUSD),
    }))
    .sort((a, b) => a.timestamp - b.timestamp);

  const clean = filterFeeOutliers(snapshots);
  return {
    summary: computeSummary(
      slug,
      parseF(f?.totalValueLockedUSD),
      parseF(f?.totalVolumeUSD),
      parseF(f?.totalFeesUSD),
      clean,
    ),
    snapshots: clean,
  };
}

// --- Public API ---

export async function fetchProtocolDetail(config: ProtocolConfig): Promise<ProtocolDetail> {
  switch (config.schemaType) {
    case 'messari-dex': {
      const data = await queryProtocolSubgraph<MessariDexData>(config.subgraphId, MESSARI_DEX_QUERY);
      return normalizeMessariDex(config.slug, data);
    }
    case 'messari-lending': {
      const data = await queryProtocolSubgraph<MessariLendingData>(config.subgraphId, MESSARI_LENDING_QUERY);
      return normalizeMessariLending(config.slug, data);
    }
    case 'messari-staking': {
      const data = await queryProtocolSubgraph<MessariStakingData>(config.subgraphId, MESSARI_STAKING_QUERY);
      return normalizeMessariStaking(config.slug, data);
    }
    case 'uniswap-v2': {
      const data = await queryProtocolSubgraph<UniswapV2Data>(config.subgraphId, UNISWAP_V2_QUERY);
      return normalizeUniswapV2(config.slug, data);
    }
    case 'uniswap-v3': {
      const data = await queryProtocolSubgraph<UniswapV3Data>(config.subgraphId, UNISWAP_V3_QUERY);
      return normalizeUniswapV3(config.slug, data);
    }
  }
}

export async function fetchProtocolSummary(config: ProtocolConfig): Promise<ProtocolSummary | null> {
  try {
    const detail = await fetchProtocolDetail(config);
    return detail.summary;
  } catch {
    return null;
  }
}
