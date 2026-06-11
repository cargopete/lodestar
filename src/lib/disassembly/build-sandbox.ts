// Subgraph Disassembly — sandboxed source builder (Phase 2).
//
// Clones a subgraph's git source into an ephemeral Vercel Sandbox (Firecracker
// microVM), installs deps with the repo's own pinned toolchain, runs
// `graph codegen` + `graph build`, and reads the produced WASM back out. The
// build runs untrusted code, so it stays inside the disposable VM and the
// process here only ever sees the resulting bytes + logs.
//
// Not exercised by unit tests — it needs a live Vercel Sandbox (OIDC). The pure
// comparison of its output lives in verify.ts and is fully tested.

import { parse as parseYaml } from 'yaml';
import { log } from '@/lib/logger';

export interface BuildInput {
  /** https git URL */
  repoUrl: string;
  /** branch / tag / commit; defaults to the repo's default branch */
  ref?: string;
  /** path to the subgraph manifest within the repo; defaults to subgraph.yaml */
  manifestPath?: string;
}

export interface BuildResult {
  ok: boolean;
  status: 'built' | 'unbuildable';
  modules: { name: string; bytes: Uint8Array }[];
  log: string;
  error?: string;
  durationMs: number;
}

const SANDBOX_TIMEOUT_MS = 240_000;
const MAX_LOG_CHARS = 24_000;
const MAX_MODULES = 60;

// Minimal structural typing over the @vercel/sandbox SDK so we're resilient to
// small SDK signature shifts and don't hard-couple types.
interface CmdResult {
  exitCode?: number;
  stdout(): Promise<string>;
  stderr?(): Promise<string>;
}
interface SandboxLike {
  runCommand(cmd: string, args: string[]): Promise<CmdResult>;
  stop(): Promise<unknown>;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** POSIX single-quote a shell argument. */
function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function posixDirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '' : p.slice(0, i);
}
function posixBasename(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? p : p.slice(i + 1);
}

function clip(s: string): string {
  return s.length > MAX_LOG_CHARS ? `${s.slice(0, MAX_LOG_CHARS)}\n…[log truncated]` : s;
}

