'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseAbi, formatUnits, parseUnits, isAddress } from 'viem';
import { arbitrum } from 'wagmi/chains';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { Badge } from '@/components/ui/Badge';
import { cn, weiToGRT, formatGRT } from '@/lib/utils';
import { useServiceProvisions } from '@/hooks/useNetworkStats';

// ── Dispatch contract addresses ──────────────────────────────────────────────

const DISPATCH = {
  rpcDataService: '0xA983b18B8291F0c317Ba4Fe0dc0f7cc9373AF078' as const,
  graphTallyCollector: '0x8f69F5C07477Ac46FBc491B1E6D91E2bb0111A9e' as const,
  paymentsEscrow: '0xf6Fcc27aAf1fcD8B254498c9794451d82afC673E' as const,
  grt: '0x9623063377AD1B27544C965cCd7342f7EA7e88C7' as const,
  provider: '0xb43B2CCCceadA5292732a8C58ae134AdEFcE09Bb' as const,
};

const ESCROW_ABI = parseAbi([
  'function getBalance(address payer, address collector, address receiver) view returns (uint256)',
  'function deposit(address collector, address receiver, uint256 tokens)',
  'function depositTo(address payer, address collector, address receiver, uint256 tokens)',
  'function thaw(address collector, address receiver, uint256 tokens)',
  'function cancelThaw(address collector, address receiver)',
  'function withdraw(address collector, address receiver)',
  'function escrowAccounts(address payer, address collector, address receiver) view returns (uint256 balance, uint256 thawingTokens, uint256 thawEndTimestamp)',
]);

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
]);

// ── Human-readable result decoder ────────────────────────────────────────────

function decodeResult(method: string, result: unknown): string | null {
  if (result == null) return null;
  try {
    if (method === 'eth_blockNumber' && typeof result === 'string') {
      return `Block ${parseInt(result, 16).toLocaleString()}`;
    }
    if (method === 'eth_chainId' && typeof result === 'string') {
      return `Chain ID ${parseInt(result, 16)}`;
    }
    if (method === 'eth_gasPrice' && typeof result === 'string') {
      const gwei = parseInt(result, 16) / 1e9;
      return `${gwei.toFixed(4)} Gwei`;
    }
    if (method === 'eth_getBalance' && typeof result === 'string') {
      const eth = parseInt(result, 16) / 1e18;
      return `${eth.toFixed(6)} ETH`;
    }
    if (method === 'eth_getLogs' && Array.isArray(result)) {
      return `${result.length} log${result.length !== 1 ? 's' : ''} returned`;
    }
  } catch {
    // fall through
  }
  return null;
}

// ── RPC method config ────────────────────────────────────────────────────────

const METHODS = [
  { label: 'eth_blockNumber',          params: '[]' },
  { label: 'eth_chainId',              params: '[]' },
  { label: 'eth_getBalance',           params: '["0x1234567890123456789012345678901234567890", "latest"]' },
  { label: 'eth_getLogs',              params: '[{"fromBlock":"latest","toBlock":"latest","address":"0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"}]' },
  { label: 'eth_gasPrice',             params: '[]' },
  { label: 'eth_call',                 params: '[{"to":"0x82aF49447D8a07e3bd95BD0d56f35241523fBab1","data":"0x70a08231000000000000000000000000f977814e90da44bfa03b6295a0616a897441acec"}, "latest"]' },
  { label: 'eth_getStorageAt',         params: '["0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", "0x0", "latest"]' },
  { label: 'eth_getTransactionByHash', params: '["0x0000000000000000000000000000000000000000000000000000000000000000"]' },
  { label: 'eth_getTransactionReceipt',params: '["0x0000000000000000000000000000000000000000000000000000000000000000"]' },
  { label: 'eth_getBlockByHash',       params: '["0x0000000000000000000000000000000000000000000000000000000000000000", false]' },
  { label: 'eth_getBlockByNumber',     params: '["latest", false]' },
  { label: 'eth_getCode',              params: '["0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", "latest"]' },
  { label: 'eth_estimateGas',          params: '[{"to":"0x82aF49447D8a07e3bd95BD0d56f35241523fBab1","data":"0x"}]' },
  { label: 'eth_getTransactionCount',  params: '["0x1234567890123456789012345678901234567890", "latest"]' },
  { label: 'eth_sendRawTransaction',   params: '["0x"]' },
  { label: 'eth_syncing',              params: '[]' },
  { label: 'eth_feeHistory',           params: '[4, "latest", [25, 75]]' },
  { label: 'eth_maxPriorityFeePerGas', params: '[]' },
  { label: 'net_version',              params: '[]' },
  { label: 'web3_clientVersion',       params: '[]' },
];

const METHODS_INITIAL_COUNT = 5;

// ── RPC Portal ───────────────────────────────────────────────────────────────

const PRICE_PER_CU = 4_000_000_000_000n; // GRT wei per compute unit

const CU_WEIGHTS: Record<string, number> = {
  eth_chainId: 1, net_version: 1, eth_blockNumber: 1,
  eth_getBalance: 5, eth_getTransactionCount: 5, eth_getCode: 5,
  eth_getStorageAt: 5, eth_sendRawTransaction: 5,
  eth_getBlockByHash: 5, eth_getBlockByNumber: 5,
  eth_call: 10, eth_estimateGas: 10,
  eth_getTransactionReceipt: 10, eth_getTransactionByHash: 10,
  eth_getLogs: 20,
};

