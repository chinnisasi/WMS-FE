'use client';

import { useSyncExternalStore } from 'react';

import { readActiveWarehouseId, subscribeActiveWarehouse } from '@/lib/warehouses';
import { readSession, subscribeSession } from '@/lib/auth';
import { useTenantWarehouses } from '@/lib/use-tenant-warehouses';
import {
  useGoodsReceipts,
  usePurchaseOrders,
  useSkuMap,
  useVendorMap,
  type PurchaseOrderHeader,
} from '@/lib/use-inbound';
import type { GoodsReceiptEntryDto, PurchaseOrderLineDto } from '@/lib/api/generated';

import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';

/**
 * The Inbound surface (stories 3.1 / 3.3) — the review half of receiving:
 * the active warehouse's purchase orders (code, vendor, per-line
 * ordered/received/open, status) and its goods receipt notes (code, PO
 * reference or blind flag + reason, lines, units, recorded time). Reads only
 * — the mobile device records receipts; the web surface reviews them.
 *
 * Warehouse scoping follows the sidebar switcher's pick (per-viewer, like
 * zone-bin-setup), falling back to the tenant's first warehouse.
 */

/** Blind reason codes are a fixed backend enum — surfaced in plain words. */
const BLIND_REASON_LABEL: Record<GoodsReceiptEntryDto['blindReasonCode'], string> = {
  'unannounced-delivery': 'Unannounced delivery',
  'po-not-found': 'PO not found',
  other: 'Other',
};

export function InboundCards() {
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );

  if (sessioned === null) return null;
  if (!sessioned) {
    return (
      <div className="rounded-md border border-(--border) p-3 text-sm">
        <div className="font-medium">Inbound</div>
        <div className="text-(--muted-foreground)">Sign in to review inbound work.</div>
      </div>
    );
  }
  return <InboundCardsSessioned />;
}

function InboundCardsSessioned() {
  const { tenantId, items: warehouses } = useTenantWarehouses() ?? {
    tenantId: null,
    items: [] as readonly never[],
  };
  const activeId = useSyncExternalStore(
    subscribeActiveWarehouse,
    () => (tenantId === null ? null : readActiveWarehouseId(tenantId)),
    () => null,
  );
  // The warehouse under review: the switcher's pick when it still belongs to
  // this tenant, else the tenant's first warehouse.
  const warehouseId =
    activeId !== null && warehouses.some((w) => w.id === activeId)
      ? activeId
      : (warehouses[0]?.id ?? null);
  const warehouse = warehouses.find((w) => w.id === warehouseId);

  return (
    <div className="flex flex-col gap-4">
      <PurchaseOrdersCard warehouseId={warehouseId} warehouseLabel={warehouse?.name ?? warehouse?.code ?? null} />
      <GoodsReceiptsCard warehouseId={warehouseId} warehouseLabel={warehouse?.name ?? warehouse?.code ?? null} />
    </div>
  );
}

