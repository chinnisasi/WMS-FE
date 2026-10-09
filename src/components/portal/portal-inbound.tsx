'use client';

import { useState } from 'react';

import type { PortalAsnRowDto, PortalPurchaseOrderRowDto } from '@/lib/api/generated';
import {
  asnStatusLabel,
  lineCountLabel,
  PO_STATUS_LABEL,
  portalDate,
  receivedOfLabel,
  skuLabel,
} from '@/lib/portal';
import { usePortalAsn, usePortalAsns, usePortalPurchaseOrder, usePortalPurchaseOrders } from '@/lib/use-portal';

import { DataTable, expandedRowId, type DataTableColumn } from '@/components/data-table/data-table';
import { ReadFailure, Section, rowButtonClass } from '@/components/outbound/shell';

/**
 * Story 21-7 — the portal's Inbound surface: this company's advance
 * shipment notices and purchase orders, each row expanding to its lines.
 * Read-only (decision 2 — announcing an ASN from the portal is 21-7b).
 */
export function PortalInbound() {
  return (
    <div className="flex flex-col gap-4">
      <AsnsSection />
      <PurchaseOrdersSection />
    </div>
  );
}

function toggleColumn<T extends { id: string }>(openId: string | null, setOpenId: (id: string | null) => void): DataTableColumn<T> {
  return {
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
  };
}

function AsnsSection() {
  const asns = usePortalAsns();
  const [openId, setOpenId] = useState<string | null>(null);
  const columns: readonly DataTableColumn<PortalAsnRowDto>[] = [
    toggleColumn<PortalAsnRowDto>(openId, setOpenId),
    { key: 'code', header: 'Notice', render: (row) => <span className="font-mono">{row.code}</span> },
    { key: 'status', header: 'Status', render: (row) => asnStatusLabel(row.status) },
    { key: 'warehouse', header: 'Warehouse', render: (row) => row.warehouseName },
    { key: 'expected', header: 'Expected', render: (row) => portalDate(row.expectedAt) },
    { key: 'lines', header: 'Lines', numeric: true, render: (row) => lineCountLabel(row.lineCount) },
    { key: 'progress', header: 'Received', numeric: true, render: (row) => receivedOfLabel(row.receivedTotal, row.announcedTotal) },
  ];
  return (
    <Section title="Advance shipment notices">
      {asns.state === 'loading' && <div className="text-(--muted-foreground)">Loading your shipment notices…</div>}
      {asns.state === 'failed' && <ReadFailure word="Notices not loaded" reason={asns.reason} onRetry={asns.reload} />}
      {asns.state === 'ready' && (
        <DataTable<PortalAsnRowDto>
          columns={columns}
          rows={asns.data.items}
          nextCursor={asns.data.nextCursor}
          onCursor={asns.onCursor}
          emptyMessage="No shipment notices for your company yet."
          renderExpanded={(row) => (row.id === openId ? <AsnLines asnId={row.id} /> : null)}
        />
      )}
    </Section>
  );
}

function AsnLines({ asnId }: { asnId: string }) {
  const asn = usePortalAsn(asnId);
  if (asn.state === 'loading') return <div className="text-(--muted-foreground)">Loading lines…</div>;
  if (asn.state === 'failed') return <ReadFailure word="Lines not loaded" reason={asn.reason} onRetry={asn.reload} />;
  return (
    <ul className="flex flex-col gap-1" data-testid="asn-lines">
      {asn.data.lines.map((line, index) => (
        <li key={index}>
          {skuLabel(line)} <span className="data">· {receivedOfLabel(line.receivedQty, line.announcedQty)}</span>
        </li>
      ))}
    </ul>
  );
}

function PurchaseOrdersSection() {
  const pos = usePortalPurchaseOrders();
  const [openId, setOpenId] = useState<string | null>(null);
  const columns: readonly DataTableColumn<PortalPurchaseOrderRowDto>[] = [
    toggleColumn<PortalPurchaseOrderRowDto>(openId, setOpenId),
    { key: 'code', header: 'Purchase order', render: (row) => <span className="font-mono">{row.code}</span> },
    { key: 'status', header: 'Status', render: (row) => PO_STATUS_LABEL[row.status] },
    { key: 'warehouse', header: 'Warehouse', render: (row) => row.warehouseName },
    { key: 'lines', header: 'Lines', numeric: true, render: (row) => lineCountLabel(row.lineCount) },
    { key: 'progress', header: 'Received', numeric: true, render: (row) => receivedOfLabel(row.receivedTotal, row.orderedTotal) },
    { key: 'created', header: 'Raised', render: (row) => portalDate(row.createdAt) },
  ];
  return (
    <Section title="Purchase orders">
      {pos.state === 'loading' && <div className="text-(--muted-foreground)">Loading your purchase orders…</div>}
      {pos.state === 'failed' && <ReadFailure word="Purchase orders not loaded" reason={pos.reason} onRetry={pos.reload} />}
      {pos.state === 'ready' && (
        <DataTable<PortalPurchaseOrderRowDto>
          columns={columns}
          rows={pos.data.items}
          nextCursor={pos.data.nextCursor}
          onCursor={pos.onCursor}
          emptyMessage="No purchase orders for your company yet."
          renderExpanded={(row) => (row.id === openId ? <PoLines poId={row.id} /> : null)}
        />
      )}
    </Section>
  );
}

function PoLines({ poId }: { poId: string }) {
  const po = usePortalPurchaseOrder(poId);
  if (po.state === 'loading') return <div className="text-(--muted-foreground)">Loading lines…</div>;
  if (po.state === 'failed') return <ReadFailure word="Lines not loaded" reason={po.reason} onRetry={po.reload} />;
  return (
    <ul className="flex flex-col gap-1" data-testid="po-lines">
      {po.data.lines.map((line, index) => (
        <li key={index}>
          {skuLabel(line)} <span className="data">· {receivedOfLabel(line.receivedQty, line.orderedQty)}</span>
          {line.expectedDate !== null && <span className="text-(--muted-foreground)"> · expected {portalDate(line.expectedDate)}</span>}
        </li>
      ))}
    </ul>
  );
}
