'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface SbMessage {
  id: number;
  name: string | null;
  tripcode: string | null;
  body: string;
  ip_hash?: string; // only present in moderation view
  deleted?: boolean;
  created_at: string;
}

const NAME_KEY = 'scuttlebutt:name';
// Cap how many messages we keep in memory / the DOM. A tab left open in a busy
// room would otherwise accumulate nodes without limit. Older messages stay in
// Postgres; this only bounds what's rendered in the current session.
const MAX_RENDERED = 300;

function appendCapped(prev: SbMessage[], msg: SbMessage): SbMessage[] {
  if (prev.some((m) => m.id === msg.id)) return prev;
  const next = [...prev, msg];
  return next.length > MAX_RENDERED ? next.slice(-MAX_RENDERED) : next;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function ScuttlebuttPage() {
  const [messages, setMessages] = useState<SbMessage[]>([]);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  // Admin
  const [isAdmin, setIsAdmin] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [password, setPassword] = useState('');
  const [modView, setModView] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // Track whether the user is pinned to the bottom (so we don't yank them up).
  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // Initial admin-status check.
  useEffect(() => {
    fetch('/api/scuttlebutt/admin/login')
      .then((r) => r.json())
      .then((d) => setIsAdmin(!!d.admin))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydrate of saved name from localStorage — intentional
    setName(localStorage.getItem(NAME_KEY) ?? '');
  }, []);

  // Load history (normal or moderation view).
  const loadHistory = useCallback(async () => {
    const url = modView ? '/api/scuttlebutt/admin/messages' : '/api/scuttlebutt/messages';
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      // API returns newest-first; reverse so newest sits at the bottom.
      setMessages((data.messages as SbMessage[]).slice().reverse());
      requestAnimationFrame(scrollToBottom);
    } catch {
      /* ignore */
    }
  }, [modView, scrollToBottom]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async history fetch sets state after await — intentional
    loadHistory();
  }, [loadHistory]);

  // Live updates via SSE (skipped in moderation view, which is a static snapshot).
  useEffect(() => {
    if (modView) return;
    const es = new EventSource('/api/scuttlebutt/stream');
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      let evt: { type: string; message?: SbMessage; id?: number };
      try {
        evt = JSON.parse(e.data);
      } catch {
        return;
      }
      if (evt.type === 'message' && evt.message) {
        const msg = evt.message;
        setMessages((prev) => appendCapped(prev, msg));
        if (atBottomRef.current) requestAnimationFrame(scrollToBottom);
      } else if (evt.type === 'delete' && typeof evt.id === 'number') {
        setMessages((prev) => prev.filter((m) => m.id !== evt.id));
      }
    };
    return () => es.close();
  }, [modView, scrollToBottom]);

  const send = async () => {
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    localStorage.setItem(NAME_KEY, name);
    try {
      const res = await fetch('/api/scuttlebutt/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, body: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Failed to send');
      } else {
        setBody('');
        // The SSE echo will append it; if Redis is down, append optimistically.
        if (!connected && data.message) {
          setMessages((prev) => appendCapped(prev, data.message));
          requestAnimationFrame(scrollToBottom);
        }
      }
    } catch {
      setError('Network error');
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // --- Admin actions ---
  const adminLogin = async () => {
    const res = await fetch('/api/scuttlebutt/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      setIsAdmin(true);
      setShowLogin(false);
      setPassword('');
    } else {
      setError('Wrong password');
    }
  };

  const adminLogout = async () => {
    await fetch('/api/scuttlebutt/admin/login', { method: 'DELETE' });
    setIsAdmin(false);
    setModView(false);
  };

  const deleteMessage = async (id: number) => {
    await fetch(`/api/scuttlebutt/messages/${id}`, {
      method: 'DELETE',
      headers: { 'x-sb-admin': '1' },
    });
    setMessages((prev) => prev.filter((m) => m.id !== id));
  };

  const ban = async (payload: { ipHash?: string; tripcode?: string }) => {
    await fetch('/api/scuttlebutt/bans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sb-admin': '1' },
      body: JSON.stringify(payload),
    });
    setError(`Banned ${payload.tripcode ?? payload.ipHash}`);
  };

  return (
    <div className="flex flex-col h-[calc(100svh-var(--topbar-height)-2rem)]">
      {/* Header */}
      <div className="pb-3 border-b border-[var(--border)] flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--text)] flex items-center gap-2">
            Scuttlebutt
            <span
              className={cn(
                'w-2 h-2 rounded-full',
                connected ? 'bg-emerald-400' : 'bg-[var(--text-faint)]',
              )}
              title={connected ? 'Live' : 'Offline / polling'}
            />
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Anonymous chatter, like the old days. Add <code className="font-mono text-[var(--accent-text)]">#secret</code>{' '}
            to your name for a tripcode. Mind your manners; the bilge has a mop.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isAdmin ? (
            <>
              <button
                onClick={() => setModView((v) => !v)}
                className={cn(
                  'text-[11px] px-2 py-1 rounded-[var(--radius-button)] border border-[var(--border)]',
                  modView ? 'bg-[var(--accent)]/15 text-[var(--accent-text)]' : 'text-[var(--text-muted)]',
                )}
              >
                {modView ? 'Exit mod' : 'Mod view'}
              </button>
              <button
                onClick={adminLogout}
                className="text-[11px] px-2 py-1 rounded-[var(--radius-button)] border border-[var(--border)] text-[var(--text-muted)]"
              >
                Log out
              </button>
            </>
          ) : (
            <button
              onClick={() => setShowLogin((v) => !v)}
              className="text-[11px] px-2 py-1 rounded-[var(--radius-button)] border border-[var(--border)] text-[var(--text-faint)] hover:text-[var(--text-muted)]"
            >
              Admin
            </button>
          )}
        </div>
      </div>

      {/* Admin login */}
      {showLogin && !isAdmin && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && adminLogin()}
            placeholder="Admin password"
            className="flex-1 px-3 py-1.5 text-[13px] bg-[var(--bg-elevated)] rounded-[var(--radius-button)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
          />
          <button
            onClick={adminLogin}
            className="text-[12px] px-3 py-1.5 rounded-[var(--radius-button)] bg-[var(--accent)] text-white"
          >
            Log in
          </button>
        </div>
      )}

      {/* Message list */}
      <div
        ref={listRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto py-4 space-y-3 min-h-0"
      >
        {messages.length === 0 && (
          <p className="text-center text-sm text-[var(--text-faint)] py-8">
            Quiet on deck. Be the first to say something.
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={cn(
              'group rounded-[var(--radius-card)] border-[0.5px] border-[var(--border)] bg-[var(--bg-surface)] px-3.5 py-2.5',
              m.deleted && 'opacity-50',
            )}
          >
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-[13px] font-semibold text-[var(--text)]">
                {m.name || 'Anonymous'}
              </span>
              {m.tripcode && (
                <span className="font-mono text-[11px] text-[var(--accent-text)]">{m.tripcode}</span>
              )}
              <span className="text-[11px] text-[var(--text-faint)]">{relativeTime(m.created_at)}</span>
              {modView && m.ip_hash && (
                <span className="font-mono text-[10px] text-[var(--text-faint)]">
                  ip:{m.ip_hash.slice(0, 8)}
                </span>
              )}
              {isAdmin && (
                <span className="ml-auto flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  {!m.deleted && (
                    <button
                      onClick={() => deleteMessage(m.id)}
                      className="text-[10px] px-1.5 py-0.5 rounded text-red-400 hover:bg-red-400/10"
                    >
                      Delete
                    </button>
                  )}
                  {m.tripcode && (
                    <button
                      onClick={() => ban({ tripcode: m.tripcode! })}
                      className="text-[10px] px-1.5 py-0.5 rounded text-amber-400 hover:bg-amber-400/10"
                    >
                      Ban trip
                    </button>
                  )}
                  {modView && m.ip_hash && (
                    <button
                      onClick={() => ban({ ipHash: m.ip_hash! })}
                      className="text-[10px] px-1.5 py-0.5 rounded text-amber-400 hover:bg-amber-400/10"
                    >
                      Ban IP
                    </button>
                  )}
                </span>
              )}
            </div>
            <p className="text-[14px] text-[var(--text)] mt-1 whitespace-pre-wrap break-words">
              {m.body}
            </p>
          </div>
        ))}
      </div>

      {/* Composer */}
      {!modView && (
        <div className="border-t border-[var(--border)] pt-3 space-y-2">
          {error && <p className="text-[12px] text-red-400">{error}</p>}
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (optional), try Name#secret for a tripcode"
            maxLength={60}
            className="w-full px-3 py-2 text-[13px] bg-[var(--bg-elevated)] rounded-[var(--radius-button)] outline-none focus:ring-1 focus:ring-[var(--accent)]"
          />
          <div className="flex items-end gap-2">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Say something… (Enter to send, Shift+Enter for a newline)"
              rows={2}
              maxLength={2000}
              className="flex-1 px-3 py-2 text-[14px] bg-[var(--bg-elevated)] rounded-[var(--radius-button)] outline-none focus:ring-1 focus:ring-[var(--accent)] resize-none"
            />
            <button
              onClick={send}
              disabled={sending || !body.trim()}
              className="px-4 py-2 text-[13px] font-medium rounded-[var(--radius-button)] bg-[var(--accent)] text-white disabled:opacity-40 transition-opacity"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
