// Subgraph Disassembly — source-repo hint (auto-resolve, Phase 2 polish).
//
// A subgraph's on-chain metadata usually records its codeRepository. We surface
// it so the "Verify against source" box can pre-fill the repo URL — turning
// verification from "go find the repo" into one click. Best-effort: returns null
// when the gateway is unavailable or the field is absent.

import { subgraphQuery, hasSubgraphAccess } from '@/lib/subgraph';
import { hasNuthatch, nuthatchEnabled } from '@/lib/nuthatch';
import { subgraphMetadataForDeployments } from '@/lib/subgraph-metadata';
import { ipfsHashToBytes32 } from '@/lib/studio/ipfs';
import type { SourceHint } from './types';

interface RawMeta {
  versions: Array<{ subgraph: { metadata: { codeRepository: string | null; website: string | null } | null } | null }>;
}

export async function fetchSourceHint(deploymentId: string): Promise<SourceHint | null> {
  // Behind NUTHATCH_SUBGRAPHS (nuthatch#1160) the metadata comes from graph-gns-nest and IPFS.
  if (nuthatchEnabled('NUTHATCH_SUBGRAPHS') && hasNuthatch()) {
    try {
      const id = ipfsHashToBytes32(deploymentId).toLowerCase();
      const meta = (await subgraphMetadataForDeployments([id])).get(id)?.metadata;
      if (!meta) return null;
      return { codeRepository: meta.codeRepository ?? null, website: meta.website ?? null };
    } catch {
      return null;
    }
  }
  if (!hasSubgraphAccess()) return null;

  const query = `{
    subgraphDeployments(where: { ipfsHash: "${deploymentId}" }, first: 1) {
      versions(first: 1, orderBy: createdAt, orderDirection: desc) {
        subgraph { metadata { codeRepository website } }
      }
    }
  }`;

  try {
    const res = await subgraphQuery<{ subgraphDeployments: RawMeta[] }>(query);
    const meta = res.subgraphDeployments?.[0]?.versions?.[0]?.subgraph?.metadata;
    if (!meta) return null;
    return { codeRepository: meta.codeRepository ?? null, website: meta.website ?? null };
  } catch {
    return null;
  }
}
