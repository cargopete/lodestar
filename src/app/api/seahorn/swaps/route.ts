import { NextRequest, NextResponse } from 'next/server';

export const revalidate = 5;

const GATEWAY = process.env.DISPATCH_GATEWAY_URL ?? 'http://167.235.29.213:8080';

const RWA_MINTS = new Set([
  'A1KLoBrKBde8Ty9qtNQUtq3C2ortoC3u7twggz7sEto6', // USDY
  '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo', // PYUSD
]);

interface SwapRow {
  fields?: { source_mint?: string; destination_mint?: string } | null;
}

function isRwa(row: SwapRow): boolean {
  return RWA_MINTS.has(row.fields?.source_mint ?? '') ||
         RWA_MINTS.has(row.fields?.destination_mint ?? '');
}

export async function GET(request: NextRequest) {
  const limitParam = Number(request.nextUrl.searchParams.get('limit') ?? '25');
  const rwa = request.nextUrl.searchParams.get('rwa') === '1';

  // For RWA queries, fetch a large batch and filter server-side (PostgREST
  // JSON sub-field OR filters are not reliably supported on this gateway).
  const fetchLimit = rwa ? 2000 : limitParam;

  let resp: Response;
  try {
    resp = await fetch(
      `${GATEWAY}/solana/entity_changes?entity_type=eq.JupiterSwap&order=slot.desc&limit=${fetchLimit}`,
      {
        signal: AbortSignal.timeout(10_000),
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

  let data: SwapRow[] = await resp.json();

  if (rwa) {
    data = data.filter(isRwa).slice(0, limitParam);
  }

  return NextResponse.json(data);
}
