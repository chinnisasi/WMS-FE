'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { fetchApiCancelReturn, fetchApiGetReturn } from '@/lib/api/client';
import type { ReturnAuthorizationDto, ReturnReceiptViewDto, SkuResponse } from '@/lib/api/generated';
import { istDateTimeLabel } from '@/lib/audit-exports';
import { readSession, subscribeSession } from '@/lib/auth';
import { quantityLabel } from '@/lib/format-quantity';
import {
  AWAITING_DISPOSITION_BADGE,
  MAX_RETURN_NOTE_LENGTH,
  RETURN_STATUS_LABEL,
  RETURNS_CHANGED_EVENT,
  canCancelReturn,
  cancelRefusalReloads,
  returnCancelledOutcome,
  notifyReturnsChanged,
  parseCancelReason,
  returnLinesSummary,
  returnOrderLabel,
  returnReason,
  returnReasonText,
  lineAwaitsDisposition,
  receiptHeading,
  receiptLineText,
  receivedOfAuthorized,
  type ReturnStatus,
} from '@/lib/returns';
import { useOutboundSkus } from '@/lib/use-outbound-orders';
import { clientFilterKey } from '@/lib/active-client';
import { useActiveClient } from '@/lib/use-active-client';
import { useReturns } from '@/lib/use-returns';
import { useTenantWarehouses } from '@/lib/use-tenant-warehouses';
import { roleHasCapability } from '@/lib/users';
import { ulid } from '@/lib/ulid';
import { readActiveWarehouseId, subscribeActiveWarehouse, writeActiveWarehouseId } from '@/lib/warehouses';

import { DataTable, expandedRowId, type DataTableColumn } from '@/components/data-table/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { ClientFilterChip } from '@/components/shared/client-filter-chip';
import { FeedbackBanner } from '@/components/feedback/banner';
import {
  buttonClass,
  inputClass,
  primaryClass,
  ReadFailure,
  rowButtonClass,
  Section,
  selectClass,
} from '@/components/outbound/shell';
import { WarehousesFailure, WarehousesRefreshNote } from '@/components/shared/warehouses-failure';
import { StatusChip } from '@/components/shared/status-chip';

const STATUS_OPTIONS: readonly ReturnStatus[] = ['open', 'partially_received', 'received', 'cancelled'];

/**
 * Story 13-1 — the Returns page (FR-46): the active warehouse's return
 * authorizations, newest first, with a SERVER-side status filter that
 * remounts the table, each row expanding into its lines, reasons and serial
 * numbers. Every role reads it; Cancel — an inline confirmation with a
 * reason, never a modal — renders only for `returns.manage`, and only on an
 * open authorization. Refreshes on `RETURNS_CHANGED_EVENT`; no polling.
 * 13-4 adds the returns queue and the disposition cards.
 */
export function ReturnsView() {
  // `null` = unknown (server render) → render nothing, no hydration mismatch.
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );
  if (sessioned === null) return null;
  if (!sessioned) {
    return (
      <Section title="Returns">
        <div className="text-(--muted-foreground)">
          Sign in to review returns —{' '}
          <Link href="/login" className="text-(--primary) underline underline-offset-2">
            go to sign in
          </Link>
          .
        </div>
      </Section>
    );
  }
  return <ReturnsSessioned />;
}

