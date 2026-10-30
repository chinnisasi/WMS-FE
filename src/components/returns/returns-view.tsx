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
  AWAITING_REVIEW_BADGE,
  DISPOSITIONED_BADGE,
  RETURN_ORIGIN_LABEL,
  REVERSED_BADGE,
  RETURNING_TO_CLIENT_BADGE,
  isBlindReturn,
  lineDispositionState,
  reviewBadge,
  reviewSummaryText,
  MAX_RETURN_NOTE_LENGTH,
  RETURNS_DISPOSED_EVENT,
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
  lineDispositionSplit,
  lineDispositionText,
  receiptHeading,
  receiptLineText,
  receivedOfAuthorized,
  type ReturnStatus,
} from '@/lib/returns';
import { useOutboundSkus } from '@/lib/use-outbound-orders';
import { clientFilterKey } from '@/lib/active-client';
import { useActiveClient } from '@/lib/use-active-client';
import { RETURNS_PAGE_TABS, type ReturnsTab } from '@/lib/page-tabs';
import { useAwaitingReturns, usePendingBlindReturns, useReturns } from '@/lib/use-returns';
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
import { PageTabPanel, PageTabStrip, usePageTab } from '@/components/shared/page-tabs';
import { AwaitingDispositions } from '@/components/returns/awaiting-dispositions';
import { BlindReviewQueue } from '@/components/returns/blind-review';
import { ClientReturnsCard } from '@/components/returns/client-returns-card';

/** Story 4-7b — the tabs a role sees: Unannounced only with `returns.manage` (the review is theirs). */
export function returnsVisibleTabs(canManage: boolean): readonly ReturnsTab[] {
  return RETURNS_PAGE_TABS.tabs.map((t) => t.id).filter((id) => canManage || id !== 'unannounced');
}

const STATUS_OPTIONS: readonly ReturnStatus[] = ['open', 'partially_received', 'received', 'cancelled'];

/**
 * Story 13-1 — the Returns page (FR-46): the active warehouse's return
 * authorizations, newest first, with a SERVER-side status filter that
 * remounts the table, each row expanding into its lines, reasons and serial
 * numbers. Every role reads it; Cancel — an inline confirmation with a
 * reason, never a modal — renders only for `returns.manage`, and only on an
 * open authorization. Refreshes on `RETURNS_CHANGED_EVENT`; no polling.
 *
 * Story 4-7a — two tabs on the shared page tabs: Authorizations (the bare
 * route) and Awaiting disposition (`?tab=awaiting`, the queue of received
 * units still in the Returns bin, with a count of the work waiting). A
 * disposition bumps the page's disposition epoch, which joins an expanded
 * RMA detail's refetch deps (A7).
 *
 * Story 4-7b — a third tab, Unannounced (`?tab=unannounced`, `returns.manage`
 * only, with a count of the parcels awaiting review): the review cards of
 * unannounced parcels received on the handheld with no RMA — Accept (link an
 * order, or none) or Reject (reverse the booking).
 *
 * Story 4-7c — a fourth tab, To client (`?tab=to-client`, every role reads
 * it): the returns to client, with Cancel, Dispatch and Print.
 */
export function ReturnsView({ initialTab = null }: { initialTab?: ReturnsTab | null } = {}) {
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
  return <ReturnsSessioned initialTab={initialTab} />;
}

