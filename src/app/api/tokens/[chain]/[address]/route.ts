import { NextResponse } from 'next/server';
import { cachedSwr } from '@/lib/cache';
import { fetchTokenDetail } from '@/lib/tokens/fetcher';

// Pin to Node runtime: the fetcher transitively uses viem's HTTP transport
// for `eth_getCode` calls, which is Node-only.
export const runtime = 'nodejs';

const SUPPORTED_CHAINS = new Set(['mainnet']);
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

interface Ctx {
  params: Promise<{ chain: string; address: string }>;
}

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { chain, address } = await params;
    // Validate at the boundary so unknown chains and malformed addresses
    // can't poison the cache or fan out wasted upstream requests.
    if (!SUPPORTED_CHAINS.has(chain)) {
      return NextResponse.json({ error: `unsupported chain: ${chain}` }, { status: 400 });
    }
    if (!ADDRESS_RE.test(address)) {
      return NextResponse.json({ error: 'invalid contract address' }, { status: 400 });
    }
    const key = `lodestar:tokens:detail:v0:${chain}:${address.toLowerCase()}`;
    const data = await cachedSwr(key, 600, () => fetchTokenDetail(chain, address));
    if (!data) return NextResponse.json({ error: 'token not in v0 seed list' }, { status: 404 });
    return NextResponse.json(
      { data },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' } }
    );
  } catch (error) {
    console.error('[tokens detail]', error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
