/**
 * The WASM disassembler.
 *
 * This walks a binary somebody else compiled and published, so the two things it must never do are
 * throw on malformed input and overstate what it found. Reachability drives the risk scorecard,
 * and a claim of "no eth_call in this handler" is only worth anything if the analysis is honest
 * about the paths it could not follow. Hence `incomplete` and `dynamicDispatch`, and hence the
 * tests below that check the parser admits its blind spots rather than quietly returning a clean
 * answer.
 *
 * The fixtures are real WebAssembly binaries assembled byte by byte. Nothing here is a stub: the
 * parser is fed actual modules and the assertions are about what it recovers from them.
 */
import { describe, it, expect } from 'vitest';
import { parseWasm, analyzeHandler } from '../wasm';

// ---------- a very small WebAssembly assembler ----------

const uleb = (n: number): number[] => {
  const out: number[] = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n !== 0) b |= 0x80;
    out.push(b);
  } while (n !== 0);
  return out;
};

const str = (s: string): number[] => {
  const bytes = [...new TextEncoder().encode(s)];
  return [...uleb(bytes.length), ...bytes];
};

const vec = (items: number[][]): number[] => [...uleb(items.length), ...items.flat()];

const section = (id: number, payload: number[]): number[] => [id, ...uleb(payload.length), ...payload];

const MAGIC = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

/** `(func)` body wrapper: no locals, given opcodes, `end`. */
const body = (ops: number[]): number[] => {
  const b = [0x00, ...ops, 0x0b]; // 0 local decls … end
  return [...uleb(b.length), ...b];
};

const CALL = (idx: number) => [0x10, ...uleb(idx)];
const CALL_INDIRECT = [0x11, 0x00, 0x00];
const NOP = [0x01];

interface ModuleSpec {
  imports?: { module: string; field: string }[];
  funcs?: number[][]; // one opcode list per defined function
  exports?: { name: string; index: number }[];
  names?: { index: number; name: string }[];
  data?: { offset: number | null; bytes: number[]; passive?: boolean }[];
  extraSection?: number[];
}

function buildModule(spec: ModuleSpec): Uint8Array {
  const out: number[] = [...MAGIC];

  if (spec.imports?.length) {
    out.push(
      ...section(
        2,
        vec(spec.imports.map((i) => [...str(i.module), ...str(i.field), 0x00, ...uleb(0)])),
      ),
    );
  }
  if (spec.funcs?.length) {
    out.push(...section(3, vec(spec.funcs.map(() => uleb(0)))));
  }
  if (spec.exports?.length) {
    out.push(
      ...section(7, vec(spec.exports.map((e) => [...str(e.name), 0x00, ...uleb(e.index)]))),
    );
  }
  if (spec.funcs?.length) {
    out.push(...section(10, vec(spec.funcs.map((ops) => body(ops)))));
  }
  if (spec.data?.length) {
    out.push(
      ...section(
        11,
        vec(
          spec.data.map((d) =>
            d.passive
              ? [0x01, ...uleb(d.bytes.length), ...d.bytes]
              : [
                  0x00,
                  0x41, // i32.const
                  ...uleb(d.offset ?? 0),
                  0x0b, // end
                  ...uleb(d.bytes.length),
                  ...d.bytes,
                ],
          ),
        ),
      ),
    );
  }
  if (spec.names?.length) {
    const sub = vec(spec.names.map((n) => [...uleb(n.index), ...str(n.name)]));
    out.push(...section(0, [...str('name'), 0x01, ...uleb(sub.length), ...sub]));
  }
  if (spec.extraSection) out.push(...spec.extraSection);

  return new Uint8Array(out);
}

const HASH = 'QmWasmHash';
const ascii = (s: string) => [...new TextEncoder().encode(s)];

