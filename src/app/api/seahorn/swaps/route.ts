import { NextRequest, NextResponse } from 'next/server';

export const revalidate = 5;

const GATEWAY = process.env.DISPATCH_GATEWAY_URL ?? 'http://167.235.29.213:8080';

const USDY  = 'A1KLoBrKBde8Ty9qtNQUtq3C2ortoC3u7twggz7sEto6';
const PYUSD = '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo';
const RWA_OR = `or=(fields->>source_mint.eq.${USDY},fields->>destination_mint.eq.${USDY},fields->>source_mint.eq.${PYUSD},fields->>destination_mint.eq.${PYUSD})`;

export async function GET(request: NextRequest) {
  const limit = request.nextUrl.searchParams.get('limit') ?? '25';
  const rwa   = request.nextUrl.searchParams.get('rwa') === '1';

  let resp: Response;
  try {
    resp = await fetch(
      `${GATEWAY}/solana/entity_changes?entity_type=eq.JupiterSwap&order=slot.desc&limit=${limit}${rwa ? `&${RWA_OR}` : ''}`,
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
