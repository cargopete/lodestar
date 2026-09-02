/**
 * The sandboxed source builder.
 *
 * This clones a stranger's repository and runs its build scripts, which is the most dangerous
 * thing this codebase does. It is safe only because all of it happens inside a disposable
 * Firecracker microVM and this process ever sees just the resulting bytes and logs. So the
 * properties worth pinning are the containment ones: every argument that comes from a caller is
 * shell-quoted before it reaches `sh -c`, and the sandbox is stopped on every exit path including
 * the ones taken by a failure.
 *
 * The module's own header says it is not exercised by unit tests because it needs a live sandbox.
 * It does not: the SDK is dynamically imported and every command goes through one method, so the
 * whole flow can be driven by a scripted responder.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const runCommand = vi.fn();
const stop = vi.fn(async () => undefined);
const create = vi.fn(async () => ({ runCommand, stop }));

vi.mock('@vercel/sandbox', () => ({ Sandbox: { create: (...a: unknown[]) => create(...a) } }));
vi.mock('@/lib/logger', () => ({ log: { api: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } } }));

import { buildSubgraphInSandbox, pickPrepareScripts } from '../build-sandbox';

/** Commands are matched in order; the first matching rule answers. */
type Rule = { match: RegExp; code?: number; out?: string };

function script(rules: Rule[]) {
  runCommand.mockImplementation(async (_sh: string, args: string[]) => {
    const cmd = args[1];
    const rule = rules.find((r) => r.match.test(cmd));
    return {
      exitCode: rule?.code ?? 0,
      stdout: async () => rule?.out ?? '',
      stderr: async () => '',
    };
  });
}

const BUILT_MANIFEST = `
dataSources:
  - name: Factory
    mapping:
      file: Factory/Factory.wasm
templates:
  - name: Pair
    mapping:
      file: templates/Pair/Pair.wasm
`;

const WASM_B64 = Buffer.from([0x00, 0x61, 0x73, 0x6d]).toString('base64');

/** Every command a fully successful build issues. */
const HAPPY: Rule[] = [
  { match: /git clone/, code: 0 },
  { match: /yarn\.lock/, out: 'npm' },
  { match: /corepack enable/, code: 0 },
  { match: /npm ci/, code: 0 },
  { match: /test -f/, code: 0 },
  { match: /graph codegen/, code: 0 },
  { match: /graph build/, code: 0 },
  { match: /cat .*build\/subgraph\.yaml/, code: 0, out: BUILT_MANIFEST },
  { match: /base64/, code: 0, out: WASM_B64 },
];

const INPUT = { repoUrl: 'https://github.com/x/y' };

beforeEach(() => {
  vi.clearAllMocks();
  create.mockResolvedValue({ runCommand, stop });
  script(HAPPY);
});

/** Every shell command the run issued. */
const commands = () => runCommand.mock.calls.map((c) => c[1][1] as string);

