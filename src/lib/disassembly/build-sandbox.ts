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
  /**
   * Optional shell command to generate the manifest, run in the manifest's
   * directory before the build (e.g. "yarn prep:addresses:mainnet && yarn
   * prepare:mainnet"). For repos whose prepare pipeline auto-detection can't
   * infer. Runs inside the disposable sandbox like everything else.
   */
  prepareCommand?: string;
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

    // 2. Detect the package manager from lockfiles.
    const pm = (await exec(
      `cd ${shq(base)} && if [ -f yarn.lock ]; then echo yarn; elif [ -f pnpm-lock.yaml ]; then echo pnpm; else echo npm; fi`,
    )).out.trim();
    const installCmd =
      pm === 'yarn'
        ? 'corepack yarn install --frozen-lockfile 2>&1 || corepack yarn install 2>&1'
        : pm === 'pnpm'
          ? 'corepack pnpm install --frozen-lockfile 2>&1 || corepack pnpm install 2>&1'
          : 'npm ci 2>&1 || npm install 2>&1';
    const runPrefix = pm === 'yarn' ? 'corepack yarn run' : pm === 'pnpm' ? 'corepack pnpm run' : 'npm run';

    // Enable corepack shims so bare `yarn`/`pnpm` resolve on PATH — custom
    // prepare commands commonly use them. Best-effort.
    await exec('sudo corepack enable 2>/dev/null || corepack enable 2>/dev/null || true');

    // 3. Install deps. This also fires the `prepare` lifecycle for repos that
    //    generate their manifest there.
    if ((await step('install deps', `cd ${shq(base)} && ${installCmd}`)).code !== 0) {
      return fail('dependency install failed');
    }

    // 4. Many subgraphs don't commit subgraph.yaml — they generate it from a
    //    mustache template via a prepare/prepare:<network> script. A custom
    //    prepareCommand takes precedence; otherwise auto-detect prepare scripts.
    const manifestThere = async () => (await exec(`test -f ${shq(`${base}/${manifestFile}`)}`)).code === 0;
    if (input.prepareCommand) {
      await step('prepare (custom)', `cd ${shq(base)} && ${input.prepareCommand} 2>&1`);
    } else if (!(await manifestThere())) {
      const scripts = await readScripts(exec, base);
      for (const name of pickPrepareScripts(scripts)) {
        await step(`${pm} run ${name}`, `cd ${shq(base)} && ${runPrefix} ${shq(name)} 2>&1`);
        if (await manifestThere()) break;
      }
    }
    if (!(await manifestThere())) {
      const names = Object.keys(await readScripts(exec, base));
      return fail(
        `Subgraph manifest "${manifestPath}" not found, and no prepare step produced it` +
          (names.length ? ` — available scripts: ${names.slice(0, 20).join(', ')}. ` : '. ') +
          'Try setting a custom prepare command.',
      );
    }

    // 5. codegen + build with the repo-pinned graph-cli (falls back to npx fetch).
    const codegen = `cd ${shq(base)} && (npx --no-install graph codegen ${shq(manifestFile)} 2>&1 || npx --yes @graphprotocol/graph-cli codegen ${shq(manifestFile)} 2>&1)`;
    if ((await step('graph codegen', codegen)).code !== 0) return fail('graph codegen failed');

    const build = `cd ${shq(base)} && (npx --no-install graph build ${shq(manifestFile)} 2>&1 || npx --yes @graphprotocol/graph-cli build ${shq(manifestFile)} 2>&1)`;
    if ((await step('graph build', build)).code !== 0) return fail('graph build failed');

    // 6. Read the built manifest to map data-source name → wasm file.
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

    // 7. Read each wasm back as base64.
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

type Exec = (cmd: string) => Promise<{ code: number; out: string }>;

/** Read the repo's package.json scripts from inside the sandbox. */
async function readScripts(exec: Exec, base: string): Promise<Record<string, string>> {
  const r = await exec(`cat ${shq(`${base}/package.json`)}`);
  if (r.code !== 0) return {};
  try {
    const pkg = JSON.parse(r.out) as { scripts?: Record<string, string> };
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

/**
 * Pick the scripts most likely to generate a templated manifest, in priority
 * order: `prepare`, `prep`, then the first network-specific `prepare:<network>`
 * / `prepare-<network>`. We deliberately don't run `build`/`deploy` scripts.
 */
export function pickPrepareScripts(scripts: Record<string, string>): string[] {
  const names = Object.keys(scripts);
  const out: string[] = [];
  if (scripts.prepare) out.push('prepare');
  if (scripts.prep) out.push('prep');
  const networked = names.find((n) => /^prepare[:-]/.test(n));
  if (networked && !out.includes(networked)) out.push(networked);
  return out;
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
