'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { cn, shortenAddress } from '@/lib/utils';
import { buildSignInMessage } from '@/lib/studio/auth';
import type { StudioSubgraph, SyncBounty } from '@/lib/studio/db';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Tab = 'subgraphs' | 'bounties' | 'guide';

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, credentials: 'include' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? 'Request failed');
  }
  return res.json();
}

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={copy}
      className={cn(
        'px-2 py-1 text-xs rounded transition-colors',
        'bg-[var(--bg-elevated)] hover:bg-[var(--border)] text-[var(--text-muted)]',
        className,
      )}
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Connect / Sign-in gate
// ---------------------------------------------------------------------------

function ConnectGate({ children }: { children: React.ReactNode }) {
  const { address, isConnected } = useAccount();

  if (!isConnected || !address) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-6">
        <div className="w-16 h-16 rounded-2xl bg-[var(--accent-dim)] flex items-center justify-center">
          <svg className="w-8 h-8 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <div>
          <h2 className="text-xl font-semibold text-[var(--text)] mb-2">Connect your wallet</h2>
          <p className="text-[var(--text-muted)] text-sm max-w-sm">
            Use the wallet button in the top bar to connect, then sign in to access Lodestar Studio.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// Auth state + sign-in
// ---------------------------------------------------------------------------

function useStudioSession() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [sessionAddress, setSessionAddress] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check existing session on mount
  useEffect(() => {
    fetch('/api/studio/auth', { credentials: 'include' })
      .then((r) => r.json())
      .then((d) => setSessionAddress(d.address ?? null))
      .catch(() => setSessionAddress(null));
  }, []);

  const signIn = useCallback(async () => {
    if (!address) return;
    setSigning(true);
    setError(null);
    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const message = buildSignInMessage(address, timestamp);
      const signature = await signMessageAsync({ message });
      const data = await apiFetch<{ address: string }>('/api/studio/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, message, signature }),
      });
      setSessionAddress(data.address);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setSigning(false);
    }
  }, [address, signMessageAsync]);

  const signOut = useCallback(async () => {
    await fetch('/api/studio/auth', { method: 'DELETE', credentials: 'include' });
    setSessionAddress(null);
  }, []);

  return { sessionAddress, signing, error, signIn, signOut };
}

// ---------------------------------------------------------------------------
// Subgraph card
// ---------------------------------------------------------------------------

