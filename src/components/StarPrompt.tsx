'use client';

import { useState, useEffect } from 'react';

const STORAGE_KEY = 'lodestar:star-dismissed';
const REPO_URL = 'https://github.com/lodestar-team/lodestar';
const DELAY_MS = 8000;

export function StarPrompt() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY)) return;
    const timer = setTimeout(() => setVisible(true), DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    setVisible(false);
  };

  const goToRepo = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    window.open(REPO_URL, '_blank', 'noopener');
    setVisible(false);
  };

  return (
    <div className="fixed z-[9999] max-w-sm right-4 md:right-6 bottom-[calc(var(--bottom-nav-height,0px)+1.5rem)] md:bottom-6" style={{ animation: 'star-slide-in 0.3s ease-out' }}>
      <div className="bg-[var(--bg-elevated)] border border-[var(--border-mid)] rounded-[var(--radius-card,12px)] shadow-2xl p-4">
        <div className="flex items-start gap-3">
          <span className="text-xl leading-none mt-0.5">&#11088;</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[var(--text)]">
              Enjoying Lodestar?
            </p>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              A GitHub star helps others find the project and keeps development going.
            </p>
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={goToRepo}
                className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-button,6px)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
              >
                Star on GitHub
              </button>
              <button
                onClick={dismiss}
                className="px-3 py-1.5 text-xs font-medium rounded-[var(--radius-button,6px)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
              >
                Not now
              </button>
            </div>
          </div>
          <button
            onClick={dismiss}
            className="text-[var(--text-faint)] hover:text-[var(--text)] transition-colors text-lg leading-none -mt-0.5 -mr-0.5"
            aria-label="Dismiss"
          >
            &times;
          </button>
        </div>
      </div>
    </div>
  );
}
