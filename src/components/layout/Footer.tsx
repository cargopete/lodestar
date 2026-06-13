export function Footer() {
  return (
    <footer className="md:pl-[var(--sidebar-width)] lg:pr-[var(--feed-active-width)] pb-[calc(var(--bottom-nav-height)+var(--safe-bottom))] md:pb-0 transition-[padding] duration-200">
      <div className="max-w-[1440px] mx-auto px-4 md:px-6 py-8 border-t border-[var(--border)]">
        <p className="text-center text-[11px] text-[var(--text-faint)] mb-6 italic">
          <span className="not-italic font-medium text-[var(--text-muted)]">lodestar</span> /ˈloʊdstɑːr/ <span className="not-italic text-[var(--text-faint)]">n.</span>{' '}
          a star, especially the pole star, used to navigate by; a guiding principle or source of inspiration.
        </p>
        <p className="text-center text-[11px] text-[var(--text-muted)] mb-6 not-italic">
          <a
            href="https://edgeandedgeandedge.com/blog/lodestar"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[var(--accent)] transition-colors"
            title="Voluntarily incorporated. No electricity was threatened."
          >
            part of the Perimeter at Edge &amp; Edge
          </a>
        </p>
        <div className="flex flex-col items-center sm:flex-row sm:justify-between gap-4 text-xs text-[var(--text-faint)]">
          <p>
            Made with{' '}
            <span className="text-[var(--accent)]">&hearts;</span> by{' '}
            <a
              href="https://github.com/cargopete"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
            >
              cargopete
            </a>
          </p>

          <p className="text-center max-w-md">
            Lodestar is an open-source public good. Development and maintenance relies entirely on community donations.
            {' '}Consider{' '}
            <a
              href="https://github.com/sponsors/cargopete"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
            >
              buying me a coffee
            </a>
            .
          </p>

          <div className="flex items-center gap-4">
            <a
              href="https://discord.gg/484vgDETEZ"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
            >
              {'⚔️'} The Night&apos;s Watch
            </a>
            <a
              href="https://github.com/lodestar-team/lodestar"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
            >
              {'\uD83D\uDC27'} Source code
            </a>
            <a
              href="https://github.com/sponsors/cargopete"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
            >
              {'\uD83D\uDC9C'} Sponsor
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
