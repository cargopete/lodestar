// Static disassembly of an AssemblyScript-compiled mapping module.
//
// We parse just the sections we need (imports / functions / exports / code /
// custom "name" / data), build the direct call graph, then for each exported
// handler compute which host imports are reachable. Everything degrades
// gracefully: an opcode we can't decode flips an `incomplete` flag rather than
// producing a wrong answer — a transparency tool must never quietly lie about
// reachability.

import type { HostCategory, HostImport, HandlerAnalysis, WasmModuleInfo } from './types';
import type { ParsedHandler } from './manifest';

// ---------- host import catalogue ----------

/** Host namespaces graph-node links into mappings (runtime/wasm/src/module). */
const HOST_MODULE: Record<string, HostCategory> = {
  store: 'store',
  ethereum: 'ethereum',
  ipfs: 'ipfs',
  json: 'json',
  crypto: 'crypto',
  typeConversion: 'typeConversion',
  bigInt: 'bigInt',
  bigDecimal: 'bigDecimal',
  dataSource: 'dataSource',
  log: 'log',
};

interface Categorised {
  label: string;
  category: HostCategory;
  isHost: boolean;
}

/**
 * AS emits host imports either as (module="ethereum", name="call") or — after
 * the "imports all in one module" change — as (module=<file>, name="ethereum.call").
 * graph-node keys on the dotted name, so we accept both shapes.
 */
function categorise(module: string, name: string): Categorised {
  if (HOST_MODULE[module]) {
    return { label: `${module}.${name}`, category: HOST_MODULE[module], isHost: true };
  }
  const dot = name.indexOf('.');
  if (dot > 0) {
    const ns = name.slice(0, dot);
    if (HOST_MODULE[ns]) return { label: name, category: HOST_MODULE[ns], isHost: true };
  }
  if (name === 'abort' || (module === 'env' && name === 'abort')) {
    return { label: 'abort', category: 'control', isHost: true };
  }
  return { label: module ? `${module}.${name}` : name, category: 'other', isHost: false };
}

/** Categories that are meaningful signals on a handler (excludes runtime noise). */
const MEANINGFUL: ReadonlySet<HostCategory> = new Set<HostCategory>([
  'store', 'ethereum', 'ipfs', 'json', 'crypto', 'bigInt', 'bigDecimal', 'typeConversion', 'dataSource', 'log',
]);

// ---------- byte reader ----------

class Reader {
  pos = 0;
  constructor(readonly buf: Uint8Array) {}

  get eof(): boolean {
    return this.pos >= this.buf.length;
  }

  byte(): number {
    return this.buf[this.pos++];
  }

  /** unsigned LEB128 — uses float accumulation to stay correct past 32 bits */
  u(): number {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = this.buf[this.pos++];
      result += (b & 0x7f) * 2 ** shift;
      shift += 7;
    } while (b & 0x80);
    return result;
  }

  /** skip an unsigned LEB128 */
  skipU(): void {
    while (this.buf[this.pos++] & 0x80) {
      /* advance */
    }
  }

  /** skip a signed LEB128 (also covers blocktype s33 and heaptype encodings) */
  skipS(): void {
    while (this.buf[this.pos++] & 0x80) {
      /* advance */
    }
  }

  raw(n: number): Uint8Array {
    const end = Math.min(this.pos + n, this.buf.length);
    const slice = this.buf.subarray(this.pos, end);
    this.pos = end;
    return slice;
  }

  name(): string {
    const len = this.u();
    const bytes = this.raw(len);
    return new TextDecoder('utf-8').decode(bytes);
  }
}

// ---------- parsed module ----------

interface FuncBody {
  calls: number[];
  indirect: boolean;
  incomplete: boolean;
}

export interface ParsedWasm {
  info: WasmModuleInfo;
  /** exported function name -> function index */
  exportFuncs: Map<string, number>;
  /** defined function index -> decoded body */
  bodies: Map<number, FuncBody>;
  /** imported function index -> categorised import */
  importByIndex: Map<number, Categorised>;
}

