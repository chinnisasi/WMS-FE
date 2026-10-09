'use client';

import { useState } from 'react';

import type { PortalOrderRowDto } from '@/lib/api/generated';
import {
  lineCountLabel,
  orderDestination,
  orderReference,
  orderStatusLabel,
  portalDate,
  portalQuantity,
  skuLabel,
} from '@/lib/portal';
import { usePortalOrder, usePortalOrders } from '@/lib/use-portal';

import { DataTable, expandedRowId, type DataTableColumn } from '@/components/data-table/data-table';
import { ReadFailure, Section, rowButtonClass } from '@/components/outbound/shell';

/**
 * Story 21-7 — the portal's Orders surface: this company's orders, newest
 * first; a row expands to its lines, a kit's components nested beneath it.
 */
export function PortalOrders() {
  const orders = usePortalOrders(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const columns: readonly DataTableColumn<PortalOrderRowDto>[] = [
    {
      key: 'toggle',
      header: '',
      render: (row) => (
        <button
          type="button"
          className={rowButtonClass}
          aria-expanded={openId === row.id}
          aria-controls={expandedRowId(row.id)}
          onClick={() => setOpenId(openId === row.id ? null : row.id)}
        >
          {openId === row.id ? 'Hide' : 'Lines'}
        </button>
      ),
    },
    { key: 'ref', header: 'Reference', render: (row) => orderReference(row) },
    { key: 'status', header: 'Status', render: (row) => orderStatusLabel(row.status) },
    { key: 'warehouse', header: 'Warehouse', render: (row) => row.warehouseName },
    { key: 'destination', header: 'Destination', render: (row) => orderDestination(row) },
    { key: 'lines', header: 'Lines', numeric: true, render: (row) => lineCountLabel(row.lineCount) },
    { key: 'created', header: 'Placed', render: (row) => portalDate(row.createdAt) },
  ];

  return (
    <Section title="Orders">
      {orders.state === 'loading' && <div className="text-(--muted-foreground)">Loading your orders…</div>}
      {orders.state === 'failed' && <ReadFailure word="Orders not loaded" reason={orders.reason} onRetry={orders.reload} />}
      {orders.state === 'ready' && (
        <DataTable<PortalOrderRowDto>
          columns={columns}
          rows={orders.data.items}
          nextCursor={orders.data.nextCursor}
          onCursor={orders.onCursor}
          emptyMessage="No orders for your company yet."
          renderExpanded={(row) => (row.id === openId ? <OrderLines orderId={row.id} /> : null)}
        />
      )}
    </Section>
  );
}

function OrderLines({ orderId }: { orderId: string }) {
  const order = usePortalOrder(orderId);
  if (order.state === 'loading') return <div className="text-(--muted-foreground)">Loading lines…</div>;
  if (order.state === 'failed') return <ReadFailure word="Lines not loaded" reason={order.reason} onRetry={order.reload} />;
  return (
    <ul className="flex flex-col gap-1" data-testid="order-lines">
      {order.data.lines.map((line, index) => (
        <li key={index}>
          <span>{skuLabel(line)}</span> <span className="data">× {portalQuantity(line.qty)}</span>
          {line.components.length > 0 && (
            <ul className="ml-6 flex flex-col gap-0.5 text-(--muted-foreground)" data-testid="kit-components">
              {line.components.map((component, inner) => (
                <li key={inner}>
                  {skuLabel(component)} <span className="data">× {portalQuantity(component.qty)}</span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
