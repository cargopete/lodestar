'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useDataServices, useServiceProvisions, useGRTPrice } from '@/hooks/useNetworkStats';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { StatCard, StatGrid } from '@/components/ui/StatCard';
import { weiToGRT, formatGRT, formatUSD, shortenAddress, resolveIndexerName, cn } from '@/lib/utils';
import type { DataService, ProvisionWithIndexer } from '@/lib/queries';

export default function ServicesPage() {
  const { data: servicesData, isLoading } = useDataServices();
  const { data: priceData } = useGRTPrice();
  const [selectedService, setSelectedService] = useState<string | null>(null);

  const grtPrice = priceData?.price ?? 0;
  const services = servicesData?.dataServices ?? [];

  // Calculate totals
  const totalProvisioned = services.reduce(
    (sum, s) => sum + weiToGRT(s.tokensProvisioned),
    0
  );
  const totalAllocated = services.reduce(
    (sum, s) => sum + weiToGRT(s.tokensAllocated),
    0
  );
  const totalIndexers = services.reduce((sum, s) => sum + s.provisionCount, 0);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Overview stats */}
      <StatGrid>
        <StatCard
          label="Active Services"
          value={String(services.length)}
          delta={{ value: 'Horizon multi-service', positive: true }}
        />
        <StatCard
          label="Total Provisioned"
          value={`${formatGRT(totalProvisioned)} GRT`}
          delta={{ value: formatUSD(totalProvisioned * grtPrice), positive: true }}
        />
        <StatCard
          label="Total Allocated"
          value={`${formatGRT(totalAllocated)} GRT`}
          delta={{
            value: `${((totalAllocated / totalProvisioned) * 100).toFixed(1)}% utilization`,
            positive: true,
          }}
        />
        <StatCard
          label="Service Providers"
          value={String(totalIndexers)}
          delta={{ value: 'unique provisions', positive: true }}
        />
      </StatGrid>

      {/* Services list */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {services.map((service) => (
          <ServiceCard
            key={service.id}
            service={service}
            grtPrice={grtPrice}
            isSelected={selectedService === service.id}
            onSelect={() =>
              setSelectedService(selectedService === service.id ? null : service.id)
            }
          />
        ))}
      </div>

      {/* Selected service details */}
      {selectedService && (
        <ServiceProvisionsPanel serviceId={selectedService} grtPrice={grtPrice} />
      )}

      {/* Info panel */}
      <Card>
        <CardHeader>
          <CardTitle>About Horizon Data Services</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-semibold text-[var(--text)] mb-2">What are Data Services?</h4>
              <p className="text-sm text-[var(--text-muted)]">
                In Graph Horizon, indexers can provision their stake to multiple data
                services rather than a single global pool. Each service (like Subgraph
                Service or Substreams) has its own parameters for thawing periods,
                verifier cuts, and slashing conditions.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-[var(--text)] mb-2">For Delegators</h4>
              <p className="text-sm text-[var(--text-muted)]">
                Your delegation supports an indexer across all services they provision
                to. The indexer&apos;s total stake (self + delegated) determines their
                capacity, but they can allocate that capacity across different services
                based on demand and opportunity.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface ServiceCardProps {
  service: DataService;
  grtPrice: number;
  isSelected: boolean;
  onSelect: () => void;
}

function ServiceCard({ service, grtPrice, isSelected, onSelect }: ServiceCardProps) {
  const provisioned = weiToGRT(service.tokensProvisioned);
  const allocated = weiToGRT(service.tokensAllocated);
  const utilization = provisioned > 0 ? (allocated / provisioned) * 100 : 0;
  const thawingDays = Math.round(service.thawingPeriod / 86400);

  return (
    <Card
      className={cn(
        'cursor-pointer transition-all',
        isSelected && 'ring-2 ring-[var(--accent)]'
      )}
      onClick={onSelect}
    >
      <CardContent className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-[var(--text)]">
              {service.metadata?.name || shortenAddress(service.id)}
            </h3>
            {service.metadata?.description && (
              <p className="text-sm text-[var(--text-muted)] mt-1">
                {service.metadata.description}
              </p>
            )}
          </div>
          <Badge variant={service.provisionCount > 50 ? 'success' : 'default'}>
            {service.provisionCount} indexers
          </Badge>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <p className="text-xs text-[var(--text-faint)]">Total Provisioned</p>
            <p className="text-lg font-mono font-semibold text-[var(--text)]">
              {formatGRT(provisioned)}
            </p>
            <p className="text-xs text-[var(--text-faint)]">
              {formatUSD(provisioned * grtPrice)}
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--text-faint)]">Allocated</p>
            <p className="text-lg font-mono font-semibold text-[var(--green)]">
              {formatGRT(allocated)}
            </p>
            <p className="text-xs text-[var(--text-faint)]">
              {formatUSD(allocated * grtPrice)}
            </p>
          </div>
        </div>

        {/* Utilization bar */}
        <div className="mb-4">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-[var(--text-faint)]">Utilization</span>
            <span className="text-[var(--text-muted)]">{utilization.toFixed(1)}%</span>
          </div>
          <ProgressBar
            value={utilization}
            max={100}
            variant={utilization > 80 ? 'orange' : 'teal'}
            size="sm"
          />
        </div>

        {/* Parameters */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="p-2 rounded bg-[var(--bg-elevated)]">
            <p className="text-xs text-[var(--text-faint)]">Thaw Period</p>
            <p className="text-sm font-mono text-[var(--text)]">{thawingDays}d</p>
          </div>
          <div className="p-2 rounded bg-[var(--bg-elevated)]">
            <p className="text-xs text-[var(--text-faint)]">Max Verifier Cut</p>
            <p className="text-sm font-mono text-[var(--text)]">
              {(service.maxVerifierCut / 10000).toFixed(0)}%
            </p>
          </div>
          <div className="p-2 rounded bg-[var(--bg-elevated)]">
            <p className="text-xs text-[var(--text-faint)]">Allocations</p>
            <p className="text-sm font-mono text-[var(--text)]">{service.allocationCount}</p>
          </div>
        </div>

        {/* Expand indicator */}
        <div className="mt-4 text-center">
          <span className="text-xs text-[var(--accent)]">
            {isSelected ? 'Click to collapse' : 'Click to view indexers'}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

interface ServiceProvisionsPanelProps {
  serviceId: string;
  grtPrice: number;
}

function ServiceProvisionsPanel({ serviceId, grtPrice }: ServiceProvisionsPanelProps) {
  const { data, isLoading } = useServiceProvisions(serviceId);
  const provisions = data?.provisions ?? [];

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Service Providers</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-[var(--bg-elevated)]" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Service Providers</CardTitle>
          <Badge variant="default">{provisions.length} indexers</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="px-4 py-2 text-left text-xs font-medium text-[var(--text-muted)] uppercase">
                  Indexer
                </th>
                <th className="px-4 py-2 text-right text-xs font-medium text-[var(--text-muted)] uppercase">
                  Provisioned
                </th>
                <th className="px-4 py-2 text-right text-xs font-medium text-[var(--text-muted)] uppercase">
                  Thawing
                </th>
                <th className="px-4 py-2 text-right text-xs font-medium text-[var(--text-muted)] uppercase">
                  Verifier Cut
                </th>
                <th className="px-4 py-2 text-right text-xs font-medium text-[var(--text-muted)] uppercase">
                  Total Stake
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {provisions.map((provision) => {
                const tokens = weiToGRT(provision.tokens);
                const thawing = weiToGRT(provision.tokensThawing);
                const selfStake = weiToGRT(provision.indexer.stakedTokens);
                const delegated = weiToGRT(provision.indexer.delegatedTokens);
                const totalStake = selfStake + delegated;
                const indexerName = resolveIndexerName(provision.indexer.account, provision.indexer.id);

                return (
                  <tr key={provision.id} className="hover:bg-[var(--bg-elevated)]">
                    <td className="px-4 py-3">
                      <Link
                        href={`/indexers/${provision.indexer.id}`}
                        className="hover:text-[var(--accent)]"
                      >
                        <p className="font-medium text-[var(--text)]">{indexerName}</p>
                        <p className="text-xs text-[var(--text-faint)] font-mono">
                          {shortenAddress(provision.indexer.id)}
                        </p>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p className="font-mono text-[var(--text)]">{formatGRT(tokens)} GRT</p>
                      <p className="text-xs text-[var(--text-faint)]">
                        {formatUSD(tokens * grtPrice)}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p
                        className={cn(
                          'font-mono',
                          thawing > 0 ? 'text-[var(--amber)]' : 'text-[var(--text-faint)]'
                        )}
                      >
                        {thawing > 0 ? formatGRT(thawing) : '-'}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p className="font-mono text-[var(--text)]">
                        {(provision.maxVerifierCut / 10000).toFixed(1)}%
                      </p>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p className="font-mono text-[var(--text)]">{formatGRT(totalStake)}</p>
                      <p className="text-xs text-[var(--green)]">
                        +{formatGRT(delegated)} delegated
                      </p>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