const WASM_MAGIC = [0x00, 0x61, 0x73, 0x6d];

function checkHeader(r: Reader): boolean {
  for (const want of WASM_MAGIC) if (r.byte() !== want) return false;
  // version (4 bytes) — accept any
  r.raw(4);
  return true;
}

// ---------- code-section instruction scanner ----------

/**
 * Walk one function body, consuming each opcode's immediates so we land exactly
 * on the next opcode, and collect direct call targets. Unknown opcodes (SIMD,
 * atomics, anything post-MVP we don't model) set `incomplete` and stop the scan.
 */
function scanBody(r: Reader, bodyEnd: number): FuncBody {
  const calls: number[] = [];
  let indirect = false;
  let incomplete = false;

  while (r.pos < bodyEnd && !incomplete) {
    const op = r.byte();
    switch (op) {
      // --- no immediates ---
      case 0x00: case 0x01: case 0x05: case 0x0b: case 0x0f:
      case 0x1a: case 0x1b: case 0xd1:
        break;
      // --- block types (s33) ---
      case 0x02: case 0x03: case 0x04:
        r.skipS();
        break;
      // --- branch label idx ---
      case 0x0c: case 0x0d:
        r.skipU();
        break;
      // --- br_table ---
      case 0x0e: {
        const n = r.u();
        for (let i = 0; i < n; i++) r.skipU();
        r.skipU();
        break;
      }
      // --- calls ---
      case 0x10: // call
      case 0x12: // return_call (tail)
        calls.push(r.u());
        break;
      case 0x11: // call_indirect
      case 0x13: // return_call_indirect
        r.skipU();
        r.skipU();
        indirect = true;
        break;
      // --- typed select ---
      case 0x1c: {
        const n = r.u();
        for (let i = 0; i < n; i++) r.byte();
        break;
      }
      // --- local/global/table get/set ---
      case 0x20: case 0x21: case 0x22: case 0x23: case 0x24: case 0x25: case 0x26:
        r.skipU();
        break;
      // --- memory.size / memory.grow ---
      case 0x3f: case 0x40:
        r.skipU();
        break;
      // --- const ---
      case 0x41: case 0x42:
        r.skipS();
        break;
      case 0x43:
        r.raw(4);
        break;
      case 0x44:
        r.raw(8);
        break;
      // --- reference types ---
      case 0xd0: // ref.null heaptype
        r.skipS();
        break;
      case 0xd2: // ref.func
        r.skipU();
        break;
      // --- prefixed (bulk-memory / saturating trunc) ---
      case 0xfc: {
        const sub = r.u();
        if (sub <= 7) break; // trunc_sat — no further immediates
        if (sub === 8) { r.skipU(); r.skipU(); break; } // memory.init
        if (sub === 9) { r.skipU(); break; } // data.drop
        if (sub === 10) { r.skipU(); r.skipU(); break; } // memory.copy
        if (sub === 11) { r.skipU(); break; } // memory.fill
        if (sub === 12) { r.skipU(); r.skipU(); break; } // table.init
        if (sub === 13) { r.skipU(); break; } // elem.drop
        if (sub === 14) { r.skipU(); r.skipU(); break; } // table.copy
        if (sub >= 15 && sub <= 17) { r.skipU(); break; } // table.grow/size/fill
        incomplete = true;
        break;
      }
      // --- SIMD / atomics: not modelled, bail honestly ---
      case 0xfd:
      case 0xfe:
        incomplete = true;
        break;
      default:
        if (op >= 0x28 && op <= 0x3e) {
          // memory load/store: memarg = align + offset
          r.skipU();
          r.skipU();
        } else if (op >= 0x45 && op <= 0xc4) {
          // numeric / comparison / conversion / sign-extension: no immediates
        } else {
          incomplete = true;
        }
        break;
    }
  }

  return { calls, indirect, incomplete };
}

// ---------- data-segment string recovery ----------