function ReturnsSessioned({ initialTab }: { initialTab: ReturnsTab | null }) {
  const [tab, selectTab] = usePageTab(RETURNS_PAGE_TABS, RETURNS_PAGE_TABS.initial(null, initialTab), false);
  // A7 — every successful disposition (from this page or any other mounted
  // reader) bumps it; an expanded RMA detail refetches on it.
  const [dispositionEpoch, setDispositionEpoch] = useState(0);
  useEffect(() => {
    const onDisposed = () => setDispositionEpoch((epoch) => epoch + 1);
    window.addEventListener(RETURNS_DISPOSED_EVENT, onDisposed);
    return () => window.removeEventListener(RETURNS_DISPOSED_EVENT, onDisposed);
  }, []);
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
  const canManage = roleHasCapability(role, 'returns.manage');
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
      <PageTabStrip
        def={RETURNS_PAGE_TABS}
        active={tab}
        drilled={false}
        onSelect={selectTab}
        visibleTabs={returnsVisibleTabs(canManage)}
        badge={(id) =>
          id === 'awaiting' ? (
            <AwaitingCountPill key={warehouseId} warehouseId={warehouseId} />
          ) : id === 'unannounced' ? (
            <UnannouncedCountPill key={warehouseId} warehouseId={warehouseId} />
          ) : null
        }
      />
      <PageTabPanel def={RETURNS_PAGE_TABS} active={tab}>
        {tab === 'unannounced' ? (
          canManage ? (
            <BlindReviewQueue
              key={warehouseId}
              tenantId={tenantId}
              warehouseId={warehouseId}
              warehouseLabel={warehouse === undefined ? null : `${warehouse.code} ${warehouse.name}`}
            />
          ) : (
            // A deep link to ?tab=unannounced without the capability: a sentence, never the cards.
            <Section title="Unannounced">
              <div className="text-(--muted-foreground)" data-testid="unannounced-denied">
                Your role cannot review unannounced returns.
              </div>
            </Section>
          )
        ) : tab === 'to-client' ? (
          <ClientReturnsCard key={warehouseId} warehouseId={warehouseId} warehouseLabel={warehouse === undefined ? null : `${warehouse.code} ${warehouse.name}`} />
        ) : tab === 'awaiting' ? (
          <AwaitingDispositions
            key={warehouseId}
            tenantId={tenantId}
            warehouseId={warehouseId}
            warehouseLabel={warehouse === undefined ? null : `${warehouse.code} ${warehouse.name}`}
            canManage={canManage}
          />
        ) : (
          <ReturnsList
            key={warehouseId}
            tenantId={tenantId}
            warehouseId={warehouseId}
            warehouseLabel={warehouse === undefined ? null : `${warehouse.code} ${warehouse.name}`}
            canManage={canManage}
            dispositionEpoch={dispositionEpoch}
          />
        )}
      </PageTabPanel>
    </div>
  );
}

type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string };

/**
 * Story 4-7a — the Awaiting disposition tab's count: the lines still waiting
 * (work, never a total), from one page at the route's ceiling — "100+" when
 * more lie beyond it. A failed or loading read shows no pill (never a wrong 0);
 * none when nothing waits.
 */
function AwaitingCountPill({ warehouseId }: { warehouseId: string }) {
  const active = useActiveClient();
  const queue = useAwaitingReturns(warehouseId, active.filter);
  if (queue.state !== 'ready' || queue.data.items.length === 0) return null;
  const count = `${queue.data.items.length}${queue.data.nextCursor === null ? '' : '+'}`;
  return (
    <span
      aria-label={`${count} awaiting`}
      className="ml-1.5 rounded-full border border-(--warning) bg-(--warning)/10 px-1.5 text-[10px] font-medium text-(--foreground)"
    >
      {count}
    </span>
  );
}

/**
 * Story 4-7b — the Unannounced tab's count: the parcels awaiting review, from
 * one page — "N+" when more lie beyond it. Warehouse-scoped and client-filtered
 * like the Awaiting pill; none while loading, failed or empty (never a wrong 0).
 */
function UnannouncedCountPill({ warehouseId }: { warehouseId: string }) {
  const active = useActiveClient();
  const pending = usePendingBlindReturns(warehouseId, active.filter);
  if (pending.state !== 'ready' || pending.data.items.length === 0) return null;
  const count = `${pending.data.items.length}${pending.data.nextCursor === null ? '' : '+'}`;
  return (
    <span
      aria-label={`${count} awaiting review`}
      className="ml-1.5 rounded-full border border-(--warning) bg-(--warning)/10 px-1.5 text-[10px] font-medium text-(--foreground)"
    >
      {count}
    </span>
  );
}

