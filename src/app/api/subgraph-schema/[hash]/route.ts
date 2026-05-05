import { NextResponse, type NextRequest } from 'next/server';
import { cached } from '@/lib/cache';
import { log } from '@/lib/logger';

const IPFS_HASH_RE = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;
const IPFS_GATEWAY = 'https://ipfs.network.thegraph.com/api/v0/cat';

async function fetchIpfsText(hash: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${IPFS_GATEWAY}?arg=${hash}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`IPFS gateway ${res.status} for ${hash}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

function extractSchemaHash(manifestYaml: string): string | null {
  // Matches both /ipfs/QmHASH and bare QmHASH after "file:" in schema section
  const m = manifestYaml.match(/schema[\s\S]*?\/ipfs\/(Qm[1-9A-HJ-NP-Za-km-z]{44})/);
  if (m) return m[1];
  // Fallback: look for the first QmHASH after "schema:"
  const schemaSection = manifestYaml.split(/\bdataSources\b/)[0];
  const m2 = schemaSection.match(/(Qm[1-9A-HJ-NP-Za-km-z]{44})/);
  return m2 ? m2[1] : null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ hash: string }> },
) {
  const { hash } = await params;

  if (!IPFS_HASH_RE.test(hash)) {
    return NextResponse.json({ error: 'Invalid deployment hash' }, { status: 400 });
  }

  try {
    const data = await cached(`lodestar:schema-text:v1:${hash}`, 86400, async () => {
      const manifestYaml = await fetchIpfsText(hash);
      const schemaHash = extractSchemaHash(manifestYaml);
      if (!schemaHash) return null;
      const schemaText = await fetchIpfsText(schemaHash);
      return { schemaText, schemaHash };
    });

    if (!data) {
      return NextResponse.json({ error: 'Schema not found in manifest' }, { status: 404 });
    }

    return NextResponse.json({ data }, {
      headers: { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=172800' },
    });
  } catch (error) {
    log.api.error({ err: error, hash }, 'Subgraph schema fetch error');
    return NextResponse.json({ error: 'Failed to fetch schema' }, { status: 500 });
  }
}
