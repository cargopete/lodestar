'use client';

import { useState, useMemo } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseAbi, parseUnits, formatUnits } from 'viem';
import { arbitrum } from 'wagmi/chains';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useCuratorPortfolio } from '@/hooks/useNetworkStats';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { CONTRACTS } from '@/lib/wallet';
import { weiToGRT, formatGRT, formatNumber, shortenAddress, cn } from '@/lib/utils';
import type { Signal } from '@/lib/queries';

// ---------------------------------------------------------------------------
// ABIs
// ---------------------------------------------------------------------------

const GNS_ABI = parseAbi([
  'function mintSignal(bytes32 _subgraphDeploymentID, uint256 _tokensIn, uint256 _minSignalOut) external',
  'function burnSignal(bytes32 _subgraphDeploymentID, uint256 _signal, uint256 _minTokensOut) external',
]);

const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
]);

type Tab = 'positions' | 'discover';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeOpportunityScore(queryFees: string, signal: string): number {
  const fees = weiToGRT(queryFees);
  const sig = weiToGRT(signal);
  return sig > 0 ? fees / sig : 0;
}

// ---------------------------------------------------------------------------
// Signal modal
// ---------------------------------------------------------------------------

function SignalModal({
  deploymentId,
  displayName,
  onClose,
}: {
  deploymentId: string;
  displayName: string;
  onClose: () => void;
}) {
  const { address } = useAccount();
  const [amount, setAmount] = useState('');
  const [step, setStep] = useState<'approve' | 'signal' | 'done'>('approve');

  const tokensIn = (() => {
    try { return parseUnits(amount || '0', 18); } catch { return 0n; }
  })();

  const { data: balance } = useReadContract({
    address: CONTRACTS.grt, abi: ERC20_ABI, functionName: 'balanceOf',
    args: [address!], chainId: arbitrum.id, query: { enabled: !!address },
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: CONTRACTS.grt, abi: ERC20_ABI, functionName: 'allowance',
    args: [address!, CONTRACTS.gns], chainId: arbitrum.id, query: { enabled: !!address },
  });

  const needsApproval = tokensIn > 0n && (allowance ?? 0n) < tokensIn;

  const { writeContract: approve, data: approveTxHash, isPending: approvePending } = useWriteContract();
  const { writeContract: signal, data: signalTxHash, isPending: signalPending } = useWriteContract();

  const { isSuccess: approveSuccess } = useWaitForTransactionReceipt({ hash: approveTxHash });
  const { isSuccess: signalSuccess } = useWaitForTransactionReceipt({ hash: signalTxHash });

  if (approveSuccess && step === 'approve') {
    refetchAllowance();
    setStep('signal');
  }
  if (signalSuccess && step === 'signal') setStep('done');

  const balanceGRT = weiToGRT(balance?.toString() ?? '0');
  const insufficient = tokensIn > 0n && balance !== undefined && tokensIn > balance;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-[var(--text)]">Signal GRT</h3>
            <p className="text-xs text-[var(--text-faint)] font-mono mt-0.5">{displayName}</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-faint)] hover:text-[var(--text)]">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {step === 'done' ? (
            <div className="py-6 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-[var(--green-dim)] flex items-center justify-center mx-auto">
                <svg className="w-6 h-6 text-[var(--green)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-[var(--text)] font-medium">Signal submitted</p>
              <p className="text-xs text-[var(--text-muted)]">Your GRT is now curating this subgraph.</p>
              <button onClick={onClose} className="px-4 py-2 text-sm font-medium rounded-[var(--radius-button)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity">
                Close
              </button>
            </div>
          ) : (
            <>
              <div>
                <div className="flex justify-between mb-1.5">
                  <label className="text-xs text-[var(--text-muted)]">Amount (GRT)</label>
                  <span className="text-xs text-[var(--text-faint)]">Balance: {formatGRT(balanceGRT)}</span>
                </div>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="100"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className={cn(
                      'flex-1 px-3 py-2 text-sm rounded-[var(--radius-button)]',
                      'bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text)]',
                      'placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)]',
                    )}
                  />
                  <button
                    onClick={() => setAmount(formatUnits(balance ?? 0n, 18))}
                    className="px-3 py-2 text-xs rounded-[var(--radius-button)] bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                  >
                    Max
                  </button>
                </div>
                {insufficient && <p className="text-xs text-[var(--red)] mt-1">Insufficient GRT balance</p>}
              </div>

              <p className="text-xs text-[var(--text-faint)] bg-[var(--bg-elevated)] rounded p-2.5 border border-[var(--border)]">
                Signalling uses a bonding curve — you may receive fewer GRT when unsignalling due to a 0.5% burn. Slippage protection is disabled for simplicity; the transaction may revert if the curve moves sharply.
              </p>

              {/* Steps */}
              <div className="space-y-2">
                {needsApproval && step === 'approve' && (
                  <button
                    disabled={!amount || tokensIn === 0n || approvePending || insufficient}
                    onClick={() => approve({ address: CONTRACTS.grt, abi: ERC20_ABI, functionName: 'approve', args: [CONTRACTS.gns, tokensIn], chainId: arbitrum.id })}
                    className="w-full px-4 py-2.5 text-sm font-medium rounded-[var(--radius-button)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {approvePending ? 'Approving...' : 'Step 1 — Approve GRT'}
                  </button>
                )}
                <button
                  disabled={!amount || tokensIn === 0n || signalPending || insufficient || (needsApproval && step === 'approve')}
                  onClick={() => signal({ address: CONTRACTS.gns, abi: GNS_ABI, functionName: 'mintSignal', args: [deploymentId as `0x${string}`, tokensIn, 0n], chainId: arbitrum.id })}
                  className="w-full px-4 py-2.5 text-sm font-medium rounded-[var(--radius-button)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {signalPending ? 'Signalling...' : needsApproval && step === 'approve' ? 'Step 2 — Signal GRT' : 'Signal GRT'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Unsignal modal
// ---------------------------------------------------------------------------

function UnsignalModal({
  deploymentId,
  displayName,
  currentSignal,
  onClose,
}: {
  deploymentId: string;
  displayName: string;
  currentSignal: string; // shares (wei)
  onClose: () => void;
}) {
  const [pct, setPct] = useState(100);
  const [done, setDone] = useState(false);

  const sharesToBurn = BigInt(currentSignal) * BigInt(pct) / 100n;

  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isSuccess } = useWaitForTransactionReceipt({ hash: txHash });
  if (isSuccess && !done) setDone(true);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-[var(--border)]">
          <div>
            <h3 className="font-semibold text-[var(--text)]">Remove Signal</h3>
            <p className="text-xs text-[var(--text-faint)] font-mono mt-0.5">{displayName}</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-faint)] hover:text-[var(--text)]">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {done ? (
            <div className="py-6 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-[var(--green-dim)] flex items-center justify-center mx-auto">
                <svg className="w-6 h-6 text-[var(--green)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-[var(--text)] font-medium">Signal removed</p>
              <button onClick={onClose} className="px-4 py-2 text-sm font-medium rounded-[var(--radius-button)] bg-[var(--accent)] text-white hover:opacity-90">Close</button>
            </div>
          ) : (
            <>
              <div>
                <div className="flex justify-between mb-2">
                  <label className="text-xs text-[var(--text-muted)]">Amount to remove</label>
                  <span className="text-sm font-medium text-[var(--text)]">{pct}%</span>
                </div>
                <input
                  type="range" min={1} max={100} value={pct}
                  onChange={(e) => setPct(Number(e.target.value))}
                  className="w-full accent-[var(--accent)]"
                />
                <div className="flex justify-between mt-1">
                  {[25, 50, 75, 100].map((p) => (
                    <button key={p} onClick={() => setPct(p)} className={cn('text-xs px-2 py-0.5 rounded transition-colors', pct === p ? 'text-[var(--accent)] font-medium' : 'text-[var(--text-faint)] hover:text-[var(--text)]')}>
                      {p}%
                    </button>
                  ))}
                </div>
              </div>

              <p className="text-xs text-[var(--text-faint)] bg-[var(--bg-elevated)] rounded p-2.5 border border-[var(--border)]">
                A 0.5% burn applies on the bonding curve. You will receive slightly less GRT than you signalled.
              </p>

              <button
                disabled={isPending}
                onClick={() => writeContract({ address: CONTRACTS.gns, abi: GNS_ABI, functionName: 'burnSignal', args: [deploymentId as `0x${string}`, sharesToBurn, 0n], chainId: arbitrum.id })}
                className="w-full px-4 py-2.5 text-sm font-medium rounded-[var(--radius-button)] bg-[var(--red)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {isPending ? 'Removing...' : `Remove ${pct}% of signal`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Position row
// ---------------------------------------------------------------------------

function PositionRow({ signal }: { signal: Signal }) {
  const [signalModal, setSignalModal] = useState(false);
  const [unsignalModal, setUnsignalModal] = useState(false);

  const signalledGRT = weiToGRT(signal.signalledTokens);
  const realizedGRT = weiToGRT(signal.realizedRewards);
  const totalSignalGRT = weiToGRT(signal.subgraphDeployment.signalledTokens);
  const queryFees = weiToGRT(signal.subgraphDeployment.queryFeesAmount);
  const opportunityScore = computeOpportunityScore(
    signal.subgraphDeployment.queryFeesAmount,
    signal.subgraphDeployment.signalledTokens,
  );
  const displayName = shortenAddress(signal.subgraphDeployment.ipfsHash, 6);

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] hover:border-[var(--accent-hover)] transition-colors">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Link href={`/subgraphs/${signal.subgraphDeployment.ipfsHash}`} className="font-mono text-sm text-[var(--text)] hover:text-[var(--accent)] transition-colors">
              {displayName}
            </Link>
            {opportunityScore > 1 && <Badge variant="success">High yield</Badge>}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
            <span className="text-xs text-[var(--text-faint)]">
              <span className="text-[var(--text-muted)]">Signalled</span> {formatGRT(signalledGRT)} GRT
            </span>
            <span className="text-xs text-[var(--text-faint)]">
              <span className="text-[var(--text-muted)]">Realized</span> +{formatGRT(realizedGRT)} GRT
            </span>
            <span className="text-xs text-[var(--text-faint)]">
              <span className="text-[var(--text-muted)]">Fees / Signal</span> {opportunityScore.toFixed(3)}
            </span>
          </div>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={() => setSignalModal(true)}
            className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-button)] bg-[var(--accent-dim)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white transition-colors"
          >
            + Signal
          </button>
          <button
            onClick={() => setUnsignalModal(true)}
            className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-button)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--red)] hover:border-[var(--red)] transition-colors"
          >
            Remove
          </button>
        </div>
      </div>

      {signalModal && (
        <SignalModal
          deploymentId={signal.subgraphDeployment.id}
          displayName={displayName}
          onClose={() => setSignalModal(false)}
        />
      )}
      {unsignalModal && (
        <UnsignalModal
          deploymentId={signal.subgraphDeployment.id}
          displayName={displayName}
          currentSignal={signal.signal}
          onClose={() => setUnsignalModal(false)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// My Positions tab
// ---------------------------------------------------------------------------

function MyPositionsTab({ address }: { address: string }) {
  const { data, isLoading } = useCuratorPortfolio(address);
  const curator = data?.curator ?? null;

  const totalSignalled = weiToGRT(curator?.totalSignalledTokens ?? '0');
  const totalRealized = weiToGRT(curator?.realizedRewards ?? '0');
  const returnPct = totalSignalled > 0 ? (totalRealized / totalSignalled) * 100 : 0;

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-lg shimmer" />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {curator && (
        <StatGrid>
          <StatCard label="Total Signalled" value={`${formatGRT(totalSignalled)} GRT`} />
          <StatCard label="Realized Rewards" value={`${formatGRT(totalRealized)} GRT`} delta={{ value: `${returnPct.toFixed(2)}% return`, positive: totalRealized > 0 }} />
          <StatCard label="Active Positions" value={String(curator.activeSignalCount)} delta={{ value: `${curator.signalCount} total`, positive: true }} />
        </StatGrid>
      )}

      {!curator || curator.signals.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center gap-4 border border-dashed border-[var(--border)] rounded-xl">
          <div className="w-12 h-12 rounded-xl bg-[var(--accent-dim)] flex items-center justify-center">
            <svg className="w-6 h-6 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5" />
            </svg>
          </div>
          <div>
            <p className="text-[var(--text)] font-medium">No signal positions</p>
            <p className="text-sm text-[var(--text-muted)] mt-1">Switch to Discover to find subgraphs worth curating.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {curator.signals.map((signal) => (
            <PositionRow key={signal.id} signal={signal} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Discover tab
// ---------------------------------------------------------------------------

interface Deployment {
  id: string;
  ipfsHash: string;
  signalledTokens: string;
  stakedTokens: string;
  queryFeesAmount: string;
  indexerAllocations: { id: string }[];
  versions: { subgraph: { metadata: { displayName: string } | null } }[];
}

function DiscoverTab() {
  const [signalTarget, setSignalTarget] = useState<{ id: string; name: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['curate-discover'],
    queryFn: async () => {
      const res = await fetch('/api/subgraph-deployments?first=100&orderBy=queryFeesAmount&orderDirection=desc');
      return res.json() as Promise<{ deployments: Deployment[] }>;
    },
    staleTime: 5 * 60 * 1000,
  });

  const ranked = useMemo(() => {
    if (!data?.deployments) return [];
    return data.deployments
      .map((d) => ({
        ...d,
        score: computeOpportunityScore(d.queryFeesAmount, d.signalledTokens),
        queryFeesGRT: weiToGRT(d.queryFeesAmount),
        signalledGRT: weiToGRT(d.signalledTokens),
        stakedGRT: weiToGRT(d.stakedTokens),
        displayName: d.versions?.[0]?.subgraph?.metadata?.displayName ?? null,
        activeIndexers: d.indexerAllocations.length,
      }))
      .filter((d) => d.stakedGRT > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 25);
  }, [data]);

  return (
    <>
      <div className="space-y-3">
        <p className="text-sm text-[var(--text-muted)]">
          Ranked by query fees generated relative to current signal — higher ratio means more fees earned per GRT curated.
        </p>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-14 rounded-lg shimmer" />)}
          </div>
        ) : (
          <div className="space-y-2">
            {ranked.map((d, idx) => (
              <div key={d.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] hover:border-[var(--accent-hover)] transition-colors">
                <span className="text-xs font-mono text-[var(--text-faint)] w-6 flex-shrink-0">#{idx + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <Link href={`/subgraphs/${d.ipfsHash}`} className="text-sm font-medium text-[var(--text)] hover:text-[var(--accent)] truncate transition-colors">
                      {d.displayName ?? shortenAddress(d.ipfsHash, 6)}
                    </Link>
                    {d.score > 2 && <Badge variant="success">Hot</Badge>}
                    {d.score > 0.5 && d.score <= 2 && <Badge variant="warning">Active</Badge>}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-0.5">
                    <span className="text-xs text-[var(--text-faint)]">
                      <span className="text-[var(--text-muted)]">Fees</span> {formatGRT(d.queryFeesGRT)} GRT
                    </span>
                    <span className="text-xs text-[var(--text-faint)]">
                      <span className="text-[var(--text-muted)]">Signal</span> {formatGRT(d.signalledGRT)} GRT
                    </span>
                    <span className="text-xs text-[var(--text-faint)]">
                      <span className="text-[var(--text-muted)]">Indexers</span> {d.activeIndexers}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="text-right">
                    <p className="text-xs text-[var(--text-faint)]">Fees/Signal</p>
                    <p className={cn('text-sm font-mono font-semibold', d.score > 1 ? 'text-[var(--green)]' : 'text-[var(--text)]')}>
                      {d.score.toFixed(3)}
                    </p>
                  </div>
                  <button
                    onClick={() => setSignalTarget({ id: d.id, name: d.displayName ?? shortenAddress(d.ipfsHash, 6) })}
                    className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-button)] bg-[var(--accent-dim)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white transition-colors"
                  >
                    Signal
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {signalTarget && (
        <SignalModal
          deploymentId={signalTarget.id}
          displayName={signalTarget.name}
          onClose={() => setSignalTarget(null)}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CuratePage() {
  const { address, isConnected } = useAccount();
  const [tab, setTab] = useState<Tab>('positions');

  const TABS = [
    { id: 'positions' as Tab, label: 'My Positions' },
    { id: 'discover' as Tab, label: 'Discover' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-[var(--text)]">Curate</h1>
            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-500/15 text-amber-500 border border-amber-500/30">
              Experimental
            </span>
          </div>
          <p className="text-[var(--text-muted)] text-sm mt-1">
            Signal GRT on subgraphs. Attract indexers, earn query fees, shape what gets indexed.
          </p>
        </div>
        {address && (
          <Link
            href={`/curators/${address}`}
            className="text-xs text-[var(--accent)] hover:underline flex-shrink-0 self-start"
          >
            Full portfolio view →
          </Link>
        )}
      </div>

      {!isConnected ? (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-6">
          <div className="w-16 h-16 rounded-2xl bg-[var(--accent-dim)] flex items-center justify-center">
            <svg className="w-8 h-8 text-[var(--accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-semibold text-[var(--text)] mb-2">Connect your wallet</h2>
            <p className="text-[var(--text-muted)] text-sm max-w-sm">
              Connect to see your curation positions and signal GRT on subgraphs.
            </p>
          </div>
          <p className="text-sm text-[var(--text-muted)]">
            Not sure where to start?{' '}
            <button onClick={() => setTab('discover')} className="text-[var(--accent)] hover:underline">
              Browse Discover
            </button>{' '}
            to find top curation opportunities.
          </p>
        </div>
      ) : (
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
            {tab === 'positions' && <MyPositionsTab address={address!} />}
            {tab === 'discover' && <DiscoverTab />}
          </div>
        </>
      )}

      {/* Discover is always accessible even without wallet */}
      {!isConnected && (
        <div className="mt-4">
          <h2 className="text-sm font-medium text-[var(--text-muted)] mb-3">Top Curation Opportunities</h2>
          <DiscoverTab />
        </div>
      )}
    </div>
  );
}
