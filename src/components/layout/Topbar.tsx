'use client';

import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { usePathname } from 'next/navigation';
import { useGRTPrice, useEpochInfo } from '@/hooks/useNetworkStats';
import { formatUSD, shortenAddress, cn } from '@/lib/utils';
import { useState, useRef, useEffect } from 'react';

const pageTitles: Record<string, string> = {
  '/': 'Protocol Overview',
  '/indexers': 'Indexer Directory',
  '/delegators': 'Delegator Portfolio',
  '/curators': 'Curator Portfolio',
  '/subgraphs': 'Subgraph Directory',
  '/calculator': 'Delegation Calculator',
  '/compare': 'Compare Indexers',
  '/profile': 'Portfolio',
  '/services': 'Data Services',
};

function getPageTitle(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  if (pathname.startsWith('/indexers/')) return 'Indexer Profile';
  if (pathname.startsWith('/delegators/')) return 'Delegator Portfolio';
  if (pathname.startsWith('/curators/')) return 'Curator Profile';
  if (pathname.startsWith('/subgraphs/')) return 'Subgraph Detail';
  return 'Lodestar';
}

export function Topbar() {
  const pathname = usePathname();
  const { data: priceData, isLoading: priceLoading } = useGRTPrice();
  const { epoch: currentEpoch } = useEpochInfo();

  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  const [showConnectMenu, setShowConnectMenu] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const connectRef = useRef<HTMLDivElement>(null);
  const accountRef = useRef<HTMLDivElement>(null);

  const price = priceData?.price ?? 0;
  const change24h = priceData?.change24h ?? 0;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (connectRef.current && !connectRef.current.contains(event.target as Node)) {
        setShowConnectMenu(false);
      }
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) {
        setShowAccountMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="fixed top-0 left-[var(--sidebar-width)] right-0 h-[var(--topbar-height)] bg-[var(--bg)] border-b-[0.5px] border-[var(--border)] z-20">
      <div className="h-full px-6 flex items-center justify-between">
        {/* Left side — page title */}
        <span className="text-[15px] font-medium text-[var(--text)]">
          {getPageTitle(pathname)}
        </span>

        {/* Right side */}
        <div className="flex items-center gap-4">
          {/* Chain pill */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-badge)] bg-[var(--bg-surface)]">
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--green)]" />
            <span className="text-[11px] font-mono text-[var(--text-muted)]">Arbitrum</span>
          </div>

          {/* GRT Price */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[var(--text-faint)]">GRT</span>
            {priceLoading ? (
              <div className="h-4 w-14 shimmer rounded" />
            ) : price ? (
              <>
                <span className="text-[13px] font-mono text-[var(--text)]">
                  {formatUSD(price, 4)}
                </span>
                {change24h != null && (
                  <span
                    className={cn(
                      'text-[11px] font-mono',
                      change24h >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'
                    )}
                  >
                    {change24h >= 0 ? '+' : ''}{change24h.toFixed(2)}%
                  </span>
                )}
              </>
            ) : (
              <span className="text-[13px] font-mono text-[var(--text-faint)]">--</span>
            )}
          </div>

          {/* Epoch */}
          {currentEpoch && (
            <span className="text-[11px] font-mono text-[var(--text-muted)]">
              E{currentEpoch}
            </span>
          )}

          {/* Wallet Connection */}
          {isConnected ? (
            <div className="relative" ref={accountRef}>
              <button
                onClick={() => setShowAccountMenu(!showAccountMenu)}
                className={cn(
                  'flex items-center gap-2 px-3 py-1 text-[13px] rounded-[var(--radius-button)]',
                  'bg-[var(--bg-surface)] border-[0.5px] border-[var(--border)]',
                  'hover:border-[var(--border-mid)] transition-colors'
                )}
              >
                <div className="w-1.5 h-1.5 rounded-full bg-[var(--green)]" />
                <span className="font-mono">{shortenAddress(address || '')}</span>
              </button>

              {showAccountMenu && (
                <div className="absolute right-0 mt-1.5 w-48 rounded-[var(--radius-card)] bg-[var(--bg-surface)] border-[0.5px] border-[var(--border)] shadow-[var(--shadow-float)] overflow-hidden z-50">
                  <a
                    href="/profile"
                    className="block px-3.5 py-2 text-[13px] text-[var(--text)] hover:bg-[var(--bg-elevated)] transition-colors"
                  >
                    View Portfolio
                  </a>
                  <a
                    href={`https://arbiscan.io/address/${address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block px-3.5 py-2 text-[13px] text-[var(--text)] hover:bg-[var(--bg-elevated)] transition-colors"
                  >
                    View on Arbiscan
                  </a>
                  <hr className="border-[var(--border)]" />
                  <button
                    onClick={() => {
                      disconnect();
                      setShowAccountMenu(false);
                    }}
                    className="w-full text-left px-3.5 py-2 text-[13px] text-[var(--red)] hover:bg-[var(--bg-elevated)] transition-colors"
                  >
                    Disconnect
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="relative" ref={connectRef}>
              <button
                onClick={() => setShowConnectMenu(!showConnectMenu)}
                disabled={isPending}
                className={cn(
                  'px-3.5 py-1 text-[13px] font-medium rounded-[var(--radius-button)]',
                  'bg-[var(--accent)] text-white',
                  'hover:bg-[var(--accent-hover)] transition-colors',
                  isPending && 'opacity-60 cursor-not-allowed'
                )}
              >
                {isPending ? 'Connecting...' : 'Connect Wallet'}
              </button>

              {showConnectMenu && (
                <div className="absolute right-0 mt-1.5 w-52 rounded-[var(--radius-card)] bg-[var(--bg-surface)] border-[0.5px] border-[var(--border)] shadow-[var(--shadow-float)] overflow-hidden z-50">
                  <div className="px-3.5 py-2 border-b-[0.5px] border-[var(--border)]">
                    <p className="text-[11px] text-[var(--text-faint)]">Connect with</p>
                  </div>
                  {connectors.map((connector) => (
                    <button
                      key={connector.uid}
                      onClick={() => {
                        connect({ connector });
                        setShowConnectMenu(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-[var(--text)] hover:bg-[var(--bg-elevated)] transition-colors"
                    >
                      <div className="w-6 h-6 rounded bg-[var(--bg-elevated)] flex items-center justify-center">
                        <svg className="w-3.5 h-3.5 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                        </svg>
                      </div>
                      <span>{connector.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
