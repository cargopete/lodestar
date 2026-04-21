import { NextRequest, NextResponse } from 'next/server';

const PROVIDER = process.env.DISPATCH_PROVIDER_URL ?? 'http://167.235.29.213:7700';

export async function POST(request: NextRequest) {
  const { chainId: rawChainId = 42161, body, receipt } = await request.json();
  const chainId = Number(rawChainId);
  if (!Number.isFinite(chainId) || chainId <= 0 || !Number.isInteger(chainId)) {
    return NextResponse.json({ error: 'Invalid chainId' }, { status: 400 });
  }

  let resp: Response;
  try {
    resp = await fetch(`${PROVIDER}/rpc/${chainId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'TAP-Receipt': receipt,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }

  const data = await resp.json();
  const attestation = resp.headers.get('x-drpc-attestation') ?? resp.headers.get('x-dispatch-attestation');

  return NextResponse.json({ data, attestation });
}