export async function buildSubgraphInSandbox(input: BuildInput): Promise<BuildResult> {
  const start = Date.now();
  const logs: string[] = [];
  const fail = (error: string): BuildResult => ({
    ok: false,
    status: 'unbuildable',
    modules: [],
    log: clip(logs.join('\n')),
    error,
    durationMs: Date.now() - start,
  });

  const manifestPath = (input.manifestPath || 'subgraph.yaml').replace(/^\/+/, '');
  const workDir = posixDirname(manifestPath);
  const manifestFile = posixBasename(manifestPath);
  const ref = input.ref?.trim();
  const base = workDir ? `repo/${workDir}` : 'repo';

  // Dynamic import keeps the SDK out of edge/client bundles.
  let Sandbox: { create(opts: Record<string, unknown>): Promise<SandboxLike> };
  try {
    ({ Sandbox } = (await import('@vercel/sandbox')) as unknown as {
      Sandbox: { create(opts: Record<string, unknown>): Promise<SandboxLike> };
    });
  } catch (e) {
    return fail(`Vercel Sandbox SDK unavailable: ${msg(e)}`);
  }

  let sandbox: SandboxLike;
  try {
    sandbox = await Sandbox.create({ runtime: 'node24', timeout: SANDBOX_TIMEOUT_MS });
  } catch (e) {
    return fail(`Could not start sandbox (is Vercel Sandbox enabled / OIDC configured?): ${msg(e)}`);
  }

  const exec = async (cmd: string): Promise<{ code: number; out: string }> => {
    const res = await sandbox.runCommand('sh', ['-c', cmd]);
    const stdout = await res.stdout().catch(() => '');
    const stderr = res.stderr ? await res.stderr().catch(() => '') : '';
    return { code: res.exitCode ?? 0, out: stdout + stderr };
  };
  const step = async (label: string, cmd: string): Promise<{ code: number; out: string }> => {
    const r = await exec(cmd);
    logs.push(`$ ${label}\n${r.out.trim()}`);
    return r;
  };

  try {
    // 1. Clone (shallow). For a specific ref, try a branch/tag shallow clone,
    //    else a full clone + checkout (covers commit SHAs).
    const clone = ref
      ? `git clone --depth 1 --branch ${shq(ref)} ${shq(input.repoUrl)} repo 2>&1 || ` +
        `(git clone ${shq(input.repoUrl)} repo 2>&1 && cd repo && git checkout ${shq(ref)} 2>&1)`
      : `git clone --depth 1 ${shq(input.repoUrl)} repo 2>&1`;
    if ((await step('git clone', clone)).code !== 0) return fail('git clone failed');

    // 2. Manifest present?
    if ((await exec(`test -f ${shq(`${base}/${manifestFile}`)}`)).code !== 0) {
      return fail(`Subgraph manifest not found at "${manifestPath}"`);
    }

    // 3. Install deps with the repo's own package manager.
    const install =
      `cd ${shq(base)} && ` +
      `if [ -f yarn.lock ]; then corepack yarn install --frozen-lockfile 2>&1 || yarn install 2>&1; ` +
      `elif [ -f pnpm-lock.yaml ]; then corepack pnpm install --frozen-lockfile 2>&1 || corepack pnpm install 2>&1; ` +
      `else npm ci 2>&1 || npm install 2>&1; fi`;
    if ((await step('install deps', install)).code !== 0) return fail('dependency install failed');

    // 4. codegen + build with the repo-pinned graph-cli (falls back to npx fetch).
    const codegen = `cd ${shq(base)} && (npx --no-install graph codegen ${shq(manifestFile)} 2>&1 || npx --yes @graphprotocol/graph-cli codegen ${shq(manifestFile)} 2>&1)`;
    if ((await step('graph codegen', codegen)).code !== 0) return fail('graph codegen failed');

    const build = `cd ${shq(base)} && (npx --no-install graph build ${shq(manifestFile)} 2>&1 || npx --yes @graphprotocol/graph-cli build ${shq(manifestFile)} 2>&1)`;
    if ((await step('graph build', build)).code !== 0) return fail('graph build failed');

    // 5. Read the built manifest to map data-source name → wasm file.
    const builtManifestPath = `${base}/build/subgraph.yaml`;
    const manifestRead = await exec(`cat ${shq(builtManifestPath)}`);
    if (manifestRead.code !== 0) return fail('build/subgraph.yaml not produced');

    let parsed: unknown;
    try {
      parsed = parseYaml(manifestRead.out);
    } catch (e) {
      return fail(`could not parse built manifest: ${msg(e)}`);
    }

    const sources = extractMappings(parsed).slice(0, MAX_MODULES);
    if (sources.length === 0) return fail('built manifest declared no mapping modules');

    // 6. Read each wasm back as base64.
    const modules: { name: string; bytes: Uint8Array }[] = [];
    for (const s of sources) {
      const wasmPath = `${base}/build/${s.file}`;
      const r = await exec(`base64 -w0 ${shq(wasmPath)} 2>/dev/null || base64 ${shq(wasmPath)}`);
      if (r.code !== 0 || !r.out.trim()) {
        logs.push(`! missing built wasm for ${s.name} (${s.file})`);
        continue;
      }
      modules.push({ name: s.name, bytes: new Uint8Array(Buffer.from(r.out.trim(), 'base64')) });
    }
    if (modules.length === 0) return fail('no built wasm modules could be read');

    return {
      ok: true,
      status: 'built',
      modules,
      log: clip(logs.join('\n')),
      durationMs: Date.now() - start,
    };
  } catch (e) {
    return fail(`build error: ${msg(e)}`);
  } finally {
    try {
      await sandbox.stop();
    } catch (e) {
      log.api.warn({ err: msg(e) }, 'sandbox stop failed');
    }
  }
}

/** Pull { name, wasm-file } from both dataSources and templates of a built manifest. */
function extractMappings(manifest: unknown): { name: string; file: string }[] {
  const out: { name: string; file: string }[] = [];
  const m = manifest as { dataSources?: unknown; templates?: unknown };
  for (const group of [m?.dataSources, m?.templates]) {
    if (!Array.isArray(group)) continue;
    for (const ds of group) {
      const name = (ds as { name?: unknown })?.name;
      const file = (ds as { mapping?: { file?: unknown } })?.mapping?.file;
      if (typeof name === 'string' && typeof file === 'string') {
        out.push({ name, file });
      }
    }
  }
  return out;
}
