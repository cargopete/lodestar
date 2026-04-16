import { HorizonActivity } from '@/components/ui/HorizonActivity';

export const metadata = {
  title: 'Horizon Activity | Lodestar',
  description: 'Live Horizon staking events on The Graph — delegations, provisions, slashing and more.',
};

export default function HorizonPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-[22px] font-semibold text-[var(--text)] tracking-tight">Horizon</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Real-time staking activity from The Graph&apos;s Horizon contract — who&apos;s staking, delegating, and getting slashed.
        </p>
      </div>

      <HorizonActivity />
    </div>
  );
}
