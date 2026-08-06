import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Support | Lodestar',
  description: 'Get help with Lodestar Dashboard.',
};

export default function SupportPage() {
  return (
    <article className="prose prose-invert mx-auto max-w-3xl prose-headings:font-semibold prose-a:text-[var(--accent-text)]">
      <h1>Support</h1>
      <p>
        Lodestar Dashboard is analytics, indexer intelligence, and portfolio tracking for The Graph
        Protocol. If you need help, hit a bug, or have a feature idea, here&rsquo;s how to reach us.
      </p>

      <h2>Get help</h2>
      <ul>
        <li>
          <strong>Community chat:</strong>{' '}
          <a href="https://discord.gg/484vgDETEZ">Discord</a> is the fastest way to ask a question.
        </li>
        <li>
          <strong>Bugs &amp; feature requests:</strong>{' '}
          <a href="https://github.com/nightswatchhq/lodestar/issues">
            github.com/nightswatchhq/lodestar/issues
          </a>
        </li>
      </ul>

      <h2>Frequently asked</h2>
      <h3>Is Lodestar custodial? Can it touch my funds?</h3>
      <p>
        No. Lodestar is read-only analytics over public on-chain data. It never takes custody of
        funds or private keys. Connecting a wallet is optional and only used to personalise your view
        and, if you choose, to deliver notifications.
      </p>

      <h3>How do notifications work?</h3>
      <p>
        Notifications are opt-in. When you enable them, you sign a message with your wallet to prove
        ownership, and your device registers to receive alerts about events affecting the indexers
        you delegate to (such as a dispute). You can turn them off at any time.
      </p>

      <h3>Why connect a wallet?</h3>
      <p>
        Connecting a wallet lets Lodestar tailor the dashboard to your delegations and stake, and is
        required to opt into notifications. Your address stays in your control; see our{' '}
        <a href="/privacy">Privacy Policy</a> for what we store.
      </p>

      <h2>Contact</h2>
      <p>
        For anything not covered above, open an issue on{' '}
        <a href="https://github.com/nightswatchhq/lodestar/issues">GitHub</a> or message us on{' '}
        <a href="https://discord.gg/484vgDETEZ">Discord</a>.
      </p>
    </article>
  );
}
