import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy | Lodestar',
  description: 'How Lodestar Dashboard handles your data.',
};

const EFFECTIVE = 'June 11, 2026';

export default function PrivacyPage() {
  return (
    <article className="prose prose-invert mx-auto max-w-3xl prose-headings:font-semibold prose-a:text-[var(--accent)]">
      <h1>Privacy Policy</h1>
      <p className="text-[var(--text-muted)]">Effective {EFFECTIVE}</p>

      <p>
        Lodestar Dashboard (&ldquo;Lodestar&rdquo;, &ldquo;we&rdquo;) is an analytics dashboard
        for The Graph Protocol. It is non-custodial and privacy-conscious: we collect the minimum
        needed to run the service, and we never take custody of your funds or private keys.
      </p>

      <h2>Information we collect</h2>
      <ul>
        <li>
          <strong>Usage analytics.</strong> Aggregate, privacy-friendly page-view and performance
          metrics (Vercel Analytics &amp; Speed Insights) and in-app interaction events (which
          features and links are used). We do not use advertising cookies and do not track you
          across other apps or websites.
        </li>
        <li>
          <strong>Diagnostics.</strong> Crash reports and a small sample of performance traces
          (Sentry), used only to find and fix bugs. These may include device/browser type; they are
          not used to identify you.
        </li>
        <li>
          <strong>Wallet address (optional).</strong> If you connect a wallet, it stays in your
          browser/app and we do not store it — <em>except</em> when you opt into notifications, where
          we store your public wallet address (and, on iOS, a push notification device token) solely
          to deliver the alerts you asked for. You can revoke this at any time.
        </li>
      </ul>
      <p>
        We do <strong>not</strong> collect your name, email, phone number, or precise location.
        On-chain data shown in the app is public blockchain data.
      </p>

      <h2>How we use information</h2>
      <p>
        To operate and improve the dashboard, diagnose and fix bugs, and deliver the notifications
        you opt into. We do not sell your data.
      </p>

      <h2>Sharing</h2>
      <p>
        Data is processed only by infrastructure providers acting on our behalf: Vercel (hosting and
        analytics), Sentry (diagnostics), and Apple Push Notification service (iOS notification
        delivery). We do not share data with advertisers or data brokers.
      </p>

      <h2>Data retention</h2>
      <p>
        Notification subscriptions and device tokens are kept until you unsubscribe or the token
        becomes invalid, after which they are deactivated. Analytics and diagnostics are retained
        according to our providers&rsquo; defaults.
      </p>

      <h2>Your choices</h2>
      <p>
        You can disable notifications at any time (in the app, or by unsubscribing), and disconnect
        your wallet at any time. Doing so removes the link between your address and your device.
      </p>

      <h2>Children</h2>
      <p>Lodestar is not directed to children under 13.</p>

      <h2>Changes</h2>
      <p>
        We may update this policy; the effective date above reflects the latest version.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about privacy? Open an issue at{' '}
        <a href="https://github.com/lodestar-team/lodestar/issues">
          github.com/lodestar-team/lodestar/issues
        </a>{' '}
        or reach us on{' '}
        <a href="https://discord.gg/484vgDETEZ">Discord</a>.
      </p>
    </article>
  );
}
