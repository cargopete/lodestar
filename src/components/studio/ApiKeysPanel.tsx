'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * ApiKeysPanel — RFC-004 Phase A (non-custodial metered gateway, free-tier only).
 *
 * Lists the caller's Lodestar API keys with this-month usage + remaining quota,
 * mints new keys (plaintext shown ONCE, copy-once box), and revokes keys.
 * No deposits, no billing, just a monthly query allowance.
 */

interface KeyRow {
  id: number;
  label: string | null;
  keyPrefix: string;
  status: 'active' | 'revoked';
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  usageThisMonth: number;
}

interface KeysResponse {
  keys: KeyRow[];
  period: string;
  perUserLimit: number;
  usageThisMonth: number;
  remaining: number;
}

const fmt = (n: number) => n.toLocaleString('en-US');

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="px-2 py-1 text-xs rounded-[var(--radius-button)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors flex-shrink-0"
    >
      {copied ? 'Copied ✓' : 'Copy'}
    </button>
  );
}

export default function ApiKeysPanel() {
  const [data, setData] = useState<KeysResponse | null>(null);
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [loading, setLoading] = useState(false);

  async function load() {
    try {
      const r = await fetch('/api/studio/keys', { credentials: 'include' });
      if (r.ok) setData(await r.json());
    } catch {
      /* offline / unauth — leave empty */
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch on mount — intentional
    load();
  }, []);

  async function mint() {
    setLoading(true);
    try {
      const r = await fetch('/api/studio/keys', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim() || undefined }),
      });
      const d = await r.json();
      if (d.key) setPlaintext(d.key);
      setLabel('');
      await load();
    } finally {
      setLoading(false);
    }
  }

  async function revoke(id: number) {
    if (!confirm('Revoke this key? Apps using it will stop working immediately.')) return;
    await fetch(`/api/studio/keys/${id}`, { method: 'DELETE', credentials: 'include' });
    await load();
  }

  const endpoint = 'POST https://www.lodestar-dashboard.com/api/gateway/<your-key>';

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-[var(--text-muted)]">Query API Keys</p>
      <p className="text-xs text-[var(--text-faint)]">
        Free-tier metered access to The Graph network via Lodestar&apos;s gateway. No deposits, no
        billing, just a monthly query allowance.
      </p>

      {data && (
        <p className="text-xs text-[var(--text-muted)]">
          This month: <span className="text-[var(--text)] font-medium">{fmt(data.usageThisMonth)}</span> /{' '}
          {fmt(data.perUserLimit)} queries{' '}
          <span className="text-[var(--text-faint)]">({fmt(data.remaining)} remaining)</span>
        </p>
      )}

      {plaintext && (
        <div className="space-y-1.5">
          <p className="text-xs text-amber-500">Save this now; it won&apos;t be shown again.</p>
          <div className="flex items-center gap-2 p-3 bg-[var(--bg-elevated)] rounded-lg border border-[var(--border)]">
            <code className="flex-1 text-xs font-mono text-[var(--text)] break-all">{plaintext}</code>
            <CopyButton text={plaintext} />
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (optional)"
          className={cn(
            'flex-1 px-3 py-1.5 text-xs rounded-[var(--radius-button)]',
            'bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text)]',
            'placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)]',
          )}
        />
        <button
          onClick={mint}
          disabled={loading}
          className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-button)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {loading ? 'Working…' : 'Create Key'}
        </button>
      </div>

      {data && data.keys.length > 0 && (
        <div className="space-y-1.5 pt-1">
          {data.keys.map((k) => (
            <div
              key={k.id}
              className={cn(
                'flex items-center justify-between gap-2 p-2.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)]',
                k.status === 'revoked' && 'opacity-50',
              )}
            >
              <div className="min-w-0">
                <div className="text-xs">
                  <code className="font-mono text-[var(--text)]">{k.keyPrefix}…</code>
                  {k.label && <span className="text-[var(--text-faint)]"> · {k.label}</span>}
                </div>
                <p className="text-xs text-[var(--text-faint)] mt-0.5">
                  {k.status === 'revoked'
                    ? 'Revoked'
                    : `${fmt(k.usageThisMonth)} / ${fmt(data.perUserLimit)} this month`}
                  {' · created '}
                  {new Date(k.createdAt).toLocaleDateString()}
                </p>
              </div>
              {k.status === 'active' && (
                <button
                  onClick={() => revoke(k.id)}
                  className="px-2 py-1 text-xs rounded-[var(--radius-button)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--red-text)] hover:border-[var(--red)]/40 transition-colors flex-shrink-0"
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="pt-1 space-y-1">
        <p className="text-xs text-[var(--text-faint)]">Usage:</p>
        <pre className="p-2.5 rounded-[var(--radius-button)] bg-[var(--bg-elevated)] text-[10px] font-mono text-[var(--text-muted)] overflow-x-auto whitespace-pre-wrap break-all border border-[var(--border)]">
{endpoint}
{'{ "deployment": "Qm...", "query": "{ _meta { block { number } } }" }'}
        </pre>
      </div>
    </div>
  );
}
