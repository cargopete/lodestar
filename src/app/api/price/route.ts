import { NextResponse } from 'next/server';

const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=the-graph&vs_currencies=usd&include_24hr_change=true';

const DEFILLAMA_URL =
  'https://coins.llama.fi/prices/current/coingecko:the-graph';

let cachedPrice: { price: number; change24h: number; timestamp: number } | null = null;
const CACHE_DURATION = 60 * 1000; // 60 seconds

async function fetchFromCoinGecko(): Promise<{ price: number; change24h: number } | null> {
  try {
    const response = await fetch(COINGECKO_URL, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const data = await response.json();
    const price = data['the-graph']?.usd ?? 0;
    const change24h = data['the-graph']?.usd_24h_change ?? 0;
    if (price > 0) return { price, change24h };
    return null;
  } catch {
    return null;
  }
}

async function fetchFromDefiLlama(): Promise<{ price: number; change24h: number } | null> {
  try {
    const response = await fetch(DEFILLAMA_URL, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const data = await response.json();
    const coin = data.coins?.['coingecko:the-graph'];
    if (!coin?.price) return null;
    return { price: coin.price, change24h: 0 };
  } catch {
    return null;
  }
}

export async function GET() {
  // Return cached price if still valid
  if (cachedPrice && Date.now() - cachedPrice.timestamp < CACHE_DURATION) {
    return NextResponse.json({
      price: cachedPrice.price,
      change24h: cachedPrice.change24h,
    });
  }

  // Try CoinGecko first (has 24h change), fall back to DefiLlama
  const result = (await fetchFromCoinGecko()) ?? (await fetchFromDefiLlama());

  if (result) {
    cachedPrice = { ...result, timestamp: Date.now() };
    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
      },
    });
  }

  // Both failed — return stale cache or null price
  if (cachedPrice) {
    return NextResponse.json({
      price: cachedPrice.price,
      change24h: cachedPrice.change24h,
    });
  }

  return NextResponse.json({ price: null, change24h: null });
}