/** Exported for the component test, which drives it without the warehouse read. */
export function ReturnsList({
  tenantId,
  warehouseId,
  warehouseLabel,
  canManage,
  dispositionEpoch = 0,
}: {
  tenantId: string;
  warehouseId: string;
  warehouseLabel: string | null;
  canManage: boolean;
  /** Story 4-7a (A7) — bumped on every successful disposition; an expanded detail refetches on it. */
  dispositionEpoch?: number;
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
      render: (rma) => {
        // Story 4-7b (A25) — an unannounced return carries its review state as the badge.
        const review = reviewBadge(rma);
        return (
          <div className="flex flex-wrap items-center gap-1">
            <StatusChip tone="neutral">{RETURN_STATUS_LABEL[rma.status]}</StatusChip>
            {review !== null && <StatusChip tone={review.tone}>{review.word}</StatusChip>}
          </div>
        );
      },
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
          renderExpanded={(rma) => (expandedId === rma.id ? <ReturnDetail tenantId={tenantId} rma={rma} skus={skuMap} dispositionEpoch={dispositionEpoch} /> : null)}
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
 * Story 13-2 — the expanded row: each line's received figure and its
 * disposition badge, then the receipts. Receipts ride ONLY on the detail
 * read (never the list), so they are fetched here, when the row expands.
 * Story 4-7a (A7) — the badge is computed from the receipts' lines (open and
 * on hold, grouped by RMA line): amber "↩ Awaiting disposition" while any
 * received unit is undecided, "✓ Dispositioned" once all are, with the split
 * in words; no badge until the receipts have loaded (never a guess).
 */
function ReturnDetail({
  tenantId,
  rma,
  skus,
  dispositionEpoch,
}: {
  tenantId: string;
  rma: ReturnAuthorizationDto;
  skus: Readonly<Record<string, SkuResponse>> | null;
  dispositionEpoch: number;
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
    // A7 — a disposition moves neither the status nor the received total.
  }, [tenantId, rma.id, rma.status, receivedTotal, dispositionEpoch]);
  return (
    <div className="flex flex-col gap-1 text-xs">
      {isBlindReturn(rma) && (
        // Story 4-7b — the origin badge and where the review stands.
        <div className="flex flex-wrap items-center gap-2" data-testid="return-review-block">
          <StatusChip tone="info">{RETURN_ORIGIN_LABEL.blind}</StatusChip>
          <span className="text-(--muted-foreground)">{reviewSummaryText(rma)}</span>
        </div>
      )}
      {rma.status === 'cancelled' && rma.cancelReason !== null && (
        <div className="text-(--muted-foreground)">Cancelled — {rma.cancelReason}</div>
      )}
      <ul className="flex flex-col gap-1">
        {rma.lines.map((line) => {
          const sku = skus?.[line.skuId];
          const uom = sku === undefined ? null : { uom: sku.uom, uomPrecision: sku.uomPrecision };
          const split = receipts.state === 'ready' ? lineDispositionSplit(line.id, receipts.receipts) : null;
          const state = receipts.state === 'ready' ? lineDispositionState(line.id, receipts.receipts) : 'none';
          const splitText = split === null ? null : lineDispositionText(split, uom);
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
                {state === 'pending-review' && <StatusChip tone="warning">{AWAITING_REVIEW_BADGE}</StatusChip>}
                {state === 'reversed' && <StatusChip tone="neutral">{REVERSED_BADGE}</StatusChip>}
                {state === 'awaiting' && <StatusChip tone="warning">{AWAITING_DISPOSITION_BADGE}</StatusChip>}
                {state === 'returning-to-client' && <StatusChip tone="warning">{RETURNING_TO_CLIENT_BADGE}</StatusChip>}
                {state === 'dispositioned' && <StatusChip tone="success">{DISPOSITIONED_BADGE}</StatusChip>}
                {splitText !== null && <span className="data text-(--muted-foreground)">{splitText}</span>}
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
