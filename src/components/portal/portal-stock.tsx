'use client';

import type { PortalStockRowDto } from '@/lib/api/generated';
import { quantityWithUom } from '@/lib/portal';
import { usePortalStock } from '@/lib/use-portal';

import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { ReadFailure, Section } from '@/components/outbound/shell';

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
  return (
    <Section title="Stock">
      {stock.state === 'loading' && <div className="text-(--muted-foreground)">Loading your stock…</div>}
      {stock.state === 'failed' && <ReadFailure word="Stock not loaded" reason={stock.reason} onRetry={stock.reload} />}
      {stock.state === 'ready' && (
        <DataTable<StockRow>
          columns={COLUMNS}
          rows={stock.data.items.map((row) => ({ ...row, id: `${row.skuId}:${row.warehouseId}` }))}
          nextCursor={stock.data.nextCursor}
          onCursor={stock.onCursor}
          emptyMessage="No stock in the warehouse for your company yet."
        />
      )}
    </Section>
  );
}
