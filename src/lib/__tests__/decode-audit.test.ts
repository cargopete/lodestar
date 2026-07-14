import { describe, it, expect } from 'vitest';
import {
  classifyType,
  classifierAvailable,
  extractDecodeCandidates,
  visibleWhitespace,
  auditModule,
} from '../disassembly/decode-audit';
import { parseWasm } from '../disassembly/wasm';

// The exact-parity classifier is a committed wasm-pack artifact (crates/decode-classify).
// If this ever fails, run `npm run build:classifier` — CI/Vercel need no Rust otherwise.
describe('classifier availability', () => {
  it('the committed ethabi/alloy WASM loads', () => {
    expect(classifierAvailable()).toBe(true);
  });
});

// Verified vectors from the audit spec — the exact behaviour of the real
// ethabi (graph-node ≤0.41) and alloy (≥0.42) parsers.
describe('classifyType — DIVERGENT (ethabi accepts, alloy rejects)', () => {
  const divergent: [string, string][] = [
    ['bytes128', 'FixedBytes(128)'], // the #6683 CCTP case
    ['bytes33', 'FixedBytes(33)'],
    ['bytes0', 'FixedBytes(0)'],
    ['(uint32,uint32,uint32,uint64,bytes32,bytes32,bytes32,bytes128)', 'FixedBytes(128)'],
    [' address', 'Uint(8)'], // the #6461 case
    ['address ', 'Uint(8)'],
    ['uint255', 'Uint(255)'],
    ['uint257', 'Uint(257)'],
    ['uint8[0]', 'FixedArray(Uint(8), 0)'],
    ['address[', 'Uint(8)'],
  ];

  it.each(divergent)('%j is divergent', (input, ethabiFragment) => {
    const c = classifyType(input);
    expect(c).not.toBeNull();
    expect(c!.ethabi).not.toBeNull(); // ethabi accepts
    expect(c!.ethabi).toContain(ethabiFragment);
    expect(c!.alloyOk).toBe(false); // alloy rejects
  });
});

describe('classifyType — fine (accepted by both, or rejected by ethabi too)', () => {
  const fine = [
    'uint',
    'int',
    'uint32',
    'string',
    'bool[2]',
    'uint256[]',
    '(uint256,address)',
    '(address)',
    '()',
  ];

  it.each(fine)('%j parses under both', (input) => {
    const c = classifyType(input);
    expect(c).not.toBeNull();
    expect(c!.ethabi).not.toBeNull();
    expect(c!.alloyOk).toBe(true);
  });

  it('tuple(...) is rejected by ethabi, so it is not a divergence', () => {
    // Would have failed pre-0.42, so no deployed subgraph relies on it.
    const c = classifyType('tuple(uint256,address)');
    expect(c).not.toBeNull();
    expect(c!.ethabi).toBeNull(); // ethabi rejects → not DIVERGENT
    expect(c!.alloyOk).toBe(true);
  });
});

describe('extractDecodeCandidates', () => {
  it('keeps ABI-shaped strings', () => {
    const got = extractDecodeCandidates([
      'bytes128',
      '(uint32,uint64,bytes32)',
      'uint256[]',
      'address',
    ]);
    expect(got).toContain('bytes128');
    expect(got).toContain('(uint32,uint64,bytes32)');
    expect(got).toContain('uint256[]');
  });

  it('drops non-ABI noise and strings without a type keyword', () => {
    const got = extractDecodeCandidates([
      'Approval',
      'https://example.com',
      'entity.save',
      'foo', // too short
      'someRandomLabel',
    ]);
    // None of these are ABI type strings.
    expect(got).toEqual([]);
  });

  it('pulls the tuple out of an event-signature-shaped string (harmless — classifies fine)', () => {
    // balancedTupleSlice makes the scan thorough: it would catch a divergent type
    // hiding inside a `name(...)` wrapper. These particular args parse fine.
    const got = extractDecodeCandidates(['Transfer(address,address,uint256)']);
    expect(got).toContain('(address,address,uint256)');
  });

  it('recovers a clean tuple from an over-joined string (trailing header junk)', () => {
    // Memory reconstruction can append a printable header byte (e.g. "\\").
    const got = extractDecodeCandidates(['(uint32,uint64,bytes128)\\']);
    expect(got).toContain('(uint32,uint64,bytes128)');
  });

  it('does not manufacture a false divergence from junk-suffixed valid tuples', () => {
    // ethabi's fallback parses ANY unparseable string as Uint(8), which alloy
    // rejects — so a raw over-joined "(...,bool)L" would falsely read DIVERGENT.
    // We classify the cleaned tuple instead, which is valid under both parsers.
    const got = extractDecodeCandidates(['(address,address,uint256,bool)L']);
    expect(got).toEqual(['(address,address,uint256,bool)']);
    const c = classifyType('(address,address,uint256,bool)');
    expect(Boolean(c && c.ethabi !== null && !c.alloyOk)).toBe(false);
  });

  it('dedupes', () => {
    const got = extractDecodeCandidates(['bytes128', 'bytes128']);
    expect(got).toEqual(['bytes128']);
  });
});

describe('visibleWhitespace', () => {
  it('makes leading/trailing spaces visible', () => {
    expect(visibleWhitespace(' address')).toBe('·address');
    expect(visibleWhitespace('address ')).toBe('address·');
  });
});

// ---- synthetic WASM fixture -------------------------------------------------
// header + type section + import(ethereum.decode) + a data segment holding two
// UTF-16LE type strings: a clean tuple and the CCTP divergent tuple. Mirrors the
// byte-building style in disassembly-verify.test.ts.

