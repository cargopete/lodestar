import { NextRequest, NextResponse } from 'next/server';

export const revalidate = 5;

const GATEWAY = process.env.DISPATCH_GATEWAY_URL ?? 'http://167.235.29.213:8080';

export async function GET(request: NextRequest) {
  const limit = request.nextUrl.searchParams.get('limit') ?? '25';

  let resp: Response;
  try {
    resp = await fetch(
      `${GATEWAY}/solana/entity_changes?entity_type=eq.JupiterSwap&order=slot.desc&limit=${limit}`,
      {
        signal: AbortSignal.timeout(5_000),
        headers: { Accept: 'application/json' },
        next: { revalidate: 5 },
      }
    );
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }

  if (!resp.ok) {
    return NextResponse.json({ error: `upstream returned ${resp.status}` }, { status: 502 });
  }

  const data = await resp.json();
  return NextResponse.json(data);
}
