import { NextRequest, NextResponse } from 'next/server';

const PROVIDER = 'http://167.235.29.213:7700';

export async function POST(request: NextRequest) {
  const { chainId = 42161, body, receipt } = await request.json();

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