function SubgraphCard({
  sg,
  onDelete,
  onBounty,
}: {
  sg: StudioSubgraph;
  onDelete: (id: number) => void;
  onBounty: (sg: StudioSubgraph) => void;
}) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Remove "${sg.slug}" from Studio? This does not affect on-chain data.`)) return;
    setDeleting(true);
    await fetch(`/api/studio/subgraphs/${sg.id}`, { method: 'DELETE', credentials: 'include' });
    onDelete(sg.id);
    setDeleting(false);
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] hover:border-[var(--accent-hover)] transition-colors">
      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-sm font-medium text-[var(--text)]">{sg.slug}</span>
          {sg.network && <Badge variant="default">{sg.network}</Badge>}
        </div>
        {sg.deployment_id ? (
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-[var(--text-faint)] font-mono">
              {shortenAddress(sg.deployment_id)}
            </span>
            <CopyButton text={sg.deployment_id} />
            <Link
              href={`/subgraphs/${sg.deployment_id}`}
              className="text-xs text-[var(--accent)] hover:underline"
            >
              View
            </Link>
          </div>
        ) : (
          <p className="text-xs text-[var(--text-faint)] mt-1 italic">Not yet deployed</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {sg.deployment_id && (
          <button
            onClick={() => onBounty(sg)}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-[var(--radius-button)] transition-colors',
              'bg-[var(--accent-dim)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white',
            )}
          >
            Offer Bounty
          </button>
        )}
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="px-2 py-1.5 text-xs text-[var(--text-faint)] hover:text-[var(--red)] transition-colors rounded"
        >
          {deleting ? '...' : 'Remove'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Register subgraph modal
// ---------------------------------------------------------------------------

function RegisterModal({ onClose, onCreated }: { onClose: () => void; onCreated: (sg: StudioSubgraph) => void }) {
  const [slug, setSlug] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await apiFetch<{ subgraph: StudioSubgraph }>('/api/studio/subgraphs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: slug.trim().toLowerCase(), displayName: displayName.trim() || undefined }),
      });
      onCreated(data.subgraph);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
          <h3 className="font-semibold text-[var(--text)]">Register Subgraph</h3>
          <button onClick={onClose} className="text-[var(--text-faint)] hover:text-[var(--text)]">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1.5">Slug <span className="text-[var(--red)]">*</span></label>
            <input
              type="text"
              placeholder="org/my-subgraph"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
              className={cn(
                'w-full px-3 py-2 text-sm font-mono rounded-[var(--radius-button)]',
                'bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text)]',
                'placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)]',
              )}
            />
            <p className="text-xs text-[var(--text-faint)] mt-1">Lowercase letters, numbers, and hyphens only. e.g. <code>acme/uniswap-v3</code></p>
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1.5">Display name (optional)</label>
            <input
              type="text"
              placeholder="Uniswap V3 on Base"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className={cn(
                'w-full px-3 py-2 text-sm rounded-[var(--radius-button)]',
                'bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text)]',
                'placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)]',
              )}
            />
          </div>
          {error && <p className="text-xs text-[var(--red)]">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 text-sm rounded-[var(--radius-button)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 text-sm font-medium rounded-[var(--radius-button)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {loading ? 'Registering...' : 'Register'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Offer bounty modal
// ---------------------------------------------------------------------------

function BountyModal({
  sg,
  onClose,
  onCreated,
}: {
  sg: StudioSubgraph;
  onClose: () => void;
  onCreated: (b: SyncBounty) => void;
}) {
  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [expiryDays, setExpiryDays] = useState('30');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const expires_at = expiryDays
        ? new Date(Date.now() + parseInt(expiryDays) * 86400_000).toISOString()
        : null;
      const data = await apiFetch<{ bounty: SyncBounty }>('/api/studio/bounties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deployment_id: sg.deployment_id,
          slug: sg.slug,
          amount_grt: amount,
          message: message || null,
          expires_at,
        }),
      });
      onCreated(data.bounty);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post bounty');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-[var(--text)]">Offer Sync Bounty</h3>
            <p className="text-xs text-[var(--text-faint)] mt-0.5 font-mono">{sg.slug}</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-faint)] hover:text-[var(--text)]">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1.5">Bounty amount (GRT) <span className="text-[var(--red)]">*</span></label>
            <input
              type="number"
              min="1"
              step="any"
              placeholder="100"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              className={cn(
                'w-full px-3 py-2 text-sm rounded-[var(--radius-button)]',
                'bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text)]',
                'placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)]',
              )}
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1.5">Message to indexers (optional)</label>
            <textarea
              placeholder="Please sync ASAP — production launch depends on this."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              className={cn(
                'w-full px-3 py-2 text-sm rounded-[var(--radius-button)] resize-none',
                'bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text)]',
                'placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)]',
              )}
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1.5">Expires after</label>
            <select
              value={expiryDays}
              onChange={(e) => setExpiryDays(e.target.value)}
              className={cn(
                'w-full px-3 py-2 text-sm rounded-[var(--radius-button)]',
                'bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text)]',
                'focus:outline-none focus:border-[var(--accent)]',
              )}
            >
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="">Never</option>
            </select>
          </div>
          <p className="text-xs text-[var(--text-faint)] bg-[var(--bg-elevated)] rounded p-2.5 border border-[var(--border)]">
            This bounty is currently off-chain — it signals your intent to pay. GRT settlement happens directly between you and the indexer. On-chain escrow is coming soon.
          </p>
          {error && <p className="text-xs text-[var(--red)]">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 text-sm rounded-[var(--radius-button)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 text-sm font-medium rounded-[var(--radius-button)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {loading ? 'Posting...' : 'Post Bounty'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deploy key panel
// ---------------------------------------------------------------------------

function DeployKeyPanel() {
  const [keyInfo, setKeyInfo] = useState<{ hasKey: boolean; createdAt: string | null; lastUsedAt: string | null } | null>(null);
  const [plainKey, setPlainKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/studio/deploy-key', { credentials: 'include' })
      .then((r) => r.json())
      .then(setKeyInfo)
      .catch(() => {});
  }, []);

  const generate = async () => {
    if (keyInfo?.hasKey && !confirm('This will invalidate your existing deploy key. Continue?')) return;
    setLoading(true);
    try {
      const data = await apiFetch<{ key: string }>('/api/studio/deploy-key', {
        method: 'POST',
        credentials: 'include',
      });
      setPlainKey(data.key);
      setKeyInfo({ hasKey: true, createdAt: new Date().toISOString(), lastUsedAt: null });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Deploy Key</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {plainKey ? (
          <div>
            <p className="text-xs text-[var(--amber)] mb-2">Save this key — it will only be shown once.</p>
            <div className="flex items-center gap-2 p-3 bg-[var(--bg-elevated)] rounded-lg border border-[var(--border)]">
              <code className="flex-1 text-xs font-mono text-[var(--text)] break-all">{plainKey}</code>
              <CopyButton text={plainKey} />
            </div>
          </div>
        ) : keyInfo?.hasKey ? (
          <div className="flex items-center gap-2 p-3 bg-[var(--bg-elevated)] rounded-lg border border-[var(--border)]">
            <code className="flex-1 text-xs font-mono text-[var(--text-faint)]">{'•'.repeat(64)}</code>
          </div>
        ) : (
          <p className="text-sm text-[var(--text-muted)]">No deploy key generated yet.</p>
        )}
        <button
          onClick={generate}
          disabled={loading}
          className={cn(
            'w-full px-4 py-2 text-sm font-medium rounded-[var(--radius-button)] transition-opacity disabled:opacity-50',
            keyInfo?.hasKey
              ? 'border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]'
              : 'bg-[var(--accent)] text-white hover:opacity-90',
          )}
        >
          {loading ? 'Generating...' : keyInfo?.hasKey ? 'Regenerate Key' : 'Generate Deploy Key'}
        </button>
        {keyInfo?.lastUsedAt && (
          <p className="text-xs text-[var(--text-faint)]">
            Last used: {new Date(keyInfo.lastUsedAt).toLocaleDateString()}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// My Subgraphs tab
// ---------------------------------------------------------------------------

function MySubgraphsTab({ sessionAddress }: { sessionAddress: string }) {
  const qc = useQueryClient();
  const [showRegister, setShowRegister] = useState(false);
  const [bountyTarget, setBountyTarget] = useState<StudioSubgraph | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['studio-subgraphs', sessionAddress],
    queryFn: () => apiFetch<{ subgraphs: StudioSubgraph[] }>('/api/studio/subgraphs'),
  });

  const subgraphs = data?.subgraphs ?? [];

  const handleDelete = (id: number) => {
    qc.setQueryData(['studio-subgraphs', sessionAddress], (old: typeof data) => ({
      subgraphs: old?.subgraphs.filter((s) => s.id !== id) ?? [],
    }));
  };

  const handleCreated = (sg: StudioSubgraph) => {
    qc.setQueryData(['studio-subgraphs', sessionAddress], (old: typeof data) => ({
      subgraphs: [sg, ...(old?.subgraphs ?? [])],
    }));
  };

  return (
    <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-[var(--text-muted)]">
            {subgraphs.length} subgraph{subgraphs.length !== 1 ? 's' : ''}
          </h2>
          <button
            onClick={() => setShowRegister(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-[var(--radius-button)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Register Subgraph
          </button>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => <div key={i} className="h-16 rounded-lg shimmer" />)}
          </div>
        ) : subgraphs.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center gap-4 border border-dashed border-[var(--border)] rounded-xl">
            <div className="w-12 h-12 rounded-xl bg-[var(--accent-dim)] flex items-center justify-center">
              <svg className="w-6 h-6 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            </div>
            <div>
              <p className="text-[var(--text)] font-medium">No subgraphs yet</p>
              <p className="text-sm text-[var(--text-muted)] mt-1">Register a slug to get your deploy endpoint and key.</p>
            </div>
            <button
              onClick={() => setShowRegister(true)}
              className="px-4 py-2 text-sm font-medium rounded-[var(--radius-button)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
            >
              Register your first subgraph
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {subgraphs.map((sg) => (
              <SubgraphCard
                key={sg.id}
                sg={sg}
                onDelete={handleDelete}
                onBounty={setBountyTarget}
              />
            ))}
          </div>
        )}

        <div className="pt-4">
          <DeployKeyPanel />
        </div>
      </div>

      {showRegister && (
        <RegisterModal onClose={() => setShowRegister(false)} onCreated={handleCreated} />
      )}
      {bountyTarget && (
        <BountyModal
          sg={bountyTarget}
          onClose={() => setBountyTarget(null)}
          onCreated={() => {}}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Bounty Board tab
// ---------------------------------------------------------------------------

function BountyBoardTab({ sessionAddress }: { sessionAddress: string | null }) {
  const { data, isLoading } = useQuery({
    queryKey: ['studio-bounties-public'],
    queryFn: () => apiFetch<{ bounties: SyncBounty[] }>('/api/studio/bounties'),
  });
  const qc = useQueryClient();

  const bounties = data?.bounties ?? [];

  const claim = async (id: number) => {
    try {
      await apiFetch(`/api/studio/bounties/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'claim' }),
      });
      qc.invalidateQueries({ queryKey: ['studio-bounties-public'] });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to claim');
    }
  };

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--accent-dim)]">
        <p className="text-sm text-[var(--text)]">
          <strong>Indexers:</strong> developers post GRT bounties for subgraphs they need synced. Allocate to the deployment, sync it, then claim the bounty. Settlement is currently off-chain — contact the developer directly.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-lg shimmer" />)}
        </div>
      ) : bounties.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-[var(--text-muted)] text-sm">No open bounties right now.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {bounties.map((b) => (
            <div key={b.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)]">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-[var(--text)] truncate">{b.deployment_id}</span>
                  <CopyButton text={b.deployment_id} />
                  <Link href={`/subgraphs/${b.deployment_id}`} className="text-xs text-[var(--accent)] hover:underline flex-shrink-0">
                    View
                  </Link>
                </div>
                {b.message && (
                  <p className="text-xs text-[var(--text-muted)] mt-1 italic">&ldquo;{b.message}&rdquo;</p>
                )}
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-xs text-[var(--text-faint)]">
                    by {shortenAddress(b.developer_address)}
                  </span>
                  {b.expires_at && (
                    <span className="text-xs text-[var(--text-faint)]">
                      expires {new Date(b.expires_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className="text-base font-semibold text-[var(--accent)]">{b.amount_grt} GRT</span>
                {sessionAddress && sessionAddress !== b.developer_address && (
                  <button
                    onClick={() => claim(b.id)}
                    className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-button)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
                  >
                    Claim
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deploy Guide tab
// ---------------------------------------------------------------------------

function DeployGuideTab() {
  const NODE_URL = typeof window !== 'undefined' ? `${window.location.origin}/api/studio/node` : 'https://lodestar-dashboard.com/api/studio/node';
  const IPFS_URL = typeof window !== 'undefined' ? `${window.location.origin}/api/studio/ipfs` : 'https://lodestar-dashboard.com/api/studio/ipfs';

  const step = (n: number, title: string, children: React.ReactNode) => (
    <div className="flex gap-4">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-[var(--accent-dim)] text-[var(--accent)] flex items-center justify-center text-xs font-bold">{n}</div>
      <div className="flex-1 pb-6">
        <p className="font-medium text-[var(--text)] mb-2">{title}</p>
        {children}
      </div>
    </div>
  );

  const Code = ({ children }: { children: string }) => (
    <div className="relative group">
      <pre className="p-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] text-xs font-mono text-[var(--text)] overflow-x-auto whitespace-pre-wrap break-all">
        {children}
      </pre>
      <div className="absolute top-2 right-2">
        <CopyButton text={children} />
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Getting Started</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-[var(--border)]">
          <div className="pb-6 space-y-4">
            {step(1, 'Install graph-cli', (
              <Code>npm install -g @graphprotocol/graph-cli</Code>
            ))}
            {step(2, 'Build your subgraph locally', (
              <Code>graph codegen && graph build</Code>
            ))}
            {step(3, 'Register a slug in Studio and generate a deploy key', (
              <p className="text-sm text-[var(--text-muted)]">Use the <strong>My Subgraphs</strong> tab above to register a slug (e.g. <code className="font-mono text-xs bg-[var(--bg-elevated)] px-1 py-0.5 rounded">acme/uniswap-v3</code>) and generate your deploy key.</p>
            ))}
            {step(4, 'Deploy to Lodestar', (
              <Code>{`graph deploy \\
  --node ${NODE_URL} \\
  --ipfs ${IPFS_URL} \\
  --deploy-key YOUR_DEPLOY_KEY \\
  your-org/your-subgraph`}</Code>
            ))}
            {step(5, 'Track sync progress', (
              <p className="text-sm text-[var(--text-muted)]">
                Once deployed, your subgraph appears under <strong>My Subgraphs</strong> with a link to its live indexing status. Lodestar indexes it immediately — no limits, no waiting for E&amp;N approval.
              </p>
            ))}
            {step(6, 'Publish on-chain (optional)', (
              <p className="text-sm text-[var(--text-muted)]">
                To make your subgraph discoverable on The Graph Network and attract additional indexers, publish it on-chain via the SubgraphService contract. On-chain publish wizard coming soon.
              </p>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function StudioPage() {
  const { address, isConnected } = useAccount();
  const { sessionAddress, signing, error: authError, signIn, signOut } = useStudioSession();
  const [tab, setTab] = useState<Tab>('subgraphs');

  const TABS: { id: Tab; label: string }[] = [
    { id: 'subgraphs', label: 'My Subgraphs' },
    { id: 'bounties', label: 'Bounty Board' },
    { id: 'guide', label: 'Deploy Guide' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)]">Lodestar Studio</h1>
          <p className="text-[var(--text-muted)] text-sm mt-1">
            Build on The Graph. Deploy subgraphs instantly — no limits, no gatekeepers.
          </p>
        </div>
        {sessionAddress && (
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--bg-elevated)] border border-[var(--border)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)] inline-block" />
              <span className="text-xs font-mono text-[var(--text-muted)]">{shortenAddress(sessionAddress)}</span>
            </div>
            <button
              onClick={signOut}
              className="text-xs text-[var(--text-faint)] hover:text-[var(--text)] transition-colors"
            >
              Sign out
            </button>
          </div>
        )}
      </div>

      <ConnectGate>
        {/* Sign-in prompt */}
        {!sessionAddress && (
          <div className="flex flex-col items-center py-16 text-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-[var(--accent-dim)] flex items-center justify-center">
              <svg className="w-7 h-7 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--text)]">Sign in with your wallet</h2>
              <p className="text-sm text-[var(--text-muted)] mt-1 max-w-sm">
                One signature — no gas, no transaction. Proves you own this address.
              </p>
            </div>
            <button
              onClick={signIn}
              disabled={signing}
              className="px-6 py-2.5 text-sm font-medium rounded-[var(--radius-button)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {signing ? 'Waiting for wallet...' : 'Sign in'}
            </button>
            {authError && <p className="text-xs text-[var(--red)]">{authError}</p>}
          </div>
        )}

        {/* Main portal — signed in */}
        {sessionAddress && (
          <>
            {/* Tabs */}
            <div className="flex gap-1 border-b border-[var(--border)]">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px',
                    tab === t.id
                      ? 'border-[var(--accent)] text-[var(--accent)]'
                      : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="pt-2">
              {tab === 'subgraphs' && <MySubgraphsTab sessionAddress={sessionAddress} />}
              {tab === 'bounties' && <BountyBoardTab sessionAddress={sessionAddress} />}
              {tab === 'guide' && <DeployGuideTab />}
            </div>
          </>
        )}

        {/* Bounty Board is public — show even without sign-in */}
        {!sessionAddress && (
          <div className="mt-8">
            <h2 className="text-sm font-medium text-[var(--text-muted)] mb-3">Open Bounties</h2>
            <BountyBoardTab sessionAddress={null} />
          </div>
        )}
      </ConnectGate>
    </div>
  );
}
