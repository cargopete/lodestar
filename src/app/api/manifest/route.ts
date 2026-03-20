import { NextResponse, type NextRequest } from 'next/server';
import { cached } from '@/lib/cache';
import { parseManifest } from '@/lib/manifest';

const IPFS_HASH_RE = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;
const IPFS_GATEWAY = 'https://ipfs.network.thegraph.com/api/v0/cat';

export async function GET(request: NextRequest) {
  const hash = request.nextUrl.searchParams.get('hash');

  if (!hash || !IPFS_HASH_RE.test(hash)) {
    return NextResponse.json(
      { error: 'Invalid IPFS hash. Expected CIDv0 format (Qm...)' },
      { status: 400 },
    );
  }

  try {
    const analysis = await cached(`lodestar:manifest:${hash}`, 86400, async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      try {
        const res = await fetch(`${IPFS_GATEWAY}?arg=${hash}`, {
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`IPFS gateway returned ${res.status}`);
        }

        const yamlString = await res.text();

        // Validate it's actually a manifest
        if (!yamlString.includes('dataSources') && !yamlString.includes('specVersion')) {
          throw new Error('Response does not appear to be a subgraph manifest');
        }

        return parseManifest(yamlString);
      } finally {
        clearTimeout(timeout);
      }
    });

    return NextResponse.json({ data: analysis }, {
      headers: {
        'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=172800',
      },
    });
  } catch (error) {
    console.error(`Manifest analysis error for ${hash}:`, error);
    return NextResponse.json(
      { error: 'Failed to fetch or parse manifest' },
      { status: 500 },
    );
  }
}
