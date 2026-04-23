import { NextRequest, NextResponse } from 'next/server';

export const revalidate = 2;

const GATEWAY = process.env.DISPATCH_GATEWAY_URL ?? 'http://167.235.29.213:8080';

export async function GET(request: NextRequest) {
  const limit = request.nextUrl.searchParams.get('limit') ?? '20';

  let resp: Response;
  try {
    resp = await fetch(`${GATEWAY}/receipts/recent?limit=${limit}`, {
      signal: AbortSignal.timeout(5_000),
      next: { revalidate: 2 },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }

  if (!resp.ok) {
    return NextResponse.json({ error: `gateway returned ${resp.status}` }, { status: 502 });
  }

  const data = await resp.json();
  return NextResponse.json(data);
}
