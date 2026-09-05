import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { resolveEnsName } from '@/lib/ens';

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get('address')?.toLowerCase();
  if (!address) {
    return NextResponse.json({ error: 'address required' }, { status: 400 });
  }
  if (!/^0x[0-9a-f]{40}$/.test(address)) {
    return NextResponse.json({ ensName: null });
  }

  try {
    const data = await cached(`ens:${address}`, 86400, async () => {
      // The primary (reverse) name over a mainnet RPC; no Graph key involved (nuthatch#1160).
      return { ensName: await resolveEnsName(address) };
    });

    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=172800' },
    });
  } catch {
    // Same distinction as the guard above: a failed lookup is not an absent name.
    return NextResponse.json({ error: 'ENS lookup failed' }, { status: 503 });
  }
}