/**
 * AssemblyScript stores String literals as UTF-16LE. Pull printable ASCII runs
 * out of the UTF-16 stream (event signatures, entity names, log format strings,
 * abort messages all live here).
 */
function collectStrings(bytes: Uint8Array, out: Set<string>, cap: number): void {
  let cur = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const lo = bytes[i];
    const hi = bytes[i + 1];
    if (hi === 0 && lo >= 0x20 && lo <= 0x7e) {
      cur += String.fromCharCode(lo);
    } else {
      if (cur.length >= 4) out.add(cur);
      cur = '';
    }
    if (out.size >= cap) return;
  }
  if (cur.length >= 4 && out.size < cap) out.add(cur);
}

/** Skip a constant init expression (data/element offset) up to its `end` (0x0b). */
function skipConstExpr(r: Reader, end: number): void {
  while (r.pos < end) {
    const op = r.byte();
    if (op === 0x0b) return; // end
    if (op === 0x41 || op === 0x42) r.skipS(); // i32/i64.const
    else if (op === 0x43) r.raw(4); // f32.const
    else if (op === 0x44) r.raw(8); // f64.const
    else if (op === 0x23 || op === 0xd2) r.skipU(); // global.get / ref.func
    else if (op === 0xd0) r.skipS(); // ref.null
    // anything else: keep scanning for the terminating `end`
  }
}

// ---------- top-level parse ----------

const MAX_STRINGS = 1500;

export function parseWasm(bytes: Uint8Array, wasmHash: string): ParsedWasm {
  const r = new Reader(bytes);
  const notes: string[] = [];

  const importByIndex = new Map<number, Categorised>();
  const hostImports: HostImport[] = [];
  let importedFuncCount = 0;
  let otherImportCount = 0;

  const exportFuncs = new Map<string, number>();
  const funcNames = new Map<number, string>();
  const bodies = new Map<number, FuncBody>();
  const strings = new Set<string>();
  let definedFuncCount = 0;
  let incomplete = false;

  if (!checkHeader(r)) {
    throw new Error('Not a WebAssembly module (bad magic)');
  }

  while (!r.eof) {
    const id = r.byte();
    const size = r.u();
    const sectionEnd = r.pos + size;

    try {
      switch (id) {
        case 2: { // import
          const n = r.u();
          for (let i = 0; i < n; i++) {
            const mod = r.name();
            const field = r.name();
            const kind = r.byte();
            if (kind === 0x00) {
              r.u(); // typeidx
              const cat = categorise(mod, field);
              const funcIndex = importedFuncCount++;
              importByIndex.set(funcIndex, cat);
              if (cat.isHost && cat.category !== 'control') {
                hostImports.push({ module: mod, name: field, label: cat.label, category: cat.category, funcIndex, isHost: true });
              } else if (!cat.isHost) {
                otherImportCount++;
              }
            } else if (kind === 0x01) { // table
              r.byte(); // reftype
              const flags = r.byte();
              r.u();
              if (flags & 0x01) r.u();
            } else if (kind === 0x02) { // memory
              const flags = r.byte();
              r.u();
              if (flags & 0x01) r.u();
            } else if (kind === 0x03) { // global
              r.byte(); // valtype
              r.byte(); // mut
            }
          }
          break;
        }
        case 3: { // function
          definedFuncCount = r.u();
          for (let i = 0; i < definedFuncCount; i++) r.u(); // typeidx
          break;
        }
        case 7: { // export
          const n = r.u();
          for (let i = 0; i < n; i++) {
            const nm = r.name();
            const kind = r.byte();
            const idx = r.u();
            if (kind === 0x00) exportFuncs.set(nm, idx);
          }
          break;
        }
        case 10: { // code
          const n = r.u();
          for (let i = 0; i < n; i++) {
            const bodySize = r.u();
            const bodyEnd = r.pos + bodySize;
            // locals
            const localDecls = r.u();
            for (let l = 0; l < localDecls; l++) {
              r.u(); // count
              r.byte(); // valtype
            }
            const funcIndex = importedFuncCount + i;
            const body = scanBody(r, bodyEnd);
            if (body.incomplete) incomplete = true;
            bodies.set(funcIndex, body);
            r.pos = bodyEnd; // defensive resync
          }
          break;
        }
        case 0: { // custom
          const customName = r.name();
          if (customName === 'name') {
            while (r.pos < sectionEnd) {
              const subId = r.byte();
              const subSize = r.u();
              const subEnd = r.pos + subSize;
              if (subId === 1) { // function names
                const n = r.u();
                for (let i = 0; i < n; i++) {
                  const idx = r.u();
                  funcNames.set(idx, r.name());
                }
              }
              r.pos = subEnd;
            }
          }
          break;
        }
        case 11: { // data
          const n = r.u();
          for (let i = 0; i < n; i++) {
            const flags = r.u();
            if (flags === 0x00) {
              skipConstExpr(r, sectionEnd);
            } else if (flags === 0x02) {
              r.u(); // memidx
              skipConstExpr(r, sectionEnd);
            }
            // flags === 0x01 (passive): no memidx, no offset expr
            const len = r.u();
            const seg = r.raw(len);
            collectStrings(seg, strings, MAX_STRINGS);
          }
          break;
        }
        default:
          break;
      }
    } catch {
      notes.push(`Section ${id} could not be fully parsed`);
      incomplete = true;
    }

    // Always resync to the declared section boundary.
    r.pos = sectionEnd;
  }

  if (incomplete && notes.length === 0) {
    notes.push('Some function bodies used opcodes outside the modelled set (SIMD/atomics/post-MVP); reachability may be partial');
  }

  const info: WasmModuleInfo = {
    wasmHash,
    byteSize: bytes.length,
    functionCount: importedFuncCount + definedFuncCount,
    importedFunctionCount: importedFuncCount,
    definedFunctionCount: definedFuncCount,
    hostImports,
    otherImportCount,
    strings: [...strings].sort(),
    namedFunctions: funcNames.size,
    incomplete,
    notes,
  };

  return { info, exportFuncs, bodies, importByIndex };
}