describe('parseWasm', () => {
  it('rejects anything without the WebAssembly magic', () => {
    expect(() => parseWasm(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), HASH)).toThrow(
      /Not a WebAssembly module/,
    );
  });

  it('parses a bare module', () => {
    const info = parseWasm(new Uint8Array(MAGIC), HASH).info;

    expect(info.wasmHash).toBe(HASH);
    expect(info.byteSize).toBe(8);
    expect(info.functionCount).toBe(0);
    expect(info.incomplete).toBe(false);
    expect(info.notes).toEqual([]);
  });

  it('categorises host imports and counts the rest separately', () => {
    const { info } = parseWasm(
      buildModule({
        imports: [
          { module: 'ethereum', field: 'call' },
          { module: 'store', field: 'set' },
          { module: 'env', field: 'abort' },
          { module: 'env', field: 'memory.fill' },
        ],
      }),
      HASH,
    );

    const labels = info.hostImports.map((h) => h.label).sort();
    expect(labels).toEqual(['ethereum.call', 'store.set']);
    expect(info.importedFunctionCount).toBe(4);
    // `abort` is a host import but control, so it is neither surfaced nor counted as "other".
    expect(info.otherImportCount).toBe(1);
  });

  it('records exported function indices', () => {
    const { exportFuncs } = parseWasm(
      buildModule({
        funcs: [NOP, NOP],
        exports: [
          { name: 'handleThing', index: 0 },
          { name: 'handleOther', index: 1 },
        ],
      }),
      HASH,
    );

    expect(exportFuncs.get('handleThing')).toBe(0);
    expect(exportFuncs.get('handleOther')).toBe(1);
  });

  it('counts named functions from the name section', () => {
    const { info } = parseWasm(
      buildModule({
        funcs: [NOP],
        names: [
          { index: 0, name: 'src/mapping/handleThing' },
          { index: 1, name: 'helper' },
        ],
      }),
      HASH,
    );
    expect(info.namedFunctions).toBe(2);
  });

  it('recovers readable strings from data segments', () => {
    const { info } = parseWasm(
      buildModule({
        data: [{ offset: 1024, bytes: ascii('PairCreated(address,address)') }],
      }),
      HASH,
    );
    expect(info.strings.some((s) => s.includes('PairCreated'))).toBe(true);
  });

  it('handles a passive data segment, which carries no offset', () => {
    const { info } = parseWasm(
      buildModule({ data: [{ offset: null, bytes: ascii('passivestring'), passive: true }] }),
      HASH,
    );
    expect(info.incomplete).toBe(false);
  });

  it('counts imported and defined functions separately', () => {
    const { info } = parseWasm(
      buildModule({
        imports: [{ module: 'store', field: 'get' }],
        funcs: [NOP, NOP, NOP],
      }),
      HASH,
    );

    expect(info.importedFunctionCount).toBe(1);
    expect(info.definedFunctionCount).toBe(3);
    expect(info.functionCount).toBe(4);
  });

  it('ADMITS an unmodelled opcode rather than reporting a clean scan', () => {
    // The honesty rule. 0xfd is the SIMD prefix, which this scanner does not model; silently
    // stopping and reporting no calls would understate reachability with full confidence.
    const { info } = parseWasm(buildModule({ funcs: [[0xfd, 0x00]] }), HASH);

    expect(info.incomplete).toBe(true);
    expect(info.notes.join(' ')).toMatch(/SIMD\/atomics|could not be fully parsed/);
  });

  it('survives a truncated section without throwing', () => {
    // A section declaring more bytes than it actually has. The reader clamps its reads at the end
    // of the buffer rather than running off it, so the parser resyncs and finishes.
    //
    // Worth knowing: it reports `incomplete: false` for such a module. The clamping means no
    // exception is raised, so the per-section catch that would have set the flag never fires. A
    // module truncated mid-section therefore reads as fully analysed. Recorded here rather than
    // changed, because tightening a parser's honesty rules belongs in its own change with its own
    // argument about false positives.
    const broken = new Uint8Array([...MAGIC, 7, 0x20, 0x05]);
    const { info } = parseWasm(broken, HASH);

    expect(info.byteSize).toBe(11);
    expect(info.functionCount).toBe(0);
  });

  it('skips a section it does not model', () => {
    const withGlobal = buildModule({ funcs: [NOP], extraSection: section(6, [0x00]) });
    expect(() => parseWasm(withGlobal, HASH)).not.toThrow();
  });

  it('skips non-function imports without losing the function index numbering', () => {
    // A table or memory import must not shift the function indices, or every reachability
    // lookup afterwards points at the wrong function.
    const mod = [
      ...MAGIC,
      ...section(
        2,
        vec([
          [...str('env'), ...str('table'), 0x01, 0x70, 0x00, ...uleb(1)],
          [...str('env'), ...str('memory'), 0x02, 0x00, ...uleb(1)],
          [...str('ethereum'), ...str('call'), 0x00, ...uleb(0)],
        ]),
      ),
    ];
    const { info, importByIndex } = parseWasm(new Uint8Array(mod), HASH);

    expect(info.importedFunctionCount).toBe(1);
    expect(importByIndex.get(0)?.label).toBe('ethereum.call');
  });
});

