'use client';

import { useState } from 'react';

import type { ConsignmentExceptionRowDto, ConsignmentWorklistRowDto } from '@/lib/api/generated';
import { istDateTimeLabel } from '@/lib/audit-exports';
import {
  COMPLIANCE_EXCEPTION_WORD,
  CONSIGNMENT_STAGE_WORD,
  gateChip,
  orderAgeWords,
  requiredBecauseWords,
} from '@/lib/consignment';
import { orderTypeLabel } from '@/lib/order-fields';
import { orderLabel } from '@/lib/orders';
import { useActiveClient } from '@/lib/use-active-client';
import { useConsignmentWorklist, type ConsignmentWorklistView } from '@/lib/use-consignment';
import { useOrderDetail } from '@/lib/use-outbound-orders';
import { roleHasCapability } from '@/lib/users';

import { DataTable, expandedRowId, type DataTableColumn } from '@/components/data-table/data-table';
import { FeedbackBanner } from '@/components/feedback/banner';
import { ConsignmentPanel } from '@/components/outbound/consignment-panel';
import type { OutboundSurfaceProps } from '@/components/outbound/outbound';
import { ReadFailure, rowButtonClass, Section } from '@/components/outbound/shell';
import { ClientFilterChip } from '@/components/shared/client-filter-chip';
import { EmptyState } from '@/components/shared/empty-state';
import { StatusChip } from '@/components/shared/status-chip';

type NeededRow = ConsignmentWorklistRowDto & { readonly id: string };
type ExceptionRow = ConsignmentExceptionRowDto & { readonly id: string };

const VIEW_LABEL: Readonly<Record<ConsignmentWorklistView, string>> = {
  needed: 'Needed',
  exceptions: 'Left without documents',
};

/**
 * Story 4-6a (A16, A24, A37, A43) — the Documents tab (`/outbound?tab=documents`):
 * the active warehouse's open client orders whose brand documents are
 * missing, owed or expiring (packed first), and the parcels a handheld
 * handed over without them. Honours the shell's client switcher. A row's
 * Record expands the order's Tax documents panel with the form open.
 */
