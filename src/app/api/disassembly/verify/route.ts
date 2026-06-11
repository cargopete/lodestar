import { NextResponse, type NextRequest } from 'next/server';
import { cached } from '@/lib/cache';
import { runDisassembly } from '@/lib/disassembly';
import { ipfsCatBytes, IPFS_HASH_RE } from '@/lib/disassembly/ipfs';
import { buildSubgraphInSandbox } from '@/lib/disassembly/build-sandbox';
import { compareBuild, type NamedModule } from '@/lib/disassembly/verify';
import { verifyRateLimit } from '@/lib/disassembly/verify-limit';
import { clientIp, hashIp } from '@/lib/scuttlebutt-ip';
import { log } from '@/lib/logger';

// The sandbox build is the slow part — give the function room.
export const runtime = 'nodejs';
export const maxDuration = 300;

const TTL = 7 * 24 * 60 * 60; // 7 days — immutable static analysis

// Only build from well-known public git hosts: keeps this off internal hosts
// (SSRF) and bounds the abuse surface. The build itself runs untrusted code, but
// inside the disposable sandbox.
const ALLOWED_HOSTS = new Set(['github.com', 'gitlab.com', 'bitbucket.org']);

function validateRepo(repoUrl: unknown): string | null {
  if (typeof repoUrl !== 'string' || repoUrl.length > 300) return null;
  let u: URL;
  try {
    u = new URL(repoUrl);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  if (!ALLOWED_HOSTS.has(u.hostname)) return null;
  return u.toString();
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const deploymentId = body?.deploymentId;
  const repoUrl = validateRepo(body?.repoUrl);
  const ref = typeof body?.ref === 'string' && body.ref.length <= 200 ? body.ref : undefined;
  const manifestPath =
    typeof body?.manifestPath === 'string' && body.manifestPath.length <= 200 && !body.manifestPath.includes('..')
      ? body.manifestPath
      : undefined;

  if (!deploymentId || !IPFS_HASH_RE.test(deploymentId)) {
    return NextResponse.json({ error: 'Invalid deployment ID (expected a CIDv0 Qm… hash)' }, { status: 400 });
  }
  if (!repoUrl) {
    return NextResponse.json(
      { error: 'repoUrl must be an https URL on github.com, gitlab.com, or bitbucket.org' },
      { status: 400 },
    );
  }

  // Gate the expensive sandbox build behind a cross-instance rate limit.
  const rl = await verifyRateLimit(hashIp(clientIp(request)), Date.now());
  if (!rl.allowed) {
    return NextResponse.json({ error: rl.reason }, { status: 429 });
  }

  try {
    // Deployed side (cached, shared with the rest of the disassembly surface).
    const report = await cached(`lodestar:disasm:v1:${deploymentId}`, TTL, () => runDisassembly(deploymentId));

    // Build the source in a disposable sandbox.
    const build = await buildSubgraphInSandbox({ repoUrl, ref, manifestPath });
    if (!build.ok) {
      return NextResponse.json({
        data: {
          verdict: 'unbuildable',
          comparison: null,
          build: { error: build.error, log: build.log, durationMs: build.durationMs },
        },
      });
    }

    // Fetch the deployed wasm bytes once per unique hash, then map per data source.
    const byHash = new Map<string, Uint8Array>();
    await Promise.all(
      [...new Set(report.dataSources.map((d) => d.wasmHash).filter((h): h is string => !!h))].map(async (hash) => {
        try {
          byHash.set(hash, await ipfsCatBytes(hash));
        } catch {
          /* leave unmapped — surfaces as only-built/missing in the verdict */
        }
      }),
    );
    const deployed: NamedModule[] = report.dataSources
      .filter((d) => d.wasmHash && byHash.has(d.wasmHash))
      .map((d) => ({ name: d.name, bytes: byHash.get(d.wasmHash!)! }));

    const comparison = compareBuild(build.modules, deployed);

    return NextResponse.json({
      data: {
        verdict: comparison.verdict,
        comparison,
        build: { log: build.log, durationMs: build.durationMs, moduleCount: build.modules.length },
      },
    });
  } catch (error) {
    log.api.error({ err: error, deploymentId, repoUrl }, 'Subgraph verify error');
    const message = error instanceof Error ? error.message : 'Verification failed';
    const status = /manifest|deployment ID|IPFS gateway|WebAssembly/i.test(message) ? 422 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
