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

// --- Uniswap V3 native schema ---

interface UniswapV3Data {
  factories: Array<{
    totalVolumeUSD: string;
    totalValueLockedUSD: string;
    totalFeesUSD: string;
    txCount: string;
  }>;
  uniswapDayDatas: Array<{
    date: string; // unix timestamp seconds (start of day)
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

function computeSummary(
  slug: string,
  tvlUSD: number,
  cumulativeVolumeUSD: number,
  cumulativeFeesUSD: number,
  snapshots: ProtocolDaySnapshot[],
  totalBorrowUSD?: number,
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
    totalBorrowUSD,
  };
}

function parseF(v: string | null | undefined): number {
  return parseFloat(v ?? '0') || 0;
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

  return {
    summary: computeSummary(
      slug,
      parseF(p?.totalValueLockedUSD),
      parseF(p?.cumulativeVolumeUSD),
      parseF(p?.cumulativeTotalRevenueUSD),
      snapshots,
    ),
    snapshots,
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

  return {
    summary: computeSummary(
      slug,
      parseF(p?.totalValueLockedUSD),
      parseF(p?.cumulativeBorrowUSD),
      parseF(p?.cumulativeTotalRevenueUSD),
      snapshots,
      parseF(p?.totalBorrowBalanceUSD),
    ),
    snapshots,
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

  return {
    summary: computeSummary(
      slug,
      parseF(f?.totalValueLockedUSD),
      parseF(f?.totalVolumeUSD),
      parseF(f?.totalFeesUSD),
      snapshots,
    ),
    snapshots,
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