/** The active warehouse's purchase orders, headers plus per-line quantities. */
function PurchaseOrdersCard({
  warehouseId,
  warehouseLabel,
}: {
  warehouseId: string | null;
  warehouseLabel: string | null;
}) {
  const pos = usePurchaseOrders(warehouseId);
  const vendors = useVendorMap();
  const skus = useSkuMap();

  const columns: readonly DataTableColumn<PurchaseOrderHeader>[] = [
    { key: 'code', header: 'PO code', render: (po) => <span className="font-mono text-xs">{po.code}</span> },
    {
      key: 'vendor',
      header: 'Vendor',
      render: (po) => vendors?.[po.vendorId]?.name ?? '—',
    },
    {
      key: 'lines',
      header: 'Lines (ordered · received · open)',
      render: (po) => {
        const lines = pos?.lines[po.id];
        if (lines === undefined || lines.length === 0) return <span>—</span>;
        return (
          <div className="flex flex-col gap-1 py-1">
            {lines.map((line) => (
              <PoLineRow key={line.id} line={line} skuCode={skus?.[line.skuId]?.code ?? null} />
            ))}
          </div>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (po) => (
        <span
          className={
            po.status === 'open'
              ? 'rounded-sm bg-(--muted) px-1.5 py-0.5 text-xs'
              : 'rounded-sm bg-(--muted) px-1.5 py-0.5 text-xs text-(--muted-foreground)'
          }
        >
          {po.status === 'open' ? 'Open' : 'Closed'}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: 'Created',
      render: (po) => <time dateTime={po.createdAt}>{new Date(po.createdAt).toLocaleString()}</time>,
    },
  ];

  return (
    <section className="flex flex-col gap-3 rounded-md border border-(--border) p-3 text-sm">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-medium">Purchase orders</h2>
        <div className="text-(--muted-foreground)">
          {warehouseLabel === null
            ? 'Pick a warehouse to review its purchase orders.'
            : `${warehouseLabel} — newest first. Open quantities are derived (ordered − received).`}
        </div>
      </div>

      <DataTable<PurchaseOrderHeader>
        columns={columns}
        rows={pos?.items ?? []}
        nextCursor={pos?.nextCursor ?? null}
        onCursor={pos?.onCursor}
        emptyMessage={
          warehouseId === null ? 'Create a warehouse first.' : 'No purchase orders yet.'
        }
      />
    </section>
  );
}

/** One PO line: `SKU 100 ord · 40 rec · 60 open` (negative open = over-received). */
function PoLineRow({ line, skuCode }: { line: PurchaseOrderLineDto; skuCode: string | null }) {
  const open = line.openQty < 0 ? `${line.openQty} (over-received)` : String(line.openQty);
  return (
    <div className="flex flex-wrap items-center gap-x-2 text-xs">
      <span className="font-mono">{skuCode ?? '(unknown SKU)'}</span>
      <span className="text-(--muted-foreground)">
        {line.orderedQty} ord · {line.receivedQty} rec · {open} open
      </span>
      {line.status !== 'open' && <span className="text-(--muted-foreground)">[{line.status}]</span>}
    </div>
  );
}

/** The warehouse's goods receipt notes, blind receipts flagged for PO-matching. */
function GoodsReceiptsCard({
  warehouseId,
  warehouseLabel,
}: {
  warehouseId: string | null;
  warehouseLabel: string | null;
}) {
  const grns = useGoodsReceipts(warehouseId);

  const columns: readonly DataTableColumn<GoodsReceiptEntryDto>[] = [
    { key: 'code', header: 'GRN code', render: (grn) => <span className="font-mono text-xs">{grn.code}</span> },
    {
      key: 'po',
      header: 'PO',
      render: (grn) => {
        if (grn.poId === null) {
          return (
            <span className="rounded-sm bg-(--muted) px-1.5 py-0.5 text-xs">
              Blind · {BLIND_REASON_LABEL[grn.blindReasonCode]}
            </span>
          );
        }
        const code = grns?.poCodes[grn.poId];
        return code === undefined ? <span>—</span> : <span className="font-mono text-xs">{code}</span>;
      },
    },
    { key: 'lineCount', header: 'Lines', numeric: true },
    {
      key: 'units',
      header: 'Units',
      numeric: true,
      render: (grn) =>
        grn.appliedUnits === grn.totalUnits ? (
          String(grn.totalUnits)
        ) : (
          // The excess is pending an over-receipt decision (Conflicts & Reviews).
          <span>
            {grn.appliedUnits}{' '}
            <span className="text-(--muted-foreground)">
              (+{grn.totalUnits - grn.appliedUnits} pending)
            </span>
          </span>
        ),
    },
    {
      key: 'recordedAt',
      header: 'Recorded',
      render: (grn) => <time dateTime={grn.recordedAt}>{new Date(grn.recordedAt).toLocaleString()}</time>,
    },
  ];

  return (
    <section className="flex flex-col gap-3 rounded-md border border-(--border) p-3 text-sm">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-medium">Goods receipt notes</h2>
        <div className="text-(--muted-foreground)">
          {warehouseLabel === null
            ? 'Pick a warehouse to review its receipts.'
            : `${warehouseLabel} — newest first. Blind receipts are flagged for PO-matching; "(+N pending)" units wait on an over-receipt decision.`}
        </div>
      </div>

      <DataTable<GoodsReceiptEntryDto>
        columns={columns}
        rows={grns?.items ?? []}
        nextCursor={grns?.nextCursor ?? null}
        onCursor={grns?.onCursor}
        emptyMessage={warehouseId === null ? 'Create a warehouse first.' : 'No receipts recorded yet.'}
      />
    </section>
  );
}