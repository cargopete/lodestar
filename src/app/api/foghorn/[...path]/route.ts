import { NextRequest, NextResponse } from 'next/server';

const FOGHORN_API_URL = process.env.FOGHORN_API_URL ?? '';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  if (!FOGHORN_API_URL) {
    return NextResponse.json({ error: 'Foghorn API not configured' }, { status: 503 });
  }

  const { path } = await params;
  const url = new URL(request.url);
  const target = `${FOGHORN_API_URL}/v1/${path.join('/')}${url.search}`;

  try {
    const response = await fetch(target, {
      headers: { 'Accept': 'application/json' },
      next: { revalidate: 0 },
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ error: 'Foghorn API unreachable' }, { status: 502 });
  }
}
