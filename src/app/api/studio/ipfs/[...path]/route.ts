/**
 * IPFS API proxy for `graph deploy`.
 *
 * graph-cli uploads subgraph artifacts (WASM, manifest) here before calling
 * subgraph_deploy. We validate the deploy key then forward to GRAPH_IPFS_URL.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { hashKey } from '@/lib/studio/auth';
import { hasDbAccess } from '@/lib/db';
import { findOwnerByKeyHash } from '@/lib/studio/db';

function ipfsUrl(): string {
  const u = process.env.GRAPH_IPFS_URL;
  if (!u) throw new Error('GRAPH_IPFS_URL not configured');
  return u.replace(/\/$/, '');
}

async function extractBearerKey(req: NextRequest): Promise<string | null> {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  return auth.slice(7).trim() || null;
}

async function proxy(req: NextRequest, pathSegments: string[]) {
  if (!hasDbAccess()) return new NextResponse('DB unavailable', { status: 503 });

  const plainKey = await extractBearerKey(req);
  if (!plainKey) return new NextResponse('Missing deploy key', { status: 401 });

  const owner = await findOwnerByKeyHash(hashKey(plainKey));
  if (!owner) return new NextResponse('Invalid deploy key', { status: 401 });

  const path = pathSegments.join('/');
  const qs = req.nextUrl.search;
  const target = `${ipfsUrl()}/${path}${qs}`;

  const headers = new Headers(req.headers);
  headers.delete('host');
  headers.delete('authorization');

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? req.body : undefined,
      // @ts-expect-error — Node fetch needs duplex for streaming body
      duplex: 'half',
    });
  } catch (err) {
    return new NextResponse(`Cannot reach IPFS: ${err}`, { status: 502 });
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: upstream.headers,
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxy(req, path);
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxy(req, path);
}
