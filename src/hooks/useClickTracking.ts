'use client';

import { useCallback } from 'react';
import { useWalletStore } from './useWalletStore';

const SESSION_KEY = 'lodestar:session';

function getSessionId(): string {
  try {
    let id = localStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return 'anon';
  }
}

export interface TradeClickEvent {
  event_type: 'trade_click';
  token_address: string;
  token_symbol: string;
  venue: string;
  pool_address: string;
  chain: string;
  destination_url: string;
}

export interface ProtocolClickEvent {
  event_type: 'protocol_visit';
  protocol_slug: string;
  venue: string;
  chain: string;
  destination_url: string;
}

export type ClickEvent = TradeClickEvent | ProtocolClickEvent;

export function useClickTracking() {
  const { wallets } = useWalletStore();

  const track = useCallback(
    (event: ClickEvent) => {
      try {
        const wallet = wallets[0]?.address ?? null;
        const session_id = getSessionId();
        const payload = JSON.stringify({ ...event, wallet, session_id });

        // sendBeacon survives page unload (user navigating away after click)
        if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
          const blob = new Blob([payload], { type: 'application/json' });
          navigator.sendBeacon('/api/analytics/clickthrough', blob);
        } else {
          fetch('/api/analytics/clickthrough', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload,
            keepalive: true,
          }).catch(() => {});
        }
      } catch {
        // never break the UI for analytics
      }
    },
    [wallets],
  );

  return { track };
}