function Playground() {
  const { address, isConnected } = useAccount();
  const [methodIdx, setMethodIdx] = useState(0);
  const [params, setParams] = useState(METHODS[0].params);
  const [status, setStatus] = useState<'idle' | 'sending'>('idle');
  const [result, setResult] = useState<{ data: unknown; attestation: string | null; feePaid: bigint } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rawOpen, setRawOpen] = useState(false);
  const [methodsExpanded, setMethodsExpanded] = useState(false);

  const visibleMethods = methodsExpanded ? METHODS : METHODS.slice(0, METHODS_INITIAL_COUNT);

  const handleMethodChange = (idx: number) => {
    setMethodIdx(idx);
    setParams(METHODS[idx].params);
    setResult(null);
    setError(null);
  };

  const send = async () => {
    if (!isConnected || !address) return;
    setStatus('sending');
    setResult(null);
    setError(null);
    try {
      let parsedParams: unknown;
      try { parsedParams = JSON.parse(params); }
      catch { setError('Invalid JSON in params'); setStatus('idle'); return; }

      const cu = CU_WEIGHTS[METHODS[methodIdx].label] ?? 10;
      const feePaid = PRICE_PER_CU * BigInt(cu);

      const resp = await fetch('/api/dispatch/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chainId: 42161,
          consumerAddress: address,
          body: { jsonrpc: '2.0', method: METHODS[methodIdx].label, params: parsedParams, id: 1 },
        }),
      });

      const json = await resp.json();
      if (json.error) setError(json.error);
      else setResult({ ...json, feePaid });
    } catch (e) {
      setError(String(e));
    } finally {
      setStatus('idle');
    }
  };

  const responseData = result?.data as Record<string, unknown> | undefined;
  const hasResult = responseData && ('result' in responseData || 'error' in responseData);

  return (
    <Card>
      <CardHeader>
        <CardTitle>RPC Portal</CardTitle>
        <p className="text-[12px] text-[var(--text-muted)] mt-0.5">
          Connect your wallet · send a request · GRT drawn from your escrow automatically
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Method selector */}
          <div className="flex flex-wrap gap-2">
            {visibleMethods.map((m, i) => (
              <button
                key={m.label}
                onClick={() => handleMethodChange(i)}
                className={cn(
                  'px-2.5 py-1 rounded-[var(--radius-badge)] text-[11px] font-mono transition-colors',
                  i === methodIdx
                    ? 'bg-[var(--accent-dim)] text-[var(--accent)]'
                    : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text)]'
                )}
              >
                {m.label}
              </button>
            ))}
            <button
              onClick={() => setMethodsExpanded(e => !e)}
              className="px-2.5 py-1 rounded-[var(--radius-badge)] text-[11px] font-mono bg-[var(--bg-elevated)] text-[var(--accent)] hover:opacity-80 transition-opacity"
            >
              {methodsExpanded ? '− show less' : `+${METHODS.length - METHODS_INITIAL_COUNT} more`}
            </button>
          </div>

          {/* Params */}
          <div>
            <label className="text-[10px] uppercase tracking-[0.06em] text-[var(--text-muted)] mb-1 block">
              Params (JSON array)
            </label>
            <textarea
              value={params}
              onChange={(e) => setParams(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 text-[12px] font-mono text-[var(--text)] bg-[var(--bg-elevated)] rounded-[var(--radius-button)] outline-none focus:ring-1 focus:ring-[var(--accent)] resize-none transition-shadow"
            />
          </div>

          {/* Send */}
          {isConnected ? (
            <button
              onClick={send}
              disabled={status !== 'idle'}
              className="px-4 py-2 text-[12px] font-medium bg-[var(--accent)] text-white rounded-[var(--radius-button)] hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {status === 'sending' ? 'Sending…' : 'Send Request →'}
            </button>
          ) : (
            <div className="px-4 py-3 rounded-[var(--radius-button)] bg-[var(--bg-elevated)] text-center space-y-1">
              <p className="text-[12px] text-[var(--text-muted)]">Connect your wallet to send paid requests</p>
              <p className="text-[11px] text-[var(--text-faint)]">Each request costs {Number(PRICE_PER_CU) / 1e18} GRT · paid directly to the provider via TAP receipt</p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-3 rounded-[var(--radius-button)] bg-[var(--red-dim)] text-[var(--red)] text-[12px] font-mono">
              {error}
            </div>
          )}

          {/* Response */}
          {hasResult && (
            <div className="space-y-2">
              {/* Fee paid badge */}
              {result?.feePaid && (
                <div className="px-3 py-2 rounded-[var(--radius-button)] bg-[var(--green-dim)] flex items-center gap-2">
                  <svg className="w-3.5 h-3.5 text-[var(--green)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-[12px] font-medium text-[var(--green)]">
                    ~{Number(result.feePaid) / 1e18} GRT charged to your escrow
                  </span>
                </div>
              )}
              {/* Hero result */}
              {(() => {
                const decoded = decodeResult(METHODS[methodIdx].label, responseData?.result);
                return decoded ? (
                  <div className="px-4 py-5 rounded-[var(--radius-button)] bg-[var(--bg-elevated)] text-center">
                    <p className="text-[11px] uppercase tracking-[0.06em] text-[var(--text-muted)] mb-1">{METHODS[methodIdx].label}</p>
                    <p className="text-[28px] font-semibold text-[var(--text)] leading-tight">{decoded}</p>
                  </div>
                ) : (
                  <div className="p-3 rounded-[var(--radius-button)] bg-[var(--bg-elevated)] overflow-x-auto">
                    <pre className="text-[11px] font-mono text-[var(--text)] whitespace-pre-wrap break-all">
                      {JSON.stringify(responseData?.result ?? responseData?.error, null, 2)}
                    </pre>
                  </div>
                );
              })()}
              {/* Raw JSON toggle — only show when decoded view is active */}
              {decodeResult(METHODS[methodIdx].label, responseData?.result) && (
                <div>
                  <button
                    onClick={() => setRawOpen(o => !o)}
                    className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                  >
                    <svg className={`w-3 h-3 transition-transform ${rawOpen ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    Raw JSON
                  </button>
                  {rawOpen && (
                    <div className="mt-1 p-3 rounded-[var(--radius-button)] bg-[var(--bg-elevated)] overflow-x-auto">
                      <pre className="text-[11px] font-mono text-[var(--text-muted)] whitespace-pre-wrap break-all">
                        {JSON.stringify(responseData, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {/* Attestation */}
              <div className="flex items-start gap-2 p-3 rounded-[var(--radius-button)] bg-[var(--bg-elevated)]">
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.06em] text-[var(--text-muted)] mb-1">
                    x-drpc-attestation
                  </p>
                  {result?.attestation ? (
                    <p className="text-[11px] font-mono text-[var(--text-muted)] break-all">
                      {result.attestation}
                    </p>
                  ) : (
                    <p className="text-[11px] text-[var(--text-faint)] italic">none</p>
                  )}
                </div>
                {result?.attestation && (
                  <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[var(--radius-badge)] bg-[var(--green-dim)] text-[var(--green)] text-[10px] font-medium">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    signed
                  </span>
                )}
              </div>

              <p className="text-[10px] text-[var(--text-faint)]">
                The attestation is an ECDSA signature by the provider over{' '}
                <code className="font-mono">keccak256(chainId · method · params · response · blockHash)</code>.
                Verify it with the{' '}
                <a
                  href="https://github.com/cargopete/dispatch"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--accent)] hover:underline"
                >
                  consumer SDK
                </a>
                .
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Consumer Status ───────────────────────────────────────────────────────────

function ConsumerStatus() {
  const { address, isConnected } = useAccount();
  const [amount, setAmount] = useState('10');
  const [approveTxHash, setApproveTxHash] = useState<`0x${string}` | undefined>();
  const [depositTxHash, setDepositTxHash] = useState<`0x${string}` | undefined>();
  const [txError, setTxError] = useState<string | null>(null);

  const amountWei = (() => { try { return parseUnits(amount || '0', 18); } catch { return 0n; } })();

  const { data: grtBalance, isLoading: grtLoading, refetch: refetchGrt } = useReadContract({
    address: DISPATCH.grt, abi: ERC20_ABI, functionName: 'balanceOf',
    args: [address!], chainId: arbitrum.id, query: { enabled: isConnected && !!address },
  });

  const { data: escrowBalance, isLoading: escrowLoading, refetch: refetchEscrow } = useReadContract({
    address: DISPATCH.paymentsEscrow, abi: ESCROW_ABI, functionName: 'getBalance',
    args: [address!, DISPATCH.graphTallyCollector, DISPATCH.provider],
    chainId: arbitrum.id, query: { enabled: isConnected && !!address },
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: DISPATCH.grt, abi: ERC20_ABI, functionName: 'allowance',
    args: [address!, DISPATCH.paymentsEscrow],
    chainId: arbitrum.id, query: { enabled: isConnected && !!address },
  });

  const { data: escrowAccount, refetch: refetchAccount } = useReadContract({
    address: DISPATCH.paymentsEscrow, abi: ESCROW_ABI, functionName: 'escrowAccounts',
    args: [address!, DISPATCH.graphTallyCollector, DISPATCH.provider],
    chainId: arbitrum.id, query: { enabled: isConnected && !!address },
  });

  const [thawTxHash, setThawTxHash] = useState<`0x${string}` | undefined>();
  const [cancelThawTxHash, setCancelThawTxHash] = useState<`0x${string}` | undefined>();
  const [withdrawTxHash, setWithdrawTxHash] = useState<`0x${string}` | undefined>();

  const { writeContractAsync } = useWriteContract();

  const { isLoading: approveConfirming, isSuccess: approveConfirmed } = useWaitForTransactionReceipt({ hash: approveTxHash });
  const { isLoading: depositConfirming, isSuccess: depositConfirmed } = useWaitForTransactionReceipt({ hash: depositTxHash });
  const { isLoading: thawConfirming, isSuccess: thawConfirmed } = useWaitForTransactionReceipt({ hash: thawTxHash });
  const { isLoading: cancelThawConfirming, isSuccess: cancelThawConfirmed } = useWaitForTransactionReceipt({ hash: cancelThawTxHash });
  const { isLoading: withdrawConfirming, isSuccess: withdrawConfirmed } = useWaitForTransactionReceipt({ hash: withdrawTxHash });

  useEffect(() => { if (approveConfirmed) refetchAllowance(); }, [approveConfirmed]);
  useEffect(() => { if (depositConfirmed) { refetchEscrow(); refetchGrt(); refetchAccount(); } }, [depositConfirmed]);
  useEffect(() => { if (thawConfirmed || cancelThawConfirmed || withdrawConfirmed) { refetchEscrow(); refetchGrt(); refetchAccount(); } }, [thawConfirmed, cancelThawConfirmed, withdrawConfirmed]);

  const isApproved = allowance != null && (allowance as bigint) >= amountWei && amountWei > 0n;

  const thawingTokens = escrowAccount ? (escrowAccount as [bigint, bigint, bigint])[1] : 0n;
  const thawEndTimestamp = escrowAccount ? (escrowAccount as [bigint, bigint, bigint])[2] : 0n;
  const isThawing = thawingTokens > 0n;
  const canWithdraw = isThawing && thawEndTimestamp > 0n && BigInt(Math.floor(Date.now() / 1000)) >= thawEndTimestamp;
  const thawReadyDate = thawEndTimestamp > 0n
    ? new Date(Number(thawEndTimestamp) * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  const handleApprove = async () => {
    setTxError(null);
    try {
      const hash = await writeContractAsync({
        address: DISPATCH.grt, abi: ERC20_ABI, functionName: 'approve',
        args: [DISPATCH.paymentsEscrow, amountWei], chainId: arbitrum.id,
      });
      setApproveTxHash(hash);
    } catch (e) { setTxError(String(e).split('(')[0].trim()); }
  };

  const handleDeposit = async () => {
    setTxError(null);
    try {
      const hash = await writeContractAsync({
        address: DISPATCH.paymentsEscrow, abi: ESCROW_ABI, functionName: 'deposit',
        args: [DISPATCH.graphTallyCollector, DISPATCH.provider, amountWei], chainId: arbitrum.id,
      });
      setDepositTxHash(hash);
    } catch (e) { setTxError(String(e).split('(')[0].trim()); }
  };

  const handleThaw = async () => {
    setTxError(null);
    try {
      const hash = await writeContractAsync({
        address: DISPATCH.paymentsEscrow, abi: ESCROW_ABI, functionName: 'thaw',
        args: [DISPATCH.graphTallyCollector, DISPATCH.provider, escrowBalance as bigint], chainId: arbitrum.id,
      });
      setThawTxHash(hash);
    } catch (e) { setTxError(String(e).split('(')[0].trim()); }
  };

  const handleCancelThaw = async () => {
    setTxError(null);
    try {
      const hash = await writeContractAsync({
        address: DISPATCH.paymentsEscrow, abi: ESCROW_ABI, functionName: 'cancelThaw',
        args: [DISPATCH.graphTallyCollector, DISPATCH.provider], chainId: arbitrum.id,
      });
      setCancelThawTxHash(hash);
    } catch (e) { setTxError(String(e).split('(')[0].trim()); }
  };

  const handleWithdraw = async () => {
    setTxError(null);
    try {
      const hash = await writeContractAsync({
        address: DISPATCH.paymentsEscrow, abi: ESCROW_ABI, functionName: 'withdraw',
        args: [DISPATCH.graphTallyCollector, DISPATCH.provider], chainId: arbitrum.id,
      });
      setWithdrawTxHash(hash);
    } catch (e) { setTxError(String(e).split('(')[0].trim()); }
  };

  if (!isConnected) {
    return (
      <Card>
        <CardHeader><CardTitle>Your Consumer Status</CardTitle></CardHeader>
        <CardContent>
          <p className="text-[13px] text-[var(--text-muted)]">Connect your wallet to check your GRT balance and fund escrow.</p>
        </CardContent>
      </Card>
    );
  }

  const grt = grtBalance != null ? Number(formatUnits(grtBalance as bigint, 18)).toFixed(2) : null;
  const escrow = escrowBalance != null ? Number(formatUnits(escrowBalance as bigint, 18)).toFixed(4) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Consumer Status</CardTitle>
        <p className="text-[11px] font-mono text-[var(--text-faint)] mt-0.5 truncate">{address}</p>
      </CardHeader>
      <CardContent>
        {/* Balances */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.06em] text-[var(--text-muted)] mb-1">GRT Balance</p>
            {grtLoading ? <div className="h-6 w-20 shimmer rounded" /> : (
              <p className="text-[18px] font-mono font-medium text-[var(--text)]">
                {grt ?? '—'} <span className="text-[12px] text-[var(--text-muted)]">GRT</span>
              </p>
            )}
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-[0.06em] text-[var(--text-muted)] mb-1">Escrow (lodestar-indexer)</p>
            {escrowLoading ? <div className="h-6 w-20 shimmer rounded" /> : (
              <p className={cn('text-[18px] font-mono font-medium', escrow && parseFloat(escrow) > 0 ? 'text-[var(--green)]' : 'text-[var(--text)]')}>
                {escrow ?? '—'} <span className="text-[12px] text-[var(--text-muted)]">GRT</span>
              </p>
            )}
          </div>
        </div>

        {/* Deposit form */}
        <div className="space-y-3 p-3 rounded-[var(--radius-button)] bg-[var(--bg-elevated)]">
          <p className="text-[11px] text-[var(--text-muted)]">Fund your escrow to pay providers directly:</p>

          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-28 px-3 py-1.5 text-[13px] font-mono bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-button)] text-[var(--text)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
            />
            <span className="text-[12px] text-[var(--text-muted)]">GRT</span>
          </div>

          <div className="flex gap-2">
            {/* Step 1: Approve */}
            <button
              onClick={handleApprove}
              disabled={amountWei === 0n || isApproved || approveConfirming}
              className={cn(
                'flex-1 px-3 py-2 text-[12px] font-medium rounded-[var(--radius-button)] transition-colors',
                isApproved
                  ? 'bg-[var(--green-dim)] text-[var(--green)] cursor-default'
                  : 'bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-40'
              )}
            >
              {approveConfirming ? 'Confirming…' : isApproved ? '✓ Approved' : '1. Approve GRT'}
            </button>

            {/* Step 2: Deposit */}
            <button
              onClick={handleDeposit}
              disabled={!isApproved || amountWei === 0n || depositConfirming}
              className="flex-1 px-3 py-2 text-[12px] font-medium bg-[var(--accent)] text-white rounded-[var(--radius-button)] hover:opacity-90 disabled:opacity-40 transition-opacity"
            >
              {depositConfirming ? 'Confirming…' : depositConfirmed ? '✓ Deposited!' : '2. Deposit to Escrow'}
            </button>
          </div>

          {txError && (
            <p className="text-[11px] text-[var(--red)] font-mono">{txError}</p>
          )}
          {depositConfirmed && (
            <p className="text-[11px] text-[var(--green)]">Escrow funded — you can now pay providers directly.</p>
          )}
        </div>

        {/* Withdraw section — only show if there's a balance or thaw in progress */}
        {((escrowBalance != null && (escrowBalance as bigint) > 0n) || isThawing) && (
          <div className="mt-3 space-y-2 p-3 rounded-[var(--radius-button)] bg-[var(--bg-elevated)]">
            <p className="text-[11px] text-[var(--text-muted)]">Withdraw from escrow:</p>

            {isThawing ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[12px] text-[var(--amber)]">
                      {Number(formatUnits(thawingTokens, 18)).toFixed(4)} GRT thawing
                    </p>
                    {!canWithdraw && thawReadyDate && (
                      <p className="text-[11px] text-[var(--text-faint)]">Ready to withdraw {thawReadyDate} · 30-day period</p>
                    )}
                  </div>
                </div>
                <div className="flex gap-2">
                  {canWithdraw ? (
                    <button
                      onClick={handleWithdraw}
                      disabled={withdrawConfirming}
                      className="flex-1 px-3 py-2 text-[12px] font-medium bg-[var(--accent)] text-white rounded-[var(--radius-button)] hover:opacity-90 disabled:opacity-40 transition-opacity"
                    >
                      {withdrawConfirming ? 'Confirming…' : withdrawConfirmed ? '✓ Withdrawn!' : 'Withdraw GRT'}
                    </button>
                  ) : (
                    <button
                      onClick={handleCancelThaw}
                      disabled={cancelThawConfirming}
                      className="flex-1 px-3 py-2 text-[12px] font-medium bg-[var(--bg)] border border-[var(--border)] text-[var(--text-muted)] rounded-[var(--radius-button)] hover:text-[var(--text)] disabled:opacity-40 transition-colors"
                    >
                      {cancelThawConfirming ? 'Confirming…' : cancelThawConfirmed ? '✓ Cancelled' : 'Cancel Thaw'}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <button
                onClick={handleThaw}
                disabled={!escrowBalance || (escrowBalance as bigint) === 0n || thawConfirming}
                className="w-full px-3 py-2 text-[12px] font-medium bg-[var(--bg)] border border-[var(--border)] text-[var(--text-muted)] rounded-[var(--radius-button)] hover:text-[var(--text)] disabled:opacity-40 transition-colors"
              >
                {thawConfirming ? 'Confirming…' : thawConfirmed ? '✓ Thaw started (30 days)' : 'Start Thaw (30-day period)'}
              </button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Fund Consumer ────────────────────────────────────────────────────────────

function FundConsumer() {
  const { address, isConnected } = useAccount();
  const [consumerAddr, setConsumerAddr] = useState('');
  const [amount, setAmount] = useState('10');
  const [approveTxHash, setApproveTxHash] = useState<`0x${string}` | undefined>();
  const [depositTxHash, setDepositTxHash] = useState<`0x${string}` | undefined>();
  const [txError, setTxError] = useState<string | null>(null);

  const validAddr = isAddress(consumerAddr);
  const amountWei = (() => { try { return parseUnits(amount || '0', 18); } catch { return 0n; } })();

  const { data: escrowBalance, refetch: refetchEscrow } = useReadContract({
    address: DISPATCH.paymentsEscrow, abi: ESCROW_ABI, functionName: 'getBalance',
    args: [consumerAddr as `0x${string}`, DISPATCH.graphTallyCollector, DISPATCH.provider],
    chainId: arbitrum.id, query: { enabled: isConnected && validAddr },
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: DISPATCH.grt, abi: ERC20_ABI, functionName: 'allowance',
    args: [address!, DISPATCH.paymentsEscrow],
    chainId: arbitrum.id, query: { enabled: isConnected && !!address },
  });

  const { writeContractAsync } = useWriteContract();
  const { isLoading: approveConfirming, isSuccess: approveConfirmed } = useWaitForTransactionReceipt({ hash: approveTxHash });
  const { isLoading: depositConfirming, isSuccess: depositConfirmed } = useWaitForTransactionReceipt({ hash: depositTxHash });

  useEffect(() => { if (approveConfirmed) refetchAllowance(); }, [approveConfirmed, refetchAllowance]);
  useEffect(() => { if (depositConfirmed) refetchEscrow(); }, [depositConfirmed, refetchEscrow]);

  const isApproved = allowance != null && (allowance as bigint) >= amountWei && amountWei > 0n;
  const escrow = escrowBalance != null ? Number(formatUnits(escrowBalance as bigint, 18)).toFixed(4) : null;

  const handleApprove = async () => {
    setTxError(null);
    try {
      const hash = await writeContractAsync({
        address: DISPATCH.grt, abi: ERC20_ABI, functionName: 'approve',
        args: [DISPATCH.paymentsEscrow, amountWei], chainId: arbitrum.id,
      });
      setApproveTxHash(hash);
    } catch (e) { setTxError(String(e).split('(')[0].trim()); }
  };

  const handleDepositTo = async () => {
    setTxError(null);
    try {
      const hash = await writeContractAsync({
        address: DISPATCH.paymentsEscrow, abi: ESCROW_ABI, functionName: 'depositTo',
        args: [consumerAddr as `0x${string}`, DISPATCH.graphTallyCollector, DISPATCH.provider, amountWei],
        chainId: arbitrum.id,
      });
      setDepositTxHash(hash);
    } catch (e) { setTxError(String(e).split('(')[0].trim()); }
  };

  if (!isConnected) {
    return (
      <Card>
        <CardHeader><CardTitle>Fund a Proxy Consumer</CardTitle></CardHeader>
        <CardContent>
          <p className="text-[13px] text-[var(--text-muted)]">Connect your wallet to fund a dispatch-proxy consumer address with GRT.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fund a Proxy Consumer</CardTitle>
        <p className="text-[12px] text-[var(--text-muted)] mt-0.5">
          Fund any consumer address from your wallet — no ETH needed on the proxy itself.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">

        {/* Steps */}
        <div className="p-3 rounded-[var(--radius-button)] bg-[var(--bg-elevated)] space-y-1.5">
          <p className="text-[10px] font-medium text-[var(--text-muted)] uppercase tracking-[0.06em]">Setup</p>
          <div className="space-y-1 text-[12px] text-[var(--text-muted)]">
            <p><span className="font-mono text-[var(--accent)] mr-1.5">1.</span>Run <code className="text-[11px] bg-[var(--bg)] px-1 py-0.5 rounded text-[var(--text)]">npm start</code> in <code className="text-[11px]">dispatch-proxy/</code> — it prints a consumer address.</p>
            <p><span className="font-mono text-[var(--accent)] mr-1.5">2.</span>Paste that address below and deposit GRT.</p>
            <p><span className="font-mono text-[var(--accent)] mr-1.5">3.</span>The proxy signs requests; providers settle via your escrow automatically.</p>
          </div>
        </div>

        {/* Address input */}
        <div className="space-y-1.5">
          <label className="text-[10px] uppercase tracking-[0.06em] text-[var(--text-muted)]">Proxy Consumer Address</label>
          <input
            type="text"
            placeholder="0x…"
            value={consumerAddr}
            onChange={(e) => setConsumerAddr(e.target.value.trim())}
            className={cn(
              'w-full px-3 py-2 text-[12px] font-mono bg-[var(--bg)] border rounded-[var(--radius-button)] text-[var(--text)] outline-none focus:ring-1 focus:ring-[var(--accent)]',
              consumerAddr && !validAddr ? 'border-[var(--red)]' : 'border-[var(--border)]'
            )}
          />
          {consumerAddr && !validAddr && (
            <p className="text-[11px] text-[var(--red)]">Not a valid Ethereum address</p>
          )}
          {validAddr && escrow !== null && (
            <p className="text-[11px] text-[var(--text-muted)]">
              Current escrow:{' '}
              <span className={cn('font-mono', parseFloat(escrow) > 0 ? 'text-[var(--green)]' : 'text-[var(--text)]')}>
                {escrow} GRT
              </span>
            </p>
          )}
        </div>

        {/* Amount + buttons */}
        <div className="space-y-3 p-3 rounded-[var(--radius-button)] bg-[var(--bg-elevated)]">
          <div className="flex items-center gap-2">
            <input
              type="number" min="0" step="1" value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-28 px-3 py-1.5 text-[13px] font-mono bg-[var(--bg)] border border-[var(--border)] rounded-[var(--radius-button)] text-[var(--text)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
            />
            <span className="text-[12px] text-[var(--text-muted)]">GRT</span>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleApprove}
              disabled={amountWei === 0n || isApproved || approveConfirming}
              className={cn(
                'flex-1 px-3 py-2 text-[12px] font-medium rounded-[var(--radius-button)] transition-colors',
                isApproved
                  ? 'bg-[var(--green-dim)] text-[var(--green)] cursor-default'
                  : 'bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-40'
              )}
            >
              {approveConfirming ? 'Confirming…' : isApproved ? '✓ Approved' : '1. Approve GRT'}
            </button>
            <button
              onClick={handleDepositTo}
              disabled={!isApproved || amountWei === 0n || !validAddr || depositConfirming}
              className="flex-1 px-3 py-2 text-[12px] font-medium bg-[var(--accent)] text-white rounded-[var(--radius-button)] hover:opacity-90 disabled:opacity-40 transition-opacity"
            >
              {depositConfirming ? 'Confirming…' : depositConfirmed ? '✓ Funded!' : '2. Fund Proxy'}
            </button>
          </div>

          {txError && <p className="text-[11px] text-[var(--red)] font-mono">{txError}</p>}
          {depositConfirmed && (
            <p className="text-[11px] text-[var(--green)]">
              Proxy escrow funded — the proxy will start routing requests immediately.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Shared receipt types ──────────────────────────────────────────────────────

interface ReceiptItem {
  id: number;
  payer: string;
  chain_id: number;
  timestamp_ns: number; // nanoseconds; JS precision fine for display (seconds-level)
  value: string;        // GRT wei as decimal string
  method: string | null;
}

function grtFromWei(weiStr: string): string {
  // Avoid BigInt for display — precision to 6 decimal places is plenty
  const grt = Number(weiStr) / 1e18;
  return grt < 0.0001 ? grt.toExponential(2) : grt.toFixed(6);
}

function relativeTime(timestampNs: number): string {
  const diffMs = Date.now() - Math.floor(timestampNs / 1_000_000);
  if (diffMs < 0) return 'just now';
  if (diffMs < 60_000) return `${Math.floor(diffMs / 1000)}s ago`;
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  return `${Math.floor(diffMs / 3_600_000)}h ago`;
}

function shortAddr(addr: string): string {
  if (addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// ── Live Feed ─────────────────────────────────────────────────────────────────

function LiveFeed() {
  const [items, setItems] = useState<ReceiptItem[]>([]);
  const [newIds, setNewIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  const poll = useCallback(async () => {
    try {
      const resp = await fetch('/api/dispatch/feed?limit=20');
      if (!resp.ok) { setUnavailable(true); return; }
      const data: ReceiptItem[] = await resp.json();
      if (!Array.isArray(data)) { setUnavailable(true); return; }
      setUnavailable(false);
      setItems(prev => {
        const prevMaxId = prev[0]?.id ?? 0;
        const fresh = new Set(data.filter(i => i.id > prevMaxId).map(i => i.id));
        if (fresh.size > 0) {
          setNewIds(fresh);
          setTimeout(() => setNewIds(new Set()), 800);
        }
        return data;
      });
    } catch {
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    poll();
    const t = setInterval(poll, 5_000);
    return () => clearInterval(t);
  }, [poll]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Live Request Feed</CardTitle>
            <p className="text-[12px] text-[var(--text-muted)] mt-0.5">
              Recent requests through the gateway · refreshes every 5s
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--radius-badge)] bg-[var(--green-dim)] text-[var(--green)] text-[10px] font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)] animate-pulse" />
            Live
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-8 shimmer rounded" />
            ))}
          </div>
        ) : unavailable ? (
          <div className="py-6 text-center">
            <p className="text-[13px] text-[var(--text-muted)]">Feed unavailable — no requests recorded yet or service unreachable.</p>
          </div>
        ) : items.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-[13px] text-[var(--text-muted)]">No requests yet. Send one from the RPC Portal above.</p>
          </div>
        ) : (
          <div className="rounded-[var(--radius-button)] border border-[var(--border)] overflow-hidden">
            {/* Header */}
            <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-3 px-4 py-2 bg-[var(--bg-elevated)] border-b border-[var(--border)]">
              {['Method', 'Consumer', 'GRT', 'When'].map(h => (
                <span key={h} className="text-[10px] uppercase tracking-[0.06em] text-[var(--text-muted)]">{h}</span>
              ))}
            </div>
            {/* Rows */}
            <div className="divide-y divide-[var(--border)]">
              {items.map(item => (
                <div
                  key={item.id}
                  className={cn(
                    'grid grid-cols-[1fr_1fr_auto_auto] gap-3 px-4 py-2.5 transition-colors',
                    newIds.has(item.id) ? 'bg-[var(--accent-dim)]' : 'hover:bg-[var(--bg-elevated)]'
                  )}
                >
                  <span className="text-[11px] font-mono text-[var(--text)] truncate">
                    {item.method ?? <span className="text-[var(--text-faint)] italic">unknown</span>}
                  </span>
                  <span className="text-[11px] font-mono text-[var(--text-muted)]">
                    {shortAddr(item.payer)}
                  </span>
                  <span className="text-[11px] font-mono text-[var(--green)] whitespace-nowrap">
                    {grtFromWei(item.value)}
                  </span>
                  <span className="text-[11px] text-[var(--text-faint)] whitespace-nowrap text-right">
                    {relativeTime(item.timestamp_ns)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Consumer History ──────────────────────────────────────────────────────────

function ConsumerHistory() {
  const { address, isConnected } = useAccount();
  const [items, setItems] = useState<ReceiptItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address) return;
    setLoading(true);
    setError(null);
    fetch(`/api/dispatch/history?payer=${address}&limit=100`)
      .then(r => r.json())
      .then((data: unknown) => {
        if (!Array.isArray(data)) throw new Error((data as { error?: string })?.error ?? 'unexpected response');
        setItems(data as ReceiptItem[]);
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [address]);

  if (!isConnected) {
    return (
      <Card>
        <CardHeader><CardTitle>Your Request History</CardTitle></CardHeader>
        <CardContent>
          <p className="text-[13px] text-[var(--text-muted)]">Connect wallet to view your history and GRT spend.</p>
        </CardContent>
      </Card>
    );
  }

  // Total GRT spent (sum of all receipt values)
  const totalWei = items.reduce((sum, i) => sum + Number(i.value), 0);
  const totalGRT = (totalWei / 1e18).toFixed(6);

  // Breakdown by method
  const byMethod: Record<string, { count: number; totalWei: number }> = {};
  for (const item of items) {
    const m = item.method ?? 'unknown';
    if (!byMethod[m]) byMethod[m] = { count: 0, totalWei: 0 };
    byMethod[m].count++;
    byMethod[m].totalWei += Number(item.value);
  }
  const methodRows = Object.entries(byMethod).sort((a, b) => b[1].count - a[1].count);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Request History</CardTitle>
        <p className="text-[11px] font-mono text-[var(--text-faint)] mt-0.5 truncate">{address}</p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-8 shimmer rounded" />)}</div>
        ) : error ? (
          <p className="text-[12px] text-[var(--text-muted)]">
            {error.includes('unavailable') || error.includes('502') ? 'History service unavailable.' : error}
          </p>
        ) : items.length === 0 ? (
          <p className="text-[13px] text-[var(--text-muted)]">No requests found for this address.</p>
        ) : (
          <div className="space-y-3">
            {/* Summary */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-[var(--radius-button)] bg-[var(--bg-elevated)]">
                <p className="text-[10px] uppercase tracking-[0.06em] text-[var(--text-muted)] mb-1">Total Requests</p>
                <p className="text-[20px] font-mono font-medium text-[var(--text)]">{items.length.toLocaleString()}</p>
              </div>
              <div className="p-3 rounded-[var(--radius-button)] bg-[var(--bg-elevated)]">
                <p className="text-[10px] uppercase tracking-[0.06em] text-[var(--text-muted)] mb-1">Total GRT Spent</p>
                <p className="text-[20px] font-mono font-medium text-[var(--green)]">{totalGRT}</p>
              </div>
            </div>

            {/* Method breakdown */}
            {methodRows.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-[0.06em] text-[var(--text-muted)] mb-2">By Method</p>
                <div className="rounded-[var(--radius-button)] border border-[var(--border)] overflow-hidden divide-y divide-[var(--border)]">
                  {methodRows.slice(0, 8).map(([method, stats]) => {
                    const pct = Math.round((stats.count / items.length) * 100);
                    return (
                      <div key={method} className="flex items-center justify-between px-3 py-2 hover:bg-[var(--bg-elevated)] transition-colors">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[11px] font-mono text-[var(--text)] truncate">{method}</span>
                          <span className="text-[10px] text-[var(--text-faint)] shrink-0">{pct}%</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-[11px] font-mono text-[var(--text-muted)]">{stats.count.toLocaleString()}×</span>
                          <span className="text-[11px] font-mono text-[var(--green)]">
                            {(stats.totalWei / 1e18).toFixed(4)} GRT
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Chainlist Widget ──────────────────────────────────────────────────────────

const DISPATCH_RPC_URL = 'https://gateway.lodestar-dashboard.com/rpc/42161';

function ChainlistWidget() {
  const [added, setAdded] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const addToMetaMask = async () => {
    setAddError(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eth = (window as any).ethereum;
    if (!eth) { setAddError('MetaMask not detected'); return; }
    try {
      await eth.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: '0xA4B1', // 42161
          chainName: 'Arbitrum One',
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: [DISPATCH_RPC_URL],
          blockExplorerUrls: ['https://arbiscan.io'],
        }],
      });
      setAdded(true);
    } catch (e) {
      setAddError(String(e).split('(')[0].trim());
    }
  };

  const copyUrl = () => {
    navigator.clipboard.writeText(DISPATCH_RPC_URL).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add to Wallet</CardTitle>
        <p className="text-[12px] text-[var(--text-muted)] mt-0.5">
          Point any wallet or app at the Dispatch gateway
        </p>
      </CardHeader>
      <CardContent className="space-y-3">

        {/* Network card */}
        <div className="rounded-[var(--radius-button)] border border-[var(--border)] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-[#1b4add] flex items-center justify-center text-white text-[11px] font-bold shrink-0">A</div>
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-[var(--text)]">Arbitrum One</p>
                <p className="text-[11px] text-[var(--text-muted)]">Chain ID 42161 · Standard + Archive</p>
              </div>
            </div>
            <button
              onClick={addToMetaMask}
              disabled={added}
              className={cn(
                'shrink-0 px-3 py-1.5 text-[12px] font-medium rounded-[var(--radius-button)] transition-colors',
                added
                  ? 'bg-[var(--green-dim)] text-[var(--green)] cursor-default'
                  : 'bg-[var(--accent)] text-white hover:opacity-90',
              )}
            >
              {added ? '✓ Added' : 'Add to MetaMask'}
            </button>
          </div>
          <div className="border-t border-[var(--border)] px-4 py-2.5 flex items-center justify-between gap-3 bg-[var(--bg-elevated)]">
            <code className="text-[11px] font-mono text-[var(--text-faint)] truncate">{DISPATCH_RPC_URL}</code>
            <button
              onClick={copyUrl}
              className="shrink-0 text-[11px] text-[var(--accent)] hover:opacity-80 transition-opacity font-medium"
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>

        {addError && <p className="text-[11px] text-[var(--red)] font-mono">{addError}</p>}

        {/* Note about X-Consumer-Address */}
        <div className="p-3 rounded-[var(--radius-button)] bg-[var(--bg-elevated)]">
          <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
            Every request needs an <code className="font-mono text-[var(--text)]">X-Consumer-Address</code> header.
            Use <strong className="text-[var(--text)]">dispatch-proxy</strong> locally to add it automatically —
            or the consumer SDK for programmatic access.
          </p>
        </div>

        {/* Quick curl */}
        <div>
          <p className="text-[10px] uppercase tracking-[0.06em] text-[var(--text-muted)] mb-1.5">Quick test</p>
          <div className="p-3 rounded-[var(--radius-button)] bg-[var(--bg-elevated)] overflow-x-auto">
            <pre className="text-[11px] font-mono text-[var(--text-muted)] whitespace-pre">{`curl ${DISPATCH_RPC_URL} \\
  -H "X-Consumer-Address: 0xYOUR_ADDRESS" \\
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'`}</pre>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Provider Methods ─────────────────────────────────────────────────────────

function ProviderMethods() {
  const [expanded, setExpanded] = useState(false);
  const allLabels = METHODS.map(m => m.label);
  const visible = expanded ? allLabels : allLabels.slice(0, 5);
  return (
    <div className="flex flex-wrap gap-1.5">
      {visible.map((m) => (
        <span key={m} className="px-1.5 py-0.5 rounded-[var(--radius-badge)] bg-[var(--bg-elevated)] text-[10px] font-mono text-[var(--text-muted)]">{m}</span>
      ))}
      <button
        onClick={() => setExpanded(!expanded)}
        className="px-1.5 py-0.5 rounded-[var(--radius-badge)] bg-[var(--bg-elevated)] text-[10px] font-mono text-[var(--accent)] hover:opacity-80 transition-opacity"
      >
        {expanded ? '− show less' : `+${allLabels.length - 5} more`}
      </button>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function DispatchPage() {
  const { data: provisionsData } = useServiceProvisions(DISPATCH.rpcDataService);
  const provisions = provisionsData?.provisions ?? [];
  const providerProvision = provisions.find(
    (p) => p.indexer.id.toLowerCase() === DISPATCH.provider.toLowerCase()
  );
  const provisionedGRT = providerProvision ? weiToGRT(providerProvision.tokensProvisioned) : null;
  const thawingGRT = providerProvision ? weiToGRT(providerProvision.tokensThawing) : null;

  return (
    <div className="space-y-6">

      {/* Hero */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-[20px] font-medium text-[var(--text)] tracking-tight">
              Dispatch JSON-RPC
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--radius-badge)] bg-[var(--green-dim)] text-[var(--green)] text-[10px] font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)] animate-pulse" />
              Live
            </span>
          </div>
          <p className="text-[13px] text-[var(--text-muted)] max-w-xl">
            Decentralised JSON-RPC on The Graph&apos;s Horizon framework. Staked indexers serve RPC requests
            and get paid per-request via GraphTally micropayments. Every response is signed by the provider.
          </p>
          <p className="text-[11px] text-[var(--text-faint)] mt-1">
            Community project · not affiliated with The Graph Foundation
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a
            href="https://github.com/cargopete/dispatch"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-button)] bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:text-[var(--text)] text-[12px] transition-colors border border-[var(--border)]"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
            GitHub
          </a>
          <a
            href="https://cargopete.github.io/dispatch"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-button)] bg-[var(--accent-dim)] text-[var(--accent)] hover:opacity-90 text-[12px] transition-opacity"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            Docs
          </a>
        </div>
      </div>

      {/* Stats */}
      <StatGrid className="lg:grid-cols-4">
        <StatCard
          label="Active Providers"
          value="1"
          subtitle="lodestar-indexer.eth"
          icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
            </svg>
          }
        />
        <StatCard
          label="Chain"
          value="Arb One"
          subtitle="chain ID 42161"
          icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
          }
        />
        <StatCard
          label="Tiers"
          value="Standard + Archive"
          subtitle="debug/trace: coming soon"
          icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h13M3 8h9m-9 4h9m5-4v12m0 0l-4-4m4 4l4-4" />
            </svg>
          }
        />
        <StatCard
          label="Provider Stake"
          value={provisionedGRT !== null ? `${formatGRT(provisionedGRT)} GRT` : '--'}
          subtitle="on HorizonStaking"
          icon={
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375" />
            </svg>
          }
        />
      </StatGrid>

      {/* Playground */}
      <Playground />

      {/* Live Feed */}
      <LiveFeed />

      {/* Consumer + Provider in a 2-col grid on large screens */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <ConsumerStatus />
          <FundConsumer />
          <ConsumerHistory />
        </div>

        <div className="space-y-6">
        {/* Active Providers */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Active Providers</CardTitle>
              <Badge variant="default">1 online</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-[var(--radius-button)] border border-[var(--border)] overflow-hidden">
              {/* Table header */}
              <div className="grid grid-cols-[1fr_auto] gap-4 px-4 py-2 bg-[var(--bg-elevated)] border-b border-[var(--border)]">
                <span className="text-[10px] uppercase tracking-[0.06em] text-[var(--text-muted)]">Indexer</span>
                <span className="text-[10px] uppercase tracking-[0.06em] text-[var(--text-muted)]">Status</span>
              </div>
              {/* Row */}
              <div className="px-4 py-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[13px] font-medium text-[var(--text)]">lodestar-indexer.eth</p>
                    <p className="text-[11px] font-mono text-[var(--text-faint)]">0xb43B2CCC…09Bb · EU Central</p>
                  </div>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-badge)] bg-[var(--green-dim)] text-[var(--green)] text-[10px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)] animate-pulse" />
                    Online
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { label: 'Stake', value: provisionedGRT !== null ? `${formatGRT(provisionedGRT)} GRT` : '--' },
                    { label: 'Thawing', value: thawingGRT ? `${formatGRT(thawingGRT)} GRT` : '0' },
                    { label: 'Chain', value: 'Arb One' },
                    { label: 'Tiers', value: 'Std + Archive' },
                  ].map(({ label, value }) => (
                    <div key={label} className="p-2 rounded bg-[var(--bg-elevated)]">
                      <p className="text-[10px] uppercase tracking-[0.06em] text-[var(--text-muted)]">{label}</p>
                      <p className="text-[12px] font-mono text-[var(--text)] mt-0.5">{value}</p>
                    </div>
                  ))}
                </div>
                <ProviderMethods />
              </div>
            </div>
          </CardContent>
        </Card>
          <ChainlistWidget />
        </div>
      </div>

      {/* How it works */}
      <Card>
        <CardHeader>
          <CardTitle>How it works</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              {
                step: '01',
                title: 'Provider stakes GRT',
                body: 'Indexers provision ≥ 25,000 GRT to RPCDataService on HorizonStaking and register which chains and tiers they serve.',
              },
              {
                step: '02',
                title: 'Consumer sends request',
                body: 'Every JSON-RPC request carries a signed EIP-712 TAP receipt. The gateway signs on your behalf, or you sign directly with the consumer SDK.',
              },
              {
                step: '03',
                title: 'GRT settles on-chain',
                body: 'Receipts batch into a RAV every 60s. The provider calls RPCDataService.collect() hourly — GRT flows from your escrow to the provider automatically.',
              },
            ].map(({ step, title, body }) => (
              <div key={step} className="flex gap-3">
                <span className="text-[11px] font-mono text-[var(--accent)] opacity-60 pt-0.5 shrink-0">{step}</span>
                <div>
                  <p className="text-[13px] font-medium text-[var(--text)] mb-1">{title}</p>
                  <p className="text-[12px] text-[var(--text-muted)] leading-relaxed">{body}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 pt-4 border-t border-[var(--border)] flex flex-wrap items-center gap-4">
            <p className="text-[12px] text-[var(--text-muted)]">Want to run a provider or build with the consumer SDK?</p>
            <div className="flex gap-3">
              <a
                href="https://cargopete.github.io/dispatch/providers"
                target="_blank"
                rel="noreferrer"
                className="text-[12px] text-[var(--accent)] hover:underline"
              >
                Provider guide →
              </a>
              <a
                href="https://cargopete.github.io/dispatch/consumers"
                target="_blank"
                rel="noreferrer"
                className="text-[12px] text-[var(--accent)] hover:underline"
              >
                Consumer SDK →
              </a>
              <a
                href="https://github.com/cargopete/dispatch"
                target="_blank"
                rel="noreferrer"
                className="text-[12px] text-[var(--accent)] hover:underline"
              >
                GitHub →
              </a>
            </div>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
