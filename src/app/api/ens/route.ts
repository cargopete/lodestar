import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { ensQuery, hasSubgraphAccess } from '@/lib/subgraph';

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get('address')?.toLowerCase();
  if (!address) {
    return NextResponse.json({ error: 'address required' }, { status: 400 });
  }
  if (!/^0x[0-9a-f]{40}$/.test(address)) {
    return NextResponse.json({ ensName: null });
  }

  // Not "this address has no ENS name" — we could not look. `ensName: null` at 200 is
  // indistinguishable from a genuine absence, which is the fault #28 fixed next door (#36).
  // useENSName already falls back to null on a non-OK response, so nothing on screen changes.
  if (!hasSubgraphAccess()) {
    return NextResponse.json({ error: 'No API key configured' }, { status: 503 });
  }

  try {
    const data = await cached(`ens:${address}`, 86400, async () => {
      const result = await ensQuery<{ domains: Array<{ name: string }> }>(`{
        domains(first: 5, where: { resolvedAddress: "${address}", name_not: null }) {
          name
        }
      }`);
      // Prefer shortest .eth name (primary over subdomains)
      const names = result.domains.map((d) => d.name).sort((a, b) => a.length - b.length);
      return { ensName: names[0] ?? null };
    });

    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=172800' },
    });
  } catch {
    // Same distinction as the guard above: a failed lookup is not an absent name.
    return NextResponse.json({ error: 'ENS lookup failed' }, { status: 503 });
  }
}
