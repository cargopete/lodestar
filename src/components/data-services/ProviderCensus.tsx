'use client';

import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/Card';
import type { ServiceCensus, ProbeVerdict } from '@/lib/service-census';

/**
 * The provider count for every service, read from chain, published because it is embarrassing.
 *
 * G-1 in the delivery tracker is the top programme risk and it says the quiet part: every service
 * here has a provider list that reads "us", and a data service with one provider is a contract
 * address rather than a market. The tracker kept those counts by hand, and by 30 August the
 * hand-written table said Seahorn had none while its registry held two registrations.
 *
 * The number that matters is not how many registered. It is how many answer.
 */

const VERDICT_LABEL: Record<ProbeVerdict, string> = {
  serving: 'answering',
  paywalled: 'answering (402, as designed)',
  http_error: 'registered, does not answer',
  unreachable: 'registered, host unreachable',
  timeout: 'registered, timed out',
  no_endpoint: 'registered, advertises nothing',
};

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

interface Payload {
  data: {
    services: ServiceCensus[];
    headline: {
      services: number;
      withAnyProvider: number;
      withAnyServing: number;
      registered: number;
      serving: number;
    };
  };
}

export function ProviderCensus() {
  const { data, isLoading, isError } = useQuery<Payload>({
    queryKey: ['service-census'],
    queryFn: async () => {
      const r = await fetch('/api/service-census');
      if (!r.ok) throw new Error(`census failed: ${r.status}`);
      return r.json();
    },
    refetchInterval: 300_000,
    staleTime: 240_000,
    retry: 1,
  });

  if (isLoading || isError || !data) {
    return (
      <Card className="mb-4">
        <h3 className="text-sm font-semibold text-[var(--text)] mb-1">Who is actually serving</h3>
        <p className="text-[12px] text-[var(--text-muted)]">
          {isError
            ? 'The census could not be read, which is not the same as finding nothing. Try again shortly.'
            : 'Reading every registry on Arbitrum One and calling what they advertise…'}
        </p>
      </Card>
    );
  }

  const { services, headline } = data.data;

  return (
    <Card className="mb-4">
      <h3 className="text-sm font-semibold text-[var(--text)] mb-1">Who is actually serving</h3>
      <p className="text-[12px] text-[var(--text-muted)] leading-relaxed mb-3">
        Read from the registries on Arbitrum One, then every advertised endpoint is called.{' '}
        <strong className="text-[var(--text)]">
          {headline.registered} registration{headline.registered === 1 ? '' : 's'} across{' '}
          {headline.withAnyProvider} of {headline.services} services, and {headline.serving}{' '}
          answering.
        </strong>{' '}
        Registered is a promise; answering is evidence. Dispatch held two registrations and zero
        answering endpoints for 39 days without anyone noticing, because everything anyone watched
        was on-chain and on-chain state stayed green throughout.
      </p>

      <div className="space-y-2.5">
        {services.map((s) => (
          <div key={s.id} className="border-t border-[var(--border)] pt-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12px] text-[var(--text)]">{s.name}</span>
              <span
                className="text-[11px] font-mono tabular-nums"
                style={{
                  color: s.error
                    ? 'var(--text-faint)'
                    : s.serving > 0
                      ? 'var(--green)'
                      : s.registered > 0
                        ? 'var(--amber)'
                        : 'var(--text-faint)',
                }}
              >
                {s.error ? 'not read' : `${s.serving}/${s.registered} answering`}
              </span>
            </div>

            {/* Nobody has registered is a different sentence from registered and not answering.
                The first is a service nobody has tried; the second is a registry telling
                consumers to call something that is not there. */}
            {!s.error && s.registered === 0 && (
              <p className="text-[11px] text-[var(--text-faint)] mt-0.5">
                Nobody has registered. The contract is live and untried, which is an opening rather
                than a fault.
              </p>
            )}

            {s.providers.map((p) => (
              <div
                key={`${p.address}-${p.endpoint}`}
                className="flex items-baseline justify-between gap-3 mt-1"
              >
                <span className="text-[11px] font-mono text-[var(--text-faint)]">
                  {short(p.address)}
                </span>
                <span className="text-[11px] text-[var(--text-muted)] text-right break-all">
                  {VERDICT_LABEL[p.verdict]}
                  {p.httpStatus !== null && p.verdict === 'http_error' ? ` (${p.httpStatus})` : ''}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      <p className="text-[11px] text-[var(--text-faint)] mt-3 pt-2 border-t border-[var(--border)]">
        Services without a registry of this shape are not listed, because saying &ldquo;0
        providers&rdquo; about a service nobody asked would be a measurement we did not take.
      </p>
    </Card>
  );
}
