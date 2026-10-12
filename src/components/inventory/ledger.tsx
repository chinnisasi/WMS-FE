'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';

import type { LedgerEventDto } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import {
  drillFor,
  ledgerDocName,
  ledgerDrillDocument,
  ledgerTypeLabel,
  warehouseDisplayLabel,
  type LedgerDrill,
  type ParsedDrill,
} from '@/lib/drill';
import {
  ledgerArmLabel,
  ledgerBinsLabel,
  ledgerQuantityLabel,
  ledgerRecordedLabel,
  ledgerReferenceLabel,
  shortId,
} from '@/lib/ledger';
import { useBinCodeMap, useSkuMap, useUserMap } from '@/lib/use-inbound';
import { useLedgerEvents } from '@/lib/use-ledger';
import { useTenantWarehouses } from '@/lib/use-tenant-warehouses';
import { readActiveWarehouseId, subscribeActiveWarehouse } from '@/lib/warehouses';

import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { DrillBanner } from '@/components/shared/drill-banner';
import { ReadFailure, Section } from '@/components/shared/surface';
import { WarehousesFailure, WarehousesRefreshNote } from '@/components/shared/warehouses-failure';

/**
 * The Ledger page (story 9-1b, `/inventory/ledger`) — one warehouse's ledger
 * timeline, newest first, Prev/Next on the keyset cursor. It is where the
 * Overview's ledger drills land (put-away, picked, dispatched).
 *
 * Without a drill it shows the active warehouse's recent events; with one,
 * the drill's warehouse and exactly the drill's filter (server-side), under
 * the banner — the active warehouse is never written. Read-only: the ledger
 * is append-only, and nothing on this page mutates.
 */
export function Ledger({ drill = null }: { drill?: ParsedDrill } = {}) {
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );
  if (sessioned === null) return null;
  if (!sessioned) {
    return (
      <Section title="Ledger">
        <div className="text-(--muted-foreground)">
          Sign in to read the ledger —{' '}
          <Link href="/login" className="text-(--primary) underline underline-offset-2">
            go to sign in
          </Link>
          .
        </div>
      </Section>
    );
  }
  return <LedgerSessioned drill={drillFor(drill, 'ledger')} />;
}

function LedgerSessioned({ drill }: { drill: LedgerDrill | null }) {
  const warehouses = useTenantWarehouses();
  const tenantId = warehouses.state === 'ready' ? warehouses.data.tenantId : null;
  const items = warehouses.state === 'ready' ? warehouses.data.items : [];
  const activeId = useSyncExternalStore(
    subscribeActiveWarehouse,
    () => (tenantId === null ? null : readActiveWarehouseId(tenantId)),
    () => null,
  );

  // Drilled: the drill's warehouse, whatever the active warehouse or the
  // warehouses read says — the drill names its warehouse itself.
  if (drill !== null) {
    const label = warehouseDisplayLabel(warehouses.state === 'ready' ? items : null, drill.warehouseId);
    // Story 9-3a — a document drill ("View ledger") names its document; the
    // dashboard's drills keep their wording.
    const document = ledgerDrillDocument(drill);
    return (
      <Section title="Ledger">
        <DrillBanner drill={drill} />
        <div className="text-(--muted-foreground)">
          {document === null
            ? `${label} — the dashboard figure's ledger events, newest first.`
            : document.doc === 'po'
              ? `${label} — the receipt events of ${ledgerDocName(document)}, newest first (its putaways name their GRN).`
              : `${label} — the ledger events of ${ledgerDocName(document)}, newest first.`}
        </div>
        <LedgerTable key={drill.warehouseId} warehouseId={drill.warehouseId} drill={drill} />
      </Section>
    );
  }

  if (warehouses.state === 'loading') {
    return (
      <Section title="Ledger">
        <div className="text-(--muted-foreground)">Loading warehouses…</div>
      </Section>
    );
  }
  if (warehouses.state === 'failed') {
    return (
      <Section title="Ledger">
        <WarehousesFailure state={warehouses} />
      </Section>
    );
  }

  const activeWarehouseId =
    activeId !== null && items.some((w) => w.id === activeId) ? activeId : (items[0]?.id ?? null);
  if (activeWarehouseId === null) {
    return (
      <Section title="Ledger">
        <div className="text-(--muted-foreground)">Create a warehouse first — the ledger is kept per warehouse.</div>
      </Section>
    );
  }
  const warehouseId = activeWarehouseId;
  const warehouseLabel = warehouseDisplayLabel(items, warehouseId);

  return (
    <Section title="Ledger">
      {warehouses.data.refreshFailed !== null && (
        <WarehousesRefreshNote reason={warehouses.data.refreshFailed} onRetry={warehouses.reload} />
      )}
      <div className="text-(--muted-foreground)">
        {warehouseLabel} — every stock movement, newest first. The ledger is append-only: a correction is a new event.
      </div>
      <LedgerTable key={warehouseId} warehouseId={warehouseId} drill={null} />
    </Section>
  );
}

