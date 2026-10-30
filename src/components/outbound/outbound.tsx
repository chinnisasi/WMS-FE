'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';

import type { UserResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { drillFor, warehouseDisplayLabel, type ParsedDrill } from '@/lib/drill';
import { OUTBOUND_PAGE_TABS, type OutboundTab } from '@/lib/page-tabs';
import { useOutboundWarehouses } from '@/lib/use-outbound-orders';
import {
  readActiveWarehouseId,
  subscribeActiveWarehouse,
  writeActiveWarehouseId,
} from '@/lib/warehouses';

import { OutboundOrders } from '@/components/outbound/outbound-orders';
import { OutboundWaves } from '@/components/outbound/outbound-waves';
import { HandoversCard } from '@/components/outbound/handovers-card';
import { OutboundPackDispatch } from '@/components/outbound/pack-dispatch';
import { Section, selectClass } from '@/components/outbound/shell';
import { PageTabPanel, PageTabStrip, usePageTab } from '@/components/shared/page-tabs';
import { WarehousesFailure, WarehousesRefreshNote } from '@/components/shared/warehouses-failure';

/**
 * The Outbound page: orders (story 4.2b), the waves they group into (story
 * 4.2c) and the pack & dispatch pipeline that finishes them (story 4.2d), in
 * the order the work happens.
 *
 * This component owns everything the three surfaces share — the session gate,
 * the warehouse read, the warehouse picker, and the signed-in role. Each
 * surface used to resolve all four for itself, which put two pickers on one
 * page that could disagree with each other. There is one picker now, and every
 * surface is keyed on the warehouse it resolves, so a switch resets each
 * surface's cursor, filter, expanded row and pending confirmation together.
 *
 * Story 9-1b — an Overview drill (`list=orders`) drills the ORDERS section
 * only: it lists the drill's warehouse (named in the link, never written to
 * the active warehouse) under a banner, and the warehouse picker is hidden —
 * it writes the active warehouse. Waves and pack & dispatch render normally
 * for the active warehouse.
 *
 * page-tabs (2026-10-17) — the three sections sit behind a tab bar under the
 * picker (Orders · Waves · Pack & Dispatch, `?tab=`), one mounted at a time.
 * A drill opens on the Orders tab; another tab leaves the drill.
 */
export function Outbound({
  drill = null,
  initialTab = null,
  initialReference = null,
  focusNewOrder = false,
}: {
  drill?: ParsedDrill;
  initialTab?: OutboundTab | null;
  /** Story UI-2 — ⌘K "Find order" (`?ref=`), already parsed; ignored under a drill. */
  initialReference?: string | null;
  /** Story UI-2 — ⌘K "Create order" (`?new=order`). */
  focusNewOrder?: boolean;
} = {}) {
  // `null` = unknown (server render) → render nothing, no hydration mismatch.
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );

  if (sessioned === null) return null;
  if (!sessioned) {
    return (
      <Section title="Outbound">
        <div className="text-(--muted-foreground)">
          Sign in to review outbound orders and waves —{' '}
          <Link href="/login" className="text-(--primary) underline underline-offset-2">
            go to sign in
          </Link>
          .
        </div>
      </Section>
    );
  }
  return <OutboundSessioned drill={drill} initialTab={initialTab} initialReference={initialReference} focusNewOrder={focusNewOrder} />;
}

