'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * SubgraphAlertsPanel (Tier 3 — health monitoring with webhook alerting).
 *
 * Per-deployment alert config for subgraph devs: paste a Discord/Slack/generic
 * incoming-webhook URL, set a block-lag threshold, and a cron pings the webhook
 * when the subgraph falls behind or errors (and again when it recovers).
 *
 * Shows the config for THIS deployment only (filtered from GET /api/studio/alerts).
 * Lets the dev save (POST upsert), toggle enabled (PATCH), delete (DELETE), and
 * fire a test ping (POST /api/studio/alerts/[id]/test — routed server-side to
 * dodge browser CORS on the webhook host).
 */

interface AlertRow {
  id: number;
  deploymentId: string;
  label: string | null;
  webhookUrl: string;
  channel: string;
  lagThreshold: number;
  enabled: boolean;
  createdAt: string;
  lastAlertedAt: string | null;
  lastStatus: string | null;
}

export default function SubgraphAlertsPanel({
  deploymentId,
  label,
}: {
  deploymentId: string;
  label: string | null;
}) {
  const [alert, setAlert] = useState<AlertRow | null>(null);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [lagThreshold, setLagThreshold] = useState('5000');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    try {
      const r = await fetch('/api/studio/alerts', { credentials: 'include' });
      if (!r.ok) return;
      const d = await r.json();
      const mine: AlertRow | undefined = (d.alerts ?? []).find(
        (a: AlertRow) => a.deploymentId === deploymentId,
      );
      if (mine) {
        setAlert(mine);
        setWebhookUrl(mine.webhookUrl);
        setLagThreshold(String(mine.lagThreshold));
      } else {
        setAlert(null);
      }
    } catch {
      /* offline / unauth — leave empty */
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch on mount — intentional
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deploymentId]);

  function channelFor(url: string): string {
    if (url.includes('discord.com') || url.includes('discordapp.com')) return 'discord';
    if (url.includes('hooks.slack.com')) return 'slack';
    return 'webhook';
  }

  const isHttps = (() => {
    try {
      return new URL(webhookUrl).protocol === 'https:';
    } catch {
      return false;
    }
  })();

  async function save() {
    if (!isHttps) {
      setNotice('Webhook URL must be a valid https URL.');
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const r = await fetch('/api/studio/alerts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deploymentId,
          label: label || undefined,
          webhookUrl,
          channel: channelFor(webhookUrl),
          lagThreshold: parseInt(lagThreshold, 10) || 5000,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setNotice(d.error ?? 'Failed to save.');
      } else {
        await load();
        setNotice('Saved.');
      }
    } finally {
      setSaving(false);
    }
  }

  async function toggle() {
    if (!alert) return;
    await fetch(`/api/studio/alerts/${alert.id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !alert.enabled }),
    });
    await load();
  }

  async function remove() {
    if (!alert) return;
    if (!confirm('Delete this alert? You will stop receiving health notifications for this subgraph.'))
      return;
    await fetch(`/api/studio/alerts/${alert.id}`, { method: 'DELETE', credentials: 'include' });
    setAlert(null);
    setWebhookUrl('');
    setLagThreshold('5000');
    setNotice(null);
  }

  async function sendTest() {
    if (!alert) return;
    setTesting(true);
    setNotice(null);
    try {
      const r = await fetch(`/api/studio/alerts/${alert.id}/test`, {
        method: 'POST',
        credentials: 'include',
      });
      setNotice(r.ok ? 'Test alert sent; check your channel.' : 'Test failed; check the webhook URL.');
    } catch {
      setNotice('Test failed; check the webhook URL.');
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="pt-4 border-t border-[var(--border)] space-y-2">
      <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wider">
        Health Alerts
      </p>
      <p className="text-xs text-[var(--text-faint)]">
        Get a Discord/Slack ping when this subgraph falls behind or hits a fatal error.
        Paste an incoming-webhook URL below.
      </p>

      {alert && (
        <div
          className={cn(
            'flex items-center justify-between gap-2 p-2.5 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border)]',
            !alert.enabled && 'opacity-60',
          )}
        >
          <div className="min-w-0">
            <div className="text-xs text-[var(--text)]">
              {alert.enabled ? 'Active' : 'Paused'}
              <span className="text-[var(--text-faint)]"> · {alert.channel}</span>
            </div>
            <p className="text-xs text-[var(--text-faint)] mt-0.5">
              Lag threshold {alert.lagThreshold.toLocaleString('en-US')} blocks
              {alert.lastStatus && ` · last: ${alert.lastStatus}`}
            </p>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={toggle}
              className="px-2 py-1 text-xs rounded-[var(--radius-button)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
            >
              {alert.enabled ? 'Pause' : 'Resume'}
            </button>
            <button
              onClick={sendTest}
              disabled={testing}
              className="px-2 py-1 text-xs rounded-[var(--radius-button)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors disabled:opacity-50"
            >
              {testing ? '…' : 'Test'}
            </button>
            <button
              onClick={remove}
              className="px-2 py-1 text-xs rounded-[var(--radius-button)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--red-text)] hover:border-[var(--red)]/40 transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      )}

      <input
        type="text"
        value={webhookUrl}
        onChange={(e) => setWebhookUrl(e.target.value)}
        placeholder="https://discord.com/api/webhooks/…"
        className={cn(
          'w-full px-3 py-1.5 text-xs rounded-[var(--radius-button)]',
          'bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text)]',
          'placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)]',
        )}
      />

      <div className="flex items-center gap-2">
        <input
          type="number"
          value={lagThreshold}
          onChange={(e) => setLagThreshold(e.target.value)}
          placeholder="5000"
          className={cn(
            'w-28 px-3 py-1.5 text-xs rounded-[var(--radius-button)]',
            'bg-[var(--bg-elevated)] border border-[var(--border)] text-[var(--text)]',
            'placeholder:text-[var(--text-faint)] focus:outline-none focus:border-[var(--accent)]',
          )}
        />
        <span className="text-xs text-[var(--text-faint)]">blocks behind</span>
        <button
          onClick={save}
          disabled={saving || !webhookUrl}
          className="ml-auto px-3 py-1.5 text-xs font-medium rounded-[var(--radius-button)] bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? 'Saving…' : alert ? 'Update' : 'Save'}
        </button>
      </div>

      {notice && <p className="text-xs text-[var(--text-muted)]">{notice}</p>}
    </div>
  );
}