function LedgerTable({ warehouseId, drill }: { warehouseId: string; drill: LedgerDrill | null }) {
  const events = useLedgerEvents(warehouseId, drill);
  const skus = useSkuMap();
  const bins = useBinCodeMap(warehouseId);
  const users = useUserMap();

  const columns: readonly DataTableColumn<LedgerEventDto>[] = [
    {
      key: 'recordedAt',
      header: 'Recorded (IST)',
      render: (event) => <time dateTime={event.recordedAt}>{ledgerRecordedLabel(event.recordedAt)}</time>,
    },
    { key: 'type', header: 'Type', render: (event) => ledgerTypeLabel(event.type) },
    {
      key: 'sku',
      header: 'SKU',
      render: (event) => <span className="font-mono text-xs">{skus?.[event.skuId]?.code ?? shortId(event.skuId)}</span>,
    },
    {
      key: 'quantity',
      header: 'Quantity',
      numeric: true,
      render: (event) => ledgerQuantityLabel(event.quantityDelta, skus?.[event.skuId] ?? null),
    },
    {
      key: 'bins',
      header: 'From → to',
      render: (event) => <span className="font-mono text-xs">{ledgerBinsLabel(event, bins)}</span>,
    },
    {
      key: 'arm',
      header: 'Batch / serial',
      render: (event) => <span className="font-mono text-xs">{ledgerArmLabel(event)}</span>,
    },
    {
      key: 'actor',
      header: 'Actor',
      render: (event) => (
        <span className="text-xs">{users?.[event.actorUserId]?.email ?? shortId(event.actorUserId)}</span>
      ),
    },
    {
      key: 'reference',
      header: 'Reference',
      render: (event) => <span className="text-xs">{ledgerReferenceLabel(event.referenceDoc)}</span>,
    },
  ];

  if (events.state === 'failed') {
    return <ReadFailure word="Ledger unavailable" reason={events.reason} onRetry={events.reload} />;
  }
  return (
    // Mounted while a page loads: its Prev/Next cursor is internal state.
    <DataTable<LedgerEventDto>
      columns={columns}
      rows={events.state === 'ready' ? events.data.items : []}
      nextCursor={events.state === 'ready' ? events.data.nextCursor : null}
      onCursor={events.onCursor}
      emptyMessage={
        events.state === 'loading'
          ? 'Loading the ledger…'
          : drill !== null
            ? ledgerDrillEmptyMessage(drill)
            : 'No ledger events in this warehouse yet.'
      }
    />
  );
}

/** The drilled table's empty line: the dashboard's, or the document's own (story 9-3a). */
function ledgerDrillEmptyMessage(drill: LedgerDrill): string {
  const document = ledgerDrillDocument(drill);
  return document === null ? 'No ledger events match this figure.' : `No ledger events for ${ledgerDocName(document)} yet.`;
}
