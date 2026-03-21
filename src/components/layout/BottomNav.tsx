'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

interface TabItem {
  label: string;
  href: string;
  icon: React.ReactNode;
}

const tabs: TabItem[] = [
  {
    label: 'Protocol',
    href: '/',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
      </svg>
    ),
  },
  {
    label: 'Indexers',
    href: '/indexers',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
      </svg>
    ),
  },
  {
    label: 'Services',
    href: '/services',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
      </svg>
    ),
  },
  {
    label: 'Portfolio',
    href: '/profile',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

const moreItems = [
  { label: 'Delegators', href: '/delegators' },
  { label: 'Subgraphs', href: '/subgraphs' },
  { label: 'Indexing Status', href: '/indexing' },
  { label: 'Calculator', href: '/calculator' },
  { label: 'Compare', href: '/compare' },
  { label: 'POI Explorer', href: '/poi' },
];

export function BottomNav() {
  const pathname = usePathname();
  const [showMore, setShowMore] = useState(false);

  // Check if current page is in "more" menu
  const isMoreActive = moreItems.some(
    (item) => pathname === item.href || pathname.startsWith(item.href + '/')
  );

  return (
    <>
      {/* More drawer overlay */}
      {showMore && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setShowMore(false)}
        />
      )}

      {/* More drawer */}
      {showMore && (
        <div className="fixed bottom-[calc(var(--bottom-nav-height)+var(--safe-bottom))] left-0 right-0 z-50 md:hidden px-3 pb-2">
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl overflow-hidden shadow-[var(--shadow-float)]">
            {moreItems.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setShowMore(false)}
                  className={cn(
                    'block px-4 py-3.5 text-sm transition-colors',
                    isActive
                      ? 'text-[var(--accent)] bg-[var(--accent-dim)]'
                      : 'text-[var(--text)] hover:bg-[var(--bg-elevated)]'
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Bottom tab bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-[var(--bg-surface)] border-t border-[var(--border)]"
        style={{ paddingBottom: 'var(--safe-bottom)' }}
      >
        <div className="flex items-center justify-around h-[var(--bottom-nav-height)]">
          {tabs.map((tab) => {
            const isActive = tab.href === '/'
              ? pathname === '/'
              : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 min-w-[56px] h-full px-2 transition-colors',
                  isActive
                    ? 'text-[var(--accent)]'
                    : 'text-[var(--text-faint)]'
                )}
              >
                {tab.icon}
                <span className="text-[10px] font-medium">{tab.label}</span>
              </Link>
            );
          })}

          {/* More button */}
          <button
            onClick={() => setShowMore(!showMore)}
            className={cn(
              'flex flex-col items-center justify-center gap-0.5 min-w-[56px] h-full px-2 transition-colors',
              isMoreActive || showMore
                ? 'text-[var(--accent)]'
                : 'text-[var(--text-faint)]'
            )}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01" />
            </svg>
            <span className="text-[10px] font-medium">More</span>
          </button>
        </div>
      </nav>
    </>
  );
}
