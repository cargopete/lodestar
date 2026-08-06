'use client';

import { Badge } from './Badge';
import type { DelegationStatus } from '@/lib/rewards';

/**
 * Renders a delegation position's status as a coloured badge.
 * "Withdrawable" (thaw complete) is distinguished from "Thawing" (in progress)
 * so delegators can spot positions ready to withdraw at a glance.
 */
export function DelegationStatusBadge({ status }: { status: DelegationStatus }) {
  switch (status) {
    case 'withdrawable':
      return <Badge variant="accent" title="Thawing complete, ready to withdraw">Withdrawable</Badge>;
    case 'thawing':
      return <Badge variant="warning">Thawing</Badge>;
    case 'active':
      return <Badge variant="success">Active</Badge>;
    case 'closed':
    default:
      return <Badge variant="default">Closed</Badge>;
  }
}
