'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';

import type { UserResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { useOutboundWarehouses } from '@/lib/use-outbound-orders';
import {
  readActiveWarehouseId,
  subscribeActiveWarehouse,
  writeActiveWarehouseId,
} from '@/lib/warehouses';

import { OutboundOrders } from '@/components/outbound/outbound-orders';
import { OutboundWaves } from '@/components/outbound/outbound-waves';
import { ReadFailure, Section, selectClass } from '@/components/outbound/shell';

/**
 * The Outbound page: orders (story 4.2b) and the waves they group into
 * (story 4.2c), in the order the work happens.
 *
 * This component owns everything the two surfaces share — the session gate,
 * the warehouse read, the warehouse picker, and the signed-in role. Each
 * surface used to resolve all four for itself, which put two pickers on one
 * page that could disagree with each other. There is one picker now, and both
 * surfaces are keyed on the warehouse it resolves, so a switch resets each
 * surface's cursor, filter, expanded row and pending confirmation together.
 */
export function Outbound() {
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
  return <OutboundSessioned />;
}

function OutboundSessioned() {
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
        <ReadFailure
          word="Warehouses unavailable"
          reason={warehouses.reason}
          onRetry={warehouses.reload}
        />
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

  const warehouseLabel = warehouse === undefined ? null : `${warehouse.code} ${warehouse.name}`;

  return (
    <div className="flex flex-col gap-4">
      {items.length > 1 && (
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
      <OutboundOrders
        key={`orders-${warehouseId}`}
        tenantId={tenantId}
        warehouseId={warehouseId}
        warehouseLabel={warehouseLabel}
        role={role}
      />
      <OutboundWaves
        key={`waves-${warehouseId}`}
        tenantId={tenantId}
        warehouseId={warehouseId}
        warehouseLabel={warehouseLabel}
        role={role}
      />
    </div>
  );
}

/** The props both Outbound surfaces take, resolved once by the page. */
export interface OutboundSurfaceProps {
  readonly tenantId: string;
  readonly warehouseId: string;
  /** `CODE Name`, or null when the warehouse row itself is not in hand. */
  readonly warehouseLabel: string | null;
  /** The signed-in role; each surface reads its own capability off it. */
  readonly role: UserResponse['role'] | undefined;
}
