'use client';

import { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { useRouter } from 'next/navigation';
import { useAccount, useSignMessage } from 'wagmi';
import { subscribeMessage } from '@/lib/push-auth';
import { useDismissible } from '@/hooks/useDismissible';
import { useHydrated } from '@/hooks/useHydrated';

// Native push registration + deep-linking. Renders (and does) nothing on the
// web — only inside the iOS Capacitor shell, where Capacitor injects its bridge
// into the loaded site so the @capacitor/push-notifications plugin is reachable.
//
// Flow: in-app, once a wallet is connected and the device isn't yet registered,
// we offer a one-tap "enable" that asks for the iOS permission, grabs the APNs
// token, has the wallet sign the opt-in message, and binds token → address via
// /api/push/register-device. Tapping a delivered notification deep-links to its
// `path`.

const isNative = () => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

function regKey(address: string) {
  return `lodestar.push.registered.${address.toLowerCase()}`;
}

export function NativePushManager() {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [busy, setBusy] = useState(false);
  const mounted = useHydrated();

  // Persisted: this address has bound a device, so never offer again.
  const { dismissed: alreadyRegistered, dismiss: markRegistered } = useDismissible(
    address ? regKey(address) : 'lodestar.push.registered.unknown',
  );
  // Session-only: iOS permission was refused. Deliberately not persisted, so the
  // offer returns on the next visit. Keyed by address so switching wallets re-asks.
  const [deniedFor, setDeniedFor] = useState<string | null>(null);

  // Deep-link: navigate to the notification's `path` when the user taps it.
  useEffect(() => {
    if (!mounted || !isNative()) return;
    let cleanup: (() => void) | undefined;
    (async () => {
      const { PushNotifications } = await import('@capacitor/push-notifications');
      const handle = await PushNotifications.addListener(
        'pushNotificationActionPerformed',
        (action) => {
          const path = action.notification?.data?.path;
          if (typeof path === 'string' && path.startsWith('/')) router.push(path);
        },
      );
      cleanup = () => handle.remove();
    })();
    return () => cleanup?.();
  }, [mounted, router]);

  // Offer to enable once a wallet is connected and this address isn't bound yet.
  // Every input is synchronous, so this derives during render rather than from an
  // effect that would schedule a second render on mount.
  const show =
    mounted &&
    isNative() &&
    isConnected &&
    !!address &&
    !alreadyRegistered &&
    deniedFor !== address.toLowerCase();

  const enable = useCallback(async () => {
    if (!address) return;
    setBusy(true);
    try {
      const { PushNotifications } = await import('@capacitor/push-notifications');

      const perm = await PushNotifications.requestPermissions();
      if (perm.receive !== 'granted') {
        setDeniedFor(address.toLowerCase());
        return;
      }

      // register() asks iOS for an APNs token, delivered via the 'registration'
      // event — race it against an error and a timeout.
      const token = await new Promise<string>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) reject(new Error('apns-timeout'));
        }, 15000);
        PushNotifications.addListener('registration', (t) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(t.value);
        });
        PushNotifications.addListener('registrationError', (e) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(new Error(String(e?.error ?? 'registration-error')));
        });
        void PushNotifications.register();
      });

      const signature = await signMessageAsync({ message: subscribeMessage(address) });
      const res = await fetch('/api/push/register-device', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, signature, token }),
      });
      if (res.ok) {
        markRegistered();
      }
    } catch {
      // Permission denied / signature rejected / timeout — leave the prompt so
      // the user can retry later.
    } finally {
      setBusy(false);
    }
  }, [address, signMessageAsync, markRegistered]);

  if (!mounted || !show) return null;

  return (
    <div
      className="fixed inset-x-3 z-50 rounded-2xl border border-white/10 bg-[#1b1f28] p-4 shadow-xl"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 76px)' }}
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none">🔔</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">Enable alerts</p>
          <p className="mt-0.5 text-xs text-white/60">
            Get notified about events affecting your indexers and delegations.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={enable}
              disabled={busy}
              className="rounded-full bg-[#6f4cff] px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy ? 'Enabling…' : 'Enable'}
            </button>
            <button
              onClick={() => {
                if (address) setDeniedFor(address.toLowerCase());
              }}
              className="rounded-full px-4 py-1.5 text-xs font-medium text-white/50"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
