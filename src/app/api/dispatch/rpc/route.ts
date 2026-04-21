import { NextRequest, NextResponse } from 'next/server';

const GATEWAY = process.env.DISPATCH_GATEWAY_URL ?? 'http://167.235.29.213:8080';

export async function POST(request: NextRequest) {
  const { chainId: rawChainId = 42161, body } = await request.json();
  const chainId = Number(rawChainId);
  if (!Number.isFinite(chainId) || chainId <= 0 || !Number.isInteger(chainId)) {
    return NextResponse.json({ error: 'Invalid chainId' }, { status: 400 });
  }

  let resp: Response;
  try {
    resp = await fetch(`${GATEWAY}/rpc/${chainId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }

  const data = await resp.json();
  const attestation = resp.headers.get('x-drpc-attestation');

  return NextResponse.json({ data, attestation });
}
