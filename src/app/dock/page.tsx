'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount, useSignMessage, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { cn, shortenAddress } from '@/lib/utils';
import { buildSignInMessage } from '@/lib/studio/auth';
import { ipfsHashToBytes32 } from '@/lib/studio/ipfs';
import { CONTRACTS } from '@/lib/wallet';
import type { StudioSubgraph, SyncBounty } from '@/lib/studio/db';

// ---------------------------------------------------------------------------
// GNS ABI (minimal — publishNewSubgraph only)
// ---------------------------------------------------------------------------

const GNS_ABI = [
  {
    name: 'publishNewSubgraph',
    type: 'function' as const,
    stateMutability: 'nonpayable' as const,
    inputs: [
      { name: 'subgraphDeploymentID', type: 'bytes32' },
      { name: 'versionMetadata', type: 'bytes32' },
      { name: 'subgraphMetadata', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'publishNewVersion',
    type: 'function' as const,
    stateMutability: 'nonpayable' as const,
    inputs: [
      { name: 'subgraphID', type: 'uint256' },
      { name: 'subgraphDeploymentID', type: 'bytes32' },
      { name: 'versionMetadata', type: 'bytes32' },
    ],
    outputs: [],
  },
] as const;

// ERC721 Transfer(from=0x0, to, tokenId) — emitted by GNS when minting a new subgraph NFT
const ERC721_TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ZERO_TOPIC = '0x0000000000000000000000000000000000000000000000000000000000000000';

function extractSubgraphId(
  logs: readonly { address: string; topics: readonly string[] }[],
  gnsAddress: string,
): string | null {
  for (const log of logs) {
    if (
      log.address.toLowerCase() === gnsAddress.toLowerCase() &&
      log.topics[0] === ERC721_TRANSFER &&
      log.topics[1] === ZERO_TOPIC // from=0 means mint
    ) {
      return BigInt(log.topics[3]).toString();
    }
  }
  return null;
}

const NODE_URL = 'https://www.lodestar-dashboard.com/api/studio/node';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function CodeBlock({ children }: { children: string }) {
  return (
    <div className="mt-1.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)] overflow-hidden">
      <pre className="px-3 pt-3 pb-2 text-xs font-mono text-[var(--text)] overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
        {children}
      </pre>
      <div className="flex justify-end px-2 pb-2">
        <CopyButton text={children} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connect gate
// ---------------------------------------------------------------------------

function ConnectGate({ children }: { children: React.ReactNode }) {
  const { isConnected } = useAccount();
  if (!isConnected) {
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
            Connect via the button in the top bar, then sign in to manage your subgraphs.
          </p>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// Session hook
// ---------------------------------------------------------------------------

function useStudioSession() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [sessionAddress, setSessionAddress] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
// Subgraph card (clickable)
// ---------------------------------------------------------------------------

function SubgraphCard({ sg, onClick }: { sg: StudioSubgraph; onClick: () => void }) {
  const isPublished = Boolean(sg.published_subgraph_id);
  return (
    <button
      onClick={onClick}
      className="w-full text-left flex items-center gap-4 p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] hover:border-[var(--accent-hover)] hover:bg-[var(--bg-surface)] transition-all cursor-pointer"
    >
      <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-[var(--accent-dim)] flex items-center justify-center">
        <svg className="w-5 h-5 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm text-[var(--text)]">
            {sg.display_name || sg.slug.split('/').pop()}
          </span>
          <span className={cn(
            'text-xs px-2 py-0.5 rounded-full font-medium',
            isPublished
              ? 'bg-[var(--accent-dim)] text-[var(--accent)]'
              : 'bg-[var(--bg-surface)] text-[var(--text-faint)] border border-[var(--border)]',
          )}>
            {isPublished ? 'Published' : 'Draft'}
          </span>
          {sg.network && <Badge variant="default">{sg.network}</Badge>}
        </div>
        <p className="text-xs text-[var(--text-faint)] font-mono mt-0.5 truncate">{sg.slug}</p>
      </div>
      <svg className="w-4 h-4 text-[var(--text-faint)] flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Register modal
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
      setError(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
          <h3 className="font-semibold text-[var(--text)]">Create Subgraph</h3>
          <button onClick={onClose} className="text-[var(--text-faint)] hover:text-[var(--text)]">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1.5">
              Slug <span className="text-[var(--red)]">*</span>
            </label>
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
            <p className="text-xs text-[var(--text-faint)] mt-1">
              e.g. <code>acme/uniswap-v3</code>
            </p>
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
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm rounded-[var(--radius-button)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 text-sm font-medium rounded-[var(--radius-button)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {loading ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Publish wizard
// ---------------------------------------------------------------------------

type PublishStep = 'confirm' | 'uploading' | 'wallet' | 'mining' | 'done' | 'error';

function PublishWizard({
  sg,
  onClose,
  onPublished,
}: {
  sg: StudioSubgraph;
  onClose: () => void;
  onPublished: (txHash: string) => void;
}) {
  const [step, setStep] = useState<PublishStep>('confirm');
  const [errMsg, setErrMsg] = useState('');
  const [metaHashes, setMetaHashes] = useState<{
    subgraphMetaBytes32: `0x${string}`;
    versionMetaBytes32: `0x${string}`;
  } | null>(null);
  const [minedTxHash, setMinedTxHash] = useState<`0x${string}` | undefined>();
  const [versionLabel, setVersionLabel] = useState('');

  const { writeContract, isPending: walletPending } = useWriteContract({
    mutation: {
      onSuccess: (hash) => {
        setMinedTxHash(hash);
        setStep('mining');
      },
      onError: (e) => {
        setErrMsg(e.message.slice(0, 300));
        setStep('error');
      },
    },
  });

  const isNewVersion = Boolean(sg.published_subgraph_id && !sg.published_subgraph_id.startsWith('0x'));

  const { isSuccess: txConfirmed, data: receipt } = useWaitForTransactionReceipt({ hash: minedTxHash });

  useEffect(() => {
    if (txConfirmed && receipt) {
      // For a new publish, extract the subgraph NFT token ID from the ERC721 mint event.
      // For a version update the subgraphID doesn't change, pass the tx hash as signal.
      const result = isNewVersion
        ? (minedTxHash ?? '')
        : (extractSubgraphId(receipt.logs, CONTRACTS.gns) ?? minedTxHash ?? '');
      onPublished(result);
      setStep('done');
    }
  }, [txConfirmed, receipt, minedTxHash, onPublished, isNewVersion]);

  const handleUpload = async () => {
    setStep('uploading');
    try {
      const data = await apiFetch<{
        subgraphMetaBytes32: `0x${string}`;
        versionMetaBytes32: `0x${string}`;
      }>('/api/studio/metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: sg.display_name,
          description: sg.description,
          versionLabel: versionLabel.trim() || undefined,
        }),
      });
      setMetaHashes(data);
      setStep('wallet');
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'IPFS upload failed');
      setStep('error');
    }
  };

  const handleWriteContract = () => {
    if (!metaHashes || !sg.deployment_id) return;
    if (isNewVersion && sg.published_subgraph_id) {
      writeContract({
        address: CONTRACTS.gns,
        abi: GNS_ABI,
        functionName: 'publishNewVersion',
        args: [
          BigInt(sg.published_subgraph_id),
          ipfsHashToBytes32(sg.deployment_id),
          metaHashes.versionMetaBytes32,
        ],
      });
    } else {
      writeContract({
        address: CONTRACTS.gns,
        abi: GNS_ABI,
        functionName: 'publishNewSubgraph',
        args: [
          ipfsHashToBytes32(sg.deployment_id),
          metaHashes.versionMetaBytes32,
          metaHashes.subgraphMetaBytes32,
        ],
      });
    }
  };

  const canClose = step !== 'uploading' && step !== 'mining';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
          <h3 className="font-semibold text-[var(--text)]">Publish on The Graph</h3>
          {canClose && (
            <button onClick={onClose} className="text-[var(--text-faint)] hover:text-[var(--text)]">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <div className="p-5 space-y-4">
          {step === 'confirm' && (
            <>
              <p className="text-sm text-[var(--text-muted)]">
                {isNewVersion
                  ? <>Publishing a new version — calls <code className="font-mono text-xs bg-[var(--bg-elevated)] px-1 rounded">GNS.publishNewVersion</code> on Arbitrum One.</>
                  : <>Uploads metadata to IPFS and calls <code className="font-mono text-xs bg-[var(--bg-elevated)] px-1 rounded">GNS.publishNewSubgraph</code> on Arbitrum One.</>}
              </p>
              <div className="space-y-0 text-sm divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg overflow-hidden">
                <div className="flex gap-3 px-4 py-2.5">
                  <span className="text-[var(--text-faint)] w-28 flex-shrink-0 text-xs">Subgraph</span>
                  <span className="text-[var(--text)] font-mono text-xs truncate">{sg.slug}</span>
                </div>
                {isNewVersion && sg.published_subgraph_id && (
                  <div className="flex gap-3 px-4 py-2.5">
                    <span className="text-[var(--text-faint)] w-28 flex-shrink-0 text-xs">Subgraph #</span>
                    <span className="text-[var(--text)] font-mono text-xs truncate">{sg.published_subgraph_id}</span>
                  </div>
                )}
                <div className="flex gap-3 px-4 py-2.5">
                  <span className="text-[var(--text-faint)] w-28 flex-shrink-0 text-xs">New deployment</span>
                  <span className="text-[var(--text)] font-mono text-xs truncate">{sg.deployment_id}</span>
                </div>
                {sg.display_name && (
                  <div className="flex gap-3 px-4 py-2.5">
                    <span className="text-[var(--text-faint)] w-28 flex-shrink-0 text-xs">Display name</span>
                    <span className="text-[var(--text)] text-sm">{sg.display_name}</span>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">
                  Version label <span className="text-[var(--text-faint)]">(optional)</span>
                </label>
                <input
                  type="text"
                  placeholder="v0.0.1"
                  value={versionLabel}
                  onChange={(e) => setVersionLabel(e.target.value)}
                  className={cn(
                    'w-full px-3 py-2 text-sm font-mono rounded-[var(--radius-button)]',
                    'bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text)]',
                    'placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)]',
                  )}
                />
              </div>
              <p className="text-xs text-[var(--text-faint)]">
                A wallet transaction is required. Gas on Arbitrum is usually &lt;$0.01.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-2 text-sm rounded-[var(--radius-button)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpload}
                  className="flex-1 px-4 py-2 text-sm font-medium rounded-[var(--radius-button)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
                >
                  Continue
                </button>
              </div>
            </>
          )}

          {step === 'uploading' && (
            <div className="flex flex-col items-center py-8 gap-3">
              <div className="w-10 h-10 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
              <p className="text-sm text-[var(--text-muted)]">Uploading metadata to IPFS...</p>
            </div>
          )}

          {step === 'wallet' && metaHashes && (
            <>
              <div className="flex items-center gap-2 text-sm text-[var(--accent)]">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Metadata uploaded to IPFS
              </div>
              <p className="text-sm text-[var(--text-muted)]">
                Confirm the transaction in your wallet to publish on The Graph Network.
              </p>
              <button
                onClick={handleWriteContract}
                disabled={walletPending}
                className="w-full px-4 py-2 text-sm font-medium rounded-[var(--radius-button)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {walletPending ? 'Waiting for wallet...' : 'Confirm in Wallet'}
              </button>
            </>
          )}

          {step === 'mining' && (
            <div className="flex flex-col items-center py-8 gap-3">
              <div className="w-10 h-10 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
              <p className="text-sm text-[var(--text-muted)]">Transaction submitted — waiting for confirmation...</p>
              {minedTxHash && (
                <a
                  href={`https://arbiscan.io/tx/${minedTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[var(--accent)] hover:underline font-mono"
                >
                  {minedTxHash.slice(0, 20)}...
                </a>
              )}
            </div>
          )}

          {step === 'done' && (
            <div className="flex flex-col items-center py-8 gap-4 text-center">
              <div className="w-14 h-14 rounded-full bg-[var(--accent-dim)] flex items-center justify-center">
                <svg className="w-7 h-7 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-[var(--text)]">
                  {isNewVersion ? 'New version published!' : 'Published!'}
                </p>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {isNewVersion
                    ? 'Indexers will migrate to the new deployment.'
                    : 'Your subgraph is now live on The Graph Network.'}
                </p>
              </div>
              <div className="w-full p-3 rounded-lg bg-[var(--accent-dim)] border border-[var(--accent)]/20 text-left">
                <p className="text-xs font-medium text-[var(--accent)] mb-1">Next: attract indexers</p>
                <p className="text-xs text-[var(--text-muted)]">
                  Signal GRT on your subgraph to show indexers it&apos;s worth syncing. It may take a few minutes to appear in Curate after publishing.
                </p>
                <a
                  href={`/curate?deployment=${sg.deployment_id ?? ''}`}
                  className="inline-block mt-2 text-xs font-medium text-[var(--accent)] hover:underline"
                >
                  Go to Curate →
                </a>
              </div>
              <button
                onClick={onClose}
                className="px-6 py-2 text-sm font-medium rounded-[var(--radius-button)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
              >
                Done
              </button>
            </div>
          )}

          {step === 'error' && (
            <div className="space-y-4">
              <p className="text-sm text-[var(--red)]">{errMsg || 'Something went wrong.'}</p>
              <button
                onClick={() => setStep('confirm')}
                className="w-full px-4 py-2 text-sm rounded-[var(--radius-button)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Deploy key panel (inline, used in detail modal)
// ---------------------------------------------------------------------------

function DeployKeyPanel() {
  const [keyInfo, setKeyInfo] = useState<{
    hasKey: boolean;
    createdAt: string | null;
    lastUsedAt: string | null;
  } | null>(null);
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
      const data = await apiFetch<{ key: string }>('/api/studio/deploy-key', { method: 'POST' });
      setPlainKey(data.key);
      setKeyInfo({ hasKey: true, createdAt: new Date().toISOString(), lastUsedAt: null });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-[var(--text-muted)]">Deploy Key</p>
      {plainKey ? (
        <div>
          <p className="text-xs text-amber-500 mb-2">Save this — it won&apos;t be shown again.</p>
          <div className="flex items-center gap-2 p-3 bg-[var(--bg-elevated)] rounded-lg border border-[var(--border)]">
            <code className="flex-1 text-xs font-mono text-[var(--text)] break-all">{plainKey}</code>
            <CopyButton text={plainKey} />
          </div>
        </div>
      ) : keyInfo?.hasKey ? (
        <div className="p-3 bg-[var(--bg-elevated)] rounded-lg border border-[var(--border)] overflow-hidden">
          <code className="block text-xs font-mono text-[var(--text-faint)] truncate">{'•'.repeat(64)}</code>
        </div>
      ) : (
        <p className="text-xs text-[var(--text-muted)]">No deploy key yet.</p>
      )}
      <button
        onClick={generate}
        disabled={loading}
        className={cn(
          'w-full px-3 py-1.5 text-xs font-medium rounded-[var(--radius-button)] transition-opacity disabled:opacity-50',
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subgraph detail modal
// ---------------------------------------------------------------------------

function SubgraphDetailModal({
  sg: initialSg,
  onClose,
  onUpdated,
  onPublished,
  onDelete,
}: {
  sg: StudioSubgraph;
  onClose: () => void;
  onUpdated: (sg: StudioSubgraph) => void;
  onPublished: (id: number, txHash: string) => void;
  onDelete: (id: number) => void;
}) {
  const [sg, setSg] = useState(initialSg);
  const [displayName, setDisplayName] = useState(sg.display_name ?? '');
  const [description, setDescription] = useState(sg.description ?? '');
  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isPublished = Boolean(sg.published_subgraph_id);
  // A proper subgraphID is a decimal number string; an old tx hash starts with '0x'
  const subgraphNftId = sg.published_subgraph_id && !sg.published_subgraph_id.startsWith('0x')
    ? sg.published_subgraph_id : null;
  // Can publish if deployed and either not yet published, or we have the NFT ID for versioning
  const canPublish = Boolean(sg.deployment_id) && (!isPublished || subgraphNftId !== null);
  const publishLabel = subgraphNftId ? 'Update Version' : 'Publish';

  const handleSave = async () => {
    setSaving(true);
    setSaveOk(false);
    try {
      await apiFetch(`/api/studio/subgraphs/${sg.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: displayName || null, description: description || null }),
      });
      const updated = { ...sg, display_name: displayName || null, description: description || null };
      setSg(updated);
      onUpdated(updated);
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 2000);
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Remove "${sg.slug}"? This does not affect on-chain data.`)) return;
    setDeleting(true);
    await fetch(`/api/studio/subgraphs/${sg.id}`, { method: 'DELETE', credentials: 'include' });
    onDelete(sg.id);
    onClose();
  };

  const handlePublished = async (result: string) => {
    // subgraphNftId is null before the first publish — always store the result then.
    // For version updates (subgraphNftId already set) there's nothing new to store.
    if (subgraphNftId === null) {
      await apiFetch(`/api/studio/subgraphs/${sg.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ published_subgraph_id: result }),
      });
      const updated = { ...sg, published_subgraph_id: result };
      setSg(updated);
      onPublished(sg.id, result);
    }
    // Don't close the wizard here — let the user read the done screen and click Done.
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div className="w-full max-w-3xl bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] shadow-2xl max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] flex-shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-[var(--accent-dim)] flex items-center justify-center">
                <svg className="w-4 h-4 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-[var(--text)] truncate">
                    {sg.display_name || sg.slug.split('/').pop()}
                  </span>
                  <span className={cn(
                    'text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0',
                    isPublished
                      ? 'bg-[var(--accent-dim)] text-[var(--accent)]'
                      : 'bg-[var(--bg-elevated)] text-[var(--text-faint)] border border-[var(--border)]',
                  )}>
                    {isPublished ? 'Published' : 'Draft'}
                  </span>
                </div>
                <p className="text-xs text-[var(--text-faint)] font-mono truncate">{sg.slug}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {canPublish && (
                <button
                  onClick={() => setShowPublish(true)}
                  className="px-4 py-1.5 text-sm font-medium rounded-[var(--radius-button)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
                >
                  {publishLabel}
                </button>
              )}
              <button onClick={onClose} className="p-1 text-[var(--text-faint)] hover:text-[var(--text)]">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[var(--border)]">
              {/* Left: metadata + key */}
              <div className="p-6 space-y-5">
                <h4 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">Details</h4>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1.5">Display name</label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder={sg.slug.split('/').pop()}
                      className={cn(
                        'w-full px-3 py-2 text-sm rounded-[var(--radius-button)]',
                        'bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text)]',
                        'placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)]',
                      )}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--text-muted)] mb-1.5">Description</label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="What does this subgraph index?"
                      rows={3}
                      className={cn(
                        'w-full px-3 py-2 text-sm rounded-[var(--radius-button)] resize-none',
                        'bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text)]',
                        'placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)]',
                      )}
                    />
                  </div>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-4 py-2 text-sm font-medium rounded-[var(--radius-button)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : saveOk ? 'Saved ✓' : 'Save'}
                  </button>
                </div>

                {sg.deployment_id && (
                  <div className="pt-4 border-t border-[var(--border)] space-y-1.5">
                    <p className="text-xs text-[var(--text-muted)]">Deployment ID</p>
                    <div className="flex items-center gap-2">
                      <code className="text-xs font-mono text-[var(--text-faint)] truncate flex-1">
                        {sg.deployment_id}
                      </code>
                      <CopyButton text={sg.deployment_id} />
                    </div>
                    <Link
                      href={`/subgraphs/${sg.deployment_id}`}
                      className="text-xs text-[var(--accent)] hover:underline"
                    >
                      View indexing status →
                    </Link>
                  </div>
                )}

                <div className="pt-4 border-t border-[var(--border)]">
                  <DeployKeyPanel />
                </div>

                <div className="pt-4 border-t border-[var(--border)]">
                  <button
                    onClick={handleDelete}
                    disabled={deleting}
                    className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-button)] bg-[var(--red)] text-white hover:opacity-80 transition-opacity disabled:opacity-50"
                  >
                    {deleting ? 'Removing...' : 'Remove subgraph'}
                  </button>
                </div>
              </div>

              {/* Right: getting started */}
              <div className="p-6 space-y-5">
                <h4 className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
                  Getting Started
                </h4>

                <div>
                  <p className="text-xs text-[var(--text-muted)] mb-0.5">1. Install graph-cli</p>
                  <CodeBlock>npm install -g @graphprotocol/graph-cli</CodeBlock>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-muted)] mb-0.5">2. Build</p>
                  <CodeBlock>graph codegen && graph build</CodeBlock>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-muted)] mb-0.5">3. Deploy</p>
                  <CodeBlock>{`graph deploy \\\n  --node ${NODE_URL} \\\n  --deploy-key <YOUR_DEPLOY_KEY> \\\n  --ipfs https://api.thegraph.com/ipfs \\\n  ${sg.slug}`}</CodeBlock>
                </div>
                <div className="pt-2 border-t border-[var(--border)]">
                  <p className="text-xs text-[var(--text-muted)] mb-1">4. Publish on-chain</p>
                  <p className="text-xs text-[var(--text-faint)]">
                    {!sg.deployment_id
                      ? 'Deploy first, then click Publish to make your subgraph discoverable on The Graph Network.'
                      : isPublished
                      ? 'Your subgraph is published on The Graph Network.'
                      : 'Click the Publish button above to list your subgraph on The Graph Network.'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showPublish && (
        <PublishWizard
          sg={sg}
          onClose={() => setShowPublish(false)}
          onPublished={handlePublished}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Bounty modal
// ---------------------------------------------------------------------------

function BountyModal({
  sg,
  onClose,
}: {
  sg: StudioSubgraph;
  onClose: () => void;
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
        ? new Date(Date.now() + parseInt(expiryDays) * 86_400_000).toISOString()
        : null;
      await apiFetch('/api/studio/bounties', {
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
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post bounty');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
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
            <label className="block text-xs text-[var(--text-muted)] mb-1.5">
              Bounty amount (GRT) <span className="text-[var(--red)]">*</span>
            </label>
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
            Bounties are currently off-chain — they signal your intent to pay. On-chain escrow coming soon.
          </p>
          {error && <p className="text-xs text-[var(--red)]">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 text-sm rounded-[var(--radius-button)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
            >
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
// My Subgraphs tab
// ---------------------------------------------------------------------------

function MySubgraphsTab({ sessionAddress }: { sessionAddress: string }) {
  const qc = useQueryClient();
  const [showRegister, setShowRegister] = useState(false);
  const [activeSubgraph, setActiveSubgraph] = useState<StudioSubgraph | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['studio-subgraphs', sessionAddress],
    queryFn: () => apiFetch<{ subgraphs: StudioSubgraph[] }>('/api/studio/subgraphs'),
  });

  const subgraphs = data?.subgraphs ?? [];

  const handleCreated = (sg: StudioSubgraph) => {
    qc.setQueryData(['studio-subgraphs', sessionAddress], (old: typeof data) => ({
      subgraphs: [sg, ...(old?.subgraphs ?? [])],
    }));
  };

  const handleUpdated = (sg: StudioSubgraph) => {
    qc.setQueryData(['studio-subgraphs', sessionAddress], (old: typeof data) => ({
      subgraphs: old?.subgraphs.map((s) => (s.id === sg.id ? sg : s)) ?? [],
    }));
  };

  const handleDeleted = (id: number) => {
    qc.setQueryData(['studio-subgraphs', sessionAddress], (old: typeof data) => ({
      subgraphs: old?.subgraphs.filter((s) => s.id !== id) ?? [],
    }));
  };

  const handlePublished = (id: number, txHash: string) => {
    qc.setQueryData(['studio-subgraphs', sessionAddress], (old: typeof data) => ({
      subgraphs:
        old?.subgraphs.map((s) => (s.id === id ? { ...s, published_subgraph_id: txHash } : s)) ?? [],
    }));
    setActiveSubgraph((prev) =>
      prev?.id === id ? { ...prev, published_subgraph_id: txHash } : prev,
    );
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
            New Subgraph
          </button>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-16 rounded-lg shimmer" />
            ))}
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
              <p className="text-sm text-[var(--text-muted)] mt-1">
                Create a subgraph to get your deploy endpoint and key.
              </p>
            </div>
            <button
              onClick={() => setShowRegister(true)}
              className="px-4 py-2 text-sm font-medium rounded-[var(--radius-button)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
            >
              Create your first subgraph
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {subgraphs.map((sg) => (
              <SubgraphCard key={sg.id} sg={sg} onClick={() => setActiveSubgraph(sg)} />
            ))}
          </div>
        )}
      </div>

      {showRegister && (
        <RegisterModal onClose={() => setShowRegister(false)} onCreated={handleCreated} />
      )}

      {activeSubgraph && (
        <SubgraphDetailModal
          sg={activeSubgraph}
          onClose={() => setActiveSubgraph(null)}
          onUpdated={handleUpdated}
          onPublished={handlePublished}
          onDelete={handleDeleted}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Bounty board tab
// ---------------------------------------------------------------------------

function BountyBoardTab({ sessionAddress }: { sessionAddress: string | null }) {
  const { data, isLoading } = useQuery({
    queryKey: ['studio-bounties-public'],
    queryFn: () => apiFetch<{ bounties: SyncBounty[] }>('/api/studio/bounties'),
  });
  const qc = useQueryClient();
  const [bountyTarget, setBountyTarget] = useState<StudioSubgraph | null>(null);

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
    <>
      <div className="space-y-4">
        <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--accent-dim)]">
          <p className="text-sm text-[var(--text)]">
            <strong>Indexers:</strong> developers post GRT bounties for subgraphs they need synced.
            Allocate to the deployment, sync it, then claim the bounty. Settlement is currently
            off-chain — contact the developer directly.
          </p>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 rounded-lg shimmer" />
            ))}
          </div>
        ) : bounties.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-[var(--text-muted)] text-sm">No open bounties right now.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {bounties.map((b) => (
              <div
                key={b.id}
                className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)]"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-[var(--text)] truncate">{b.deployment_id}</span>
                    <CopyButton text={b.deployment_id} />
                    <Link
                      href={`/subgraphs/${b.deployment_id}`}
                      className="text-xs text-[var(--accent)] hover:underline flex-shrink-0"
                    >
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

      {bountyTarget && (
        <BountyModal sg={bountyTarget} onClose={() => setBountyTarget(null)} />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

type Tab = 'subgraphs';

export default function StudioPage() {
  const { sessionAddress, signing, error: authError, signIn, signOut } = useStudioSession();
  const [tab, setTab] = useState<Tab>('subgraphs');

  const TABS: { id: Tab; label: string }[] = [
    { id: 'subgraphs', label: 'My Subgraphs' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-[var(--text)]">Subgraph Dock</h1>
            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-500/15 text-amber-500 border border-amber-500/30">
              Experimental
            </span>
          </div>
          <p className="text-[var(--text-muted)] text-sm mt-1">
            Deploy subgraphs to The Graph Network — no limits, no gatekeepers.
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

        {/* Signed-in view */}
        {sessionAddress && (
          <>
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
            </div>
          </>
        )}
      </ConnectGate>
    </div>
  );
}
