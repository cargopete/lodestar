/**
 * Upload subgraph + version metadata to IPFS and return bytes32 hashes.
 * Called server-side by the Publish Wizard before invoking GNS.publishNewSubgraph.
 */
import { type NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/studio/auth';
import { uploadJsonToIpfs, ipfsHashToBytes32 } from '@/lib/studio/ipfs';

export async function POST(req: NextRequest) {
  const auth = requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({}));
  const { displayName = '', description = '', versionLabel = 'v0.0.1' } = body;

  const [subgraphMetaHash, versionMetaHash] = await Promise.all([
    uploadJsonToIpfs({
      description: description ?? '',
      displayName: displayName ?? '',
      image: '',
      codeRepository: '',
      website: '',
    }),
    uploadJsonToIpfs({
      label: versionLabel,
      description: '',
    }),
  ]);

  if (!subgraphMetaHash || !versionMetaHash) {
    return NextResponse.json({ error: 'IPFS upload failed' }, { status: 502 });
  }

  return NextResponse.json({
    subgraphMetaHash,
    versionMetaHash,
    subgraphMetaBytes32: ipfsHashToBytes32(subgraphMetaHash),
    versionMetaBytes32: ipfsHashToBytes32(versionMetaHash),
  });
}