function uleb(n: number): number[] {
  const out: number[] = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return out;
}

function str(s: string): number[] {
  const b = [...Buffer.from(s, 'utf8')];
  return [b.length, ...b];
}

function utf16le(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    out.push(c & 0xff, (c >> 8) & 0xff);
  }
  return out;
}

const CLEAN_STRING = '(uint32,uint64,bytes32)';
const CCTP_STRING = '(uint32,uint32,uint32,uint64,bytes32,bytes32,bytes32,bytes128)';

function decodeFixture({ withDecodeImport }: { withDecodeImport: boolean }): Uint8Array {
  const header = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  const typeSec = [0x01, 0x04, 0x01, 0x60, 0x00, 0x00]; // one () -> () functype

  // import section: ethereum.decode (or a benign store.set when withDecodeImport=false)
  const impMod = withDecodeImport ? 'ethereum' : 'store';
  const impName = withDecodeImport ? 'decode' : 'set';
  const impEntry = [...str(impMod), ...str(impName), 0x00, 0x00]; // func kind, typeidx 0
  const impPayload = [0x01, ...impEntry];
  const importSec = [0x02, ...uleb(impPayload.length), ...impPayload];

  // data section: one active segment at offset 0 holding both UTF-16LE strings,
  // separated by a 0x0000 pair so collectStrings flushes between them.
  const seg = [...utf16le(CLEAN_STRING), 0x00, 0x00, ...utf16le(CCTP_STRING)];
  const offsetExpr = [0x41, 0x00, 0x0b]; // i32.const 0; end
  const dataPayload = [0x01, 0x00, ...offsetExpr, ...uleb(seg.length), ...seg];
  const dataSec = [0x0b, ...uleb(dataPayload.length), ...dataPayload];

  return new Uint8Array([...header, ...typeSec, ...importSec, ...dataSec]);
}

describe('auditModule — synthetic fixture', () => {
  it('flags exactly one DIVERGENT string (the CCTP bytes128 tuple)', () => {
    const parsed = parseWasm(decodeFixture({ withDecodeImport: true }), 'QmFixture');
    // Both strings were recovered from the data segment.
    expect(parsed.info.strings).toContain(CLEAN_STRING);
    expect(parsed.info.strings).toContain(CCTP_STRING);

    const audit = auditModule(parsed.info);
    expect(audit.usesDecode).toBe(true);
    expect(audit.status).toBe('divergent');
    expect(audit.findings).toHaveLength(1);
    expect(audit.findings[0].raw).toBe(CCTP_STRING);
    expect(audit.findings[0].ethabi).toContain('FixedBytes(128)');
  });

  it('reports no-import when the module does not import ethereum.decode', () => {
    const parsed = parseWasm(decodeFixture({ withDecodeImport: false }), 'QmFixture');
    const audit = auditModule(parsed.info);
    expect(audit.usesDecode).toBe(false);
    expect(audit.status).toBe('no-import');
    expect(audit.findings).toEqual([]);
  });
});

// Reproduce the real CCTP layout: AssemblyScript splits a string across multiple
// odd-length data segments so a UTF-16 char straddles a boundary, and packs an
// adjacent constant with no zero gap (a printable header byte over-joins). The
// memory reconstruction in wasm.ts + candidate trimming must still recover it.
function sleb(n: number): number[] {
  const out: number[] = [];
  let more = true;
  while (more) {
    let b = n & 0x7f;
    n >>= 7;
    if ((n === 0 && !(b & 0x40)) || (n === -1 && b & 0x40)) more = false;
    else b |= 0x80;
    out.push(b);
  }
  return out;
}

function straddleFixture(): Uint8Array {
  const header = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  const typeSec = [0x01, 0x04, 0x01, 0x60, 0x00, 0x00];
  const impEntry = [...str('ethereum'), ...str('ethereum.decode'), 0x00, 0x00];
  const importSec = [0x02, ...uleb(impEntry.length + 1), 0x01, ...impEntry];

  const full = utf16le(CCTP_STRING); // 122 bytes, even
  const base = 1024; // even base
  // Split at an ODD index so the char at the seam straddles: 121 → the ')' low
  // byte ends segment A, its high byte begins segment B.
  const a = full.slice(0, 121);
  const b = full.slice(121);
  const junk = [0x5c, 0x00]; // a '\' immediately after ')' — memory-adjacent over-join

  const segEntries = [
    { off: base, bytes: a },
    { off: base + a.length, bytes: b },
    { off: base + full.length, bytes: junk },
  ];
  const segs: number[] = [];
  for (const { off, bytes } of segEntries) {
    segs.push(0x00, 0x41, ...sleb(off), 0x0b, ...uleb(bytes.length), ...bytes);
  }
  const dataPayload = [segEntries.length, ...segs];
  const dataSec = [0x0b, ...uleb(dataPayload.length), ...dataPayload];

  return new Uint8Array([...header, ...typeSec, ...importSec, ...dataSec]);
}

describe('parseWasm — straddling UTF-16 across data segments', () => {
  it('recovers the full CCTP string despite the boundary split + over-join', () => {
    const parsed = parseWasm(straddleFixture(), 'QmStraddle');
    const audit = auditModule(parsed.info);
    expect(audit.usesDecode).toBe(true);
    expect(audit.status).toBe('divergent');
    expect(audit.findings).toHaveLength(1);
    expect(audit.findings[0].raw).toBe(CCTP_STRING); // clean, closing ')' restored
  });
});
