'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

// The verifier is the tattler crate compiled to WebAssembly, served from /public/tattler. It is
// deliberately NOT a TypeScript reimplementation: verification hinges on two parties computing
// byte-identical canonical bytes, and a second implementation is a second set of decisions about
// key ordering, integer formatting and length prefixes. The day the two disagree, this page reports
// a forgery that never happened, and whoever chases it is debugging the verifier while believing
// they are auditing the data.
//
// Everything below runs in the reader's browser. Nothing is uploaded. Checking a receipt against
// our server would mean trusting us, which is the exact thing a receipt exists to avoid, so the one
// page on this site that must not phone home does not.

interface Verdict {
  ok: boolean;
  /** `not_proven` and `no_commitment` only ever come back for a disclosure. */
  verdict:
    | 'ok'
    | 'malformed'
    | 'rows_altered'
    | 'bad_signature'
    | 'not_proven'
    | 'no_commitment'
    | 'error';
  detail?: string;
  /** Which of the two artefacts this was read as. Decided here, not by the reader. */
  kind?: 'receipt' | 'disclosure';
  body?: {
    merkle_root?: string | null;
    disclosed_row?: Record<string, unknown>;
    path_len?: number;
    nid: string | null;
    dataset: string;
    query: string;
    as_of_block: number;
    sealed_through: number;
    registry_hash: string | null;
    result_hash: string;
    row_count: number;
    issued_at: string;
  };
}

type WasmModule = {
  default: (init?: { module_or_path: string }) => Promise<unknown>;
  verify_receipt: (json: string) => string;
  verify_disclosure: (json: string) => string;
};

const PLACEHOLDER = `Paste a receipt or a disclosure here, or drop the .json file anywhere on
this page. Which one it is is worked out from its shape.

Produce a receipt with:
  tattler attest --endpoint https://www.lodestar-dashboard.com \\
    --dataset staking --as-of 497000000 \\
    --query "SELECT ... WHERE block_number <= 497000000" \\
    --key issuer.key --out receipt.json

And a disclosure, showing one row of it and no others, with:
  tattler disclose --receipt receipt.json \\
    --matching delegator=0x... --out disclosure.json`;