describe('buildSubgraphInSandbox', () => {
  it('builds and returns each mapping module', async () => {
    const r = await buildSubgraphInSandbox(INPUT);

    expect(r.ok).toBe(true);
    expect(r.status).toBe('built');
    expect(r.modules.map((m) => m.name)).toEqual(['Factory', 'Pair']);
    expect([...r.modules[0].bytes]).toEqual([0x00, 0x61, 0x73, 0x6d]);
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('stops the sandbox on the happy path', async () => {
    await buildSubgraphInSandbox(INPUT);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('stops the sandbox even when the build fails', async () => {
    // A leaked microVM is a bill that runs for as long as nobody notices.
    script([{ match: /git clone/, code: 1 }, ...HAPPY]);
    await buildSubgraphInSandbox(INPUT);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('survives the sandbox refusing to stop', async () => {
    stop.mockRejectedValue(new Error('already gone'));
    await expect(buildSubgraphInSandbox(INPUT)).resolves.toMatchObject({ ok: true });
  });

  it('SHELL-QUOTES a hostile ref rather than interpolating it', async () => {
    // The single most important line in this file. Without `shq` a crafted ref is arbitrary
    // command execution inside the VM, and the VM is only a containment boundary, not a licence.
    await buildSubgraphInSandbox({ ...INPUT, ref: "main'; rm -rf /; echo '" });

    // Note what is asserted: the dangerous text still APPEARS in the command, and must. What
    // makes it safe is that it sits inside single quotes with every embedded quote closed,
    // escaped and reopened, so the shell reads the whole thing as one word. Asserting the
    // substring is absent would be a test passing for the wrong reason.
    const clone = commands().find((c) => c.includes('git clone'))!;
    expect(clone).toContain(`--branch 'main'\\''; rm -rf /; echo '\\'''`);
    expect(clone).not.toContain('--branch main;');
  });

  it('shell-quotes the repository URL too', async () => {
    await buildSubgraphInSandbox({ repoUrl: "https://x/y'; id; '" });
    const clone = commands().find((c) => c.includes('git clone'))!;
    expect(clone).toContain(`'https://x/y'\\''; id; '\\'''`);
    expect(clone).not.toContain('https://x/y; id;');
  });

  it('does a shallow clone when no ref is given', async () => {
    await buildSubgraphInSandbox(INPUT);
    const clone = commands().find((c) => c.includes('git clone'))!;
    expect(clone).toContain('--depth 1');
    expect(clone).not.toContain('--branch');
  });

  it('falls back to a full clone and checkout for a ref, which covers a commit SHA', async () => {
    await buildSubgraphInSandbox({ ...INPUT, ref: 'abc123' });
    const clone = commands().find((c) => c.includes('git clone'))!;
    expect(clone).toContain('--branch');
    expect(clone).toContain('git checkout');
  });

  it.each([
    ['yarn', /corepack yarn install/],
    ['pnpm', /corepack pnpm install/],
    ['npm', /npm ci/],
  ])('installs with %s when the lockfile says so', async (pm, expected) => {
    script([{ match: /yarn\.lock/, out: pm }, ...HAPPY]);
    await buildSubgraphInSandbox(INPUT);
    expect(commands().some((c) => expected.test(c))).toBe(true);
  });

  it('reports the SDK being unavailable rather than throwing', async () => {
    create.mockRejectedValue(new Error('OIDC not configured'));
    const r = await buildSubgraphInSandbox(INPUT);

    expect(r.ok).toBe(false);
    expect(r.status).toBe('unbuildable');
    expect(r.error).toMatch(/Could not start sandbox/);
  });

  it.each([
    ['git clone failed', /git clone/],
    ['dependency install failed', /npm ci/],
    ['graph codegen failed', /graph codegen/],
    ['graph build failed', /graph build/],
  ])('reports "%s" when that step exits non-zero', async (expected, match) => {
    script([{ match, code: 1, out: 'boom' }, ...HAPPY]);
    const r = await buildSubgraphInSandbox(INPUT);

    expect(r.ok).toBe(false);
    expect(r.error).toBe(expected);
    // The log carries what actually happened, which is the only debugging aid a caller gets.
    expect(r.log).toContain('boom');
  });

  it('runs a custom prepare command in preference to guessing', async () => {
    await buildSubgraphInSandbox({ ...INPUT, prepareCommand: 'yarn prep:mainnet' });
    expect(commands().some((c) => c.includes('yarn prep:mainnet'))).toBe(true);
  });

  it('auto-detects a prepare script when the manifest is not committed', async () => {
    // Many subgraphs generate subgraph.yaml from a template, so a missing manifest is normal
    // rather than fatal.
    let manifestExists = false;
    runCommand.mockImplementation(async (_sh: string, args: string[]) => {
      const cmd = args[1];
      let code = 0;
      let out = '';
      if (/test -f/.test(cmd)) code = manifestExists ? 0 : 1;
      else if (/yarn\.lock/.test(cmd)) out = 'npm';
      else if (/cat .*package\.json/.test(cmd)) out = JSON.stringify({ scripts: { prepare: 'x' } });
      else if (/npm run 'prepare'/.test(cmd)) manifestExists = true;
      else if (/cat .*build\/subgraph\.yaml/.test(cmd)) out = BUILT_MANIFEST;
      else if (/base64/.test(cmd)) out = WASM_B64;
      return { exitCode: code, stdout: async () => out, stderr: async () => '' };
    });

    const r = await buildSubgraphInSandbox(INPUT);
    expect(r.ok).toBe(true);
    expect(commands().some((c) => c.includes("npm run 'prepare'"))).toBe(true);
  });

  it('lists the available scripts when no prepare step produced a manifest', async () => {
    // The most useful failure message this thing can give: it tells the user what to try next.
    script([
      { match: /test -f/, code: 1 },
      { match: /cat .*package\.json/, out: JSON.stringify({ scripts: { codegen: 'a', deploy: 'b' } }) },
      ...HAPPY,
    ]);

    const r = await buildSubgraphInSandbox(INPUT);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not found, and no prepare step produced it/);
    expect(r.error).toContain('codegen, deploy');
  });

  it('reports a built manifest that never appeared', async () => {
    script([{ match: /cat .*build\/subgraph\.yaml/, code: 1 }, ...HAPPY]);
    const r = await buildSubgraphInSandbox(INPUT);
    expect(r.error).toBe('build/subgraph.yaml not produced');
  });

  it('reports a built manifest declaring no mappings', async () => {
    script([{ match: /cat .*build\/subgraph\.yaml/, out: 'dataSources: []' }, ...HAPPY]);
    const r = await buildSubgraphInSandbox(INPUT);
    expect(r.error).toBe('built manifest declared no mapping modules');
  });

  it('notes a module whose wasm could not be read, and fails when none can', async () => {
    script([{ match: /base64/, code: 1 }, ...HAPPY]);
    const r = await buildSubgraphInSandbox(INPUT);

    expect(r.ok).toBe(false);
    expect(r.error).toBe('no built wasm modules could be read');
    expect(r.log).toContain('missing built wasm for Factory');
  });

  it('builds from a manifest nested inside the repo', async () => {
    await buildSubgraphInSandbox({ ...INPUT, manifestPath: 'packages/subgraph/subgraph.yaml' });
    expect(commands().some((c) => c.includes("'repo/packages/subgraph'"))).toBe(true);
  });

  it('strips leading slashes from the manifest path', async () => {
    await buildSubgraphInSandbox({ ...INPUT, manifestPath: '///subgraph.yaml' });
    expect(commands().every((c) => !c.includes('repo////'))).toBe(true);
  });
});

describe('pickPrepareScripts', () => {
  it('prefers prepare, then prep, then a networked variant', () => {
    expect(
      pickPrepareScripts({ prepare: 'a', prep: 'b', 'prepare:mainnet': 'c', build: 'd' }),
    ).toEqual(['prepare', 'prep', 'prepare:mainnet']);
  });

  it('accepts a hyphenated network variant', () => {
    expect(pickPrepareScripts({ 'prepare-mainnet': 'a' })).toEqual(['prepare-mainnet']);
  });

  it('does not repeat a script already chosen', () => {
    expect(pickPrepareScripts({ prepare: 'a' })).toEqual(['prepare']);
  });

  it('never picks build or deploy, which would do far more than generate a manifest', () => {
    expect(pickPrepareScripts({ build: 'a', deploy: 'b', test: 'c' })).toEqual([]);
  });

  it('returns nothing for a package with no scripts', () => {
    expect(pickPrepareScripts({})).toEqual([]);
  });
});
