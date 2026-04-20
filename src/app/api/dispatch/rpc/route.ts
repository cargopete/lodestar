import { NextRequest, NextResponse } from 'next/server';

const GATEWAY = 'http://167.235.29.213:8080';

export async function POST(request: NextRequest) {
  const { chainId = 42161, body } = await request.json();

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