export default function VerifyPage() {
  const [text, setText] = useState('');
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const wasm = useRef<WasmModule | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Loaded through a constructed import so neither TypeScript nor the bundler tries to
        // resolve it: these two files are build outputs of a Rust crate served from /public, not
        // modules in this project. Bundling them would mean a copy of the verifier that drifts
        // from the one the CLI ships, which is the single thing this design exists to prevent.
        const importAtRuntime = new Function('p', 'return import(p)') as (
          p: string
        ) => Promise<WasmModule>;
        const mod = await importAtRuntime('/tattler/tattler_wasm.js');
        // The object form, not the bare path: wasm-bindgen still accepts a string and warns that
        // it is deprecated, and a deprecation warning on the one page whose whole argument is that
        // it can be trusted is noise nobody should have to weigh up.
        await mod.default({ module_or_path: '/tattler/tattler_wasm_bg.wasm' });
        if (cancelled) return;
        wasm.current = mod;
        setReady(true);
      } catch (e) {
        if (!cancelled) setLoadError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const check = useCallback((raw: string) => {
    setText(raw);
    if (!raw.trim() || !wasm.current) {
      setVerdict(null);
      return;
    }
    try {
      // A disclosure carries a `proof` and no rows; a receipt carries rows and no proof. Routing on
      // the shape rather than asking the reader to pick, because someone handed one of these has no
      // reason to know which they were sent, and the two make different claims. Checking one as the
      // other would report a bad paste for an artefact that is perfectly good.
      let isDisclosure = false;
      try {
        const parsed = JSON.parse(raw) as { proof?: unknown };
        isDisclosure = typeof parsed === 'object' && parsed !== null && 'proof' in parsed;
      } catch {
        // Not JSON at all. Fall through to the receipt path, which names that properly.
      }
      const out = isDisclosure
        ? wasm.current.verify_disclosure(raw)
        : wasm.current.verify_receipt(raw);
      setVerdict({
        ...(JSON.parse(out) as Verdict),
        kind: isDisclosure ? 'disclosure' : 'receipt',
      });
    } catch (e) {
      setVerdict({ ok: false, verdict: 'error', detail: String(e) });
    }
  }, []);

  // Dropping the file is how anyone who was sent one will actually use this.
  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) check(await file.text());
    },
    [check]
  );

  return (
    <main
      className="max-w-[1000px] mx-auto px-4 py-8"
      onDrop={onDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <header className="mb-6">
        <h1
          className="text-2xl font-semibold text-[var(--text)] mb-2"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Verify a receipt
        </h1>
        <p className="text-sm text-[var(--text-muted)] max-w-2xl">
          Check a{' '}
          <a
            href="https://github.com/nightswatchhq/tattler"
            target="_blank"
            rel="noreferrer"
            className="text-[var(--accent)] hover:underline"
          >
            tattler
          </a>{' '}
          receipt: whether the rows still hash to what was signed, and whether the signature covers
          the body. Or a disclosure, which shows one row of an answer and proves it belonged there
          without handing over the rest. This runs entirely in your browser, on the same compiled
          Rust the command-line tool runs. Nothing is uploaded, because checking a receipt against
          our server would mean trusting us.
        </p>
      </header>

      {loadError && (
        <Card className="mb-4 border-[var(--amber)]">
          <p className="text-sm text-[var(--amber)]">
            The verifier failed to load, so nothing on this page can be trusted right now. Use{' '}
            <code className="font-mono">tattler verify</code> instead.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <textarea
            value={text}
            onChange={(e) => check(e.target.value)}
            placeholder={PLACEHOLDER}
            spellCheck={false}
            rows={18}
            className="w-full font-mono text-[12px] leading-relaxed bg-[var(--bg-elevated)] border-[0.5px] border-[var(--border)] rounded-[var(--radius-button)] p-3 text-[var(--text)] outline-none focus:border-[var(--accent)] resize-y"
          />
          <p className="text-[11px] text-[var(--text-faint)] mt-2">
            {ready ? 'Verifier loaded. Checks as you type.' : 'Loading the verifier…'}
          </p>
        </Card>

        <div className="space-y-4">
          {verdict && <VerdictCard v={verdict} />}

          {/* What a disclosure does and does not hide, stated up front rather than in the docs. */}
          <Card>
            <h3 className="text-sm font-semibold text-[var(--text)] mb-1">
              What a disclosure shows
            </h3>
            <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
              One row, how many rows there were, and the question that was asked. Not the other
              rows: those are present only as hashes of hashes, and the answer they came from is
              never sent. It is for the ordinary case where a counterparty wants to check a single
              line and the holder will prove that line without publishing the book.
            </p>
            <p className="text-[13px] text-[var(--text-muted)] leading-relaxed mt-2">
              The limit worth knowing: the leaves are{' '}
              <strong className="text-[var(--text)]">not salted</strong>, so anyone holding a
              disclosure can test a guess at a neighbouring row by hashing it. Against rows carrying
              an address or a <code className="font-mono text-[11px]">uint256</code> that is no
              help at all. Against rows drawn from a small set, a single low-cardinality column
              say, it is trivial. Disclose from the former.
            </p>
          </Card>

          {/* The honest limit, stated where it cannot be missed rather than in a footnote. */}
          <Card>
            <h3 className="text-sm font-semibold text-[var(--text)] mb-1">
              What a green tick here does not mean
            </h3>
            <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
              It means nobody edited the rows since they were signed. It does{' '}
              <strong className="text-[var(--text)]">not</strong> mean the answer is true: a signed
              wrong answer is a wrong answer, signed. For that, replay the receipt&apos;s question
              against a nest the issuer does not run and compare hashes.
            </p>
            <pre className="mt-2 text-[11px] font-mono text-[var(--text-faint)] whitespace-pre-wrap break-all">
              tattler replay --receipt receipt.json --endpoint &lt;not theirs&gt;
            </pre>
            <p className="text-[11px] text-[var(--text-faint)] mt-2">
              Replay is a command-line job on purpose: it has to talk to an endpoint of your
              choosing, and a browser on this domain is the wrong thing to route that through. You
              can start from the datasets on the{' '}
              <Link href="/sql" className="text-[var(--accent)] hover:underline">
                SQL page
              </Link>
              .
            </p>
          </Card>
        </div>
      </div>
    </main>
  );
}

function VerdictCard({ v }: { v: Verdict }) {
  const tone = v.ok ? 'var(--green)' : 'var(--amber)';
  // A disclosure and a receipt do not make the same claim, so a green tick must not read the same
  // way for both. "rows unaltered" would be an outright lie about a disclosure: it carries no rows.
  const label: Record<Verdict['verdict'], string> =
    v.kind === 'disclosure'
      ? {
          ok: 'This row was in the answer that was signed',
          rows_altered: 'The rows were changed after signing',
          bad_signature: 'The signature does not cover this body',
          not_proven: 'Signed body, and this row does not belong to it',
          no_commitment: 'That answer committed to nothing to prove against',
          malformed: 'Not a disclosure',
          error: 'Could not check this',
        }
      : {
          ok: 'Signature valid, rows unaltered',
          rows_altered: 'The rows were changed after signing',
          bad_signature: 'The signature does not cover this body',
          not_proven: 'Signed body, and this row does not belong to it',
          no_commitment: 'That answer committed to nothing to prove against',
          malformed: 'Not a receipt',
          error: 'Could not check this',
        };

  return (
    <Card className={cn('border-[0.5px]')} >
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: tone }} />
        <span className="text-sm font-medium" style={{ color: tone }}>
          {label[v.verdict]}
        </span>
      </div>

      {v.detail && (
        <p className="text-[12px] text-[var(--text-muted)] font-mono break-words mb-3">{v.detail}</p>
      )}

      {v.kind === 'disclosure' && v.body?.disclosed_row && (
        <div className="mb-3">
          <div className="text-[var(--text-faint)] uppercase tracking-wide text-[10px] mb-1">
            the one row being shown, of {v.body.row_count}
          </div>
          <pre className="font-mono text-[11px] text-[var(--text)] whitespace-pre-wrap break-words bg-[var(--bg-elevated)] rounded p-2">
            {JSON.stringify(v.body.disclosed_row, null, 1)}
          </pre>
          <p className="text-[11px] text-[var(--text-faint)] mt-1.5">
            The other {v.body.row_count - 1} are not here and cannot be recovered from what you
            hold. {v.body.path_len} sibling hashes were enough to prove this one belongs.
          </p>
        </div>
      )}

      {v.body && (
        <dl className="text-[12px] space-y-1.5">
          <Row k="dataset" val={v.body.dataset} />
          <Row k="as of block" val={v.body.as_of_block.toLocaleString()} />
          <Row k="sealed through" val={v.body.sealed_through.toLocaleString()} />
          <Row k="rows" val={String(v.body.row_count)} />
          <Row k="issued" val={v.body.issued_at} />
          {v.body.nid && <Row k="nest id" val={v.body.nid} mono />}
          {v.body.registry_hash && <Row k="registry" val={v.body.registry_hash} mono />}
          <Row k="result hash" val={v.body.result_hash} mono />
          <div className="pt-2">
            <dt className="text-[var(--text-faint)] uppercase tracking-wide text-[10px] mb-1">
              query
            </dt>
            <dd>
              <pre className="font-mono text-[11px] text-[var(--text)] whitespace-pre-wrap break-words bg-[var(--bg-elevated)] rounded p-2">
                {v.body.query}
              </pre>
            </dd>
          </div>
        </dl>
      )}

      {v.verdict === 'ok' && (
        <div className="mt-3">
          <Badge variant="default">unreplayed</Badge>
          <span className="text-[11px] text-[var(--text-faint)] ml-2">
            {v.kind === 'disclosure'
              ? 'the row is authentic; whether the answer was true is a separate question'
              : 'nobody has independently reproduced this yet'}
          </span>
        </div>
      )}
    </Card>
  );
}

function Row({ k, val, mono = false }: { k: string; val: string; mono?: boolean }) {
  return (
    <div className="flex gap-3">
      <dt className="text-[var(--text-faint)] uppercase tracking-wide text-[10px] w-[92px] shrink-0 pt-0.5">
        {k}
      </dt>
      <dd className={cn('text-[var(--text)] break-all', mono && 'font-mono text-[11px]')}>{val}</dd>
    </div>
  );
}
