'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAccount, useSignMessage, useWriteContract, useWaitForTransactionReceipt, useReadContract } from 'wagmi';
import { arbitrum } from 'wagmi/chains';
import { parseEther } from 'viem';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { cn, shortenAddress } from '@/lib/utils';
import { buildSignInMessage } from '@/lib/studio/auth';
import { ipfsHashToBytes32 } from '@/lib/studio/ipfs';
import { CONTRACTS } from '@/lib/wallet';
import { BOUNTY_BOARD_ABI, GRT_ABI, SUBGRAPH_SERVICE_ABI, extractBountyId } from '@/lib/bountyBoard';
import { SubgraphLifecyclePanel } from '@/components/studio/SubgraphLifecyclePanel';
import ApiKeysPanel from '@/components/studio/ApiKeysPanel';
import SubgraphAlertsPanel from '@/components/studio/SubgraphAlertsPanel';
import type { StudioSubgraph, SyncBounty } from '@/lib/studio/db';

// ---------------------------------------------------------------------------
// GNS ABI (minimal — publishNewSubgraph / publishNewVersion)
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
      log.topics[1] === ZERO_TOPIC
    ) {
      return BigInt(log.topics[3]).toString();
    }
  }
  return null;
}

const NODE_URL = 'https://www.lodestar-dashboard.com/api/studio/node';