export function ConsignmentsCard({ warehouseId, warehouseLabel, role }: OutboundSurfaceProps) {
  // Record opens the form: shown only to a role that can record (dispatch.execute); every role reads.
  const canRecord = roleHasCapability(role, 'dispatch.execute');
  const active = useActiveClient();
  const [view, setView] = useState<ConsignmentWorklistView>('needed');
  const worklist = useConsignmentWorklist(warehouseId, active.filter, view);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [nowMs] = useState(() => Date.now());

  const toggle = (id: string, label: string) => (
    <button
      type="button"
      aria-expanded={expandedId === id}
      aria-controls={expandedId === id ? expandedRowId(id) : undefined}
      onClick={() => setExpandedId((open) => (open === id ? null : id))}
      className="flex items-center gap-2 text-left underline-offset-2 hover:underline"
    >
      <span aria-hidden className="text-(--muted-foreground)">
        {expandedId === id ? '▾' : '▸'}
      </span>
      <span className="font-mono text-xs">{label}</span>
    </button>
  );

  const neededColumns: readonly DataTableColumn<NeededRow>[] = [
    { key: 'order', header: 'Order', render: (row) => toggle(row.id, row.orderLabel) },
    { key: 'client', header: 'Client', render: (row) => row.clientCode },
    { key: 'type', header: 'Type', priority: 3, render: (row) => orderTypeLabel(row.orderType) },
    { key: 'stage', header: 'Stage', render: (row) => CONSIGNMENT_STAGE_WORD[row.stage] },
    {
      key: 'needed',
      header: 'Needed',
      render: (row) => {
        const chip = gateChip(row.state, row.state === 'ready');
        return (
          <span className="flex flex-col items-start gap-0.5">
            {chip !== null && (
              <StatusChip tone={chip.tone} data-testid="worklist-needed">
                {chip.word}
              </StatusChip>
            )}
            {row.declaredBelowRatedValue && <span className="text-[11px] text-(--warning)">⚠ Declared below the order’s value</span>}
          </span>
        );
      },
    },
    { key: 'why', header: 'Why', priority: 2, render: (row) => <span data-testid="worklist-why">{requiredBecauseWords(row.requiredBecause, row.valueFloorPaise)}</span> },
    { key: 'age', header: 'Age', priority: 2, render: (row) => <time dateTime={row.createdAt}>{orderAgeWords(row.createdAt, nowMs)}</time> },
    ...(canRecord
      ? [
          {
            key: 'action',
            header: '',
            render: (row: NeededRow) => (
              <button type="button" className={rowButtonClass} onClick={() => setExpandedId(row.id)} data-testid="worklist-record">
                Record
              </button>
            ),
          } satisfies DataTableColumn<NeededRow>,
        ]
      : []),
  ];

  const exceptionColumns: readonly DataTableColumn<ExceptionRow>[] = [
    { key: 'order', header: 'Order', render: (row) => toggle(row.id, row.orderLabel) },
    { key: 'client', header: 'Client', render: (row) => row.clientCode },
    {
      key: 'handover',
      header: 'Handover / truck',
      // Story 4-9a (A20) — a truck consignment's row names its load instead of a handover.
      render: (row) => <span className="font-mono text-xs">{row.freight?.loadCode ?? row.handoverCode ?? '—'}</span>,
    },
    {
      key: 'left',
      header: 'Left (IST)',
      render: (row) => {
        const left = row.freight?.dispatchedAt ?? row.handedOverAt;
        return left === null ? '—' : <time dateTime={left}>{istDateTimeLabel(left)}</time>;
      },
    },
    {
      key: 'flag',
      header: 'Left without',
      render: (row) => (
        <StatusChip tone="danger" data-testid="worklist-exception">
          {COMPLIANCE_EXCEPTION_WORD[row.code]}
        </StatusChip>
      ),
    },
  ];

  const data = worklist.state === 'ready' ? worklist.data : null;

  return (
    <Section title="Documents">
      <div className="text-(--muted-foreground)">
        {warehouseLabel === null ? 'The brand’s documents.' : `${warehouseLabel} — client orders that cannot leave until the brand’s invoice or e-way bill is recorded.`}
      </div>
      <div role="tablist" aria-label="Documents views" className="flex gap-2">
        {(Object.keys(VIEW_LABEL) as ConsignmentWorklistView[]).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            className={`${rowButtonClass} ${view === id ? 'bg-(--muted) font-medium' : ''}`}
            onClick={() => {
              setView(id);
              setExpandedId(null);
            }}
            data-testid={`documents-view-${id}`}
          >
            {VIEW_LABEL[id]}
          </button>
        ))}
      </div>
      <ClientFilterChip active={active} tenantName={active.tenantName} />
      {data !== null && data.truncated && (
        <FeedbackBanner
          tone="warning"
          {...(view === 'needed'
            ? { word: 'Showing the first 5,000 open orders', reason: 'Packed orders are listed first; record these, then refresh for the rest.' }
            : { word: 'Showing the newest 500 parcels left without documents', reason: 'Record their documents to clear them, then refresh for older ones.' })}
        />
      )}
      {worklist.state === 'failed' ? (
        <ReadFailure word="Documents worklist unavailable" reason={worklist.reason} onRetry={worklist.reload} />
      ) : view === 'needed' ? (
        <DataTable<NeededRow>
          key={`needed-${String(active.filter)}`}
          columns={neededColumns}
          rows={data === null ? [] : data.needed.map((row) => ({ ...row, id: row.orderId }))}
          renderExpanded={(row) => (expandedId === row.id ? <WorklistOrderPanel orderId={row.orderId} clientCode={row.clientCode} defaultOpen /> : null)}
          emptyMessage={<EmptyState kind="cleared">No open order is waiting for the brand’s documents.</EmptyState>}
          loading={worklist.state === 'loading' ? 'Loading the orders waiting for documents…' : undefined}
        />
      ) : (
        <DataTable<ExceptionRow>
          key={`exceptions-${String(active.filter)}`}
          columns={exceptionColumns}
          rows={data === null ? [] : data.exceptions.map((row) => ({ ...row, id: row.shipmentId ?? row.freight?.consignmentId ?? row.orderId }))}
          renderExpanded={(row) => (expandedId === row.id ? <WorklistOrderPanel orderId={row.orderId} clientCode={row.clientCode} defaultOpen={false} /> : null)}
          emptyMessage={<EmptyState kind="cleared">No parcel left without the brand’s documents.</EmptyState>}
          loading={worklist.state === 'loading' ? 'Loading the parcels that left without documents…' : undefined}
        />
      )}
    </Section>
  );
}

/** A worklist row's panel: the order's live status and creation day come from its own detail read. */
function WorklistOrderPanel({ orderId, clientCode, defaultOpen }: { orderId: string; clientCode: string; defaultOpen: boolean }) {
  const detail = useOrderDetail(orderId);
  if (detail.state === 'loading') return <div className="text-xs text-(--muted-foreground)">Loading the order…</div>;
  if (detail.state === 'failed') return <ReadFailure word="Order unavailable" reason={detail.reason} onRetry={detail.reload} />;
  const order = detail.data;
  return (
    <ConsignmentPanel
      orderId={order.id}
      orderLabel={orderLabel(order)}
      status={order.status}
      createdAt={order.createdAt}
      clientCode={clientCode}
      defaultOpen={defaultOpen && (order.status === 'accepted' || order.status === 'ready_to_dispatch')}
    />
  );
}
