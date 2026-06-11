import { describe, it, expect } from 'vitest';
import { compareBuild, sha256Hex, type NamedModule } from '../disassembly/verify';

// --- minimal hand-rolled WASM modules -------------------------------------
// A header + type section (one () -> () functype) + an import section with a
// single imported function from (module, name). Enough for parseWasm to recover
// the host-import label. String lengths are all < 128 so LEB128 = one byte.

function str(s: string): number[] {
  const b = [...Buffer.from(s, 'utf8')];
  return [b.length, ...b];
}

function wasmWithImport(mod: string, name: string): Uint8Array {
  const header = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  const typeSec = [0x01, 0x04, 0x01, 0x60, 0x00, 0x00]; // id=1, len=4, 1 functype () -> ()
  const entry = [...str(mod), ...str(name), 0x00, 0x00]; // importdesc: func (0x00), typeidx 0
  const payload = [0x01, ...entry]; // count = 1
  const importSec = [0x02, payload.length, ...payload];
  return new Uint8Array([...header, ...typeSec, ...importSec]);
}

const STORE_WASM = wasmWithImport('store', 'set'); // host label store.set
const ETH_WASM = wasmWithImport('ethereum', 'call'); // host label ethereum.call

function mod(name: string, bytes: Uint8Array): NamedModule {
  return { name, bytes };
}

describe('sha256Hex', () => {
  it('is stable and distinguishes content', () => {
    expect(sha256Hex(STORE_WASM)).toBe(sha256Hex(new Uint8Array(STORE_WASM)));
    expect(sha256Hex(STORE_WASM)).not.toBe(sha256Hex(ETH_WASM));
  });
});

describe('compareBuild', () => {
  it('verified-exact when every module is byte-identical', () => {
    const r = compareBuild([mod('Token', STORE_WASM)], [mod('Token', STORE_WASM)]);
    expect(r.verdict).toBe('verified-exact');
    expect(r.summary).toMatchObject({ exact: 1, structural: 0, diverged: 0, missing: 0, total: 1 });
    expect(r.modules[0].builtSha256).toBe(r.modules[0].deployedSha256);
  });

  it('verified-structural when bytes differ but host surface matches', () => {
    // Two different byte blobs that both parse to the SAME host surface: pad one
    // STORE module with trailing zero bytes (an ignored custom-section-free tail
    // still changes the hash but not the recovered host imports).
    const padded = new Uint8Array([...STORE_WASM, 0x00]);
    const r = compareBuild([mod('Token', padded)], [mod('Token', STORE_WASM)]);
    expect(r.verdict).toBe('verified-structural');
    expect(r.modules[0].status).toBe('structural');
    expect(r.modules[0].hostImportsAdded).toEqual([]);
    expect(r.modules[0].hostImportsRemoved).toEqual([]);
    expect(r.modules[0].builtSha256).not.toBe(r.modules[0].deployedSha256);
  });

  it('diverged when the reachable host surface differs', () => {
    const r = compareBuild([mod('Token', ETH_WASM)], [mod('Token', STORE_WASM)]);
    expect(r.verdict).toBe('diverged');
    expect(r.modules[0].status).toBe('diverged');
    expect(r.modules[0].hostImportsAdded).toEqual(['ethereum.call']); // in built, not deployed
    expect(r.modules[0].hostImportsRemoved).toEqual(['store.set']); // in deployed, not built
  });

  it('diverged when a module exists on only one side', () => {
    const r = compareBuild(
      [mod('Token', STORE_WASM), mod('Extra', ETH_WASM)],
      [mod('Token', STORE_WASM)],
    );
    expect(r.verdict).toBe('diverged');
    expect(r.summary.missing).toBe(1);
    expect(r.modules.find((m) => m.name === 'Extra')?.status).toBe('only-built');
  });

  it('sorts modules by name and counts a mixed result', () => {
    const padded = new Uint8Array([...STORE_WASM, 0x00]);
    const r = compareBuild(
      [mod('B', STORE_WASM), mod('A', padded)],
      [mod('B', STORE_WASM), mod('A', STORE_WASM)],
    );
    expect(r.modules.map((m) => m.name)).toEqual(['A', 'B']);
    expect(r.summary).toMatchObject({ exact: 1, structural: 1, total: 2 });
    expect(r.verdict).toBe('verified-structural');
  });
});