const BOUNTY_BOARD_DEPLOYED =
  CONTRACTS.bountyBoard !== '0x0000000000000000000000000000000000000000';

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
          <svg className="w-8 h-8 text-[var(--accent-text)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
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
        <svg className="w-5 h-5 text-[var(--accent-text)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
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
              ? 'bg-[var(--accent-dim)] text-[var(--accent-text)]'
              : 'bg-[var(--bg-surface)] text-[var(--text-faint)] border border-[var(--border)]',
          )}>
            {isPublished ? 'Published' : 'Draft'}
          </span>
          {sg.version_label && (
            <span className="text-xs px-2 py-0.5 rounded-full font-mono bg-[var(--bg-elevated)] text-[var(--text-faint)] border border-[var(--border)]">
              {sg.version_label}
            </span>
          )}
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
          <button onClick={onClose} aria-label="Close" className="text-[var(--text-faint)] hover:text-[var(--text)]">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-1.5">
              Slug <span className="text-[var(--red-text)]">*</span>
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
          {error && <p className="text-xs text-[var(--red-text)]">{error}</p>}
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
  onPublished: (txHash: string, versionLabel: string) => void;
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
      const result = isNewVersion
        ? (minedTxHash ?? '')
        : (extractSubgraphId(receipt.logs, CONTRACTS.gns) ?? minedTxHash ?? '');
      onPublished(result, versionLabel);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- responding to wagmi tx-receipt confirmation — intentional
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
            <button onClick={onClose} aria-label="Close" className="text-[var(--text-faint)] hover:text-[var(--text)]">
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
                  ? <>Publishing a new version, which calls <code className="font-mono text-xs bg-[var(--bg-elevated)] px-1 rounded">GNS.publishNewVersion</code> on Arbitrum One.</>
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
              <div className="flex items-center gap-2 text-sm text-[var(--accent-text)]">
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
              <p className="text-sm text-[var(--text-muted)]">Transaction submitted. Waiting for confirmation...</p>
              {minedTxHash && (
                <a
                  href={`https://arbiscan.io/tx/${minedTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-[var(--accent-text)] hover:underline font-mono"
                >
                  {minedTxHash.slice(0, 20)}...
                </a>
              )}
            </div>
          )}

          {step === 'done' && (
            <div className="flex flex-col items-center py-8 gap-4 text-center">
              <div className="w-14 h-14 rounded-full bg-[var(--accent-dim)] flex items-center justify-center">
                <svg className="w-7 h-7 text-[var(--accent-text)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
                <p className="text-xs font-medium text-[var(--accent-text)] mb-1">Next: attract indexers</p>
                <p className="text-xs text-[var(--text-muted)]">
                  Signal GRT on your subgraph to show indexers it&apos;s worth syncing. It may take a few minutes to appear in Curate after publishing.
                </p>
                <a
                  href={`/curate?deployment=${sg.deployment_id ?? ''}`}
                  className="inline-block mt-2 text-xs font-medium text-[var(--accent-text)] hover:underline"
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
              <p className="text-sm text-[var(--red-text)]">{errMsg || 'Something went wrong.'}</p>
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
// Deploy key panel
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
          <p className="text-xs text-amber-500 mb-2">Save this now; it won&apos;t be shown again.</p>
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
// Post bounty wizard (on-chain GRT escrow)
// ---------------------------------------------------------------------------

type BountyWizardStep = 'form' | 'approve' | 'approving' | 'post' | 'posting' | 'done' | 'error';

function PostBountyWizard({
  sg,
  sessionAddress,
  onClose,
}: {
  sg: StudioSubgraph;
  sessionAddress: string;
  onClose: () => void;
}) {
  const { address } = useAccount();
  const qc = useQueryClient();
  const [step, setStep] = useState<BountyWizardStep>('form');
  const [amountGrt, setAmountGrt] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('30');
  const [message, setMessage] = useState('');
  const [errMsg, setErrMsg] = useState('');
  const [bountyId, setBountyId] = useState<string | null>(null);
  const [approveTxHash, setApproveTxHash] = useState<`0x${string}` | undefined>();
  const [postTxHash, setPostTxHash] = useState<`0x${string}` | undefined>();

  // eslint-disable-next-line react-hooks/preserve-manual-memoization -- try/catch parse; intentionally hand-memoized
  const amountWei = useMemo(() => {
    try { return parseEther(amountGrt || '0'); } catch { return 0n; }
  }, [amountGrt]);

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: CONTRACTS.grt,
    abi: GRT_ABI,
    functionName: 'allowance',
    args: address ? [address, CONTRACTS.bountyBoard] : undefined,
    query: { enabled: BOUNTY_BOARD_DEPLOYED && !!address },
  });

  const { writeContract: writeApprove, isPending: approvePending } = useWriteContract({
    mutation: {
      onSuccess: (hash) => { setApproveTxHash(hash); setStep('approving'); },
      onError: (e) => { setErrMsg(e.message.slice(0, 300)); setStep('error'); },
    },
  });

  const { writeContract: writePost, isPending: postPending } = useWriteContract({
    mutation: {
      onSuccess: (hash) => { setPostTxHash(hash); setStep('posting'); },
      onError: (e) => { setErrMsg(e.message.slice(0, 300)); setStep('error'); },
    },
  });

  const { isSuccess: approveConfirmed } = useWaitForTransactionReceipt({ hash: approveTxHash });
  const { isSuccess: postConfirmed, data: postReceipt } = useWaitForTransactionReceipt({ hash: postTxHash });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- responding to wagmi tx-receipt confirmation — intentional
    if (approveConfirmed) { refetchAllowance(); setStep('post'); }
  }, [approveConfirmed, refetchAllowance]);

  useEffect(() => {
    if (!postConfirmed || !postReceipt) return;
    const id = extractBountyId(postReceipt.logs, CONTRACTS.bountyBoard);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- responding to wagmi tx-receipt confirmation — intentional
    setBountyId(id?.toString() ?? null);
    // Save to DB for discoverability (best-effort)
    if (sg.deployment_id) {
      const expiresAt = expiresInDays
        ? new Date(Date.now() + parseInt(expiresInDays) * 86_400_000).toISOString()
        : null;
      apiFetch('/api/studio/bounties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deployment_id: sg.deployment_id,
          slug: sg.slug,
          amount_grt: amountGrt,
          message: message || null,
          expires_at: expiresAt,
          chain_bounty_id: id?.toString() ?? null,
          post_tx_hash: postTxHash ?? null,
        }),
      }).then(() => {
        qc.invalidateQueries({ queryKey: ['studio-bounties-public'] });
      }).catch(() => {});
    }
    setStep('done');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postConfirmed, postReceipt]);

  const handleContinue = () => {
    if (!amountGrt || parseFloat(amountGrt) <= 0) return;
    const needsApproval = allowance === undefined || allowance < amountWei;
    setStep(needsApproval ? 'approve' : 'post');
  };

  const handleApprove = () => {
    writeApprove({
      address: CONTRACTS.grt,
      abi: GRT_ABI,
      functionName: 'approve',
      args: [CONTRACTS.bountyBoard, amountWei],
    });
  };

  const handlePost = () => {
    if (!sg.deployment_id) return;
    const deploymentId = ipfsHashToBytes32(sg.deployment_id);
    const expiresAt = expiresInDays
      ? BigInt(Math.floor(Date.now() / 1000) + parseInt(expiresInDays) * 86400)
      : 0n;
    writePost({
      address: CONTRACTS.bountyBoard,
      abi: BOUNTY_BOARD_ABI,
      functionName: 'post',
      args: [deploymentId, amountWei, expiresAt],
    });
  };

  const canClose = !['approving', 'posting'].includes(step);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-[var(--text)]">Post Sync Bounty</h3>
            <p className="text-xs text-amber-500 mt-0.5">Experimental: on-chain GRT escrow</p>
          </div>
          {canClose && (
            <button onClick={onClose} aria-label="Close" className="text-[var(--text-faint)] hover:text-[var(--text)]">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <div className="p-5 space-y-4">
          {step === 'form' && (
            <>
              <p className="text-sm text-[var(--text-muted)]">
                GRT is locked on-chain. First indexer to sync and present a POI for this deployment wins.
              </p>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">
                  Bounty amount (GRT) <span className="text-[var(--red-text)]">*</span>
                </label>
                <input
                  type="number" min="1" step="any" placeholder="100"
                  value={amountGrt}
                  onChange={(e) => setAmountGrt(e.target.value)}
                  className={cn(
                    'w-full px-3 py-2 text-sm rounded-[var(--radius-button)]',
                    'bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text)]',
                    'placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)]',
                  )}
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">Expires after</label>
                <select
                  aria-label="Expires after"
                  value={expiresInDays}
                  onChange={(e) => setExpiresInDays(e.target.value)}
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
                  <option value="">Never (cancel anytime after 72h)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">Message to indexers (optional)</label>
                <textarea
                  placeholder="Please sync ASAP, production depends on this."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={2}
                  className={cn(
                    'w-full px-3 py-2 text-sm rounded-[var(--radius-button)] resize-none',
                    'bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text)]',
                    'placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)]',
                  )}
                />
              </div>
              <p className="text-xs text-[var(--text-faint)] bg-[var(--bg-elevated)] rounded p-2.5 border border-[var(--border)]">
                GRT is locked for 72h before you can cancel. The contract verifies the POI on-chain, so no admin can interfere.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-2 text-sm rounded-[var(--radius-button)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleContinue}
                  disabled={!amountGrt || parseFloat(amountGrt) <= 0}
                  className="flex-1 px-4 py-2 text-sm font-medium rounded-[var(--radius-button)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  Continue
                </button>
              </div>
            </>
          )}

          {step === 'approve' && (
            <>
              <p className="text-sm text-[var(--text-muted)]">
                Approve the BountyBoard contract to spend <strong>{amountGrt} GRT</strong>.
              </p>
              <button
                onClick={handleApprove}
                disabled={approvePending}
                className="w-full px-4 py-2 text-sm font-medium rounded-[var(--radius-button)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {approvePending ? 'Waiting for wallet...' : 'Approve GRT'}
              </button>
              <button
                onClick={onClose}
                className="w-full px-4 py-2 text-sm rounded-[var(--radius-button)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
              >
                Cancel
              </button>
            </>
          )}

          {step === 'approving' && (
            <div className="flex flex-col items-center py-8 gap-3">
              <div className="w-10 h-10 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
              <p className="text-sm text-[var(--text-muted)]">Waiting for approval confirmation...</p>
              {approveTxHash && (
                <a href={`https://arbiscan.io/tx/${approveTxHash}`} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-[var(--accent-text)] hover:underline font-mono">
                  {approveTxHash.slice(0, 20)}...
                </a>
              )}
            </div>
          )}

          {step === 'post' && (
            <>
              <div className="flex items-center gap-2 text-sm text-[var(--accent-text)]">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                GRT approved
              </div>
              <p className="text-sm text-[var(--text-muted)]">
                Lock <strong>{amountGrt} GRT</strong> in the BountyBoard contract on Arbitrum One.
              </p>
              <button
                onClick={handlePost}
                disabled={postPending}
                className="w-full px-4 py-2 text-sm font-medium rounded-[var(--radius-button)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {postPending ? 'Waiting for wallet...' : 'Post Bounty'}
              </button>
            </>
          )}

          {step === 'posting' && (
            <div className="flex flex-col items-center py-8 gap-3">
              <div className="w-10 h-10 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
              <p className="text-sm text-[var(--text-muted)]">Locking GRT on-chain...</p>
              {postTxHash && (
                <a href={`https://arbiscan.io/tx/${postTxHash}`} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-[var(--accent-text)] hover:underline font-mono">
                  {postTxHash.slice(0, 20)}...
                </a>
              )}
            </div>
          )}

          {step === 'done' && (
            <div className="flex flex-col items-center py-8 gap-4 text-center">
              <div className="w-14 h-14 rounded-full bg-[var(--accent-dim)] flex items-center justify-center">
                <svg className="w-7 h-7 text-[var(--accent-text)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-[var(--text)]">Bounty posted!</p>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {amountGrt} GRT locked on-chain. First indexer to sync and present a POI wins.
                </p>
                {bountyId !== null && (
                  <p className="text-xs text-[var(--text-faint)] font-mono mt-2">Bounty #{bountyId}</p>
                )}
              </div>
              <div className="flex gap-3">
                {postTxHash && (
                  <a href={`https://arbiscan.io/tx/${postTxHash}`} target="_blank" rel="noopener noreferrer"
                    className="px-4 py-2 text-sm border border-[var(--border)] rounded-[var(--radius-button)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
                    View on Arbiscan
                  </a>
                )}
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium rounded-[var(--radius-button)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {step === 'error' && (
            <div className="space-y-4">
              <p className="text-sm text-[var(--red-text)]">{errMsg || 'Something went wrong.'}</p>
              <button
                onClick={() => setStep('form')}
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
// Claim modal (for indexers)
// ---------------------------------------------------------------------------

function ClaimModal({ bounty, onClose }: { bounty: SyncBounty; onClose: () => void }) {
  const [allocationId, setAllocationId] = useState('');
  const [step, setStep] = useState<'form' | 'claiming' | 'done' | 'error'>('form');
  const [claimTxHash, setClaimTxHash] = useState<`0x${string}` | undefined>();
  const [errMsg, setErrMsg] = useState('');

  const validAddress = allocationId.startsWith('0x') && allocationId.length === 42;

  // POI presentation state
  const [agentUrl, setAgentUrl] = useState('http://localhost:8000');
  const [agentToken, setAgentToken] = useState('');
  const [poiQueuing, setPoiQueuing] = useState(false);
  const [poiQueued, setPoiQueued] = useState(false);
  const [poiQueueError, setPoiQueueError] = useState('');

  const handlePresentPoi = async () => {
    if (!validAddress || !bounty.deployment_id) return;
    setPoiQueuing(true);
    setPoiQueueError('');
    setPoiQueued(false);
    try {
      const res = await fetch('/api/indexer/present-poi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deploymentId: bounty.deployment_id,
          allocationId,
          agentUrl: agentUrl.trim(),
          agentToken: agentToken.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Request failed');
      if (data.errors?.length) throw new Error(data.errors[0].message);
      setPoiQueued(true);
    } catch (e) {
      setPoiQueueError((e as Error).message);
    } finally {
      setPoiQueuing(false);
    }
  };

  // Poll allocation state from SubgraphService every 10s once an address is entered
  const { data: allocState } = useReadContract({
    address: CONTRACTS.subgraphService,
    abi: SUBGRAPH_SERVICE_ABI,
    functionName: 'getAllocation',
    args: validAddress ? [allocationId as `0x${string}`] : undefined,
    query: {
      enabled: validAddress && step !== 'done',
      refetchInterval: 10_000,
    },
  });

  // Read the on-chain bounty to get postedAt for the POI comparison
  const { data: chainBounty } = useReadContract({
    address: CONTRACTS.bountyBoard,
    abi: BOUNTY_BOARD_ABI,
    functionName: 'getBounty',
    args: bounty.chain_bounty_id ? [BigInt(bounty.chain_bounty_id)] : undefined,
    query: { enabled: !!bounty.chain_bounty_id && step !== 'done' },
  });

  const poiReady = !!(
    allocState &&
    chainBounty &&
    allocState.lastPOIPresentedAt > 0n &&
    allocState.lastPOIPresentedAt > (chainBounty as { postedAt: bigint }).postedAt
  );
  const allocationClosed = allocState ? allocState.closedAt > 0n : false;

  const { writeContract, isPending } = useWriteContract({
    mutation: {
      onSuccess: (hash) => { setClaimTxHash(hash); setStep('claiming'); },
      onError: (e) => { setErrMsg(e.message.slice(0, 600)); setStep('error'); },
    },
  });

  const { isSuccess: claimConfirmed } = useWaitForTransactionReceipt({ hash: claimTxHash });
  useEffect(() => {
    if (!claimConfirmed) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- responding to wagmi tx-receipt confirmation — intentional
    setStep('done');
    // Best-effort DB update — fire and forget
    fetch(`/api/studio/bounties/${bounty.id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'claim' }),
    }).catch(() => {});
  }, [claimConfirmed, bounty.id]);

  const handleClaim = () => {
    if (!bounty.chain_bounty_id || !validAddress) return;
    writeContract({
      address: CONTRACTS.bountyBoard,
      abi: BOUNTY_BOARD_ABI,
      functionName: 'claim',
      args: [BigInt(bounty.chain_bounty_id), allocationId as `0x${string}`],
    });
  };

  const canClose = step !== 'claiming';

  // GraphQL snippet indexers can run against their own management API
  const poiMutation = `mutation {
  queueActions(actions: [{
    type: presentPOI,
    deploymentID: "${bounty.deployment_id}",
    allocationID: "${allocationId || '<your-allocation-id>'}",
    protocolNetwork: "eip155:42161",
    status: approved, priority: 0,
    isLegacy: false, source: "manual",
    reason: "bounty claim"
  }]) { id type status failureReason }
}`;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-[var(--text)]">Claim Bounty #{bounty.chain_bounty_id}</h3>
            <p className="text-xs text-[var(--text-faint)] font-mono mt-0.5">{bounty.amount_grt} GRT</p>
          </div>
          {canClose && (
            <button onClick={onClose} aria-label="Close" className="text-[var(--text-faint)] hover:text-[var(--text)]">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <div className="p-5 space-y-4">
          {step === 'form' && (
            <>
              {/* Steps checklist */}
              <ol className="space-y-2 text-xs text-[var(--text-muted)]">
                <li className="flex gap-2">
                  <span className="flex-shrink-0 w-4 h-4 rounded-full bg-[var(--accent-dim)] text-[var(--accent-text)] flex items-center justify-center font-semibold text-[10px]">1</span>
                  <span>Deploy the subgraph to your graph-node and wait for it to sync</span>
                </li>
                <li className="flex gap-2">
                  <span className="flex-shrink-0 w-4 h-4 rounded-full bg-[var(--accent-dim)] text-[var(--accent-text)] flex items-center justify-center font-semibold text-[10px]">2</span>
                  <span>Allocate to this deployment via your indexer-agent (<code>setIndexingRule</code> or <code>queueActions</code>)</span>
                </li>
                <li className="flex gap-2">
                  <span className="flex-shrink-0 w-4 h-4 rounded-full bg-[var(--accent-dim)] text-[var(--accent-text)] flex items-center justify-center font-semibold text-[10px]">3</span>
                  <span>Present a POI via your management API (port 8000). See below</span>
                </li>
                <li className="flex gap-2">
                  <span className="flex-shrink-0 w-4 h-4 rounded-full bg-[var(--accent-dim)] text-[var(--accent-text)] flex items-center justify-center font-semibold text-[10px]">4</span>
                  <span>Enter your allocation ID here. Both checks must be green before the Claim button enables</span>
                </li>
              </ol>
              <p className="text-xs text-[var(--text-faint)]">
                New to this?{' '}
                <a href="/blog/sync-bounty-indexer-guide" target="_blank" rel="noopener noreferrer" className="text-[var(--accent-text)] hover:underline">
                  Full guide for indexers →
                </a>
              </p>

              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">
                  Allocation ID <span className="text-[var(--red-text)]">*</span>
                </label>
                <input
                  type="text"
                  placeholder="0x..."
                  value={allocationId}
                  onChange={(e) => setAllocationId(e.target.value)}
                  className={cn(
                    'w-full px-3 py-2 text-sm font-mono rounded-[var(--radius-button)]',
                    'bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text)]',
                    'placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)]',
                  )}
                />
                <p className="text-xs text-[var(--text-faint)] mt-1">
                  The <code>0x</code> address created when you allocated, not your indexer address.
                  Query <code>{'{ allocations(filter: {}) { id subgraphDeployment } }'}</code> on your management API, or find a{' '}
                  <code>ServiceStarted</code> event on{' '}
                  <a href={`https://arbiscan.io/address/${CONTRACTS.subgraphService}#events`} target="_blank" rel="noopener noreferrer" className="text-[var(--accent-text)] hover:underline">
                    Arbiscan
                  </a>.
                </p>
              </div>

              {/* On-chain status panel */}
              {validAddress && allocState && (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3 space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-[var(--text-faint)]">Allocation</span>
                    <span className={allocationClosed ? 'text-[var(--red-text)]' : 'text-[var(--green)]'}>
                      {allocationClosed ? 'Closed, cannot claim' : 'Open'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-faint)]">POI verified on-chain</span>
                    <span className={poiReady ? 'text-[var(--green)]' : 'text-[var(--text-muted)]'}>
                      {poiReady ? 'Yes, ready to claim' : 'Not yet (polling every 10s)'}
                    </span>
                  </div>
                </div>
              )}

              {/* POI — interactive form when allocation open but POI not yet confirmed */}
              {validAddress && allocState && !allocationClosed && !poiReady && (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-3 space-y-3">
                  <p className="text-xs font-medium text-[var(--text-muted)]">Step 3: Present a POI</p>
                  <div className="space-y-2">
                    <div>
                      <label className="block text-xs text-[var(--text-faint)] mb-1">Management API URL</label>
                      <input
                        type="text"
                        value={agentUrl}
                        onChange={(e) => setAgentUrl(e.target.value)}
                        placeholder="http://localhost:8000"
                        className={cn(
                          'w-full px-2.5 py-1.5 text-xs font-mono rounded-[var(--radius-button)]',
                          'bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text)]',
                          'placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)]',
                        )}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[var(--text-faint)] mb-1">Basic auth <span className="opacity-60">(user:password, optional)</span></label>
                      <input
                        type="password"
                        value={agentToken}
                        onChange={(e) => setAgentToken(e.target.value)}
                        placeholder="user:password"
                        className={cn(
                          'w-full px-2.5 py-1.5 text-xs font-mono rounded-[var(--radius-button)]',
                          'bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text)]',
                          'placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)]',
                        )}
                      />
                    </div>
                  </div>
                  <button
                    onClick={handlePresentPoi}
                    disabled={poiQueuing || poiQueued || !agentUrl.trim()}
                    className="w-full px-3 py-1.5 text-xs font-medium rounded-[var(--radius-button)] bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 transition-colors disabled:opacity-50"
                  >
                    {poiQueuing ? 'Queuing...' : poiQueued ? 'Queued ✓, waiting for chain confirmation' : 'Queue POI Action'}
                  </button>
                  {poiQueueError && (
                    <p className="text-xs text-[var(--red-text)]">{poiQueueError}</p>
                  )}
                  {!poiQueued && (
                    <details className="text-xs">
                      <summary className="text-[var(--text-faint)] cursor-pointer hover:text-[var(--text-muted)]">Do it manually instead</summary>
                      <pre className="mt-2 text-[10px] font-mono text-[var(--text-faint)] whitespace-pre-wrap break-all leading-relaxed">
                        {poiMutation}
                      </pre>
                    </details>
                  )}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-2 text-sm rounded-[var(--radius-button)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleClaim}
                  disabled={isPending || !poiReady}
                  className="flex-1 px-4 py-2 text-sm font-medium rounded-[var(--radius-button)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {isPending ? 'Waiting for wallet...' : 'Claim GRT'}
                </button>
              </div>
            </>
          )}

          {step === 'claiming' && (
            <div className="flex flex-col items-center py-8 gap-3">
              <div className="w-10 h-10 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
              <p className="text-sm text-[var(--text-muted)]">Transaction submitted...</p>
              {claimTxHash && (
                <a href={`https://arbiscan.io/tx/${claimTxHash}`} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-[var(--accent-text)] hover:underline font-mono">
                  {claimTxHash.slice(0, 20)}...
                </a>
              )}
            </div>
          )}

          {step === 'done' && (
            <div className="flex flex-col items-center py-8 gap-4 text-center">
              <div className="w-14 h-14 rounded-full bg-[var(--accent-dim)] flex items-center justify-center">
                <svg className="w-7 h-7 text-[var(--accent-text)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="font-semibold text-[var(--text)]">Bounty claimed!</p>
                <p className="text-sm text-[var(--text-muted)] mt-1">{bounty.amount_grt} GRT sent to your wallet.</p>
              </div>
              <div className="flex gap-3">
                {claimTxHash && (
                  <a href={`https://arbiscan.io/tx/${claimTxHash}`} target="_blank" rel="noopener noreferrer"
                    className="px-4 py-2 text-sm border border-[var(--border)] rounded-[var(--radius-button)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
                    View on Arbiscan
                  </a>
                )}
                <button onClick={onClose} className="px-4 py-2 text-sm font-medium rounded-[var(--radius-button)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity">
                  Done
                </button>
              </div>
            </div>
          )}

          {step === 'error' && (
            <div className="space-y-4">
              <p className="text-xs text-[var(--red-text)] font-mono whitespace-pre-wrap break-all">{errMsg}</p>
              <button
                onClick={() => setStep('form')}
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
// Subgraph detail modal
// ---------------------------------------------------------------------------

function SubgraphDetailModal({
  sg: initialSg,
  sessionAddress,
  onClose,
  onUpdated,
  onPublished,
  onDelete,
}: {
  sg: StudioSubgraph;
  sessionAddress: string;
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
  const [showBountyWizard, setShowBountyWizard] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { data: activeBounties } = useQuery<SyncBounty[]>({
    queryKey: ['bounties', sg.deployment_id],
    queryFn: async () => {
      if (!sg.deployment_id) return [];
      const res = await fetch(`/api/studio/bounties?deployment=${sg.deployment_id}`);
      const json = await res.json();
      return (json.bounties ?? []).filter((b: SyncBounty) => b.status === 'open');
    },
    enabled: Boolean(sg.deployment_id),
    staleTime: 30_000,
  });

  // Auto-resolve legacy tx hash → on-chain subgraph NFT ID
  const legacyTxHash = (
    sg.published_subgraph_id?.startsWith('0x') ? sg.published_subgraph_id as `0x${string}` : undefined
  );
  const { data: legacyReceipt, isPending: isResolvingNftId } = useWaitForTransactionReceipt({ hash: legacyTxHash, chainId: arbitrum.id });
  useEffect(() => {
    if (!legacyReceipt) return;
    const nftId = extractSubgraphId(legacyReceipt.logs, CONTRACTS.gns);
    if (!nftId) return;
    apiFetch(`/api/studio/subgraphs/${sg.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ published_subgraph_id: nftId }),
    }).then(() => {
      const updated = { ...sg, published_subgraph_id: nftId };
      setSg(updated);
      onUpdated(updated);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legacyReceipt]);

  const isPublished = Boolean(sg.published_subgraph_id);
  const subgraphNftId = sg.published_subgraph_id && !sg.published_subgraph_id.startsWith('0x')
    ? sg.published_subgraph_id : null;
  const hasNewDeployment = Boolean(
    sg.deployment_id && sg.last_published_deployment_id !== null && sg.deployment_id !== sg.last_published_deployment_id,
  );
  const canPublish = Boolean(sg.deployment_id) && (!isPublished || (subgraphNftId !== null && hasNewDeployment));
  const publishLabel = isPublished ? 'Update Version' : 'Publish';

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

  const handlePublished = async (result: string, versionLabel: string) => {
    const trimLabel = versionLabel.trim() || null;
    if (subgraphNftId === null) {
      await apiFetch(`/api/studio/subgraphs/${sg.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ published_subgraph_id: result, version_label: trimLabel, last_published_deployment_id: sg.deployment_id }),
      });
      const updated = { ...sg, published_subgraph_id: result, version_label: trimLabel, last_published_deployment_id: sg.deployment_id };
      setSg(updated);
      onUpdated(updated);
      onPublished(sg.id, result);
    } else {
      await apiFetch(`/api/studio/subgraphs/${sg.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version_label: trimLabel, last_published_deployment_id: sg.deployment_id }),
      });
      const updated = { ...sg, version_label: trimLabel, last_published_deployment_id: sg.deployment_id };
      setSg(updated);
      onUpdated(updated);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <div className="w-full max-w-3xl bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] shadow-2xl max-h-[90vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] flex-shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-[var(--accent-dim)] flex items-center justify-center">
                <svg className="w-4 h-4 text-[var(--accent-text)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
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
                      ? 'bg-[var(--accent-dim)] text-[var(--accent-text)]'
                      : 'bg-[var(--bg-elevated)] text-[var(--text-faint)] border border-[var(--border)]',
                  )}>
                    {isPublished ? 'Published' : 'Draft'}
                  </span>
                  {sg.version_label && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-mono flex-shrink-0 bg-[var(--bg-elevated)] text-[var(--text-faint)] border border-[var(--border)]">
                      {sg.version_label}
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--text-faint)] font-mono truncate">{sg.slug}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Post Bounty button */}
              {sg.deployment_id && BOUNTY_BOARD_DEPLOYED && (
                <button
                  onClick={() => setShowBountyWizard(true)}
                  className="px-3 py-1.5 text-sm font-medium rounded-[var(--radius-button)] border border-amber-500/40 text-amber-500 hover:bg-amber-500/10 transition-colors"
                >
                  Post Bounty
                </button>
              )}
              {/* Publish / Update Version */}
              {isPublished && !canPublish && sg.deployment_id ? (
                <div className="relative group">
                  <button
                    disabled
                    className="px-4 py-1.5 text-sm font-medium rounded-[var(--radius-button)] bg-[var(--accent)] text-white opacity-40 cursor-not-allowed"
                  >
                    Update Version
                  </button>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 text-xs text-[var(--text)] bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg shadow-xl whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                    {!hasNewDeployment
                      ? 'No new deployment. Run graph deploy again (step 3) first'
                      : 'Resolving on-chain subgraph ID. Try again in a moment'}
                    <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[var(--border)]" />
                  </div>
                </div>
              ) : canPublish && (
                <button
                  onClick={() => setShowPublish(true)}
                  className="px-4 py-1.5 text-sm font-medium rounded-[var(--radius-button)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
                >
                  {publishLabel}
                </button>
              )}
              <button onClick={onClose} aria-label="Close" className="p-1 text-[var(--text-faint)] hover:text-[var(--text)]">
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
                      className="text-xs text-[var(--accent-text)] hover:underline"
                    >
                      View indexing status →
                    </Link>
                  </div>
                )}

                {activeBounties && activeBounties.length > 0 && (
                  <div className="pt-4 border-t border-[var(--border)] space-y-2">
                    <p className="text-xs font-medium text-amber-400">Active Bounties</p>
                    {activeBounties.map((b) => (
                      <div key={b.id} className="rounded-[var(--radius)] bg-amber-500/10 border border-amber-500/20 px-3 py-2 space-y-0.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-amber-300">{b.amount_grt} GRT</span>
                          {b.chain_bounty_id && (
                            <span className="text-xs text-[var(--text-faint)] font-mono">#{b.chain_bounty_id}</span>
                          )}
                        </div>
                        {b.message && <p className="text-xs text-[var(--text-muted)] italic">&quot;{b.message}&quot;</p>}
                        {b.expires_at && (
                          <p className="text-xs text-[var(--text-faint)]">
                            expires {new Date(b.expires_at).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="pt-4 border-t border-[var(--border)]">
                  <DeployKeyPanel />
                </div>

                {/* Query API keys (RFC-004 Phase A — metered gateway, free-tier) */}
                <ApiKeysPanel />

                {sg.deployment_id && (
                  <SubgraphAlertsPanel
                    deploymentId={sg.deployment_id}
                    label={displayName || sg.display_name}
                  />
                )}

                <SubgraphLifecyclePanel
                  sg={sg}
                  displayName={displayName}
                  description={description}
                  onUpdated={(updated) => {
                    setSg(updated);
                    onUpdated(updated);
                  }}
                />

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
                      ? hasNewDeployment
                        ? 'New deployment detected. Click Update Version above to publish it on-chain.'
                        : 'Published ✓. Update your code, run graph deploy again (step 3), then click Update Version above.'
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

      {showBountyWizard && (
        <PostBountyWizard
          sg={sg}
          sessionAddress={sessionAddress}
          onClose={() => setShowBountyWizard(false)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// My Subgraphs tab
// ---------------------------------------------------------------------------

function MySubgraphsTab({ sessionAddress }: { sessionAddress: string }) {
  const qc = useQueryClient();
  const [showRegister, setShowRegister] = useState(false);
  const [activeSubgraph, setActiveSubgraph] = useState<StudioSubgraph | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['studio-subgraphs', sessionAddress],
    queryFn: () => apiFetch<{ subgraphs: StudioSubgraph[] }>('/api/studio/subgraphs'),
    retry: 1,
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
        ) : isError ? (
          <p className="text-sm text-[var(--red-text)] py-4">Failed to load subgraphs. Please refresh.</p>
        ) : subgraphs.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center gap-4 border border-dashed border-[var(--border)] rounded-xl">
            <div className="w-12 h-12 rounded-xl bg-[var(--accent-dim)] flex items-center justify-center">
              <svg className="w-6 h-6 text-[var(--accent-text)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
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
          sessionAddress={sessionAddress}
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
// Bounty query playground
// ---------------------------------------------------------------------------

const STARTER_QUERY = `{
  _meta {
    block { number hash }
    deployment
  }
}`;

function BountyQueryPanel({ bounty }: { bounty: SyncBounty }) {
  const [tab, setTab] = useState<'playground' | 'gateway'>('playground');
  const [query, setQuery] = useState(STARTER_QUERY);
  const [running, setRunning] = useState(false);
  const [response, setResponse] = useState<string | null>(null);
  const [responseError, setResponseError] = useState<string | null>(null);
  const endpointUrl = `https://www.lodestar-dashboard.com/api/bounty-query/${bounty.id}`;

  const run = async () => {
    setRunning(true);
    setResponse(null);
    setResponseError(null);
    try {
      const res = await fetch(`/api/bounty-query/${bounty.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResponseError(data.error ?? `HTTP ${res.status}`);
      } else if (Array.isArray(data.errors) && data.errors.length > 0) {
        const msg: string = data.errors[0]?.message ?? 'GraphQL error';
        if (msg.includes('not found') || msg.includes('not available')) {
          setResponseError(
            'Subgraph not available via gateway. The indexer who claimed this bounty may have closed their allocation after syncing. Try querying the indexer directly, or wait for another indexer to pick it up.',
          );
        } else {
          setResponseError(msg);
        }
      } else {
        setResponse(JSON.stringify(data, null, 2));
      }
    } catch (e) {
      setResponseError(String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-[var(--border)]">
        {(['playground', 'gateway'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-3 py-2 text-xs font-medium capitalize transition-colors',
              tab === t
                ? 'text-[var(--accent-text)] border-b-2 border-[var(--accent)] -mb-px'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="p-3 space-y-2">
        {tab === 'playground' && (
          <>
            {/* Endpoint */}
            <div className="flex items-center gap-2">
              <code className="flex-1 text-[10px] font-mono text-[var(--text-faint)] truncate">{endpointUrl}</code>
              <CopyButton text={endpointUrl} />
            </div>
            {/* Query textarea */}
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              rows={5}
              spellCheck={false}
              className={cn(
                'w-full px-3 py-2 text-xs font-mono rounded-[var(--radius-button)] resize-y',
                'bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text)]',
                'placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)]',
              )}
            />
            <button
              onClick={run}
              disabled={running || !query.trim()}
              className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-button)] bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {running ? 'Running…' : 'Run →'}
            </button>
            {responseError && (
              <div className="p-2 rounded-[var(--radius-button)] bg-[var(--red-dim)] text-[var(--red-text)] text-xs font-mono">
                {responseError}
              </div>
            )}
            {response && (
              <pre className="p-2 rounded-[var(--radius-button)] bg-[var(--bg-elevated)] text-[10px] font-mono text-[var(--text-muted)] overflow-x-auto max-h-48 whitespace-pre-wrap break-all">
                {response}
              </pre>
            )}
          </>
        )}

        {tab === 'gateway' && (
          <div className="space-y-3 text-xs text-[var(--text-muted)]">
            <p>
              If this subgraph has been published to The Graph Network, you can query it via the decentralised gateway
              using your own API key:
            </p>
            <div className="p-2 rounded-[var(--radius-button)] bg-[var(--bg-elevated)] font-mono text-[10px] text-[var(--text-faint)] break-all">
              {`https://gateway-arbitrum.network.thegraph.com/api/<YOUR_API_KEY>/subgraphs/id/<SUBGRAPH_NFT_ID>`}
            </div>
            <p className="text-[var(--text-faint)]">
              The <strong className="text-[var(--text-muted)]">subgraph NFT ID</strong> is assigned when you call{' '}
              <code>GNS.publishNewSubgraph</code>. If you published via the Dock above, it appears in your subgraph
              details.
            </p>
            <div className="flex gap-3 flex-wrap">
              <Link
                href={`/subgraphs/${bounty.deployment_id}`}
                className="text-[var(--accent-text)] hover:underline"
              >
                Check indexing status →
              </Link>
              <a
                href="https://thegraph.com/studio"
                target="_blank"
                rel="noreferrer"
                className="text-[var(--accent-text)] hover:underline"
              >
                Get API key at The Graph Studio →
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bounty board tab
// ---------------------------------------------------------------------------

function BountyBoardTab({ sessionAddress }: { sessionAddress: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['studio-bounties-public'],
    queryFn: () => apiFetch<{ bounties: SyncBounty[] }>('/api/studio/bounties'),
    retry: 1,
  });
  const [claimTarget, setClaimTarget] = useState<SyncBounty | null>(null);
  const [cancelHashes, setCancelHashes] = useState<Record<string, `0x${string}`>>({});
  const [howToOpen, setHowToOpen] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [refundHashes, setRefundHashes] = useState<Record<string, `0x${string}`>>({});
  const [queryOpenIds, setQueryOpenIds] = useState<Set<number>>(new Set());
  // Mount-stable "now" (ms) — keeps render pure (no Date.now() during render).
  const [nowMs] = useState(() => Date.now());

  const toggleQuery = (id: number) =>
    setQueryOpenIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const { writeContract: writeCancel } = useWriteContract({
    mutation: {
      onSuccess: (hash) => {
        if (cancellingId) setCancelHashes((prev) => ({ ...prev, [cancellingId]: hash }));
        setCancellingId(null);
      },
      onError: (e) => {
        setCancellingId(null);
        alert(e.message.slice(0, 200));
      },
    },
  });

  const handleCancel = (bounty: SyncBounty) => {
    if (!bounty.chain_bounty_id) return;
    if (!confirm(`Cancel bounty #${bounty.chain_bounty_id}? GRT will be returned to your wallet.`)) return;
    setCancellingId(bounty.chain_bounty_id);
    writeCancel({
      address: CONTRACTS.bountyBoard,
      abi: BOUNTY_BOARD_ABI,
      functionName: 'cancel',
      args: [BigInt(bounty.chain_bounty_id)],
    });
  };

  const { writeContract: writeRefund } = useWriteContract({
    mutation: {
      onSuccess: (hash) => {
        if (refundingId) setRefundHashes((prev) => ({ ...prev, [refundingId]: hash }));
        setRefundingId(null);
      },
      onError: (e) => {
        setRefundingId(null);
        alert(e.message.slice(0, 200));
      },
    },
  });

  const handleRefund = (bounty: SyncBounty) => {
    if (!bounty.chain_bounty_id) return;
    if (!confirm(`Refund expired bounty #${bounty.chain_bounty_id}? The locked GRT returns to the developer.`)) return;
    setRefundingId(bounty.chain_bounty_id);
    writeRefund({
      address: CONTRACTS.bountyBoard,
      abi: BOUNTY_BOARD_ABI,
      functionName: 'refundExpired',
      args: [BigInt(bounty.chain_bounty_id)],
    });
  };

  const bounties = data?.bounties ?? [];

  if (!BOUNTY_BOARD_DEPLOYED) {
    return (
      <div className="py-16 text-center">
        <p className="text-[var(--text-muted)] text-sm">On-chain bounty contract not yet deployed.</p>
        <p className="text-xs text-[var(--text-faint)] mt-1">Set <code>NEXT_PUBLIC_BOUNTY_BOARD_ADDRESS</code> after deployment.</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        <div className="p-4 rounded-lg border border-amber-500/20 bg-amber-500/5">
          <p className="text-sm text-amber-600 dark:text-amber-400">
            <strong>Experimental.</strong> GRT is locked on-chain in the BountyBoard contract: fully trustless, no admin.
            The contract verifies on-chain that the indexer has an open allocation with a POI submitted after the bounty was posted.
            First valid claim wins.
          </p>
        </div>

        {/* How indexers claim — collapsible */}
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] overflow-hidden">
          <button
            onClick={() => setHowToOpen((o) => !o)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-[var(--text)] hover:bg-[var(--bg-surface)] transition-colors text-left"
          >
            <span>How do indexers claim?</span>
            <svg className={cn('w-4 h-4 text-[var(--text-faint)] transition-transform', howToOpen && 'rotate-180')} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {howToOpen && (
            <div className="px-4 pb-4 space-y-3 border-t border-[var(--border)]">
              <ol className="mt-3 space-y-3 text-sm text-[var(--text-muted)]">
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[var(--accent-dim)] text-[var(--accent-text)] flex items-center justify-center font-semibold text-[11px] mt-0.5">1</span>
                  <div>
                    <p className="font-medium text-[var(--text)]">Deploy the subgraph to your graph-node</p>
                    <p className="text-xs mt-0.5">Use the deployment ID shown on the bounty. Call <code>subgraph_create</code> then <code>subgraph_deploy</code> on your graph-node admin API (port 8020). Wait for <code>synced: true</code>.</p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[var(--accent-dim)] text-[var(--accent-text)] flex items-center justify-center font-semibold text-[11px] mt-0.5">2</span>
                  <div>
                    <p className="font-medium text-[var(--text)]">Allocate to the deployment</p>
                    <p className="text-xs mt-0.5">Use <code>setIndexingRule</code> with <code>decisionBasis: always</code> or queue an <code>allocate</code> action via your indexer-agent management API (port 8000). Note your allocation ID; it&apos;s a <code>0x</code> address, not your indexer address.</p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[var(--accent-dim)] text-[var(--accent-text)] flex items-center justify-center font-semibold text-[11px] mt-0.5">3</span>
                  <div>
                    <p className="font-medium text-[var(--text)]">Present a POI</p>
                    <p className="text-xs mt-0.5">Queue a <code>presentPOI</code> action via your management API. This calls <code>SubgraphService.collect()</code> and sets <code>lastPOIPresentedAt</code> on-chain, the timestamp the contract checks. Keep your allocation <strong>open</strong> until after claiming.</p>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[var(--accent-dim)] text-[var(--accent-text)] flex items-center justify-center font-semibold text-[11px] mt-0.5">4</span>
                  <div>
                    <p className="font-medium text-[var(--text)]">Click Claim and sign</p>
                    <p className="text-xs mt-0.5">Open the claim modal, enter your allocation ID. The status panel polls the chain every 10s. Once both checks are green, click <strong>Claim GRT</strong> and sign with your indexer wallet. GRT is paid out immediately.</p>
                  </div>
                </li>
              </ol>
              <a
                href="/blog/sync-bounty-indexer-guide"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-xs text-[var(--accent-text)] hover:underline mt-1"
              >
                Full step-by-step guide with code snippets →
              </a>
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-lg shimmer" />)}
          </div>
        ) : isError ? (
          <p className="text-sm text-[var(--red-text)] py-4">Failed to load bounties. Please refresh.</p>
        ) : bounties.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-[var(--text-muted)] text-sm">No bounties posted yet.</p>
            <p className="text-xs text-[var(--text-faint)] mt-1">
              Open a subgraph from the My Subgraphs tab and click Post Bounty.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {bounties.map((b) => {
              const isOwn = sessionAddress.toLowerCase() === b.developer_address?.toLowerCase();
              const isClaimed = b.status === 'claimed';
              // Expired = the cache says so, or the deadline has passed (guard against
              // a not-yet-reconciled row showing a Claim button that would revert).
              const isExpired =
                !isClaimed &&
                (b.status === 'expired' ||
                  (!!b.expires_at && nowMs > new Date(b.expires_at).getTime()));
              const cancelTxHash = b.chain_bounty_id ? cancelHashes[b.chain_bounty_id] : undefined;
              const refundTxHash = b.chain_bounty_id ? refundHashes[b.chain_bounty_id] : undefined;
              const cancelUnlockAt = new Date(new Date(b.created_at).getTime() + 72 * 60 * 60 * 1000);
              const cancelUnlocked = nowMs >= cancelUnlockAt.getTime();
              const isCancelling = cancellingId === b.chain_bounty_id;
              const isRefunding = refundingId === b.chain_bounty_id;
              const queryOpen = queryOpenIds.has(b.id);

              return (
                <div
                  key={b.id}
                  className={cn(
                    'p-4 rounded-lg border bg-[var(--bg-elevated)]',
                    isClaimed ? 'border-[var(--green)]/20' : 'border-[var(--border)]',
                  )}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs text-[var(--text)] truncate">{b.deployment_id}</span>
                        <CopyButton text={b.deployment_id} />
                        <Link href={`/subgraphs/${b.deployment_id}`} className="text-xs text-[var(--accent-text)] hover:underline flex-shrink-0">
                          View
                        </Link>
                        {b.chain_bounty_id && (
                          <a
                            href={`https://arbiscan.io/address/${CONTRACTS.bountyBoard}#readContract`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-[var(--text-faint)] hover:text-[var(--accent-text)] transition-colors"
                          >
                            #{b.chain_bounty_id} ↗
                          </a>
                        )}
                        {isClaimed && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--green-dim)] text-[var(--green)] font-medium">
                            Claimed
                          </span>
                        )}
                        {isExpired && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--amber-dim)] text-[var(--amber)] font-medium">
                            Expired
                          </span>
                        )}
                      </div>
                      {b.message && (
                        <p className="text-xs text-[var(--text-muted)] mt-1 italic">&ldquo;{b.message}&rdquo;</p>
                      )}
                      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                        <span className="text-xs text-[var(--text-faint)]">by {shortenAddress(b.developer_address)}</span>
                        {b.expires_at && !isClaimed && (
                          <span className="text-xs text-[var(--text-faint)]">
                            expires {new Date(b.expires_at).toLocaleDateString()}
                          </span>
                        )}
                        {isClaimed && b.claimed_at && (
                          <span className="text-xs text-[var(--text-faint)]">
                            claimed {new Date(b.claimed_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className={cn('text-base font-semibold', (isClaimed || isExpired) ? 'text-[var(--text-muted)] line-through' : 'text-[var(--accent-text)]')}>
                        {b.amount_grt} GRT
                      </span>
                      {isClaimed ? (
                        <button
                          onClick={() => toggleQuery(b.id)}
                          className={cn(
                            'px-3 py-1.5 text-xs font-medium rounded-[var(--radius-button)] transition-colors',
                            queryOpen
                              ? 'bg-[var(--accent-dim)] text-[var(--accent-text)]'
                              : 'border border-[var(--accent)]/40 text-[var(--accent-text)] hover:bg-[var(--accent-dim)]',
                          )}
                        >
                          {queryOpen ? 'Hide Query' : 'Query →'}
                        </button>
                      ) : isExpired && b.chain_bounty_id ? (
                        refundTxHash ? (
                          <a
                            href={`https://arbiscan.io/tx/${refundTxHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-[var(--text-faint)] hover:underline"
                          >
                            Refunding...
                          </a>
                        ) : isOwn ? (
                          <button
                            onClick={() => handleRefund(b)}
                            disabled={isRefunding}
                            className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-button)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--accent-text)] hover:border-[var(--accent)] transition-colors disabled:opacity-50"
                            title="Return the locked GRT to the developer"
                          >
                            {isRefunding ? 'Waiting...' : 'Refund'}
                          </button>
                        ) : (
                          <span className="text-xs text-[var(--text-faint)]">Expired</span>
                        )
                      ) : isOwn && b.chain_bounty_id ? (
                        cancelTxHash ? (
                          <a
                            href={`https://arbiscan.io/tx/${cancelTxHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-[var(--text-faint)] hover:underline"
                          >
                            Cancelling...
                          </a>
                        ) : cancelUnlocked ? (
                          <button
                            onClick={() => handleCancel(b)}
                            disabled={isCancelling}
                            className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-button)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--red-text)] hover:border-[var(--red)] transition-colors disabled:opacity-50"
                          >
                            {isCancelling ? 'Waiting...' : 'Cancel'}
                          </button>
                        ) : (
                          <div className="relative group">
                            <button disabled className="px-3 py-1.5 text-xs rounded-[var(--radius-button)] border border-[var(--border)] text-[var(--text-faint)] opacity-50 cursor-not-allowed">
                              Cancel
                            </button>
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 text-xs whitespace-nowrap bg-[var(--bg-elevated)] border border-[var(--border)] rounded shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none z-10">
                              Unlocks {cancelUnlockAt.toLocaleString()}
                            </div>
                          </div>
                        )
                      ) : !isOwn && b.chain_bounty_id ? (
                        <button
                          onClick={() => setClaimTarget(b)}
                          className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-button)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
                        >
                          Claim
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {isClaimed && queryOpen && <BountyQueryPanel bounty={b} />}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {claimTarget && <ClaimModal bounty={claimTarget} onClose={() => setClaimTarget(null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

type Tab = 'subgraphs' | 'bounties';

export default function StudioPage() {
  const { sessionAddress, signing, error: authError, signIn, signOut } = useStudioSession();
  const [tab, setTab] = useState<Tab>('subgraphs');

  const TABS: { id: Tab; label: string }[] = [
    { id: 'subgraphs', label: 'My Subgraphs' },
    { id: 'bounties', label: 'Bounty Board' },
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
            Deploy subgraphs to The Graph Network. No limits, no gatekeepers.
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
              <svg className="w-7 h-7 text-[var(--accent-text)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[var(--text)]">Sign in with your wallet</h2>
              <p className="text-sm text-[var(--text-muted)] mt-1 max-w-sm">
                One signature, no gas, no transaction. Proves you own this address.
              </p>
            </div>
            <button
              onClick={signIn}
              disabled={signing}
              className="px-6 py-2.5 text-sm font-medium rounded-[var(--radius-button)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {signing ? 'Waiting for wallet...' : 'Sign in'}
            </button>
            {authError && <p className="text-xs text-[var(--red-text)]">{authError}</p>}
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
                      ? 'border-[var(--accent)] text-[var(--accent-text)]'
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
            </div>
          </>
        )}
      </ConnectGate>
    </div>
  );
}
