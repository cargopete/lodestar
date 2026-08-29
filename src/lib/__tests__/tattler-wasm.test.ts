/**
 * The verifier that actually ships, exercised against a receipt issued from live production data.
 *
 * **Why this test earns its place.** `/verify` serves a compiled Rust artefact from `public/`. The
 * whole argument for compiling the verifier rather than rewriting it in TypeScript is that there is
 * then exactly one canonicalisation, so the browser and the CLI cannot disagree. A committed binary
 * quietly reintroduces the risk from the other side: change `canonical.rs` in the tattler repo,
 * forget to rebuild, and this page keeps verifying by yesterday's rules while `tattler verify`
 * uses today's. Nothing would fail, and the two would silently diverge — which is precisely the
 * failure the design exists to prevent.
 *
 * So this runs the shipped `.wasm` against the same frozen fixture that tattler's own
 * `tests/fixture.rs` pins. If the binary is stale in any way that changes an answer, this fails.
 *
 * The node glue sits beside the wasm in `public/tattler/` because `wasm-bindgen`'s web and nodejs
 * targets emit byte-identical `.wasm` — verified, not assumed — so both wrap one binary and there
 * is nothing to drift.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const PUBLIC = path.join(process.cwd(), 'public', 'tattler');

/** Issued 2026-08-29 against `staking`, pinned at block 497,000,000, and independently reproduced
 *  by the separately backfilled `legacy-flows` nest. */
const FROZEN_HASH = '0x87bace01dd464438c431fdac73191fb479f5d2ffbf02a20b4e784978ae91bab4';

interface Wasm {
  verify_receipt: (json: string) => string;
  result_hash: (rowsJson: string) => string;
}

let wasm: Wasm;
let receipt: string;

beforeAll(() => {
  wasm = require(path.join(PUBLIC, 'tattler_wasm_node.cjs')) as Wasm;
  receipt = readFileSync(
    path.join(process.cwd(), 'src/lib/__tests__/fixtures/receipt-staking-497000000.json'),
    'utf8'
  );
});

const check = (json: string) => JSON.parse(wasm.verify_receipt(json));

describe('the shipped tattler verifier', () => {
  it('accepts a real receipt', () => {
    const r = check(receipt);
    expect(r.verdict).toBe('ok');
    expect(r.ok).toBe(true);
    expect(r.body.as_of_block).toBe(497_000_000);
    expect(r.body.result_hash).toBe(FROZEN_HASH);
  });

  it('still computes the frozen canonical hash', () => {
    const rows = JSON.parse(receipt).rows;
    const r = JSON.parse(wasm.result_hash(JSON.stringify(rows)));
    expect(r.detail, 'the wasm in public/ is stale: rebuild it from the tattler repo').toBe(
      FROZEN_HASH
    );
  });

  // Three genuinely different situations. Collapsing them into "invalid" would tell a reader
  // nothing about whether they are looking at a bad paste or at somebody lying.
  it('reports edited rows distinctly from an edited body', () => {
    const edited = JSON.parse(receipt);
    edited.rows[0].tokens = '999999999999999999999';
    expect(check(JSON.stringify(edited)).verdict).toBe('rows_altered');

    const rebody = JSON.parse(receipt);
    rebody.body.as_of_block = 1;
    expect(check(JSON.stringify(rebody)).verdict).toBe('bad_signature');
  });

  it('calls a bad paste malformed rather than a forgery', () => {
    expect(check('{"nope":1}').verdict).toBe('malformed');
    expect(check('not json').verdict).toBe('malformed');
  });

  /** The row-order independence the whole scheme rests on, checked through the shipped artefact. */
  it('does not care what order the rows arrive in', () => {
    const rows = JSON.parse(receipt).rows;
    const a = JSON.parse(wasm.result_hash(JSON.stringify(rows)));
    const b = JSON.parse(wasm.result_hash(JSON.stringify([...rows].reverse())));
    expect(a.detail).toBe(b.detail);
  });
});
