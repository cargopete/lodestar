import { NextResponse } from 'next/server';
import { cached } from '@/lib/cache';

const DEFILLAMA_URL = 'https://api.llama.fi/protocol/the-graph';

async function fetchTVLFromDefiLlama(): Promise<number> {
  const response = await fetch(DEFILLAMA_URL, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new Error(`DefiLlama request failed: ${response.status}`);
  }

  const data = await response.json();

  if (data.currentChainTvls?.staking !== undefined) {
    return data.currentChainTvls.staking;
  } else if (data.currentChainTvls?.total !== undefined) {
    return data.currentChainTvls.total;
  } else if (typeof data.tvl === 'number') {
    return data.tvl;
  } else if (data.chainTvls) {
    const stakingKeys = Object.keys(data.chainTvls).filter(k => k.includes('staking'));
    if (stakingKeys.length > 0) {
      return stakingKeys.reduce((sum, key) => {
        const chainData = data.chainTvls[key];
        if (Array.isArray(chainData?.tvl) && chainData.tvl.length > 0) {
          const latest = chainData.tvl[chainData.tvl.length - 1];
          return sum + (latest?.totalLiquidityUSD ?? 0);
        }
        return sum;
      }, 0);
    }
  }

  return 0;
}

export async function GET() {
  try {
    const tvl = await cached('lodestar:tvl', 300, fetchTVLFromDefiLlama);

    return NextResponse.json(
      { tvl },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        },
      }
    );
  } catch (error) {
    console.error('TVL proxy error:', error);
    return NextResponse.json({ error: 'Failed to fetch TVL', tvl: 0 }, { status: 500 });
  }
}
