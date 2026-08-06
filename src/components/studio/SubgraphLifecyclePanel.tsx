'use client';

// ---------------------------------------------------------------------------
// Subgraph lifecycle panel — on-chain GNS write flows for PUBLISHED subgraphs
//
// Three actions, all gated on the subgraph having a numeric on-chain NFT id
// (published_subgraph_id that is not a 0x tx-hash placeholder):
//   1. Update metadata on-chain  — GNS.updateSubgraphMetadata(uint256, bytes32)
//   2. Transfer ownership        — GNS.safeTransferFrom(address,address,uint256)
//   3. Deprecate                 — GNS.deprecateSubgraph(uint256)
//
// Mirrors the PublishWizard's tx-status UX (upload → wallet → mining → done,
// with Arbiscan links and a red error state). Persists best-effort to the same
// PATCH route the publish flow uses. Deliberately self-contained so it can't
// disturb the existing publish path.
// ---------------------------------------------------------------------------

import { useState, useEffect } from 'react';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { isAddress, getAddress } from 'viem';
import { CONTRACTS } from '@/lib/wallet';
import { cn } from '@/lib/utils';
import type { StudioSubgraph } from '@/lib/studio/db';

// GNS lifecycle ABI — kept local so the inline publish ABI in dock/page.tsx
// stays untouched. GNS is itself the ERC-721 for subgraph NFTs, hence
// safeTransferFrom lives here too.
const GNS_LIFECYCLE_ABI = [
  {
    name: 'updateSubgraphMetadata',
    type: 'function' as const,
    stateMutability: 'nonpayable' as const,
    inputs: [
      { name: 'subgraphID', type: 'uint256' },
      { name: 'subgraphMetadata', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'deprecateSubgraph',
    type: 'function' as const,
    stateMutability: 'nonpayable' as const,
    inputs: [{ name: 'subgraphID', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'safeTransferFrom',
    type: 'function' as const,
    stateMutability: 'nonpayable' as const,
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'tokenId', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

async function apiPatch(id: number, body: Record<string, unknown>): Promise<void> {
  await fetch(`/api/studio/subgraphs/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

type ActionKind = 'metadata' | 'transfer' | 'deprecate';
type Step = 'idle' | 'uploading' | 'wallet' | 'mining' | 'done' | 'error';

function ArbiscanLink({ hash }: { hash: `0x${string}` }) {
  return (
    <a
      href={`https://arbiscan.io/tx/${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs text-[var(--accent)] hover:underline font-mono"
    >
      {hash.slice(0, 20)}...
    </a>
  );
}

// ---------------------------------------------------------------------------
// Modal shell shared by the three flows
// ---------------------------------------------------------------------------

function LifecycleModal({
  kind,
  sg,
  nftId,
  displayName,
  description,
  onClose,
  onUpdated,
}: {
  kind: ActionKind;
  sg: StudioSubgraph;
  nftId: string;
  displayName: string;
  description: string;
  onClose: () => void;
  onUpdated: (sg: StudioSubgraph) => void;
}) {
  const { address } = useAccount();
  const [step, setStep] = useState<Step>('idle');
  const [errMsg, setErrMsg] = useState('');
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  // Typed confirmation for the irreversible transfer flow.
  const [recipient, setRecipient] = useState('');
  const [recipientConfirm, setRecipientConfirm] = useState('');
  // Typed confirmation for deprecation.
  const [deprecateConfirm, setDeprecateConfirm] = useState('');

  const { writeContract, isPending: walletPending } = useWriteContract({
    mutation: {
      onSuccess: (hash) => {
        setTxHash(hash);
        setStep('mining');
      },
      onError: (e) => {
        setErrMsg(e.message.slice(0, 300));
        setStep('error');
      },
    },
  });

  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (!txConfirmed) return;
    // Persist best-effort, matching the existing PATCH field shapes.
    if (kind === 'metadata') {
      apiPatch(sg.id, { display_name: displayName || null, description: description || null })
        .then(() => onUpdated({ ...sg, display_name: displayName || null, description: description || null }))
        .catch(() => {});
    } else if (kind === 'transfer') {
      // The NFT now belongs to someone else — drop our local publish link so the
      // subgraph reverts to a draft in the Dock. (No dedicated "transferred"
      // column exists; see report.)
      apiPatch(sg.id, { published_subgraph_id: '', version_label: null, last_published_deployment_id: null })
        .then(() => onUpdated({ ...sg, published_subgraph_id: null, version_label: null, last_published_deployment_id: null }))
        .catch(() => {});
    }
    // For 'deprecate' there is no schema field to flag; on-chain state is the
    // source of truth. We leave the DB row as-is and surface the deprecation
    // via the success screen only.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- responding to wagmi tx-receipt — intentional
    setStep('done');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txConfirmed]);

  // --- metadata: upload to IPFS first, then write ---
  const runMetadata = async () => {
    setStep('uploading');
    try {
      const res = await fetch('/api/studio/metadata', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, description }),
      });
      const data = await res.json();
      if (!res.ok || !data.subgraphMetaBytes32) {
        throw new Error(data.error ?? 'IPFS upload failed');
      }
      setStep('wallet');
      writeContract({
        address: CONTRACTS.gns,
        abi: GNS_LIFECYCLE_ABI,
        functionName: 'updateSubgraphMetadata',
        args: [BigInt(nftId), data.subgraphMetaBytes32 as `0x${string}`],
      });
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'IPFS upload failed');
      setStep('error');
    }
  };

  const runTransfer = () => {
    if (!address || !isAddress(recipient)) return;
    setStep('wallet');
    writeContract({
      address: CONTRACTS.gns,
      abi: GNS_LIFECYCLE_ABI,
      functionName: 'safeTransferFrom',
      args: [getAddress(address), getAddress(recipient), BigInt(nftId)],
    });
  };

  const runDeprecate = () => {
    setStep('wallet');
    writeContract({
      address: CONTRACTS.gns,
      abi: GNS_LIFECYCLE_ABI,
      functionName: 'deprecateSubgraph',
      args: [BigInt(nftId)],
    });
  };

  const title =
    kind === 'metadata'
      ? 'Update Metadata On-Chain'
      : kind === 'transfer'
      ? 'Transfer Ownership'
      : 'Deprecate Subgraph';

  const canClose = step !== 'uploading' && step !== 'mining' && step !== 'wallet';

  // Transfer is enabled only when both address fields match and are valid.
  const transferReady =
    isAddress(recipient) &&
    recipient.toLowerCase() === recipientConfirm.toLowerCase() &&
    recipient.toLowerCase() !== (address?.toLowerCase() ?? '');
  const deprecateReady = deprecateConfirm.trim().toUpperCase() === 'DEPRECATE';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
          <h3 className="font-semibold text-[var(--text)]">{title}</h3>
          {canClose && (
            <button onClick={onClose} className="text-[var(--text-faint)] hover:text-[var(--text)]">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        <div className="p-5 space-y-4">
          {/* ---- idle / confirm forms (per kind) ---- */}
          {step === 'idle' && kind === 'metadata' && (
            <>
              <p className="text-sm text-[var(--text-muted)]">
                Uploads the current display name &amp; description to IPFS and calls{' '}
                <code className="font-mono text-xs bg-[var(--bg-elevated)] px-1 rounded">GNS.updateSubgraphMetadata</code>{' '}
                on Arbitrum One. The on-chain listing will reflect these details.
              </p>
              <div className="space-y-0 text-sm divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg overflow-hidden">
                <div className="flex gap-3 px-4 py-2.5">
                  <span className="text-[var(--text-faint)] w-28 flex-shrink-0 text-xs">Subgraph #</span>
                  <span className="text-[var(--text)] font-mono text-xs truncate">{nftId}</span>
                </div>
                <div className="flex gap-3 px-4 py-2.5">
                  <span className="text-[var(--text-faint)] w-28 flex-shrink-0 text-xs">Display name</span>
                  <span className="text-[var(--text)] text-sm truncate">{displayName || '—'}</span>
                </div>
              </div>
              <p className="text-xs text-[var(--text-faint)]">
                Tip: edit the name &amp; description in Details and Save first, then run this to push them on-chain.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-2 text-sm rounded-[var(--radius-button)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={runMetadata}
                  className="flex-1 px-4 py-2 text-sm font-medium rounded-[var(--radius-button)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
                >
                  Continue
                </button>
              </div>
            </>
          )}

          {step === 'idle' && kind === 'transfer' && (
            <>
              <div className="p-3 rounded-lg bg-[var(--red-dim)] border border-[var(--red)]/30">
                <p className="text-sm font-medium text-[var(--red)]">This is irreversible.</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Transferring sends the subgraph NFT (#{nftId}) to another wallet. You will lose all control,
                  you cannot update versions, edit metadata, or take it back. Make absolutely sure the recipient
                  address is correct.
                </p>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">
                  Recipient address <span className="text-[var(--red)]">*</span>
                </label>
                <input
                  type="text"
                  placeholder="0x..."
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  className={cn(
                    'w-full px-3 py-2 text-sm font-mono rounded-[var(--radius-button)]',
                    'bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text)]',
                    'placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)]',
                  )}
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">
                  Confirm recipient address <span className="text-[var(--red)]">*</span>
                </label>
                <input
                  type="text"
                  placeholder="Paste the address again"
                  value={recipientConfirm}
                  onChange={(e) => setRecipientConfirm(e.target.value)}
                  className={cn(
                    'w-full px-3 py-2 text-sm font-mono rounded-[var(--radius-button)]',
                    'bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text)]',
                    'placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)]',
                  )}
                />
                {recipient.length > 0 && !isAddress(recipient) && (
                  <p className="text-xs text-[var(--red)] mt-1">Not a valid address.</p>
                )}
                {isAddress(recipient) &&
                  recipient.toLowerCase() === (address?.toLowerCase() ?? '') && (
                    <p className="text-xs text-[var(--red)] mt-1">That&apos;s your own address.</p>
                  )}
                {recipientConfirm.length > 0 && recipient.toLowerCase() !== recipientConfirm.toLowerCase() && (
                  <p className="text-xs text-[var(--red)] mt-1">Addresses don&apos;t match.</p>
                )}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-2 text-sm rounded-[var(--radius-button)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={runTransfer}
                  disabled={!transferReady}
                  className="flex-1 px-4 py-2 text-sm font-medium rounded-[var(--radius-button)] bg-[var(--red)] text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Transfer
                </button>
              </div>
            </>
          )}

          {step === 'idle' && kind === 'deprecate' && (
            <>
              <div className="p-3 rounded-lg bg-[var(--red-dim)] border border-[var(--red)]/30">
                <p className="text-sm font-medium text-[var(--red)]">This deprecates your subgraph.</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Calls <code className="font-mono">GNS.deprecateSubgraph</code> on subgraph #{nftId}. The subgraph
                  is removed from The Graph Network, curators can withdraw their signal, and it can no longer be
                  queried via the gateway. You cannot un-deprecate it.
                </p>
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1.5">
                  Type <span className="font-mono text-[var(--text)]">DEPRECATE</span> to confirm
                </label>
                <input
                  type="text"
                  placeholder="DEPRECATE"
                  value={deprecateConfirm}
                  onChange={(e) => setDeprecateConfirm(e.target.value)}
                  className={cn(
                    'w-full px-3 py-2 text-sm font-mono rounded-[var(--radius-button)]',
                    'bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text)]',
                    'placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)]',
                  )}
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 px-4 py-2 text-sm rounded-[var(--radius-button)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={runDeprecate}
                  disabled={!deprecateReady}
                  className="flex-1 px-4 py-2 text-sm font-medium rounded-[var(--radius-button)] bg-[var(--red)] text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Deprecate
                </button>
              </div>
            </>
          )}

          {/* ---- shared status states ---- */}
          {step === 'uploading' && (
            <div className="flex flex-col items-center py-8 gap-3">
              <div className="w-10 h-10 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
              <p className="text-sm text-[var(--text-muted)]">Uploading metadata to IPFS...</p>
            </div>
          )}

          {step === 'wallet' && (
            <div className="flex flex-col items-center py-8 gap-3">
              <div className="w-10 h-10 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
              <p className="text-sm text-[var(--text-muted)]">
                {walletPending ? 'Confirm the transaction in your wallet...' : 'Waiting for wallet...'}
              </p>
            </div>
          )}

          {step === 'mining' && (
            <div className="flex flex-col items-center py-8 gap-3">
              <div className="w-10 h-10 rounded-full border-2 border-[var(--accent)] border-t-transparent animate-spin" />
              <p className="text-sm text-[var(--text-muted)]">Transaction submitted. Waiting for confirmation...</p>
              {txHash && <ArbiscanLink hash={txHash} />}
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
                  {kind === 'metadata'
                    ? 'Metadata updated!'
                    : kind === 'transfer'
                    ? 'Ownership transferred'
                    : 'Subgraph deprecated'}
                </p>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {kind === 'metadata'
                    ? 'The on-chain listing now reflects your latest details.'
                    : kind === 'transfer'
                    ? 'The subgraph NFT now belongs to the recipient.'
                    : 'The subgraph has been removed from The Graph Network.'}
                </p>
              </div>
              <div className="flex gap-3">
                {txHash && (
                  <a
                    href={`https://arbiscan.io/tx/${txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 text-sm border border-[var(--border)] rounded-[var(--radius-button)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                  >
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
              <p className="text-sm text-[var(--red)] whitespace-pre-wrap break-all">{errMsg || 'Something went wrong.'}</p>
              <button
                onClick={() => setStep('idle')}
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
// Panel — the three trigger buttons, rendered inside the subgraph detail modal
// ---------------------------------------------------------------------------

export function SubgraphLifecyclePanel({
  sg,
  displayName,
  description,
  onUpdated,
}: {
  sg: StudioSubgraph;
  /** current (possibly unsaved) display name from the Details form */
  displayName: string;
  /** current (possibly unsaved) description from the Details form */
  description: string;
  onUpdated: (sg: StudioSubgraph) => void;
}) {
  const [active, setActive] = useState<ActionKind | null>(null);

  // Only meaningful once we have a numeric on-chain subgraph NFT id.
  // (published_subgraph_id starts as a 0x tx hash, then resolves to a number.)
  const nftId =
    sg.published_subgraph_id && !sg.published_subgraph_id.startsWith('0x')
      ? sg.published_subgraph_id
      : null;

  if (!nftId) return null;

  return (
    <div className="pt-4 border-t border-[var(--border)] space-y-2">
      <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
        On-chain Lifecycle
      </p>
      <p className="text-xs text-[var(--text-faint)]">
        Manage subgraph #{nftId} on The Graph Network.
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          onClick={() => setActive('metadata')}
          className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-button)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--accent-hover)] transition-colors"
        >
          Update Metadata On-Chain
        </button>
        <button
          onClick={() => setActive('transfer')}
          className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-button)] border border-amber-500/40 text-amber-500 hover:bg-amber-500/10 transition-colors"
        >
          Transfer Ownership
        </button>
        <button
          onClick={() => setActive('deprecate')}
          className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-button)] border border-[var(--red)]/40 text-[var(--red)] hover:bg-[var(--red-dim)] transition-colors"
        >
          Deprecate
        </button>
      </div>

      {active && (
        <LifecycleModal
          kind={active}
          sg={sg}
          nftId={nftId}
          displayName={displayName}
          description={description}
          onClose={() => setActive(null)}
          onUpdated={onUpdated}
        />
      )}
    </div>
  );
}
