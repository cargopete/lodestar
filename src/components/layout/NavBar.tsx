'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { useGRTPrice, useEpochInfo } from '@/hooks/useNetworkStats';
import { formatUSD, shortenAddress, cn } from '@/lib/utils';

interface DropdownItem {
  label: string;
  href: string;
  description?: string;
}

interface NavItem {
  label: string;
  href?: string;
  children?: DropdownItem[];
}

const navigation: NavItem[] = [
  { label: 'Overview', href: '/' },
  {
    label: 'Participants',
    children: [
      { label: 'Indexers', href: '/indexers', description: 'Performance & APR for all indexers' },
      { label: 'Delegators', href: '/delegators', description: 'Portfolio tracking & history' },
      { label: 'Curators', href: '/curators', description: 'Curation positions & signal' },
      { label: 'Services', href: '/services', description: 'Data service availability' },
      { label: 'Activity', href: '/activity', description: 'Live delegation feed' },
      { label: 'Payments', href: '/payments', description: 'TAP payment streams' },
    ],
  },
  {
    label: 'Subgraphs',
    children: [
      { label: 'Directory', href: '/subgraphs', description: 'All subgraphs on The Graph' },
      { label: 'Indexing Status', href: '/indexing', description: 'Chain indexing health' },
      { label: 'POI Explorer', href: '/poi', description: 'Proof of indexing verification' },
    ],
  },
  {
    label: 'Tools',
    children: [
      { label: 'Delegate GRT', href: '/delegate', description: 'Delegate directly from Lodestar' },
      { label: 'Calculator', href: '/calculator', description: 'APR & rewards calculator' },
      { label: 'Compare', href: '/compare', description: 'Side-by-side indexer comparison' },
      { label: 'Leaderboard', href: '/leaderboard', description: 'Monthly community rankings' },
    ],
  },
  {
    label: 'Governance',
    children: [
      { label: 'Governance', href: '/governance', description: 'GIP tracker & on-chain voting' },
      { label: 'Council', href: '/council', description: 'Graph Council members' },
      { label: 'Roadmap', href: '/roadmap', description: 'Lodestar feature roadmap' },
    ],
  },
  {
    label: 'More',
    children: [
      { label: 'Blog', href: '/blog', description: 'Technical articles & updates' },
      { label: 'AI / MCPs', href: '/ai', description: 'AI tools & MCP integrations' },
      { label: 'Dispatch', href: '/dispatch', description: 'JSON-RPC data service on Horizon' },
    ],
  },
];

