'use client';

import { useState } from 'react';

import type { PortalReturnRowDto } from '@/lib/api/generated';
import {
  PORTAL_RETURN_FILTER_LABEL,
  PORTAL_RETURN_REASON_LABEL,
  PORTAL_RETURN_STATUS_LABEL,
  lineCountLabel,
  portalDate,
  portalDispositionSummary,
  portalDispositionText,
  portalInstantIst,
  portalQuantity,
  portalReturnDecisionState,
  portalReturnOrder,
  portalReturnOriginText,
  receivedOfLabel,
  type PortalReturnFilter,
} from '@/lib/portal';
import { usePortalReturn, usePortalReturns } from '@/lib/use-portal';

import { DataTable, expandedRowId, type DataTableColumn } from '@/components/data-table/data-table';
import { PortalClientReturns } from '@/components/portal/portal-client-returns';
import { ReadFailure, rowButtonClass, Section, selectClass } from '@/components/shared/surface';

const FILTERS: readonly PortalReturnFilter[] = ['all', 'awaiting', 'dispositioned'];

/** Word-first decision chip on the existing tokens (amber to look at, green settled). */
function DecisionChip({ totals }: { totals: Parameters<typeof portalReturnDecisionState>[0] }) {
  const state = portalReturnDecisionState(totals);
  if (state === null) return <span className="text-(--muted-foreground)">—</span>;
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-xs text-(--foreground) ${
        state.tone === 'warning' ? 'border-(--warning) bg-(--warning)/10' : 'border-(--accent) bg-(--accent)/10'
      }`}
    >
      {state.word}
    </span>
  );
}

/**
 * Story 4-7a — the portal's Returns surface: this company's returns, newest
 * first, with what the warehouse decided for every unit that came back —
 * restocked, held for inspection, failed inspection, scrapped, or still
 * awaiting a decision. A filter narrows to returns still awaiting a decision
 * or fully decided (server-side, `dispositionState`). A row expands to its
 * lines (authorized, received, the customer's reason and the split) and the
 * decisions, oldest first, with their reasons and times. Read only; the
 * response is the server's allowlist — never a bin, a user, a note or a hold.
 */
export function PortalReturns() {
  const [filter, setFilter] = useState<PortalReturnFilter>('all');
  const returns = usePortalReturns(filter);
  const [openId, setOpenId] = useState<string | null>(null);
  const columns: readonly DataTableColumn<PortalReturnRowDto>[] = [
    {
      key: 'toggle',
      header: '',
      render: (row) => (
        <button
          type="button"
          className={rowButtonClass}
          aria-expanded={openId === row.id}
          aria-controls={expandedRowId(row.id)}
          aria-label={`${openId === row.id ? 'Hide' : 'Show'} the lines of ${row.code}`}
          onClick={() => setOpenId(openId === row.id ? null : row.id)}
        >
          {openId === row.id ? 'Hide' : 'Lines'}
        </button>
      ),
    },
    {
      key: 'code',
      header: 'Return',
      render: (row) => (
        <div className="flex flex-col">
          <span className="font-mono">{row.code}</span>
          {row.externalReference !== null && <span className="text-xs text-(--muted-foreground)">{row.externalReference}</span>}
          {/* Story 4-7b — an accepted unannounced return says so, with its parcel reference. */}
          {portalReturnOriginText(row) !== null && (
            <span className="text-xs text-(--muted-foreground)" data-testid="portal-return-origin">
              {portalReturnOriginText(row)}
            </span>
          )}
        </div>
      ),
    },
    { key: 'order', header: 'Order', render: (row) => portalReturnOrder(row) },
    { key: 'status', header: 'Status', render: (row) => PORTAL_RETURN_STATUS_LABEL[row.status] ?? row.status },
    { key: 'lines', header: 'Lines', numeric: true, render: (row) => lineCountLabel(row.lineCount) },
    { key: 'received', header: 'Received', numeric: true, render: (row) => portalQuantity(row.receivedTotal) },
    { key: 'outcome', header: 'What happened', render: (row) => <span className="text-xs">{portalDispositionSummary(row)}</span> },
    { key: 'decision', header: 'Decision', render: (row) => <DecisionChip totals={row} /> },
    { key: 'created', header: 'Raised', render: (row) => portalDate(row.createdAt) },
  ];
  return (
    <div className="flex flex-col gap-4">
      <Section title="Returns">
        <div className="max-w-3xl text-(--muted-foreground)">
          Your customers&apos; returns, newest first — and what the warehouse decided for each unit once it was back: restocked to
          sell again, held for inspection, or scrapped.
        </div>
        <label className="flex w-fit flex-col gap-1">
          <span className="text-xs text-(--muted-foreground)">Show</span>
          <select
            aria-label="Show"
            className={`${selectClass} w-auto py-1`}
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value as PortalReturnFilter);
              setOpenId(null);
            }}
          >
            {FILTERS.map((option) => (
              <option key={option} value={option}>
                {PORTAL_RETURN_FILTER_LABEL[option]}
              </option>
            ))}
          </select>
        </label>
        {returns.state === 'loading' && <div className="text-(--muted-foreground)">Loading your returns…</div>}
        {returns.state === 'failed' && <ReadFailure word="Returns not loaded" reason={returns.reason} onRetry={returns.reload} />}
        {returns.state === 'ready' && (
          <DataTable<PortalReturnRowDto>
            key={filter}
            columns={columns}
            rows={returns.data.items}
            nextCursor={returns.data.nextCursor}
            onCursor={returns.onCursor}
            emptyMessage={
              filter === 'all'
                ? 'No returns for your company yet.'
                : filter === 'awaiting'
                  ? 'Nothing is awaiting a decision — every returned unit has been decided.'
                  : 'No fully decided returns yet.'
            }
            renderExpanded={(row) => (row.id === openId ? <ReturnDetail rmaId={row.id} /> : null)}
          />
        )}
      </Section>
      {/* Story 4-7c — the client's shipments back to it (returns to client), read only. */}
      <PortalClientReturns />
    </div>
  );
}

function ReturnDetail({ rmaId }: { rmaId: string }) {
  const rma = usePortalReturn(rmaId);
  if (rma.state === 'loading') return <div className="text-(--muted-foreground)">Loading lines…</div>;
  if (rma.state === 'failed') return <ReadFailure word="Lines not loaded" reason={rma.reason} onRetry={rma.reload} />;
  return (
    <div className="flex flex-col gap-3 py-1" data-testid="portal-return-detail">
      <ul className="flex flex-col gap-1.5">
        {rma.data.lines.map((line, index) => (
          <li key={index} className="flex flex-col gap-0.5">
            <div>
              <span className="font-mono">{line.skuCode}</span> — {line.skuName}{' '}
              <span className="data text-(--muted-foreground)">· {receivedOfLabel(line.receivedQty, line.authorizedQty)}</span>
              <span className="text-(--muted-foreground)"> · returned as {PORTAL_RETURN_REASON_LABEL[line.returnReasonCode] ?? line.returnReasonCode}</span>
            </div>
            {line.receivedQty > 0 && (
              <div className="text-xs text-(--muted-foreground)">
                {portalDispositionSummary({
                  receivedTotal: line.receivedQty,
                  restockedTotal: line.restockedQty,
                  onHoldTotal: line.onHoldQty,
                  failedInspectionTotal: line.failedInspectionQty,
                  scrappedTotal: line.scrappedQty,
                  openTotal: line.openQty,
                  // Story 4-7c — units on their way back to the client, and shipped back.
                  returningToClientTotal: line.returningToClientQty,
                  returnedToClientTotal: line.returnedToClientQty,
                })}
              </div>
            )}
          </li>
        ))}
      </ul>
      {rma.data.dispositions.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-xs font-medium">Decisions</div>
          <ol className="flex flex-col gap-0.5 border-l border-(--border) pl-3 text-xs">
            {rma.data.dispositions.map((entry, index) => (
              <li key={index}>
                <span className="font-mono">{entry.skuCode}</span> · {portalDispositionText(entry)}{' '}
                <time className="text-(--muted-foreground)" dateTime={entry.occurredAt}>
                  · {portalInstantIst(entry.occurredAt)}
                </time>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
