'use client';

import type { PortalStockRowDto } from '@/lib/api/generated';
import { quantityWithUom } from '@/lib/portal';
import { usePortalTenantId, usePortalStock } from '@/lib/use-portal';

import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { ReadFailure, Section } from '@/components/shared/surface';

type StockRow = PortalStockRowDto & { id: string };

const COLUMNS: readonly DataTableColumn<StockRow>[] = [
  { key: 'sku', header: 'SKU', render: (row) => <span className="font-mono">{row.skuCode}</span> },
  { key: 'name', header: 'Product', render: (row) => row.skuName },
  { key: 'warehouse', header: 'Warehouse', render: (row) => row.warehouseName },
  { key: 'onHand', header: 'On hand', numeric: true, render: (row) => quantityWithUom(row.onHand, row.baseUom) },
  { key: 'allocated', header: 'Allocated to orders', numeric: true, render: (row) => quantityWithUom(row.allocated, row.baseUom) },
];

/**
 * Story 21-7 — the portal's Stock surface: one row per (SKU, warehouse) —
 * on hand across the whole warehouse, and what open orders hold. Never a
 * bin: where the goods sit is the warehouse's business.
 */
export function PortalStock() {
  const stock = usePortalStock();
  const tenantId = usePortalTenantId();
  return (
    <Section title="Stock">
      {/* Story UI-2 (A1) — ONE table across every page load, so its cursor
          stack survives and Prev returns to the previous page; a failure
          shows above it and the table is kept (hidden), so Retry keeps Prev. */}
      {stock.state === 'failed' && <ReadFailure word="Stock not loaded" reason={stock.reason} onRetry={stock.reload} />}
      <div hidden={stock.state === 'failed'}>
        <DataTable<StockRow>
          key={tenantId ?? 'none'}
          columns={COLUMNS}
          rows={(stock.state === 'ready' ? stock.data.items : []).map((row) => ({ ...row, id: `${row.skuId}:${row.warehouseId}` }))}
          nextCursor={stock.state === 'ready' ? stock.data.nextCursor : null}
          onCursor={stock.onCursor}
          emptyMessage={<EmptyState kind="first-use">No stock in the warehouse for your company yet.</EmptyState>}
          loading={stock.state === 'loading' ? 'Loading your stock…' : undefined}
        />
      </div>
    </Section>
  );
}