function OutboundSessioned({
  drill,
  initialTab,
  initialReference,
  focusNewOrder,
}: {
  drill: ParsedDrill;
  initialTab: OutboundTab | null;
  initialReference: string | null;
  focusNewOrder: boolean;
}) {
  const ordersDrill = drillFor(drill, 'orders');
  const [tab, selectTab] = usePageTab(OUTBOUND_PAGE_TABS, OUTBOUND_PAGE_TABS.initial(drill, initialTab), ordersDrill !== null);
  const warehouses = useOutboundWarehouses();
  const tenantId = warehouses.state === 'ready' ? warehouses.data.tenantId : null;
  const items = warehouses.state === 'ready' ? warehouses.data.items : [];
  const activeId = useSyncExternalStore(
    subscribeActiveWarehouse,
    () => (tenantId === null ? null : readActiveWarehouseId(tenantId)),
    () => null,
  );
  // Story 1.5 gating pattern: subscribed (not a bare readSession() at render)
  // so a /me bootstrap role rewrite re-renders the affordances.
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );

  if (warehouses.state === 'loading') {
    return (
      <Section title="Outbound">
        <div className="text-(--muted-foreground)">Loading warehouses…</div>
      </Section>
    );
  }
  if (warehouses.state === 'failed') {
    return (
      <Section title="Outbound">
        <WarehousesFailure state={warehouses} />
      </Section>
    );
  }

  // The warehouse both surfaces read: the sidebar switcher's pick when it
  // still belongs to this tenant, else the tenant's first warehouse.
  const warehouseId =
    activeId !== null && items.some((w) => w.id === activeId) ? activeId : (items[0]?.id ?? null);
  const warehouse = items.find((w) => w.id === warehouseId);

  if (tenantId === null || warehouseId === null) {
    return (
      <Section title="Outbound">
        <div className="text-(--muted-foreground)">
          Create a warehouse first — orders are raised against one, and waves group them.
        </div>
      </Section>
    );
  }

  // Decision 3 (21-11b): a failed refresh keeps the last-good list, with one line.
  const refreshNote =
    warehouses.state === 'ready' && warehouses.data.refreshFailed !== null ? (
      <WarehousesRefreshNote reason={warehouses.data.refreshFailed} onRetry={warehouses.reload} />
    ) : null;
  const warehouseLabel = warehouse === undefined ? null : `${warehouse.code} ${warehouse.name}`;
  // The drilled orders section reads the DRILL's warehouse, never the active one.
  const ordersWarehouseId = ordersDrill === null ? warehouseId : ordersDrill.warehouseId;
  const ordersWarehouseLabel = ordersDrill === null ? warehouseLabel : warehouseDisplayLabel(items, ordersWarehouseId);

  return (
    <div className="flex flex-col gap-4">
      {refreshNote}
      {items.length > 1 && ordersDrill === null && (
        <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
          <label className="flex items-center gap-2 text-xs">
            <span className="text-(--muted-foreground)">Warehouse</span>
            <select
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
      <PageTabStrip def={OUTBOUND_PAGE_TABS} active={tab} drilled={ordersDrill !== null} onSelect={selectTab} />
      <PageTabPanel def={OUTBOUND_PAGE_TABS} active={tab}>
        {tab === 'orders' && (
          <OutboundOrders
            key={`orders-${ordersWarehouseId}`}
            tenantId={tenantId}
            warehouseId={ordersWarehouseId}
            warehouseLabel={ordersWarehouseLabel}
            role={role}
            drill={ordersDrill}
            initialReference={ordersDrill === null ? initialReference : null}
            focusNewOrder={ordersDrill === null && focusNewOrder}
          />
        )}
        {tab === 'waves' && (
          <OutboundWaves
            key={`waves-${warehouseId}`}
            tenantId={tenantId}
            warehouseId={warehouseId}
            warehouseLabel={warehouseLabel}
            role={role}
          />
        )}
        {tab === 'pack' && (
          <OutboundPackDispatch
            key={`pack-${warehouseId}`}
            tenantId={tenantId}
            warehouseId={warehouseId}
            warehouseLabel={warehouseLabel}
            role={role}
          />
        )}
        {tab === 'handovers' && (
          <HandoversCard
            key={`handovers-${warehouseId}`}
            tenantId={tenantId}
            warehouseId={warehouseId}
            warehouseLabel={warehouseLabel}
            role={role}
          />
        )}
      </PageTabPanel>
    </div>
  );
}

/** The props the Outbound surfaces take, resolved once by the page. */
export interface OutboundSurfaceProps {
  readonly tenantId: string;
  readonly warehouseId: string;
  /** `CODE Name`, or null when the warehouse row itself is not in hand. */
  readonly warehouseLabel: string | null;
  /** The signed-in role; each surface reads its own capability off it. */
  readonly role: UserResponse['role'] | undefined;
}
