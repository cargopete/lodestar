'use client';

import { useState, useEffect } from 'react';

const STORAGE_KEY = 'lodestar:camp-banner-dismissed';
const CAMP_URL = 'https://engine.camp/?utm_source=lodestar&utm_medium=banner';

// Camp's signature orange (dark-theme accent / hover shade).
const CAMP_ORANGE = '#ff7a3d';
const CAMP_ORANGE_DEEP = '#c8501a';

export function CampBanner() {
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
        background: `color-mix(in srgb, ${CAMP_ORANGE} 12%, var(--bg-surface))`,
        borderColor: `color-mix(in srgb, ${CAMP_ORANGE} 45%, transparent)`,
      }}
    >
      <span
        className="hidden sm:inline-flex items-center justify-center w-6 h-6 rounded-[var(--radius-button)] text-[13px] font-bold shrink-0"
        style={{ background: CAMP_ORANGE, color: '#1a1a1c' }}
        aria-hidden="true"
      >
        ⛺
      </span>

      <p className="flex-1 min-w-0 text-[12px] md:text-[13px] text-[var(--text)]">
        <span className="font-semibold" style={{ color: CAMP_ORANGE }}>
          Camp
        </span>{' '}
        — a free community Amp node for Arbitrum One. Read blocks, txs &amp; decoded events over a simple REST API.{' '}
        <span className="hidden md:inline text-[var(--text-muted)]">No signup, no API key, no middleman.</span>
      </p>

      <a
        href={CAMP_URL}
        target="_blank"
        rel="noopener noreferrer"
        onMouseEnter={(e) => (e.currentTarget.style.background = CAMP_ORANGE_DEEP)}
        onMouseLeave={(e) => (e.currentTarget.style.background = CAMP_ORANGE)}
        className="shrink-0 px-3 py-1 text-[12px] font-medium rounded-[var(--radius-button)] transition-colors active:scale-[0.97]"
        style={{ background: CAMP_ORANGE, color: '#1a1a1c' }}
      >
        Explore →
      </a>

      <button
        onClick={dismiss}
        className="shrink-0 text-[var(--text-faint)] hover:text-[var(--text)] transition-colors text-lg leading-none -mr-0.5"
        aria-label="Dismiss Camp banner"
      >
        &times;
      </button>
    </div>
  );
}