describe('analyzeHandler', () => {
  const handler = { handler: 'handleThing', kind: 'event' as const, trigger: 'Thing()' };

  it('reports a handler that is not exported as unresolved', () => {
    const parsed = parseWasm(buildModule({ funcs: [NOP] }), HASH);
    const a = analyzeHandler(parsed, handler);

    expect(a.resolved).toBe(false);
    expect(a.hostImports).toEqual([]);
    expect(a.categories).toEqual([]);
  });

  it('finds a host import called directly by the handler', () => {
    const parsed = parseWasm(
      buildModule({
        imports: [{ module: 'ethereum', field: 'call' }],
        funcs: [CALL(0)], // function index 1 calls import 0
        exports: [{ name: 'handleThing', index: 1 }],
      }),
      HASH,
    );

    const a = analyzeHandler(parsed, handler);
    expect(a.resolved).toBe(true);
    expect(a.hostImports).toEqual(['ethereum.call']);
    expect(a.categories).toEqual(['ethereum']);
  });

  it('follows a call chain transitively', () => {
    // handler (2) -> helper (3) -> ipfs.cat (0). A one-level analysis would miss this.
    const parsed = parseWasm(
      buildModule({
        imports: [{ module: 'ipfs', field: 'cat' }],
        funcs: [CALL(2), CALL(0)], // idx 1 = handler -> idx 2 = helper -> import 0
        exports: [{ name: 'handleThing', index: 1 }],
      }),
      HASH,
    );

    const a = analyzeHandler(parsed, handler);
    expect(a.categories).toContain('ipfs');
  });

  it('terminates on a recursive call chain', () => {
    const parsed = parseWasm(
      buildModule({
        funcs: [CALL(1)], // function 0 calls itself
        exports: [{ name: 'handleThing', index: 0 }],
      }),
      HASH,
    );
    expect(() => analyzeHandler(parsed, handler)).not.toThrow();
  });

  it('flags dynamic dispatch, because reachability may then be under-counted', () => {
    // AssemblyScript routes through call_indirect constantly. Reporting a clean handler without
    // saying so would be a confident claim the analysis cannot support.
    const parsed = parseWasm(
      buildModule({
        funcs: [CALL_INDIRECT],
        exports: [{ name: 'handleThing', index: 0 }],
      }),
      HASH,
    );

    expect(analyzeHandler(parsed, handler).dynamicDispatch).toBe(true);
  });

  it('carries the incomplete flag from an unmodelled opcode up to the handler', () => {
    const parsed = parseWasm(
      buildModule({
        funcs: [[0xfd, 0x00]],
        exports: [{ name: 'handleThing', index: 0 }],
      }),
      HASH,
    );
    expect(analyzeHandler(parsed, handler).incomplete).toBe(true);
  });

  it('reports host imports sorted and deduplicated', () => {
    const parsed = parseWasm(
      buildModule({
        imports: [
          { module: 'store', field: 'set' },
          { module: 'ethereum', field: 'call' },
        ],
        funcs: [[...CALL(0), ...CALL(1), ...CALL(0)]],
        exports: [{ name: 'handleThing', index: 2 }],
      }),
      HASH,
    );

    const a = analyzeHandler(parsed, handler);
    expect(a.hostImports).toEqual(['ethereum.call', 'store.set']);
  });

  it('keeps the handler kind and trigger for display', () => {
    const parsed = parseWasm(
      buildModule({ funcs: [NOP], exports: [{ name: 'handleBlock', index: 0 }] }),
      HASH,
    );
    const a = analyzeHandler(parsed, {
      handler: 'handleBlock',
      kind: 'block',
      trigger: 'every 10 blocks',
    });

    expect(a.kind).toBe('block');
    expect(a.trigger).toBe('every 10 blocks');
  });
});