export function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [searchValue, setSearchValue] = useState('');
  const [showConnectMenu, setShowConnectMenu] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);

  const { data: priceData } = useGRTPrice();
  const { epoch: currentEpoch } = useEpochInfo();
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

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

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const addr = searchValue.trim();
    if (!addr) return;
    if (/^0x[a-fA-F0-9]{40}$/.test(addr) || addr.endsWith('.eth')) {
      router.push(`/delegators/${addr}`);
      setSearchValue('');
    }
  };

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 h-[var(--navbar-height)]"
      style={{
        background: 'rgba(12, 10, 29, 0.88)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div className="h-full px-4 lg:px-8 flex items-center gap-2 lg:gap-6">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 flex-shrink-0 mr-2">
          <Image src="/lodestar.png" alt="Lodestar" width={26} height={26} className="w-[26px] h-[26px]" />
          <span className="text-[15px] font-semibold text-white tracking-tight hidden sm:inline">lodestar</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-0.5 flex-1">
          {navigation.map((item) => {
            const isActive = item.href
              ? item.href === '/'
                ? pathname === '/'
                : pathname.startsWith(item.href)
              : item.children?.some(
                  (c) => pathname === c.href || pathname.startsWith(c.href + '/')
                );

            if (!item.children) {
              return (
                <Link
                  key={item.label}
                  href={item.href!}
                  className={cn(
                    'px-3 py-1.5 text-[14px] rounded-[var(--radius-button)] transition-colors',
                    isActive
                      ? 'text-white font-semibold bg-[rgba(111,76,255,0.22)] shadow-[0_0_12px_rgba(111,76,255,0.25)]'
                      : 'text-[rgba(255,255,255,0.64)] hover:text-white hover:bg-[rgba(255,255,255,0.06)]'
                  )}
                >
                  {item.label}
                </Link>
              );
            }

            const isOpen = activeDropdown === item.label;

            return (
              <div
                key={item.label}
                className="relative"
                onMouseEnter={() => setActiveDropdown(item.label)}
                onMouseLeave={() => setActiveDropdown(null)}
              >
                <button
                  className={cn(
                    'flex items-center gap-1 px-3 py-1.5 text-[14px] rounded-[var(--radius-button)] transition-colors select-none',
                    isActive || isOpen
                      ? 'text-white font-semibold'
                      : 'text-[rgba(255,255,255,0.64)] hover:text-white hover:bg-[rgba(255,255,255,0.06)]'
                  )}
                >
                  {item.label}
                  <svg
                    className={cn('w-3 h-3 transition-transform duration-150', isOpen && 'rotate-180')}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isOpen && (
                  <div className="absolute top-full left-0 pt-1 z-50 animate-[lodie-panel-in_0.15s_ease-out]">
                  <div
                    className="w-64 rounded-[var(--radius-card)] overflow-hidden"
                    style={{
                      background: 'rgba(19,17,42,0.98)',
                      border: '1px solid rgba(255,255,255,0.10)',
                      boxShadow: '0 16px 40px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(111,76,255,0.12)',
                    }}
                  >
                    {item.children.map((child) => {
                      const childActive =
                        pathname === child.href || pathname.startsWith(child.href + '/');
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          className={cn(
                            'flex flex-col px-4 py-3 transition-colors',
                            childActive
                              ? 'bg-[rgba(111,76,255,0.14)] text-white'
                              : 'text-[rgba(255,255,255,0.72)] hover:bg-[rgba(255,255,255,0.04)] hover:text-white'
                          )}
                        >
                          <span className="text-[13px] font-medium">{child.label}</span>
                          {child.description && (
                            <span className="text-[11px] text-[rgba(255,255,255,0.40)] mt-0.5">
                              {child.description}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-2 lg:gap-3 ml-auto flex-shrink-0">
          {/* Address search */}
          <form onSubmit={handleSearch} className="hidden lg:block">
            <input
              type="text"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              placeholder="Search address…"
              className="w-36 xl:w-44 px-3 py-1.5 text-[12px] text-[var(--text)] placeholder-[var(--text-faint)] bg-[rgba(255,255,255,0.05)] border border-[var(--border)] rounded-[var(--radius-button)] outline-none focus:ring-1 focus:ring-[var(--accent)] transition-[width] duration-200 focus:w-52"
            />
          </form>

          {/* Chain pill */}
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-badge)] border border-[var(--border)] bg-[rgba(255,255,255,0.04)]">
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--green)]" />
            <span className="text-[11px] font-mono text-[var(--text-muted)]">Arbitrum</span>
          </div>

          {/* GRT price */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-[var(--text-faint)]">GRT</span>
            {price ? (
              <>
                <span className="text-[13px] font-mono text-[var(--text)]">{formatUSD(price, 4)}</span>
                <span
                  className={cn(
                    'hidden sm:inline text-[11px] font-mono',
                    change24h >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'
                  )}
                >
                  {change24h >= 0 ? '+' : ''}
                  {change24h.toFixed(2)}%
                </span>
              </>
            ) : (
              <span className="text-[13px] font-mono text-[var(--text-faint)]">--</span>
            )}
          </div>

          {/* Epoch */}
          {currentEpoch && (
            <span className="hidden xl:inline text-[11px] font-mono text-[var(--text-muted)]">
              E{currentEpoch}
            </span>
          )}

          {/* Wallet */}
          {isConnected ? (
            <div className="relative" ref={accountRef}>
              <button
                onClick={() => setShowAccountMenu(!showAccountMenu)}
                className="flex items-center gap-2 px-3 py-1.5 text-[13px] rounded-[var(--radius-button)] bg-[rgba(255,255,255,0.06)] border border-[var(--border)] hover:border-[var(--border-mid)] transition-colors"
              >
                <div className="w-1.5 h-1.5 rounded-full bg-[var(--green)]" />
                <span className="font-mono">{shortenAddress(address || '')}</span>
              </button>
              {showAccountMenu && (
                <div
                  className="absolute right-0 mt-1.5 w-48 rounded-[var(--radius-card)] overflow-hidden z-50"
                  style={{ background: 'rgba(19,17,42,0.98)', border: '1px solid rgba(255,255,255,0.10)', boxShadow: 'var(--shadow-float)' }}
                >
                  <a href="/profile" className="block px-3.5 py-2 text-[13px] text-[var(--text)] hover:bg-[rgba(255,255,255,0.05)] transition-colors">
                    View Portfolio
                  </a>
                  <a
                    href={`https://arbiscan.io/address/${address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block px-3.5 py-2 text-[13px] text-[var(--text)] hover:bg-[rgba(255,255,255,0.05)] transition-colors"
                  >
                    View on Arbiscan
                  </a>
                  <hr className="border-[var(--border)]" />
                  <button
                    onClick={() => { disconnect(); setShowAccountMenu(false); }}
                    className="w-full text-left px-3.5 py-2 text-[13px] text-[var(--red)] hover:bg-[rgba(255,255,255,0.05)] transition-colors"
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
                className="px-3.5 py-1.5 text-[13px] font-semibold rounded-[var(--radius-button)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {isPending ? '…' : 'Connect Wallet'}
              </button>
              {showConnectMenu && (
                <div
                  className="absolute right-0 mt-1.5 w-52 rounded-[var(--radius-card)] overflow-hidden z-50"
                  style={{ background: 'rgba(19,17,42,0.98)', border: '1px solid rgba(255,255,255,0.10)', boxShadow: 'var(--shadow-float)' }}
                >
                  <div className="px-3.5 py-2 border-b border-[var(--border)]">
                    <p className="text-[11px] text-[var(--text-faint)]">Connect with</p>
                  </div>
                  {connectors.map((connector) => (
                    <button
                      key={connector.uid}
                      onClick={() => { connect({ connector }); setShowConnectMenu(false); }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-[var(--text)] hover:bg-[rgba(255,255,255,0.05)] transition-colors"
                    >
                      <div className="w-6 h-6 rounded bg-[rgba(255,255,255,0.06)] flex items-center justify-center">
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
