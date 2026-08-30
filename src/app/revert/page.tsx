'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import { decodeHorizonRevert } from '@/lib/horizon-revert';

/**
 * Paste a Horizon revert, get a sentence.
 *
 * Every trap in our own operator write-up fails in a way that points somewhere else, and the
 * provisioning ceiling is the clearest: exceed it and the transaction is refused by a custom error
 * carrying two raw numbers in seconds and no name. `cast send` prints the selector and the
 * calldata. A wallet prints "execution reverted". Neither says what to change.
 *
 * This is deliberately usable by somebody who never touches the rest of this dashboard, because
 * the people we most want to reach are running their own stack from a terminal. It runs entirely
 * in the browser and makes no request: the decoding is a table lookup and an ABI decode.
 */

const PLACEHOLDER = `Paste the revert data. Any of these work:

  0xee5602e1...            the data from a failed eth_call
  execution reverted: 0x…  a wallet or ethers error, pasted whole
  Error: ... data: "0x…"   what cast send prints

Nothing is uploaded. This is a table of the 63 custom errors these
contracts declare, decoded in your browser.`;

const TRAP_LABEL: Record<string, string> = {
  'thawing-period': 'The thawing-period ceiling',
  'provision-range': "The service's own provision range",
  'authorize-own-key': 'A payer must authorise their own key',
  'no-provision': 'The provision is what makes you payable',
  'not-you': 'Acting for somebody else',
};

export default function RevertPage() {
  const [text, setText] = useState('');

  // The paste is rarely just the hex, so pull the first thing shaped like revert data out of
  // whatever was pasted rather than asking the reader to trim it themselves.
  const decoded = useMemo(() => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const m = trimmed.match(/0x[0-9a-fA-F]{8}(?:[0-9a-fA-F]{64})*/);
    return decodeHorizonRevert(m ? m[0] : trimmed);
  }, [text]);

  return (
    <main className="max-w-[900px] mx-auto px-4 py-8">
      <header className="mb-6">
        <h1
          className="text-2xl font-semibold text-[var(--text)] mb-2"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          What did that revert mean?
        </h1>
        <p className="text-sm text-[var(--text-muted)] max-w-2xl">
          Paste the revert data from a failed Graph Horizon transaction. This knows the 63 custom
          errors the staking, payments and data-service contracts declare, and for the ones that
          actually catch people out it says what to change rather than only what failed. Written
          while walking into four of them; the write-up is in{' '}
          <Link href="/data-services" className="text-[var(--accent)] hover:underline">
            running one of these services
          </Link>
          .
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={PLACEHOLDER}
            spellCheck={false}
            rows={14}
            className="w-full font-mono text-[12px] leading-relaxed bg-[var(--bg-elevated)] border-[0.5px] border-[var(--border)] rounded-[var(--radius-button)] p-3 text-[var(--text)] outline-none focus:border-[var(--accent)] resize-y"
          />
          <p className="text-[11px] text-[var(--text-faint)] mt-2">
            Decodes as you type. Nothing leaves your browser.
          </p>
        </Card>

        <div className="space-y-4">
          {decoded && (
            <Card>
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: decoded.name ? 'var(--green)' : 'var(--amber)' }}
                />
                <span
                  className="text-sm font-medium font-mono break-all"
                  style={{ color: decoded.name ? 'var(--text)' : 'var(--amber)' }}
                >
                  {decoded.name ?? 'Not a known error'}
                </span>
              </div>

              <p className="text-[13px] text-[var(--text)] leading-relaxed">{decoded.plain}</p>

              {decoded.trap && (
                <p className="text-[11px] text-[var(--accent)] mt-2">
                  This is a documented trap: {TRAP_LABEL[decoded.trap]}.
                </p>
              )}

              {decoded.args.length > 0 && (
                <div className="mt-3 pt-2 border-t border-[var(--border)]">
                  <div className="text-[10px] text-[var(--text-faint)] uppercase tracking-wide mb-1">
                    raw arguments
                  </div>
                  <pre className="font-mono text-[11px] text-[var(--text-muted)] whitespace-pre-wrap break-all">
                    {decoded.args.map((a) => String(a)).join('\n')}
                  </pre>
                </div>
              )}
            </Card>
          )}

          <Card>
            <h3 className="text-sm font-semibold text-[var(--text)] mb-1">
              What this cannot tell you
            </h3>
            <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
              The worst trap of the four throws no error at all. Several Horizon addresses in
              circulation are implementations rather than proxies, and calling one does not revert.
              If it was never initialised its views return zero, which is at least obviously wrong.
              If it was initialised they return{' '}
              <strong className="text-[var(--text)]">stale values that look right</strong>: the
              stray RPC data service implementation our own configuration pointed at for months
              agrees with the live proxy on the thawing period, the verifier cut and the owner, and
              reports a minimum provision of 10,000 GRT where the real one is 555. Resolve
              addresses from the Controller rather than copying any table, including ours.
            </p>
          </Card>
        </div>
      </div>
    </main>
  );
}
