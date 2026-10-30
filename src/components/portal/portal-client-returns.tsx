'use client';

import { useState } from 'react';

import type { PortalClientReturnRowDto } from '@/lib/api/generated';
import {
  PORTAL_CLIENT_RETURN_CONDITION_LABEL,
  PORTAL_CLIENT_RETURN_SOURCE_LABEL,
  lineCountLabel,
  portalClientReturnCarrier,
  portalClientReturnQuantity,
  portalClientReturnStatusLabel,
  portalClientReturnTone,
  portalConsigneeState,
  portalDate,
  portalQuantity,
} from '@/lib/portal';
import { usePortalClientReturn, usePortalClientReturns } from '@/lib/use-portal';

import { DataTable, expandedRowId, type DataTableColumn } from '@/components/data-table/data-table';
import { StatusChip } from '@/components/shared/status-chip';
import { ReadFailure, rowButtonClass, Section } from '@/components/shared/surface';

/**
 * Story 4-7c (decision 15, A14) — the portal's "Shipments back to you": the
 * client's returns to client, newest first — customer returns and damaged
 * stock the warehouse is sending home. Draft and picked read "Being
 * prepared", dispatched "Shipped", cancelled "Cancelled". A row expands to
 * where it goes, the brand document, the carrier, the AWB and the lines.
 * Read only: no print, no write; the response is the server's allowlist —
 * never a user, a device, a bin, a note or a cancel reason.
 */
export function PortalClientReturns() {
  const shipments = usePortalClientReturns();
  const [openId, setOpenId] = useState<string | null>(null);
  const columns: readonly DataTableColumn<PortalClientReturnRowDto>[] = [
    {
      key: 'toggle',
      header: '',
      render: (row) => (
        <button
          type="button"
          className={rowButtonClass}
          aria-expanded={openId === row.id}
          aria-controls={expandedRowId(row.id)}
          aria-label={`${openId === row.id ? 'Hide' : 'Show'} the details of ${row.code}`}
          onClick={() => setOpenId(openId === row.id ? null : row.id)}
        >
          {openId === row.id ? 'Hide' : 'Details'}
        </button>
      ),
    },
    { key: 'code', header: 'Shipment', render: (row) => <span className="font-mono">{row.code}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <StatusChip tone={portalClientReturnTone(row.status)} data-testid={`portal-rtc-status-${row.code}`}>
          {portalClientReturnStatusLabel(row.status)}
        </StatusChip>
      ),
    },
    { key: 'lines', header: 'Lines', numeric: true, render: (row) => lineCountLabel(row.lineCount) },
    { key: 'units', header: 'Units', numeric: true, render: (row) => portalClientReturnQuantity(row) },
    { key: 'carrier', header: 'Carrier', render: (row) => portalClientReturnCarrier(row) },
    { key: 'awb', header: 'AWB / LR', render: (row) => <span className="font-mono text-xs">{row.trackingRef ?? '—'}</span> },
    { key: 'packages', header: 'Packages', numeric: true, render: (row) => (row.packageCount === null ? '—' : portalQuantity(row.packageCount)) },
    { key: 'when', header: 'Shipped', render: (row) => (row.dispatchedAt === null ? '—' : portalDate(row.dispatchedAt)) },
  ];
  return (
    <Section title="Shipments back to you">
      <div className="max-w-3xl text-(--muted-foreground)">
        Customer returns and damaged stock the warehouse is sending back to you, newest first — with the carrier, the AWB and the
        packages once shipped.
      </div>
      {shipments.state === 'loading' && <div className="text-(--muted-foreground)">Loading your return shipments…</div>}
      {shipments.state === 'failed' && <ReadFailure word="Return shipments not loaded" reason={shipments.reason} onRetry={shipments.reload} />}
      {shipments.state === 'ready' && (
        <DataTable<PortalClientReturnRowDto>
          columns={columns}
          rows={shipments.data.items}
          nextCursor={shipments.data.nextCursor}
          onCursor={shipments.onCursor}
          emptyMessage="Nothing is being sent back to you."
          renderExpanded={(row) => (row.id === openId ? <ClientReturnDetail clientReturnId={row.id} /> : null)}
        />
      )}
    </Section>
  );
}

function ClientReturnDetail({ clientReturnId }: { clientReturnId: string }) {
  const rtc = usePortalClientReturn(clientReturnId);
  if (rtc.state === 'loading') return <div className="text-(--muted-foreground)">Loading the shipment…</div>;
  if (rtc.state === 'failed') return <ReadFailure word="Shipment not loaded" reason={rtc.reason} onRetry={rtc.reload} />;
  const data = rtc.data;
  const address = data.consigneeAddress;
  const place = [address.city, portalConsigneeState(address), address.pincode].filter((part) => part !== null && part !== '').join(', ');
  return (
    <div className="flex flex-col gap-3 py-1 text-xs" data-testid="portal-client-return-detail">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5">
        <dt className="text-(--muted-foreground)">Going to</dt>
        <dd>
          {[address.contactName, address.line1, address.line2, place].filter((part) => part !== null && part !== '').join(', ')}
          {' '}
          <span className="text-(--muted-foreground)">({address.kind === 'return' ? 'your return address' : 'your registered address'})</span>
        </dd>
        {data.brandDocument !== null && (
          <>
            <dt className="text-(--muted-foreground)">Your document</dt>
            <dd>
              {data.brandDocument.type === 'challan' ? 'Delivery challan' : 'Tax invoice'} <span className="font-mono">{data.brandDocument.number}</span> ·{' '}
              {portalDate(data.brandDocument.date)}
            </dd>
          </>
        )}
        {data.ewayBillNumber !== null && (
          <>
            <dt className="text-(--muted-foreground)">E-way bill</dt>
            <dd className="font-mono">{data.ewayBillNumber}</dd>
          </>
        )}
        <dt className="text-(--muted-foreground)">Carrier</dt>
        <dd>
          {portalClientReturnCarrier(data)}
          {data.vehicleNumber === null ? '' : ` · vehicle ${data.vehicleNumber}`}
        </dd>
        <dt className="text-(--muted-foreground)">AWB / LR</dt>
        <dd className="font-mono">{data.trackingRef ?? '—'}</dd>
        <dt className="text-(--muted-foreground)">Packages</dt>
        <dd>{data.packageCount === null ? '—' : portalQuantity(data.packageCount)}</dd>
      </dl>
      <ul className="flex flex-col gap-1">
        {data.lines.map((line) => (
          <li key={line.lineNo} data-testid="portal-client-return-line">
            <span className="font-mono">{line.skuCode}</span> — {line.skuName}{' '}
            <span className="data">
              · {line.shippedQuantity === null ? portalQuantity(line.quantity) : `${portalQuantity(line.shippedQuantity)} of ${portalQuantity(line.quantity)} shipped`}{' '}
              {line.uom}
            </span>
            <span className="text-(--muted-foreground)">
              {' '}
              · {PORTAL_CLIENT_RETURN_SOURCE_LABEL[line.source] ?? line.source}
              {line.rmaCode === null ? '' : ` ${line.rmaCode}`}
              {line.condition === null ? '' : ` · ${PORTAL_CLIENT_RETURN_CONDITION_LABEL[line.condition] ?? line.condition}`}
              {line.batchCode === null ? '' : ` · batch ${line.batchCode}`}
              {line.serialNumber === null ? '' : ` · serial ${line.serialNumber}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