function ReturnsSessioned() {
  const warehouses = useTenantWarehouses();
  const tenantId = warehouses.state === 'ready' ? warehouses.data.tenantId : null;
  const items = warehouses.state === 'ready' ? warehouses.data.items : [];
  const activeId = useSyncExternalStore(
    subscribeActiveWarehouse,
    () => (tenantId === null ? null : readActiveWarehouseId(tenantId)),
    () => null,
  );
  // Subscribed, never a bare readSession() at render: the /me bootstrap
  // rewrites the role after mount.
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );

  if (warehouses.state === 'loading') {
    return (
      <Section title="Returns">
        <div className="text-(--muted-foreground)">Loading warehouses…</div>
      </Section>
    );
  }
  if (warehouses.state === 'failed') {
    return (
      <Section title="Returns">
        <WarehousesFailure state={warehouses} />
      </Section>
    );
  }
  const warehouseId = activeId !== null && items.some((w) => w.id === activeId) ? activeId : (items[0]?.id ?? null);
  if (tenantId === null || warehouseId === null) {
    return (
      <Section title="Returns">
        <div className="text-(--muted-foreground)">Create a warehouse first — returns come back to the warehouse that dispatched them.</div>
      </Section>
    );
  }
  const warehouse = items.find((w) => w.id === warehouseId);
  return (
    <div className="flex flex-col gap-4">
      {warehouses.data.refreshFailed !== null && (
        <WarehousesRefreshNote reason={warehouses.data.refreshFailed} onRetry={warehouses.reload} />
      )}
      {items.length > 1 && (
        <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
          <label className="flex items-center gap-2 text-xs">
            <span className="text-(--muted-foreground)">Warehouse</span>
            <select
              className={`${selectClass} w-auto py-1`}
              value={warehouseId}
              onChange={(e) => writeActiveWarehouseId(tenantId, e.target.value)}
            >
              {items.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} {w.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <ReturnsList
        key={warehouseId}
        tenantId={tenantId}
        warehouseId={warehouseId}
        warehouseLabel={warehouse === undefined ? null : `${warehouse.code} ${warehouse.name}`}
        canManage={roleHasCapability(role, 'returns.manage')}
      />
    </div>
  );
}

type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string };

/** Exported for the component test, which drives it without the warehouse read. */
export function ReturnsList({
  tenantId,
  warehouseId,
  warehouseLabel,
  canManage,
}: {
  tenantId: string;
  warehouseId: string;
  warehouseLabel: string | null;
  canManage: boolean;
}) {
  const [status, setStatus] = useState<ReturnStatus | null>(null);
  // Story 1-5a — the screen's one active-client read filters the list.
  const active = useActiveClient();
  const returns = useReturns(warehouseId, status, active.filter);
  const skus = useOutboundSkus();
  const skuMap = skus.state === 'ready' ? skus.data : null;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // The Idempotency-Key lives with the CONFIRMATION: minted on its first
  // submit, reused by every retry of it (a cancel whose response was lost
  // replays its 200 rather than answering "Not cancelled"), cleared when the
  // reason changes (it is in the hash), on success and on close.
  const [confirm, setConfirm] = useState<{ rmaId: string; reason: string; problem: string | null; key: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // DataTable holds its Prev/Next cursor internally: a change returns the
  // list to page one by remounting it.
  const [pageEpoch, setPageEpoch] = useState(0);

  const { onCursor } = returns;
  useEffect(() => {
    const onChange = () => {
      onCursor(null);
      setPageEpoch((epoch) => epoch + 1);
    };
    window.addEventListener(RETURNS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(RETURNS_CHANGED_EVENT, onChange);
  }, [onCursor]);

  async function confirmCancel() {
    if (confirm === null || inFlight.current) return;
    const parsed = parseCancelReason(confirm.reason);
    if (parsed.reason === null) {
      setConfirm({ ...confirm, problem: parsed.problem });
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setOutcome(null);
    try {
      // The synchronous ref above stops a double-click sending twice.
      const key = confirm.key ?? ulid();
      setConfirm({ ...confirm, key });
      const rma = await fetchApiCancelReturn(tenantId, confirm.rmaId, parsed.reason, key);
      setConfirm(null);
      setOutcome({ tone: 'accepted', ...returnCancelledOutcome(rma) });
      notifyReturnsChanged();
    } catch (error) {
      setOutcome({ tone: 'rejected', word: 'Not cancelled', reason: returnReason(error) });
      // A 409 means the row moved (cancelled elsewhere, units received): re-read it.
      if (cancelRefusalReloads(error)) {
        setConfirm(null);
        returns.reload();
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const rows = returns.state === 'ready' ? returns.data.items : [];
  const columns: readonly DataTableColumn<ReturnAuthorizationDto>[] = [
    {
      key: 'code',
      header: 'Return',
      render: (rma) => (
        <button
          type="button"
          aria-expanded={expandedId === rma.id}
          aria-controls={expandedId === rma.id ? expandedRowId(rma.id) : undefined}
          onClick={() => setExpandedId((id) => (id === rma.id ? null : rma.id))}
          className="flex items-center gap-2 text-left underline-offset-2 hover:underline"
        >
          <span aria-hidden className="text-(--muted-foreground)">
            {expandedId === rma.id ? '▾' : '▸'}
          </span>
          <span className="font-mono text-xs">{rma.code}</span>
        </button>
      ),
    },
    { key: 'order', header: 'Order', render: (rma) => <span className="font-mono text-xs">{returnOrderLabel(rma)}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (rma) => (
        <StatusChip tone="neutral">{RETURN_STATUS_LABEL[rma.status]}</StatusChip>
      ),
    },
    { key: 'lines', header: 'Lines', numeric: true, render: (rma) => returnLinesSummary(rma) },
    { key: 'external', header: 'External ref', render: (rma) => rma.externalReference ?? '—' },
    { key: 'createdAt', header: 'Created (IST)', render: (rma) => <time dateTime={rma.createdAt}>{istDateTimeLabel(rma.createdAt)}</time> },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: '',
            render: (rma: ReturnAuthorizationDto) =>
              canCancelReturn(rma.status) ? (
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirm({ rmaId: rma.id, reason: '', problem: null, key: null })}
                    className={rowButtonClass}
                  >
                    Cancel
                  </button>
                </div>
              ) : null,
          } satisfies DataTableColumn<ReturnAuthorizationDto>,
        ]
      : []),
  ];

  const confirmTarget = confirm === null ? null : (rows.find((r) => r.id === confirm.rmaId) ?? null);
  // A confirmation whose row left the page (paged away, filtered out,
  // refreshed off) is closed — never kept hidden to reappear later with a
  // stale reason and key. A guarded set-state during render, not an effect.
  if (confirm !== null && returns.state === 'ready' && confirmTarget === null) {
    setConfirm(null);
  }

  return (
    <Section title="Returns">
      <div className="text-(--muted-foreground)">
        {warehouseLabel === null ? 'Return authorizations' : `${warehouseLabel} — return authorizations, newest first.`}
      </div>
      <ClientFilterChip active={active} tenantName={active.tenantName} />
      <label className="flex w-fit flex-col gap-1">
        <span className="text-xs text-(--muted-foreground)">Status</span>
        <select
          aria-label="Status"
          className={`${selectClass} w-auto py-1`}
          value={status ?? ''}
          onChange={(e) => {
            setStatus(e.target.value === '' ? null : (e.target.value as ReturnStatus));
            setExpandedId(null);
            setConfirm(null);
          }}
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {RETURN_STATUS_LABEL[option]}
            </option>
          ))}
        </select>
      </label>

      {confirm !== null && confirmTarget !== null && (
        <div className="flex flex-col gap-2 rounded-sm border border-(--border) bg-(--muted) p-3">
          <div className="text-xs text-(--muted-foreground)">
            Cancelling return <span className="font-mono">{confirmTarget.code}</span> makes its units returnable again.
          </div>
          <input
            type="text"
            aria-label="Cancel reason"
            placeholder="Why (required)"
            maxLength={MAX_RETURN_NOTE_LENGTH}
            value={confirm.reason}
            onChange={(e) => setConfirm({ ...confirm, reason: e.target.value, problem: null, key: null })}
            className={`${inputClass} max-w-md py-1`}
          />
          {confirm.problem !== null && (
            <div role="alert" className="text-xs text-(--destructive)">
              {confirm.problem}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void confirmCancel()} className={primaryClass}>
              {busy ? 'Cancelling…' : 'Cancel this return'}
            </button>
            <button type="button" onClick={() => setConfirm(null)} className={buttonClass}>
              Keep it
            </button>
          </div>
        </div>
      )}

      {returns.state === 'failed' ? (
        <ReadFailure word="Returns unavailable" reason={returns.reason} onRetry={returns.reload} />
      ) : (
        <DataTable<ReturnAuthorizationDto>
          key={`${status ?? 'all'}#${pageEpoch}|${clientFilterKey(active.filter)}`}
          columns={columns}
          rows={rows}
          nextCursor={returns.state === 'ready' ? returns.data.nextCursor : null}
          onCursor={returns.onCursor}
          renderExpanded={(rma) => (expandedId === rma.id ? <ReturnDetail tenantId={tenantId} rma={rma} skus={skuMap} /> : null)}
          loading={returns.state === 'loading' ? 'Loading returns…' : undefined}
          emptyMessage={<EmptyState kind="first-use">No returns yet</EmptyState>}
        />
      )}
      {outcome !== null && <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />}
    </Section>
  );
}

type ReceiptsRead =
  | { state: 'loading' }
  | { state: 'ready'; receipts: readonly ReturnReceiptViewDto[] }
  | { state: 'failed'; reason: string };

/**
 * Story 13-2 — the expanded row: each line's received figure and the amber
 * "↩ Awaiting disposition" badge on a line with received units, then the
 * receipts. Receipts ride ONLY on the detail read (never the list), so they
 * are fetched here, when the row expands.
 */
function ReturnDetail({
  tenantId,
  rma,
  skus,
}: {
  tenantId: string;
  rma: ReturnAuthorizationDto;
  skus: Readonly<Record<string, SkuResponse>> | null;
}) {
  const [receipts, setReceipts] = useState<ReceiptsRead>({ state: 'loading' });
  // Refetch when the row moves on (a receipt landed: the status or the summed
  // received quantity changed) — not only when the row is first expanded.
  const receivedTotal = rma.lines.reduce((sum, line) => sum + line.receivedQty, 0);
  useEffect(() => {
    const controller = new AbortController();
    fetchApiGetReturn(tenantId, rma.id, { signal: controller.signal })
      .then((detail) => setReceipts({ state: 'ready', receipts: detail.receipts ?? [] }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setReceipts({ state: 'failed', reason: returnReason(error) });
      });
    return () => controller.abort();
  }, [tenantId, rma.id, rma.status, receivedTotal]);
  return (
    <div className="flex flex-col gap-1 text-xs">
      {rma.status === 'cancelled' && rma.cancelReason !== null && (
        <div className="text-(--muted-foreground)">Cancelled — {rma.cancelReason}</div>
      )}
      <ul className="flex flex-col gap-1">
        {rma.lines.map((line) => {
          const sku = skus?.[line.skuId];
          return (
            <li key={line.id} className="flex flex-col gap-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{sku?.code ?? line.skuId}</span>
                <span className="data">
                  {quantityLabel(line.authorizedQty, sku === undefined ? null : { uom: sku.uom, uomPrecision: sku.uomPrecision })}
                </span>
                <span className="text-(--muted-foreground)">{returnReasonText(line)}</span>
                <span className="data text-(--muted-foreground)">
                  {receivedOfAuthorized(line, sku === undefined ? null : { uom: sku.uom, uomPrecision: sku.uomPrecision })}
                </span>
                {lineAwaitsDisposition(line) && (
                  <StatusChip tone="warning">{AWAITING_DISPOSITION_BADGE}</StatusChip>
                )}
              </div>
              {line.serials.length > 0 && (
                <div className="font-mono text-(--muted-foreground)">{line.serials.map((serial) => serial.serialNumber).join(', ')}</div>
              )}
            </li>
          );
        })}
      </ul>
      {receipts.state === 'loading' && <div className="text-(--muted-foreground)">Loading receipts…</div>}
      {receipts.state === 'failed' && <div className="text-(--muted-foreground)">Receipts unavailable — {receipts.reason}</div>}
      {receipts.state === 'ready' && receipts.receipts.length > 0 && (
        <div className="flex flex-col gap-1 pt-1">
          <div className="font-medium">Receipts</div>
          {receipts.receipts.map((receipt) => (
            <div key={receipt.id} className="flex flex-col gap-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{receiptHeading(receipt)}</span>
                <time className="text-(--muted-foreground)" dateTime={receipt.occurredAt}>
                  {istDateTimeLabel(receipt.occurredAt)}
                </time>
              </div>
              <ul className="flex flex-col gap-0.5 pl-3">
                {receipt.lines.map((line, index) => (
                  <li key={`${receipt.id}-${index}`}>
                    <span className="font-mono">{skus?.[line.skuId]?.code ?? line.skuId}</span>{' '}
                    <span className="text-(--muted-foreground)">{receiptLineText(line)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
