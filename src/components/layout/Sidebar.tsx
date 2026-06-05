'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
}

interface NavSection {
  title: string;
  items: NavItem[];
  collapsible?: boolean;
}

const navigation: NavSection[] = [
  {
    title: 'Overview',
    items: [
      {
        label: 'Protocol',
        href: '/',
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
          </svg>
        ),
      },
      {
        label: 'Subgraphs',
        href: '/subgraphs',
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
        ),
      },
      {
        label: 'Data Services',
        href: '/data-services',
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
          </svg>
        ),
      },
    ],
  },
  {
    title: 'Delegators',
    items: [
      {
        label: 'Delegators',
        href: '/delegators',
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        ),
      },
      {
        label: 'Delegate GRT',
        href: '/delegate',
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
          </svg>
        ),
      },
      {
        label: 'Compare Indexers',
        href: '/compare',
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        ),
      },
      {
        label: 'Delegation Calculator',
        href: '/calculator',
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        ),
      },
    ],
  },
  {
    title: 'Indexers',
    items: [
      {
        label: 'Indexers',
        href: '/indexers',
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
          </svg>
        ),
      },
      {
        label: 'Indexing Status',
        href: '/indexing',
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
          </svg>
        ),
      },
      {
        label: 'POI Explorer',
        href: '/poi',
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
          </svg>
        ),
      },
    ],
  },
  {
    title: 'Developers',
    items: [
      {
        label: 'Subgraph Dock',
        href: '/dock',
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
          </svg>
        ),
      },
    ],
  },
  {
    title: 'Curators',
    items: [
      {
        label: 'Curate',
        href: '/curate',
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5" />
          </svg>
        ),
      },
    ],
  },
  {
    title: 'Analytics',
    items: [
      {
        label: 'Protocols',
        href: '/protocols',
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6" />
          </svg>
        ),
      },
      {
        label: 'Tokens',
        href: '/tokens',
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c2.485 0 4.5-1.343 4.5-3S14.485 2 12 2 7.5 3.343 7.5 5 9.515 8 12 8zm0 0c-2.485 0-4.5 1.343-4.5 3v2c0 1.657 2.015 3 4.5 3s4.5-1.343 4.5-3v-2c0-1.657-2.015-3-4.5-3zm0 8c-2.485 0-4.5 1.343-4.5 3v0c0 1.657 2.015 3 4.5 3s4.5-1.343 4.5-3v0c0-1.657-2.015-3-4.5-3z" />
          </svg>
        ),
      },
      {
        label: 'Activity',
        href: '/activity',
        icon: (
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
        ),
      },
      {
        label: 'Payments',
        href: '/payments',
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
          </svg>
        ),
      },
    ],
  },
  {
    title: 'Community',
    items: [
      {
        label: 'Scuttlebutt',
        href: '/scuttlebutt',
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
          </svg>
        ),
      },
      {
        label: 'AI / MCPs',
        href: '/ai',
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
          </svg>
        ),
      },
      {
        label: 'Blog',
        href: '/blog',
        icon: (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 01-2.25 2.25M16.5 7.5V18a2.25 2.25 0 002.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 002.25 2.25h13.5" />
          </svg>
        ),
      },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [searchValue, setSearchValue] = useState('');

  // Collapsible sections: default collapsed unless the active path lives inside them
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const section of navigation) {
      if (section.collapsible) {
        const hasActive = section.items.some(
          (item) => pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))
        );
        init[section.title] = !hasActive;
      }
    }
    return init;
  });

  const toggleSection = (title: string) => {
    setCollapsed((prev) => ({ ...prev, [title]: !prev[title] }));
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const addr = searchValue.trim();
    if (!addr) return;

    if (/^0x[a-fA-F0-9]{40}$/.test(addr)) {
      router.push(`/delegators/${addr}`);
      setSearchValue('');
    } else if (addr.endsWith('.eth')) {
      router.push(`/delegators/${addr}`);
      setSearchValue('');
    }
  };

  return (
    <aside className="hidden md:flex fixed left-0 top-0 h-screen w-[var(--sidebar-width)] bg-[var(--bg-surface)] border-r border-[var(--border)] flex-col z-30" style={{ backgroundImage: 'radial-gradient(ellipse 200% 25% at 50% 0%, rgba(111, 76, 255, 0.10) 0%, transparent 70%)' }}>
      {/* Logo */}
      <div className="flex items-center px-5 py-3 border-b-[0.5px] border-[var(--border)]">
        <Link href="/" className="flex flex-col group">
          <div className="flex items-center gap-2.5">
            <Image src="/lodestar.png" alt="Lodestar" width={22} height={22} className="w-[22px] h-[22px]" />
            <span className="text-[15px] font-semibold text-[var(--text)] tracking-tight" style={{ fontFamily: 'var(--font-display)' }}>lodestar</span>
          </div>
          <span className="text-[10px] text-[var(--text-faint)] tracking-wide mt-1 pl-[30px]">Stay oriented</span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-3">
        {navigation.map((section) => {
          const isCollapsed = section.collapsible && collapsed[section.title];
          return (
            <div key={section.title} className={cn('mb-5', isCollapsed && 'mb-1.5')}>
              {section.collapsible ? (
                <button
                  onClick={() => toggleSection(section.title)}
                  className={cn(
                    'flex items-center justify-between w-full px-2.5 py-1.5 rounded-[var(--radius-button)] transition-colors group',
                    isCollapsed
                      ? 'bg-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.08)] mb-0'
                      : 'mb-1.5 hover:bg-[rgba(255,255,255,0.03)]'
                  )}
                >
                  <h4 className={cn(
                    'text-[11px] font-medium transition-colors',
                    isCollapsed
                      ? 'text-[var(--text-muted)]'
                      : 'text-[var(--text-faint)] group-hover:text-[var(--text-muted)]'
                  )}>
                    {section.title}
                  </h4>
                  <svg
                    className={cn(
                      'w-3 h-3 transition-transform',
                      isCollapsed ? 'text-[var(--text-muted)]' : 'text-[var(--text-faint)] rotate-180'
                    )}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              ) : (
                <h4 className="text-[11px] font-medium text-[var(--text-faint)] px-2.5 mb-1.5">
                  {section.title}
                </h4>
              )}
              {!isCollapsed && (
                <ul className="space-y-px">
                  {section.items.map((item) => {
                    const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className={cn(
                            'relative flex items-center gap-2.5 px-2.5 py-[7px] rounded-[var(--radius-button)] text-[13px] transition-colors active:scale-[0.97]',
                            isActive
                              ? 'bg-[rgba(111,76,255,0.14)] text-white font-medium'
                              : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[rgba(255,255,255,0.04)]'
                          )}
                        >
                          {isActive && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-r bg-[var(--accent)]" />
                          )}
                          <span className={cn('opacity-50', isActive && 'opacity-90')}>
                            {item.icon}
                          </span>
                          <span>{item.label}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      {/* The Night's Watch — permanent community CTA */}
      <div className="px-3 pt-3">
        <a
          href="https://discord.gg/484vgDETEZ"
          target="_blank"
          rel="noopener noreferrer"
          className="block rounded-[var(--radius-card)] border p-3 transition-colors active:scale-[0.98] group"
          style={{
            background: 'color-mix(in srgb, var(--accent) 12%, var(--bg-surface))',
            borderColor: 'color-mix(in srgb, var(--accent) 45%, transparent)',
          }}
        >
          <div className="flex items-center gap-2">
            <span className="text-[15px] leading-none" aria-hidden="true">⚔️</span>
            <span className="text-[13px] font-semibold text-[var(--text)]">The Night&apos;s Watch</span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--text-muted)] leading-snug">
            An open community holding The Graph&apos;s data layer. Hold the wall.
          </p>
          <span
            className="mt-2 inline-flex items-center justify-center w-full px-3 py-1.5 text-[12px] font-medium rounded-[var(--radius-button)] transition-[filter] group-hover:brightness-110"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            Join the Watch →
          </span>
        </a>
      </div>

      {/* Address search */}
      <div className="p-3 border-t-[0.5px] border-[var(--border)]">
        <form onSubmit={handleSearch} className="relative">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--text-faint)] pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="text"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder="Search address..."
            className="w-full pl-7 pr-3 py-2 text-[12px] text-[var(--text)] placeholder-[var(--text-faint)] bg-[var(--bg-elevated)] border-none rounded-[var(--radius-button)] outline-none focus:ring-1 focus:ring-[var(--accent)] transition-shadow"
          />
        </form>
      </div>
    </aside>
  );
}
