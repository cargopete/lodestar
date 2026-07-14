// Self-contained loader for the committed decode-classify WASM.
//
// We deliberately do NOT `require`/`import` the wasm-pack JS glue: bundlers
// (Turbopack, webpack) statically trace such a require and fail to resolve the
// runtime path at build time. Instead we read the `.wasm` bytes ourselves from a
// path computed at runtime (invisible to the module tracer) and reproduce the
// tiny wasm-bindgen calling convention here. next.config's
// outputFileTracingIncludes ensures the artifact ships with the function.
//
// Only Node built-ins (fs) + the WebAssembly API are used, so this works
// identically under Next server runtime and vitest. Any failure degrades to
// "unavailable" (classifyJson → null) rather than throwing.

import fs from 'node:fs';
import path from 'node:path';

const WASM_REL = 'src/lib/disassembly/decode-classify/pkg/decode_classify_bg.wasm';

interface WasmExports {
  memory: WebAssembly.Memory;
  classify_json(ptr: number, len: number): [number, number];
  __wbindgen_malloc(size: number, align: number): number;
  __wbindgen_realloc(ptr: number, oldSize: number, newSize: number, align: number): number;
  __wbindgen_free(ptr: number, size: number, align: number): void;
  __wbindgen_externrefs: WebAssembly.Table;
  __wbindgen_start(): void;
}

let wasm: WasmExports | null = null;
let loadState: 'ok' | 'fail' | undefined;
let cachedMem: Uint8Array | null = null;

const decoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
const encoder = new TextEncoder();
let vectorLen = 0;

function memU8(): Uint8Array {
  if (cachedMem === null || cachedMem.byteLength === 0) {
    cachedMem = new Uint8Array(wasm!.memory.buffer);
  }
  return cachedMem;
}

function getString(ptr: number, len: number): string {
  return decoder.decode(memU8().subarray(ptr >>> 0, (ptr >>> 0) + len));
}

// Faithful port of wasm-bindgen's passStringToWasm0 (UTF-8, grows on demand).
function passString(arg: string): number {
  const malloc = wasm!.__wbindgen_malloc;
  const realloc = wasm!.__wbindgen_realloc;

  let len = arg.length;
  let ptr = malloc(len, 1) >>> 0;
  const mem = memU8();

  let offset = 0;
  for (; offset < len; offset++) {
    const code = arg.charCodeAt(offset);
    if (code > 0x7f) break;
    mem[ptr + offset] = code;
  }

  if (offset !== len) {
    if (offset !== 0) arg = arg.slice(offset);
    ptr = realloc(ptr, len, (len = offset + arg.length * 3), 1) >>> 0;
    const view = memU8().subarray(ptr + offset, ptr + len);
    const ret = encoder.encodeInto(arg, view);
    offset += ret.written ?? 0;
    ptr = realloc(ptr, len, offset, 1) >>> 0;
  }

  vectorLen = offset;
  return ptr;
}

function buildImports(module: WebAssembly.Module): WebAssembly.Imports {
  const imports: WebAssembly.Imports = {};
  for (const im of WebAssembly.Module.imports(module)) {
    const group = (imports[im.module] ??= {} as WebAssembly.ModuleImports);
    if (im.kind !== 'function') continue;
    if (im.name.includes('__wbindgen_throw')) {
      group[im.name] = (ptr: number, len: number) => {
        throw new Error(getString(ptr, len));
      };
    } else if (im.name.includes('init_externref_table')) {
      group[im.name] = () => {
        const table = wasm!.__wbindgen_externrefs;
        const offset = table.grow(4);
        table.set(0, undefined);
        table.set(offset + 0, undefined);
        table.set(offset + 1, null);
        table.set(offset + 2, true);
        table.set(offset + 3, false);
      };
    } else {
      // Unmodelled import — the crate grew a dependency on JS interop we didn't
      // reproduce. Fail loudly at instantiation so it degrades to "unavailable".
      group[im.name] = () => {
        throw new Error(`decode-classify: unexpected wasm import ${im.module}.${im.name}`);
      };
    }
  }
  return imports;
}

function ensureLoaded(): boolean {
  if (loadState !== undefined) return loadState === 'ok';
  try {
    const bytes = fs.readFileSync(path.join(process.cwd(), WASM_REL));
    const wasmModule = new WebAssembly.Module(bytes);
    const instance = new WebAssembly.Instance(wasmModule, buildImports(wasmModule));
    wasm = instance.exports as unknown as WasmExports;
    cachedMem = null;
    wasm.__wbindgen_start();
    loadState = 'ok';
  } catch {
    wasm = null;
    loadState = 'fail';
  }
  return loadState === 'ok';
}

/** Whether the committed classifier WASM instantiates in this runtime. */
export function classifierLoads(): boolean {
  return ensureLoaded();
}

/**
 * Classify one type string. Returns the raw JSON from the crate
 * (`{ ethabi, alloy_ok, alloy_err }`), or null if the classifier is unavailable.
 */
export function classifyJson(s: string): string | null {
  if (!ensureLoaded() || !wasm) return null;
  let deferredPtr: number | undefined;
  let deferredLen: number | undefined;
  try {
    const ptr = passString(s);
    const len = vectorLen;
    const ret = wasm.classify_json(ptr, len);
    deferredPtr = ret[0];
    deferredLen = ret[1];
    return getString(ret[0], ret[1]);
  } catch {
    return null;
  } finally {
    if (deferredPtr !== undefined && deferredLen !== undefined) {
      wasm.__wbindgen_free(deferredPtr, deferredLen, 1);
    }
  }
}
