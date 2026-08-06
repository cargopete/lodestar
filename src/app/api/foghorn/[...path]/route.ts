import { NextRequest, NextResponse } from 'next/server';

const FOGHORN_API_URL = process.env.FOGHORN_API_URL ?? '';

/**
 * Path segments are pasted into the upstream URL, and `fetch` normalises `..`
 * before sending. Without this an encoded `%2e%2e` segment would walk back out
 * of the `/v1/` prefix and reach anything else the internal service exposes.
 */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

function hasUnsafeSegment(path: string[]): boolean {
  return path.some((s) => !SAFE_SEGMENT.test(s) || s === '.' || s === '..');
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  if (!FOGHORN_API_URL) {
    return NextResponse.json({ error: 'Foghorn API not configured' }, { status: 503 });
  }

  const { path } = await params;
  if (hasUnsafeSegment(path)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }
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

/**
 * POST, needed because the oracle-compatible GraphQL endpoint is a POST.
 *
 * Without this the "repoint your existing QoS query at us" claim is false: every GraphQL client
 * POSTs. Kept deliberately narrow — GraphQL is the only POST surface Foghorn exposes, and
 * forwarding arbitrary POSTs to an internal service is not something to do by accident.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  if (!FOGHORN_API_URL) {
    return NextResponse.json({ error: 'Foghorn API not configured' }, { status: 503 });
  }

  const { path } = await params;
  const joined = path.join('/');
  if (joined !== 'qos/graphql') {
    return NextResponse.json({ error: 'Not a POST endpoint' }, { status: 405 });
  }

  const url = new URL(request.url);
  const target = `${FOGHORN_API_URL}/v1/${joined}${url.search}`;

  try {
    const response = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: await request.text(),
      next: { revalidate: 0 },
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ error: 'Foghorn API unreachable' }, { status: 502 });
  }
}
