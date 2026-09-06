// Subgraph Disassembly — source-repo hint (auto-resolve, Phase 2 polish).
//
// A subgraph's on-chain metadata usually records its codeRepository. We surface
// it so the "Verify against source" box can pre-fill the repo URL — turning
// verification from "go find the repo" into one click. Best-effort: returns null
// when the gateway is unavailable or the field is absent.

import { hasNuthatch } from '@/lib/nuthatch';
import { subgraphMetadataForDeployments } from '@/lib/subgraph-metadata';
import { ipfsHashToBytes32 } from '@/lib/studio/ipfs';
import type { SourceHint } from './types';

export async function fetchSourceHint(deploymentId: string): Promise<SourceHint | null> {
  // From the nest, always (nuthatch#1160); the gateway path this once fell back to left with the key.
  if (!hasNuthatch()) return null;
  try {
    const id = ipfsHashToBytes32(deploymentId).toLowerCase();
    const meta = (await subgraphMetadataForDeployments([id])).get(id)?.metadata;
    if (!meta) return null;
    return { codeRepository: meta.codeRepository ?? null, website: meta.website ?? null };
  } catch {
    return null;
  }
}
