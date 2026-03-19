import { NextResponse } from 'next/server';

const DEFILLAMA_URL = 'https://api.llama.fi/protocol/the-graph';

// Cache the TVL for 5 minutes
let cachedTVL: { tvl: number; timestamp: number } | null = null;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export async function GET() {
  try {
    // Return cached TVL if still valid
    if (cachedTVL && Date.now() - cachedTVL.timestamp < CACHE_DURATION) {
      return NextResponse.json({ tvl: cachedTVL.tvl });
    }

    const response = await fetch(DEFILLAMA_URL, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      // If rate limited, return cached data
      if (cachedTVL) {
        return NextResponse.json({ tvl: cachedTVL.tvl });
      }
      throw new Error(`DefiLlama request failed: ${response.status}`);
    }

    const data = await response.json();

    // Get the latest TVL from the response - The Graph's TVL is in staking
    let tvl = 0;
    if (data.currentChainTvls?.staking !== undefined) {
      // The Graph reports staking TVL separately
      tvl = data.currentChainTvls.staking;
    } else if (data.currentChainTvls?.total !== undefined) {
      tvl = data.currentChainTvls.total;
    } else if (typeof data.tvl === 'number') {
      tvl = data.tvl;
    } else if (data.chainTvls) {
      // Sum staking TVLs from all chains
      const stakingKeys = Object.keys(data.chainTvls).filter(k => k.includes('staking'));
      if (stakingKeys.length > 0) {
        tvl = stakingKeys.reduce((sum, key) => {
          const chainData = data.chainTvls[key];
          if (Array.isArray(chainData?.tvl) && chainData.tvl.length > 0) {
            const latest = chainData.tvl[chainData.tvl.length - 1];
            return sum + (latest?.totalLiquidityUSD ?? 0);
          }
          return sum;
        }, 0);
      }
    }

    // Update cache
    cachedTVL = {
      tvl,
      timestamp: Date.now(),
    };

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

    // Return cached TVL on error if available
    if (cachedTVL) {
      return NextResponse.json({ tvl: cachedTVL.tvl });
    }

    return NextResponse.json({ error: 'Failed to fetch TVL', tvl: 0 }, { status: 500 });
  }
}
