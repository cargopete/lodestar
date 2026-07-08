'use client';

import { useState, useEffect } from 'react';

// New key (not the retired camp one) so this shows to everyone, including
// people who dismissed the previous banner.
const STORAGE_KEY = 'lodestar:redstart-banner-dismissed';
const GENERATOR_URL = 'https://redstart-lang.com/generator?utm_source=lodestar&utm_medium=banner';

// Redstart's signature red / ember.
const RED = '#ff3355';
const EMBER = '#ff7a45';
const RED_DEEP = '#a60f33';

export function RedstartBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY)) return;
    setVisible(true);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    setVisible(false);
  };

  return (
    <div
      className="mb-4 md:mb-6 flex items-center gap-3 rounded-[var(--radius-card)] px-4 py-2.5 border"
      style={{
        background: `color-mix(in srgb, ${RED} 12%, var(--bg-surface))`,
        borderColor: `color-mix(in srgb, ${RED} 45%, transparent)`,
      }}
    >
      <span
        className="hidden sm:inline-flex items-center justify-center w-6 h-6 rounded-[var(--radius-button)] shrink-0"
        style={{ background: `linear-gradient(135deg, ${RED}, ${EMBER})` }}
        aria-hidden="true"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="#fff">
          <path d="M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z" />
        </svg>
      </span>

      <p className="flex-1 min-w-0 text-[12px] md:text-[13px] text-[var(--text)]">
        <span className="font-semibold" style={{ color: RED }}>
          Redstart
        </span>{' '}
        — the typed language for The Graph subgraphs. Paste any contract into{' '}
        <span className="font-semibold" style={{ color: EMBER }}>
          The Generator
        </span>{' '}
        and get a tested, best-practices subgraph.{' '}
        <span className="text-[var(--text-muted)]">Your AI, your repo, no code.</span>
      </p>

      <a
        href={GENERATOR_URL}
        target="_blank"
        rel="noopener noreferrer"
        onMouseEnter={(e) => (e.currentTarget.style.background = RED_DEEP)}
        onMouseLeave={(e) => (e.currentTarget.style.background = RED)}
        className="shrink-0 px-3 py-1 text-[12px] font-medium rounded-[var(--radius-button)] transition-colors active:scale-[0.97]"
        style={{ background: RED, color: '#fff' }}
      >
        Try The Generator →
      </a>

      <button
        onClick={dismiss}
        className="shrink-0 text-[var(--text-faint)] hover:text-[var(--text)] transition-colors text-lg leading-none -mr-0.5"
        aria-label="Dismiss Redstart banner"
      >
        &times;
      </button>
    </div>
  );
}
