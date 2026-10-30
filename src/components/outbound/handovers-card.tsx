'use client';

import { useState } from 'react';

import type { HandoverListItemDto, HandoverResponse } from '@/lib/api/generated';
import { istDateTimeLabel } from '@/lib/audit-exports';
import { handoverOutcome, sheetCell } from '@/lib/shipping';
import { useActiveClient } from '@/lib/use-active-client';
import { useHandovers } from '@/lib/use-shipping';
import { roleHasCapability } from '@/lib/users';

import { DataTable, expandedRowId, type DataTableColumn } from '@/components/data-table/data-table';
import { FeedbackBanner } from '@/components/feedback/banner';
import { HandoverBuilder } from '@/components/outbound/handover-builder';
import { HandoverDetail } from '@/components/outbound/handover-sheet';
import type { OutboundSurfaceProps } from '@/components/outbound/outbound';
import { primaryClass, ReadFailure, Section } from '@/components/outbound/shell';
import { ClientFilterChip } from '@/components/shared/client-filter-chip';
import { StatusChip } from '@/components/shared/status-chip';

/**
 * Story 4-4a (A20) — the Handovers tab (`/outbound?tab=handovers`): the
 * warehouse's courier handovers, newest first, filtered by the active client;
 * a row expands into its printable sheet and the signed-sheet upload. "New
 * handover" (`dispatch.execute`, hidden without it) opens the builder.
 */
export function HandoversCard({ tenantId, warehouseId, warehouseLabel, role }: OutboundSurfaceProps) {
  const canDispatch = roleHasCapability(role, 'dispatch.execute');
  const canRemove = roleHasCapability(role, 'orders.manage');
  const active = useActiveClient();
  const handovers = useHandovers(warehouseId, active.filter);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [created, setCreated] = useState<HandoverResponse | null>(null);
  const [pageEpoch, setPageEpoch] = useState(0);

  const columns: readonly DataTableColumn<HandoverListItemDto>[] = [
    {
      key: 'code',
      header: 'Handover',
      render: (row) => (
        <button
          type="button"
          aria-expanded={expandedId === row.id}
          aria-controls={expandedId === row.id ? expandedRowId(row.id) : undefined}
          onClick={() => setExpandedId((id) => (id === row.id ? null : row.id))}
          className="flex items-center gap-2 text-left underline-offset-2 hover:underline"
        >
          <span aria-hidden className="text-(--muted-foreground)">
            {expandedId === row.id ? '▾' : '▸'}
          </span>
          <span className="font-mono text-xs">{row.code}</span>
        </button>
      ),
    },
    { key: 'client', header: 'Client', render: (row) => row.clientCode ?? '—' },
    { key: 'courier', header: 'Courier', render: (row) => row.courierName },
    { key: 'parcels', header: 'Parcels', numeric: true, render: (row) => `${row.shipmentCount} · ${row.packageCount} pcs` },
    {
      key: 'handedOverAt',
      header: 'Picked up (IST)',
      render: (row) => <time dateTime={row.handedOverAt}>{istDateTimeLabel(row.handedOverAt)}</time>,
    },
    {
      key: 'sheet',
      header: 'Signed sheet',
      render: (row) => {
        const cell = sheetCell(row.sheetPageCount);
        return <StatusChip tone={cell.tone}>{cell.word}</StatusChip>;
      },
    },
  ];

  return (
    <Section title="Handovers">
      <div className="text-(--muted-foreground)">
        {warehouseLabel === null ? 'Courier handovers.' : `${warehouseLabel} — each handover is one courier collecting one client’s parcels; it dispatches them.`}
      </div>
      {canDispatch && (
        <div>
          <button type="button" className={primaryClass} onClick={() => setBuilding(true)} disabled={building} data-testid="new-handover">
            New handover
          </button>
        </div>
      )}
      {created !== null && <FeedbackBanner tone="accepted" {...handoverOutcome(created)} />}
      {building && (
        <HandoverBuilder
          tenantId={tenantId}
          warehouseId={warehouseId}
          initialClientId={active.filter !== null && typeof active.filter === 'string' ? active.filter : null}
          initialOrderId={null}
          onClose={() => setBuilding(false)}
          onCreated={(response) => {
            setBuilding(false);
            setCreated(response);
            handovers.onCursor(null);
            setPageEpoch((e) => e + 1);
            if (response.handover !== null) setExpandedId(response.handover.id);
          }}
        />
      )}
      <ClientFilterChip active={active} tenantName={active.tenantName} />
      {handovers.state === 'failed' ? (
        <ReadFailure word="Handovers unavailable" reason={handovers.reason} onRetry={handovers.reload} />
      ) : (
        <DataTable<HandoverListItemDto>
          key={pageEpoch}
          columns={columns}
          rows={handovers.state === 'ready' ? handovers.data.items : []}
          nextCursor={handovers.state === 'ready' ? handovers.data.nextCursor : null}
          onCursor={handovers.onCursor}
          renderExpanded={(row) =>
            expandedId === row.id ? <HandoverDetail tenantId={tenantId} handoverId={row.id} canDispatch={canDispatch} canRemove={canRemove} /> : null
          }
          emptyMessage="No handovers yet — hand packed parcels over to a courier from here or from Pack & Dispatch."
          loading={handovers.state === 'loading' ? 'Loading handovers…' : undefined}
        />
      )}
    </Section>
  );
}