// ---------- per-handler reachability ----------

function reachable(parsed: ParsedWasm, start: number): {
  labels: Set<string>;
  categories: Set<HostCategory>;
  indirect: boolean;
  incomplete: boolean;
} {
  const labels = new Set<string>();
  const categories = new Set<HostCategory>();
  let indirect = false;
  let incomplete = false;

  const visited = new Set<number>();
  const stack = [start];
  while (stack.length) {
    const f = stack.pop()!;
    if (visited.has(f)) continue;
    visited.add(f);

    const imp = parsed.importByIndex.get(f);
    if (imp) {
      // imports are leaves
      if (imp.isHost && MEANINGFUL.has(imp.category)) {
        labels.add(imp.label);
        categories.add(imp.category);
      }
      continue;
    }

    const body = parsed.bodies.get(f);
    if (!body) continue;
    if (body.indirect) indirect = true;
    if (body.incomplete) incomplete = true;
    for (const c of body.calls) if (!visited.has(c)) stack.push(c);
  }

  return { labels, categories, indirect, incomplete };
}

export function analyzeHandler(parsed: ParsedWasm, handler: ParsedHandler): HandlerAnalysis {
  const idx = parsed.exportFuncs.get(handler.handler);
  if (idx === undefined) {
    return {
      handler: handler.handler,
      kind: handler.kind,
      trigger: handler.trigger,
      resolved: false,
      hostImports: [],
      categories: [],
      dynamicDispatch: false,
      incomplete: false,
    };
  }

  const { labels, categories, indirect, incomplete } = reachable(parsed, idx);
  return {
    handler: handler.handler,
    kind: handler.kind,
    trigger: handler.trigger,
    resolved: true,
    hostImports: [...labels].sort(),
    categories: [...categories].sort(),
    dynamicDispatch: indirect,
    incomplete,
  };
}
