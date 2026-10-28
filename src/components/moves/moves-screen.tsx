'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';

import { readSession, subscribeSession } from '@/lib/auth';
import { warehouseDisplayLabel } from '@/lib/drill';
import { useActiveClient } from '@/lib/use-active-client';
import { useWarehouseBins } from '@/lib/use-inventory';
import { useTenantWarehouses } from '@/lib/use-tenant-warehouses';
import { roleHasCapability } from '@/lib/users';
import { readActiveWarehouseId, subscribeActiveWarehouse } from '@/lib/warehouses';

import { MoveForm } from '@/components/moves/move-form';
import { RecentMoves } from '@/components/moves/recent-moves';
import { ReadFailure, Section } from '@/components/shared/surface';
import { WarehousesFailure, WarehousesRefreshNote } from '@/components/shared/warehouses-failure';

/** Story 3-5b — the Moves page's link to `/moves/counts`. */
export const MOVES_COUNTS_LINK_LABEL = 'Counts and stock takes';

/**
 * Story 3-1 — the Moves page: the move form (for a role holding
 * `stock.move`) and the active warehouse's recent moves (every member reads
 * them). The warehouse is the switcher's pick, else the tenant's first; a
 * switch remounts the form (its draft and key belong to the old warehouse).
 * No nav gate — the recent moves are readable by every role.
 */
export function MovesScreen() {
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );
  if (sessioned === null) return null;
  if (!sessioned) {
    return (
      <Section title="Moves">
        <div className="text-(--muted-foreground)">
          Sign in to move stock —{' '}
          <Link href="/login" className="text-(--primary) underline underline-offset-2">
            go to sign in
          </Link>
          .
        </div>
      </Section>
    );
  }
  return <MovesSessioned />;
}

function MovesSessioned() {
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );
  const active = useActiveClient();
  const warehouses = useTenantWarehouses();
  const tenantId = warehouses.state === 'ready' ? warehouses.data.tenantId : null;
  const items = warehouses.state === 'ready' ? warehouses.data.items : [];
  const activeId = useSyncExternalStore(
    subscribeActiveWarehouse,
    () => (tenantId === null ? null : readActiveWarehouseId(tenantId)),
    () => null,
  );
  const warehouseId = activeId !== null && items.some((w) => w.id === activeId) ? activeId : (items[0]?.id ?? null);
  const bins = useWarehouseBins(warehouseId);

  if (warehouses.state === 'loading') {
    return (
      <Section title="Moves">
        <div className="text-(--muted-foreground)">Loading warehouses…</div>
      </Section>
    );
  }
  if (warehouses.state === 'failed') {
    return (
      <Section title="Moves">
        <WarehousesFailure state={warehouses} />
      </Section>
    );
  }
  if (warehouseId === null) {
    return (
      <Section title="Moves">
        <div className="text-(--muted-foreground)">Create a warehouse first — stock moves between the bins of one warehouse.</div>
      </Section>
    );
  }
  const canMove = roleHasCapability(role, 'stock.move');

  return (
    <div className="flex flex-col gap-4">
      {warehouses.data.refreshFailed !== null && (
        <WarehousesRefreshNote reason={warehouses.data.refreshFailed} onRetry={warehouses.reload} />
      )}
      {canMove && (
        <Section title="Move stock">
          <div className="text-(--muted-foreground)">
            {warehouseDisplayLabel(items, warehouseId)} — move stock from one bin to another. The handheld moves offline the same way.
          </div>
          {bins.state === 'loading' && <div className="text-(--muted-foreground)">Loading bins…</div>}
          {bins.state === 'failed' && <ReadFailure word="Bins unavailable" reason={bins.reason} onRetry={bins.reload} />}
          {bins.state === 'ready' && <MoveForm key={warehouseId} warehouseId={warehouseId} bins={bins.data} active={active} />}
        </Section>
      )}
      <Section title="Recent moves">
        <RecentMoves key={warehouseId} warehouseId={warehouseId} active={active} />
      </Section>
      {/* Story 3-5b (PENDING, 3-5a) — the counts surface lives under Moves. */}
      <Link href="/moves/counts" className="w-fit text-(--primary) underline underline-offset-2">
        {MOVES_COUNTS_LINK_LABEL}
      </Link>
    </div>
  );
}
