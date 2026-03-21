import { NextRequest, NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { ensQuery, hasSubgraphAccess } from '@/lib/subgraph';

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get('address')?.toLowerCase();
  if (!address) {
    return NextResponse.json({ error: 'address required' }, { status: 400 });
  }

  if (!hasSubgraphAccess()) {
    return NextResponse.json({ ensName: null });
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
    return NextResponse.json({ ensName: null });
  }
}
