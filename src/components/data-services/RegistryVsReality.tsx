'use client';

import { useQuery } from '@tanstack/react-query';
import type { LivenessSummary, LivenessStatus } from '@/lib/dispatch-liveness';

/**
 * Registry versus reality for Dispatch.
 *
 * The catalogue entry beside this is hand-written and therefore goes stale — it claimed
 * "Live · Production" for 39 days after every endpoint stopped answering. This probes the
 * endpoints the registry actually advertises, every time the page loads, so the page cannot
 * confidently lie again.
 */

const STATUS_LABEL: Record<LivenessStatus, string> = {
  serving: 'serving',
  wrong_chain: 'wrong chain',
  http_error: 'HTTP error',
  bad_response: 'bad response',
  unreachable: 'unreachable',
  timeout: 'timeout',
};

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function RegistryVsReality() {
  const { data, isLoading, isError } = useQuery<{ data: LivenessSummary }>({
    queryKey: ['provider-liveness'],
    queryFn: async () => {
      const r = await fetch('/api/provider-liveness');
      if (!r.ok) throw new Error(`liveness probe failed: ${r.status}`);
      return r.json();
    },
    refetchInterval: 300_000,
    staleTime: 240_000,
    retry: 1,
  });

  if (isLoading) {
    return (
      <div>
        <h4 className="text-[11px] font-semibold text-[var(--text-faint)] uppercase tracking-wide mb-2.5">
          Registry vs reality
        </h4>
        <p className="text-xs text-[var(--text-faint)]">probing advertised endpoints…</p>
      </div>
    );
  }

  // A probe that could not run must never render as "all healthy".
  if (isError || !data?.data) {
    return (
      <div>
        <h4 className="text-[11px] font-semibold text-[var(--text-faint)] uppercase tracking-wide mb-2.5">
          Registry vs reality
        </h4>
        <p className="text-xs text-[var(--amber)]">
          Probe could not run. This is not evidence that anything is healthy.
        </p>
      </div>
    );
  }

  const s = data.data;
  const allDown = s.registered > 0 && s.serving === 0;
  const partial = s.serving > 0 && s.serving < s.registered;

  return (
    <div>
      <h4 className="text-[11px] font-semibold text-[var(--text-faint)] uppercase tracking-wide mb-2.5">
        Registry vs reality
      </h4>

      <p
        className={`font-mono text-[13px] font-semibold tabular-nums ${
          allDown ? 'text-[var(--red-text)]' : partial ? 'text-[var(--amber)]' : 'text-[var(--green)]'
        }`}
      >
        {s.serving}/{s.registered} answering
      </p>
      <p className="text-[11px] text-[var(--text-faint)] mb-2.5">
        registered on-chain vs endpoints that returned a real <code>eth_chainId</code>
      </p>

      <div className="space-y-2">
        {s.providers.map((p) => (
          <div key={p.address} className="text-xs">
            <div className="flex items-center gap-1.5">
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  p.serving ? 'bg-[var(--green)]' : 'bg-[var(--red-text)]'
                }`}
              />
              <span className="font-mono text-[10px] text-[var(--text-muted)]">
                {shortAddr(p.address)}
              </span>
            </div>
            {p.endpoints.map((e) => (
              <div key={e.endpoint} className="pl-3 text-[10px] text-[var(--text-faint)] truncate">
                <span className="font-mono">{e.endpoint.replace(/^https?:\/\//, '')}</span>
                {' · '}
                <span className={e.status === 'serving' ? 'text-[var(--green)]' : 'text-[var(--amber)]'}>
                  {STATUS_LABEL[e.status]}
                </span>
                {e.status === 'serving' && e.latencyMs !== null ? ` ${e.latencyMs}ms` : ''}
              </div>
            ))}
            {p.endpoints.length === 0 && (
              <div className="pl-3 text-[10px] text-[var(--text-faint)]">no endpoint advertised</div>
            )}
          </div>
        ))}
      </div>

      {s.lying > 0 && (
        <p className="text-[11px] text-[var(--amber)] mt-2.5">
          {s.lying === 1 ? 'One provider is' : `${s.lying} providers are`} registered on-chain while
          advertising {s.lying === 1 ? 'an endpoint' : 'endpoints'} that does not answer. Consumers
          following the registry will fail.
        </p>
      )}
    </div>
  );
}
