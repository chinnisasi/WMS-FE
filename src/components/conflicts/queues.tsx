'use client';

import { useState, useSyncExternalStore } from 'react';

import { OverReceiptQueue } from '@/components/conflicts/over-receipt-queue';
import { ExcursionQueue } from '@/components/conflicts/excursion-queue';
import { RejectedOpsQueue } from '@/components/conflicts/rejected-ops-queue';
import { VarianceQueue } from '@/components/conflicts/variance-queue';
import { AdjustmentPendingsQueue } from '@/components/conflicts/adjustment-pendings-queue';
import { readSession, subscribeSession } from '@/lib/auth';
import type { Capability } from '@/lib/users';
import { roleHasCapability } from '@/lib/users';

/**
 * The Conflicts & Reviews page's queue switcher (story 12-7, UX-DR30): the
 * over-receipt decisions stay put; the temperature-excursion review queue
 * joined them as a sibling; story 5-5 adds the escalated-variance queue and
 * the adjustment-pendings queue. Each queue keeps its own status tabs and
 * its own decision flow — the switcher and the per-tab capability gate are
 * the only things shared.
 *
 * Per-tab capability gating (story 5-5): each tab declares the decision
 * capabilities its queue's actions carry, and the switcher filters the tabs
 * by the session role. A role holding SOME of what a tab needs renders that
 * tab read-only (each queue component gates its own affordances — hide,
 * never block); a role holding NONE of a tab's decision capability never
 * even sees the tab. An unknown role (server render, signed out) sees the
 * full list — the sidebar's unknown-role convention: every queue component
 * renders its own session gate, so an unknown role is a pre-session render,
 * not a leak.
 *
 * The surface-level nav gate stays `review.decide` (navigation.ts,
 * unchanged — owner and ops_manager hold it; the accountant/operator never
 * see the nav item). `adjustments.approve` is owner-only in the mirror (the
 * 5-2 segregation-of-duties rule: the role that raises the adjustment does
 * not hold the approval pen), so the pendings tab is owner's alone. The
 * backend's per-command role read remains the authority everywhere.
 */
const QUEUES: readonly {
  readonly id: Queue;
  readonly label: string;
  readonly capabilities: readonly Capability[];
}[] = [
  { id: 'over-receipts', label: 'Over-receipts', capabilities: ['review.decide'] },
  { id: 'variances', label: 'Variances', capabilities: ['variances.resolve'] },
  {
    id: 'adjustment-pendings',
    label: 'Adjustment pendings',
    capabilities: ['adjustments.approve'],
  },
  { id: 'excursions', label: 'Excursions', capabilities: ['review.decide'] },
  // Story 5-6: the AD-14 quarantine residents' queue — the decisions ride
  // `review.decide` (owner + ops_manager), so the tab is hidden from roles
  // holding none, like the over-receipts and excursions tabs.
  { id: 'rejected-ops', label: 'Rejected ops', capabilities: ['review.decide'] },
];

type Queue = 'over-receipts' | 'variances' | 'adjustment-pendings' | 'excursions' | 'rejected-ops';

export function ConflictsQueues() {
  // Story 1.5 gating pattern: subscribed (not a bare readSession() at
  // render) so a /me bootstrap role rewrite re-renders the tab filtering.
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );
  // An unknown role (undefined) means the session is not readable yet — the
  // full list, like the sidebar's unknown-role rule; a known role filters.
  const visible =
    role === undefined
      ? QUEUES
      : QUEUES.filter((q) =>
          q.capabilities.some((capability) => roleHasCapability(role, capability)),
        );

  const [queue, setQueue] = useState<Queue>('over-receipts');
  // Keyed derivation, not a reset effect: a role rewrite can invalidate the
  // selected tab in the same render.
  const active = visible.some((q) => q.id === queue) ? queue : (visible[0]?.id ?? null);

  return (
    <div className="flex flex-col gap-3">
      {visible.length === 0 ? (
        <div className="rounded-md border border-(--border) p-3 text-sm">
          <div className="font-medium">Conflicts & Reviews</div>
          <div className="text-(--muted-foreground)">
            No review queues are open to your role — queue decisions live with the owner or
            ops manager. Everything your role can read elsewhere stays readable elsewhere.
          </div>
        </div>
      ) : (
        <>
          <div className="flex gap-1 text-xs" role="tablist" aria-label="Conflicts queue">
            {visible.map((q) => (
              <button
                key={q.id}
                type="button"
                role="tab"
                aria-selected={active === q.id}
                onClick={() => setQueue(q.id)}
                className={`rounded-sm border border-(--border) px-3 py-1 ${
                  active === q.id ? 'bg-(--muted) font-medium' : 'hover:bg-(--muted)'
                }`}
              >
                {q.label}
              </button>
            ))}
          </div>
          {active === 'over-receipts' ? (
            <OverReceiptQueue />
          ) : active === 'variances' ? (
            <VarianceQueue />
          ) : active === 'adjustment-pendings' ? (
            <AdjustmentPendingsQueue />
          ) : active === 'rejected-ops' ? (
            <RejectedOpsQueue />
          ) : (
            <ExcursionQueue />
          )}
        </>
      )}
    </div>
  );
}
