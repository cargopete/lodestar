// ethereum.decode() compatibility audit — graph-node 0.42 alloy migration.
//
// graph-node 0.42 (graphprotocol/graph-node#6063) swapped its ABI type-string
// parser from ethabi to alloy. alloy is strict where ethabi was absurdly lenient,
// so `ethereum.decode(typeString, data)` calls whose type string ethabi accepted
// but alloy rejects now return null on graph-node >= 0.42 — often as *silent* data
// loss (see #6683 CCTP `bytes128`, #6461 `" address"`).
//
// The type string is a compile-time constant in the mapping's data segment, so
// affected deployments are detectable statically from the WASM we already parse.
// Classification uses the *real* ethabi + alloy parsers compiled to WASM
// (crates/decode-classify) — never a TS approximation, because ethabi's leniency
// is bizarre (it parses `" address"` as uint8) and an approximation would miss cases.

import type { WasmModuleInfo, DecodeAudit, DecodeFinding } from './types';
import { classifyJson, classifierLoads } from './decode-classify/loader';

// ---------- exact-parity classifier (committed wasm-pack artifact) ----------
//
// Classification uses the real ethabi/alloy parsers compiled to WASM. If the
// artifact can't be loaded the audit degrades to "unavailable" rather than
// crashing the disassembly — a transparency tool must never lie about analysis
// it couldn't run. Loading details live in ./decode-classify/loader.

/** Whether the exact-parity classifier could be loaded in this runtime. */
export function classifierAvailable(): boolean {
  return classifierLoads();
}

export interface Classification {
  /** Debug of the ethabi ParamType (graph-node <=0.41), or null if ethabi rejects */
  ethabi: string | null;
  /** whether alloy (graph-node >=0.42) accepts the string */
  alloyOk: boolean;
  /** alloy's rejection message, or null on success */
  alloyErr: string | null;
}

/** Classify one type string via the real ethabi/alloy parsers. null if unavailable. */
export function classifyType(s: string): Classification | null {
  const raw = classifyJson(s);
  if (raw === null) return null;
  try {
    const r = JSON.parse(raw) as {
      ethabi: string | null;
      alloy_ok: boolean;
      alloy_err: string | null;
    };
    return { ethabi: r.ethabi, alloyOk: r.alloy_ok, alloyErr: r.alloy_err };
  } catch {
    return null;
  }
}

// ---------- candidate extraction ----------

/**
 * ABI-ish shape (bare type or tuple), per the audit spec. Deliberately loose —
 * false positives are acceptable, we label the panel as a static scan.
 */
const CANDIDATE_RE =
  /^\s*\(?\s*(u?int[0-9]*|bytes[0-9]*|address|bool|string|fixed[0-9x]*|ufixed[0-9x]*)(\[[0-9]*\])*(\s*,\s*\(?[a-zA-Z0-9[\](), ]*\)?)*\s*\)?\s*$/;
/** At least one real ABI keyword must be present, to cut generic-string noise. */
const TYPE_KEYWORD_RE = /uint|int|bytes|address|bool|string/;

const MIN_LEN = 4;
const MAX_LEN = 2048;

/**
 * The `(...)` slice from the first `(` to its matching `)`, or null. Recovers a
 * clean tuple type from a data-segment string that picked up junk on either side
 * — e.g. a printable object-header byte over-joined during memory reconstruction
 * (`(uint32,...,bytes128)\` → `(uint32,...,bytes128)`).
 */
function balancedTupleSlice(s: string): string | null {
  const open = s.indexOf('(');
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') {
      depth--;
      if (depth === 0) return s.slice(open, i + 1);
    }
  }
  return null;
}

/**
 * The single cleaned form of a recovered string worth classifying — NOT the raw
 * string. Memory reconstruction routinely over-joins a printable header byte
 * onto a constant (`(…,bool)L`, `string,`), and ethabi's fallback silently
 * parses ANY unparseable string as `Uint(8)`, which alloy rejects — so the raw
 * junk-suffixed form manufactures a false divergence. We therefore classify the
 * balanced tuple (the real decode argument) or the trailing-junk-trimmed type.
 * Leading whitespace is preserved — a leading space is itself a divergence (the
 * #6461 `" address"` case), and it is never junk.
 */
function candidateForms(s: string): string[] {
  const tuple = balancedTupleSlice(s);
  if (tuple) return [tuple];
  const trimmed = s.replace(/[^A-Za-z0-9\])]+$/, '');
  return trimmed ? [trimmed] : [];
}

/** Pick ABI-shaped candidate type strings out of recovered data-segment strings. */
export function extractDecodeCandidates(strings: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of strings) {
    if (s.length < MIN_LEN || s.length > MAX_LEN) continue;
    for (const form of candidateForms(s)) {
      if (form.length < MIN_LEN || form.length > MAX_LEN) continue;
      if (!TYPE_KEYWORD_RE.test(form)) continue;
      if (!CANDIDATE_RE.test(form)) continue;
      if (seen.has(form)) continue;
      seen.add(form);
      out.push(form);
    }
  }
  return out;
}

/** Render whitespace visibly so leading/trailing/inner spaces are obvious in the UI. */
export function visibleWhitespace(s: string): string {
  return s.replace(/ /g, '·').replace(/\t/g, '→');
}

// ---------- per-module audit ----------

/**
 * Audit one mapping module for `ethereum.decode` alloy-migration divergence.
 * Only surfaces findings for modules that actually import `ethereum.decode`; a
 * divergent-looking string in a module that never decodes is almost certainly
 * noise (e.g. an embedded ABI definition), so we gate on the import.
 */
export function auditModule(wasm: WasmModuleInfo): DecodeAudit {
  // graph-ts import shapes vary: (module="ethereum", name="decode"),
  // (module=<file>, name="ethereum.decode"), and (module="ethereum",
  // name="ethereum.decode") → label "ethereum.ethereum.decode". Match on the
  // recognised ethereum category plus a "decode" field rather than one label.
  const usesDecode = wasm.hostImports.some(
    (h) => h.category === 'ethereum' && (h.name === 'decode' || h.name.endsWith('.decode')),
  );
  if (!usesDecode) {
    return { usesDecode: false, candidatesScanned: 0, findings: [], status: 'no-import' };
  }

  const candidates = extractDecodeCandidates(wasm.strings);
  const findings: DecodeFinding[] = [];
  let anyClassified = false;

  for (const raw of candidates) {
    const c = classifyType(raw);
    if (!c) continue; // classifier unavailable — handled below
    anyClassified = true;
    // DIVERGENT ⇔ ethabi accepts && alloy rejects.
    if (c.ethabi !== null && !c.alloyOk) {
      findings.push({
        raw,
        display: visibleWhitespace(raw),
        ethabi: c.ethabi,
        alloyReason: c.alloyErr ?? 'rejected by alloy (graph-node ≥0.42)',
      });
    }
  }

  // Couldn't classify anything (and there was something to classify) → be honest.
  if (!anyClassified && candidates.length > 0 && !classifierAvailable()) {
    return {
      usesDecode: true,
      candidatesScanned: candidates.length,
      findings: [],
      status: 'clean',
      unavailable: true,
    };
  }

  return {
    usesDecode: true,
    candidatesScanned: candidates.length,
    findings,
    status: findings.length > 0 ? 'divergent' : 'clean',
  };
}
