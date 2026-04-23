import { NextRequest, NextResponse } from 'next/server';

const GATEWAY = process.env.DISPATCH_GATEWAY_URL ?? 'http://167.235.29.213:8080';

export async function GET(request: NextRequest) {
  const payer = request.nextUrl.searchParams.get('payer')?.toLowerCase();
  if (!payer) {
    return NextResponse.json({ error: 'payer query param required' }, { status: 400 });
  }
  const limit = request.nextUrl.searchParams.get('limit') ?? '100';

  let resp: Response;
  try {
    resp = await fetch(
      `${GATEWAY}/receipts?payer=${encodeURIComponent(payer)}&limit=${limit}`,
      { signal: AbortSignal.timeout(5_000), cache: 'no-store' },
    );
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }

  if (!resp.ok) {
    return NextResponse.json({ error: `gateway returned ${resp.status}` }, { status: 502 });
  }

  const data = await resp.json();
  return NextResponse.json(data);
}
