import { NextResponse } from 'next/server';
import { cached } from '@/lib/cache';
import { getProtocol } from '@/lib/protocols/config';
import { fetchProtocolDetail } from '@/lib/protocols/fetcher';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const config = getProtocol(slug);

  if (!config) {
    return NextResponse.json({ error: 'Protocol not found' }, { status: 404 });
  }

  try {
    const data = await cached(`lodestar:protocols:${slug}`, 3600, () =>
      fetchProtocolDetail(config)
    );

    return NextResponse.json({ data }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
    });
  } catch (error) {
    console.error(`Protocol detail error for ${slug}:`, error);
    return NextResponse.json({ error: 'Failed to fetch protocol data' }, { status: 500 });
  }
}
