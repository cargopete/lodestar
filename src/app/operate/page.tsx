'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/Card';
import type { PreflightStep, StepStatus } from '@/lib/operator-preflight';

/**
 * Rehearse the operator sequence for an address, without a wallet.
 *
 * `becoming-an-operator.md` says to rehearse on a fork before spending anything, which is right and
 * asks somebody to install Foundry and write a Solidity test before they have decided whether they
 * care. Nearly all of what a fork rehearsal tells you is readable off mainnet for free.
 *
 * Deliberately takes a pasted address rather than a wallet connection. Connecting a wallet to find
 * out whether a job is worth doing is a much bigger ask than typing an address, and it means you can
 * check one you have not funded yet, or somebody else's, or your cold one.
 */

const SERVICES = [
  { id: 'dispatch', name: 'Dispatch (RPC)' },
  { id: 'seahorn', name: 'Seahorn (Solana)' },
  { id: 'sdsce', name: 'SDSCE (Substreams)' },
  { id: 'nuthatch-data-service', name: 'Nuthatch Data Service' },
  { id: 'mainline-firehose', name: 'Mainline (Firehose)' },
];

const DOT: Record<StepStatus, string> = {
  done: 'var(--green)',
  todo: 'var(--accent)',
  blocked: 'var(--amber)',
  unknown: 'var(--text-faint)',
};

interface Payload {
  data: {
    address: string;
    service: { id: string; name: string; address: string };
    verdict: string;
    steps: PreflightStep[];
  };
}

export default function OperatePage() {
  const [address, setAddress] = useState('');
  const [service, setService] = useState(SERVICES[0].id);

  const valid = /^0x[0-9a-fA-F]{40}$/.test(address.trim());
  const { data, isLoading, isError } = useQuery<Payload>({
    queryKey: ['operator-preflight', address.trim().toLowerCase(), service],
    queryFn: async () => {
      const r = await fetch(
        `/api/operator-preflight?address=${address.trim()}&service=${service}`
      );
      if (!r.ok) throw new Error(`preflight failed: ${r.status}`);
      return r.json();
    },
    enabled: valid,
    staleTime: 60_000,
    retry: 1,
  });

  return (
    <main className="max-w-[900px] mx-auto px-4 py-8">
      <header className="mb-6">
        <h1
          className="text-2xl font-semibold text-[var(--text)] mb-2"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Could you run one of these?
        </h1>
        <p className="text-sm text-[var(--text-muted)] max-w-2xl">
          Paste an address and pick a service. This reads Arbitrum One and says what would happen if
          that address tried to become a provider: what it holds, what it has staked, what it has
          provisioned, and which step it would fail on. No wallet, no signature, no gas, so you can
          check an address you have not funded yet, or one you do not control. The costs are on the{' '}
          <Link href="/data-services" className="text-[var(--accent)] hover:underline">
            data services page
          </Link>
          , and if something does revert,{' '}
          <Link href="/revert" className="text-[var(--accent)] hover:underline">
            paste it here
          </Link>
          .
        </p>
      </header>

      <Card className="mb-4">
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="0x…"
            spellCheck={false}
            className="flex-1 font-mono text-[12px] bg-[var(--bg-elevated)] border-[0.5px] border-[var(--border)] rounded-[var(--radius-button)] px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
          />
          <select
            value={service}
            onChange={(e) => setService(e.target.value)}
            className="text-[12px] bg-[var(--bg-elevated)] border-[0.5px] border-[var(--border)] rounded-[var(--radius-button)] px-3 py-2 text-[var(--text)] outline-none focus:border-[var(--accent)]"
          >
            {SERVICES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        {address.trim() !== '' && !valid && (
          <p className="text-[11px] text-[var(--amber)] mt-2">That is not a 20-byte address.</p>
        )}
      </Card>

      {valid && isLoading && (
        <Card>
          <p className="text-[12px] text-[var(--text-muted)]">Reading Arbitrum One…</p>
        </Card>
      )}

      {valid && isError && (
        <Card>
          <p className="text-[12px] text-[var(--amber)]">
            The preflight could not run, which is not the same as finding nothing wrong. Try again
            shortly.
          </p>
        </Card>
      )}

      {data && (
        <Card>
          <p className="text-sm font-medium text-[var(--text)] mb-1">{data.data.verdict}</p>
          <p className="text-[11px] text-[var(--text-faint)] mb-4">
            {data.data.service.name} · {data.data.service.address}
          </p>

          <ol className="space-y-3">
            {data.data.steps.map((s) => (
              <li key={s.key} className="flex gap-2.5">
                <span
                  className="w-2 h-2 rounded-full shrink-0 mt-1.5"
                  style={{ background: DOT[s.status] }}
                />
                <div>
                  <div className="text-[13px] text-[var(--text)]">{s.title}</div>
                  <div className="text-[12px] text-[var(--text-muted)] leading-relaxed">
                    {s.detail}
                  </div>
                </div>
              </li>
            ))}
          </ol>

          {/* The limit, said where it cannot be missed. Everything above is on-chain state, and
              on-chain state is exactly what looked green for 39 days while nothing answered. */}
          <p className="text-[11px] text-[var(--text-faint)] mt-4 pt-3 border-t border-[var(--border)]">
            Every line above is on-chain state, and being correct on chain is not the same as
            serving. Dispatch had two providers registered and provisioned, and zero endpoints that
            answered, for 39 days. The last mile is running the thing, and nothing here can check
            that for you.
          </p>
        </Card>
      )}
    </main>
  );
}
