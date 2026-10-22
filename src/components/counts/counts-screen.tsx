'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';

import { readSession, subscribeSession } from '@/lib/auth';
import { COUNTS_PAGE_TABS, type CountsTab } from '@/lib/page-tabs';
import { useActiveClient } from '@/lib/use-active-client';
import { useOutboundWarehouses } from '@/lib/use-outbound-orders';
import { roleHasCapability } from '@/lib/users';
import { readActiveWarehouseId, subscribeActiveWarehouse, writeActiveWarehouseId } from '@/lib/warehouses';

import { PageTabPanel, PageTabStrip, usePageTab } from '@/components/shared/page-tabs';
import { Section, selectClass } from '@/components/shared/surface';
import { WarehousesFailure, WarehousesRefreshNote } from '@/components/shared/warehouses-failure';

import { CountSchedule } from './count-schedule';
import { CountTasks } from './count-tasks';

/**
 * Story 3-5a — the Counts surface (`/moves/counts`): the count tasks of the
 * active warehouse (list, expandable detail with expected beside counted,
 * and the bulk create) and its ABC schedule. Reads are open to every staff
 * role; the create and the schedule writes need `counts.manage`, and the
 * variance-queue link needs `variances.resolve` — hidden, never "blocked".
 * The handheld counts blind; this is where a supervisor sees the numbers.
 */
export function CountsScreen({ initialTab = null }: { initialTab?: CountsTab | null } = {}) {
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );
  if (sessioned === null) return null;
  if (!sessioned) {
    return (
      <Section title="Counts">
        <div className="text-(--muted-foreground)">
          Sign in to plan and review cycle counts —{' '}
          <Link href="/login" className="text-(--primary) underline underline-offset-2">
            go to sign in
          </Link>
          .
        </div>
      </Section>
    );
  }
  return <CountsSessioned initialTab={initialTab} />;
}

function CountsSessioned({ initialTab }: { initialTab: CountsTab | null }) {
  const [tab, selectTab] = usePageTab(COUNTS_PAGE_TABS, COUNTS_PAGE_TABS.initial(null, initialTab), false);
  const active = useActiveClient();
  const warehouses = useOutboundWarehouses();
  const tenantId = warehouses.state === 'ready' ? warehouses.data.tenantId : null;
  const items = warehouses.state === 'ready' ? warehouses.data.items : [];
  const activeId = useSyncExternalStore(
    subscribeActiveWarehouse,
    () => (tenantId === null ? null : readActiveWarehouseId(tenantId)),
    () => null,
  );
  // Subscribed, so a /me bootstrap role rewrite re-renders the affordances.
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );
  const viewerId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.id ?? null,
    () => null,
  );
  const canManage = roleHasCapability(role, 'counts.manage');
  const canResolve = roleHasCapability(role, 'variances.resolve');

  if (warehouses.state === 'loading') {
    return (
      <Section title="Counts">
        <div className="text-(--muted-foreground)">Loading warehouses…</div>
      </Section>
    );
  }
  if (warehouses.state === 'failed') {
    return (
      <Section title="Counts">
        <WarehousesFailure state={warehouses} />
      </Section>
    );
  }
  const warehouseId =
    activeId !== null && items.some((w) => w.id === activeId) ? activeId : (items[0]?.id ?? null);
  if (tenantId === null || warehouseId === null) {
    return (
      <Section title="Counts">
        <div className="text-(--muted-foreground)">Create a warehouse first — counts are planned per warehouse.</div>
      </Section>
    );
  }
  const refreshNote =
    warehouses.data.refreshFailed !== null ? (
      <WarehousesRefreshNote reason={warehouses.data.refreshFailed} onRetry={warehouses.reload} />
    ) : null;

  return (
    <div className="flex flex-col gap-4">
      {refreshNote}
      {items.length > 1 && (
        <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
          <label className="flex items-center gap-2 text-xs">
            <span className="text-(--muted-foreground)">Warehouse</span>
            <select
              aria-label="Warehouse"
              className={`${selectClass} w-auto py-1`}
              value={warehouseId}
              onChange={(e) => writeActiveWarehouseId(tenantId, e.target.value)}
            >
              {items.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} {w.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <PageTabStrip def={COUNTS_PAGE_TABS} active={tab} drilled={false} onSelect={selectTab} />
      <PageTabPanel def={COUNTS_PAGE_TABS} active={tab}>
        {tab === 'tasks' && (
          <CountTasks
            key={`tasks-${warehouseId}`}
            tenantId={tenantId}
            warehouseId={warehouseId}
            canManage={canManage}
            canResolve={canResolve}
            viewerId={viewerId}
            active={active}
          />
        )}
        {tab === 'schedule' && (
          <CountSchedule key={`schedule-${warehouseId}`} tenantId={tenantId} warehouseId={warehouseId} canManage={canManage} />
        )}
      </PageTabPanel>
    </div>
  );
}
