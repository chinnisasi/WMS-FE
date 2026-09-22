'use client';

import { useEffect, useState } from 'react';

import { fetchApiCancelOrder, fetchApiCreateOrder } from '@/lib/api/client';
import type { OrderEntryDto, SkuResponse } from '@/lib/api/generated';
import { quantityInputLabel, sharedQuantityUom } from '@/lib/format-quantity';
import { notifyOutboundChanged, OUTBOUND_CHANGED_EVENT } from '@/lib/outbound';
import {
  canCancelOrder,
  cancelOutcome,
  cancelReason,
  channelRefLabel,
  createOutcome,
  createReason,
  destinationSummary,
  emptyDestinationFields,
  filterPage,
  groupKitLines,
  holdStateLabel,
  kitParentHoldLabel,
  lineQuantityLabel,
  lineTotals,
  ORDER_STATUSES,
  orderSourceLabel,
  orderStatusLabel,
  orderTotalsLabel,
  pageFilterCount,
  parseDestinationFields,
  parseDraftLines,
  type DestinationFields,
  type DraftLine,
  type Outcome,
  type OrderStatus,
} from '@/lib/outbound-orders';
import { useOrderDetail, useOutboundOrders, useOutboundSkus } from '@/lib/use-outbound-orders';
import { roleHasCapability } from '@/lib/users';
import { ulid } from '@/lib/ulid';

import { DataTable, expandedRowId, type DataTableColumn } from '@/components/data-table/data-table';
import { FeedbackBanner } from '@/components/feedback/banner';
import type { OutboundSurfaceProps } from '@/components/outbound/outbound';
import {
  buttonClass,
  inputClass,
  labelClass,
  primaryClass,
  ReadFailure,
  Section,
  selectClass,
} from '@/components/outbound/shell';

/**
 * The Outbound orders surface (story 4.2b) — the first web consumer of the
 * order lifecycle stories 4.1-4.6 shipped: the active warehouse's orders
 * newest-first, a row that expands into its per-line ordered / reserved /
 * shortfall quantities and hold state, manual multi-line entry, and cancel.
 *
 * The session, the warehouse and the role are resolved once by `outbound.tsx`
 * and passed in — this surface used to walk the warehouse list itself and
 * render a second picker beside the waves surface's.
 *
 * Gating hides, never blocks: the list and the expanded detail are readable
 * by every role, while the create form and the cancel affordance render only
 * for `orders.manage` (Owner + Ops Manager — deliberately not Operator). The
 * nav entry itself stays ungated. The backend's per-command role read is the
 * authority either way.
 */
export function OutboundOrders({ tenantId, warehouseId, warehouseLabel, role }: OutboundSurfaceProps) {
  const canManageOrders = roleHasCapability(role, 'orders.manage');
  return (
    <Section title="Orders">
      <div className="text-(--muted-foreground)">
        {warehouseLabel === null
          ? 'Outbound orders'
          : `${warehouseLabel} — newest first. Acceptance reserves stock line by line.`}
      </div>
      {canManageOrders && <OrderCreateForm tenantId={tenantId} warehouseId={warehouseId} />}
      <OrdersTable
        tenantId={tenantId}
        warehouseId={warehouseId}
        canManageOrders={canManageOrders}
      />
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Manual entry                                                        */
/* ------------------------------------------------------------------ */

interface DraftRow extends DraftLine {
  /** Stable across removals — an index key would move focus and IME state. */
  readonly id: string;
}

function emptyRow(): DraftRow {
  return { id: ulid(), skuId: '', quantity: '' };
}

/**
 * Manual multi-line order entry (capability `orders.manage`). Acceptance
 * reserves `min(qty, atp)` per line, so a line above ATP still comes back
 * 201 — the result reads as accepted with a named shortfall, never as a
 * failure.
 *
 * The `Idempotency-Key` is minted once per DRAFT, not per attempt: a create
 * that times out after the server committed is then safe to retry, because
 * the replay returns the original response instead of raising a second
 * order. Editing the draft mints a fresh key — the same key with a changed
 * body is what the backend answers 422 `idempotency-key-reuse` to — and so
 * does a successful submit, which clears the draft.
 */
function OrderCreateForm({ tenantId, warehouseId }: { tenantId: string; warehouseId: string }) {
  const skus = useOutboundSkus();
  const [draft, setDraft] = useState<readonly DraftRow[]>([emptyRow()]);
  // Story 11-1: the destination is required at create, so the form owns one
  // fieldset shared by every line — one shipment, one address.
  const [destination, setDestination] = useState<DestinationFields>(emptyDestinationFields());
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const skuMap = skus.state === 'ready' ? skus.data : null;
  const skuList: readonly SkuResponse[] =
    skuMap === null ? [] : Object.values(skuMap).sort((a, b) => a.code.localeCompare(b.code));

  /** Any draft edit invalidates the key the previous attempt would replay. */
  function editDraft(next: (rows: readonly DraftRow[]) => readonly DraftRow[]) {
    setIdempotencyKey(null);
    setDraft(next);
  }

  /** The destination is part of the hashed payload — an address edit is a
   * draft edit, and mints a fresh key the same way a line edit does. */
  function editDestination(next: DestinationFields) {
    setIdempotencyKey(null);
    setDestination(next);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = parseDraftLines(draft);
    if (parsed.problem !== null) {
      setOutcome({ tone: 'rejected', word: 'Not created', reason: parsed.problem });
      return;
    }
    // Nothing is requested that the backend would only answer 400 to: the
    // destination's shape is decided here first (the server re-checks it
    // behind its replay lookup — the DTO's word is never trusted twice).
    const address = parseDestinationFields(destination, 'destination');
    if (address.problem !== null) {
      setOutcome({ tone: 'rejected', word: 'Not created', reason: address.problem });
      return;
    }
    // Reused across retries of an unchanged draft; minted afresh otherwise.
    const key = idempotencyKey ?? ulid();
    setIdempotencyKey(key);
    setPending(true);
    setOutcome(null);
    try {
      const { order } = await fetchApiCreateOrder(
        tenantId,
        { warehouseId, source: 'manual', lines: [...parsed.lines], destination: address.destination! },
        key,
      );
      setDraft([emptyRow()]);
      setDestination(emptyDestinationFields());
      setIdempotencyKey(null);
      setOutcome(createOutcome(order, (skuId) => skuMap?.[skuId]));
      notifyOutboundChanged();
    } catch (error) {
      setOutcome({ tone: 'rejected', word: 'Not created', reason: createReason(error) });
    } finally {
      setPending(false);
    }
  }

  if (skus.state === 'loading') {
    return (
      <div className="rounded-sm border border-(--border) p-3 text-xs text-(--muted-foreground)">
        Loading SKUs…
      </div>
    );
  }
  if (skus.state === 'failed') {
    // No SKUs, no honest picker — the form is not offered rather than
    // offered empty.
    return (
      <div className="rounded-sm border border-(--border) p-3">
        <ReadFailure word="SKUs unavailable" reason={skus.reason} onRetry={skus.reload} />
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-sm border border-(--border) p-3">
      <div className="text-xs text-(--muted-foreground)">
        Raise an order — acceptance reserves each line against available stock. A line above what is
        available is accepted and backordered for the remainder.
      </div>
      <fieldset className="flex flex-col gap-2 rounded-sm border border-(--border) p-3">
        <legend className="px-1 text-xs text-(--muted-foreground)">Ship to</legend>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="flex flex-[2] flex-col gap-1">
            <span className={labelClass}>Contact name</span>
            <input
              className={inputClass}
              value={destination.contactName}
              onChange={(e) => editDestination({ ...destination, contactName: e.target.value })}
              required
              maxLength={120}
              placeholder="Priya Sharma"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className={labelClass}>Phone</span>
            <input
              className={inputClass}
              value={destination.phone}
              onChange={(e) => editDestination({ ...destination, phone: e.target.value })}
              required
              maxLength={20}
              placeholder="+91 98450 12345"
            />
          </label>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="flex flex-[2] flex-col gap-1">
            <span className={labelClass}>Address line 1</span>
            <input
              className={inputClass}
              value={destination.line1}
              onChange={(e) => editDestination({ ...destination, line1: e.target.value })}
              required
              maxLength={200}
              placeholder="12, Peenya Industrial Area"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className={labelClass}>Address line 2 (optional)</span>
            <input
              className={inputClass}
              value={destination.line2}
              onChange={(e) => editDestination({ ...destination, line2: e.target.value })}
              maxLength={200}
              placeholder="Gate 3"
            />
          </label>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="flex flex-1 flex-col gap-1">
            <span className={labelClass}>City</span>
            <input
              className={inputClass}
              value={destination.city}
              onChange={(e) => editDestination({ ...destination, city: e.target.value })}
              required
              maxLength={100}
              placeholder="Bengaluru"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className={labelClass}>State</span>
            <input
              className={inputClass}
              value={destination.state}
              onChange={(e) => editDestination({ ...destination, state: e.target.value })}
              required
              maxLength={100}
              placeholder="Karnataka"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className={labelClass}>Pincode</span>
            <input
              className={inputClass}
              value={destination.pincode}
              onChange={(e) => editDestination({ ...destination, pincode: e.target.value })}
              required
              // Text, never a number input: the pincode keeps its leading
              // zeros (`110001`), and `type="number"` would strip them.
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              placeholder="560066"
            />
          </label>
        </div>
      </fieldset>
      <div className="flex flex-col gap-2">
        {draft.map((row, index) => (
          <div key={row.id} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex flex-[3] flex-col gap-1">
              <span className={labelClass}>SKU</span>
              <select
                className={selectClass}
                value={row.skuId}
                onChange={(e) =>
                  editDraft((rows) =>
                    rows.map((r) => (r.id === row.id ? { ...r, skuId: e.target.value } : r)),
                  )
                }
                required
              >
                <option value="" disabled>
                  Pick a SKU…
                </option>
                {skuList.map((sku) => (
                  <option key={sku.id} value={sku.id}>
                    {sku.code} {sku.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className={labelClass}>Quantity</span>
              <input
                className={inputClass}
                type="number"
                inputMode="decimal"
                // The input constrains NOTHING: no `min` (the backend accepts
                // sub-1 fractions down to 0.001) and `step="any"` (a step
                // value would make the browser refuse a too-fine entry with
                // its generic step-mismatch copy — the backend's precision
                // refusal naming unit and precision is the authority, and it
                // renders under the error contract). `parseDraftLines` and
                // the server decide everything.
                step="any"
                value={row.quantity}
                onChange={(e) =>
                  editDraft((rows) =>
                    rows.map((r) => (r.id === row.id ? { ...r, quantity: e.target.value } : r)),
                  )
                }
                required
                placeholder="1"
                title={quantityInputLabel(skuMap?.[row.skuId]?.uomPrecision ?? 0)}
              />
            </label>
            <button
              type="button"
              aria-label={`Remove line ${index + 1}`}
              disabled={draft.length === 1}
              onClick={() => editDraft((rows) => rows.filter((r) => r.id !== row.id))}
              className={buttonClass}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => editDraft((rows) => [...rows, emptyRow()])}
          className={buttonClass}
        >
          Add line
        </button>
        <button type="submit" disabled={pending} className={primaryClass}>
          {pending ? 'Creating…' : 'Create order'}
        </button>
      </div>
      {outcome !== null && (
        <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />
      )}
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* The list                                                            */
/* ------------------------------------------------------------------ */

function OrdersTable({
  tenantId,
  warehouseId,
  canManageOrders,
}: {
  tenantId: string;
  warehouseId: string;
  canManageOrders: boolean;
}) {
  const orders = useOutboundOrders(warehouseId);
  const [statusFilter, setStatusFilter] = useState<OrderStatus | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // Bumped to remount DataTable, whose Prev/Next cursor is internal state —
  // without it the table would still offer Prev on what is now page one.
  const [pageEpoch, setPageEpoch] = useState(0);

  const { onCursor } = orders;
  useEffect(() => {
    // A create or a cancel invalidates the keyset position (a new order
    // lands at the top of page one), so any outbound change returns the list
    // to page one before it refetches. Otherwise the banner reports an
    // acceptance the page on screen demonstrably cannot show.
    const onChange = () => {
      onCursor(null);
      setPageEpoch((epoch) => epoch + 1);
    };
    window.addEventListener(OUTBOUND_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(OUTBOUND_CHANGED_EVENT, onChange);
  }, [onCursor]);

  const loaded = orders.state === 'ready' ? orders.data.items : [];
  const rows = filterPage(loaded, statusFilter);

  async function confirmCancel(orderId: string) {
    setBusyId(orderId);
    setOutcome(null);
    try {
      const { order } = await fetchApiCancelOrder(tenantId, orderId, ulid());
      setOutcome(cancelOutcome(order));
      setConfirmId(null);
      notifyOutboundChanged();
    } catch (error) {
      // The refusal stays on screen with the confirmation still open — its
      // two real causes (a committed reservation, a drawn pick line) are
      // invisible in every field this client holds, so the server's own
      // words are what gets rendered.
      setOutcome({ tone: 'rejected', word: 'Not cancelled', reason: cancelReason(error) });
    } finally {
      setBusyId(null);
    }
  }

  const columns: readonly DataTableColumn<OrderEntryDto>[] = [
    {
      key: 'id',
      header: 'Order',
      render: (order) => (
        <button
          type="button"
          aria-expanded={expandedId === order.id}
          aria-controls={expandedId === order.id ? expandedRowId(order.id) : undefined}
          onClick={() => setExpandedId((id) => (id === order.id ? null : order.id))}
          className="flex items-center gap-2 text-left underline-offset-2 hover:underline"
        >
          <span aria-hidden className="text-(--muted-foreground)">
            {expandedId === order.id ? '▾' : '▸'}
          </span>
          <span className="font-mono text-xs">{order.id}</span>
        </button>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (order) => (
        <span className="rounded-full border border-(--border) bg-(--muted) px-2 py-0.5 text-xs text-(--muted-foreground)">
          {orderStatusLabel(order.status)}
        </span>
      ),
    },
    { key: 'source', header: 'Source', render: (order) => orderSourceLabel(order.source) },
    {
      // Story 11-1: the one address line the list works from first — city
      // and pincode. Pre-11.1 rows read `destination: null` and render a dash.
      key: 'destination',
      header: 'Ship to',
      render: (order) => destinationSummary(order),
    },
    {
      key: 'channel',
      header: 'Channel refs',
      render: (order) => <span className="font-mono text-xs">{channelRefLabel(order)}</span>,
    },
    {
      key: 'createdAt',
      header: 'Created',
      render: (order) => <time dateTime={order.createdAt}>{new Date(order.createdAt).toLocaleString()}</time>,
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      render: (order) => <time dateTime={order.updatedAt}>{new Date(order.updatedAt).toLocaleString()}</time>,
    },
    ...(canManageOrders
      ? [
          {
            key: 'actions',
            header: '',
            render: (order: OrderEntryDto) =>
              // No affordance at all for a state the backend would refuse:
              // ready_to_dispatch, dispatched and cancelled are downstream or
              // already done.
              canCancelOrder(order.status) ? (
                <div className="flex justify-end">
                  <button
                    type="button"
                    // Any cancel in flight disables every row: `busyId` and
                    // the outcome banner are single, so two concurrent
                    // cancels would leave one of them unreported.
                    disabled={busyId !== null}
                    onClick={() => setConfirmId(order.id)}
                    className="rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted) disabled:opacity-40"
                  >
                    Cancel
                  </button>
                </div>
              ) : null,
          } satisfies DataTableColumn<OrderEntryDto>,
        ]
      : []),
  ];

  const confirmTarget = confirmId === null ? null : (loaded.find((o) => o.id === confirmId) ?? null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <label className="flex flex-col gap-1">
          {/* The list API offers cursor + limit and nothing else — no status
              filter, no sort, no search. Naming the scope in the control is
              what keeps it from implying it searched the whole warehouse. */}
          <span className="text-xs text-(--muted-foreground)">Filter this page</span>
          <select
            className={`${selectClass} w-auto py-1`}
            value={statusFilter ?? ''}
            onChange={(e) => setStatusFilter(e.target.value === '' ? null : (e.target.value as OrderStatus))}
          >
            <option value="">All statuses</option>
            {ORDER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {orderStatusLabel(status)}
              </option>
            ))}
          </select>
        </label>
        <span className="text-xs text-(--muted-foreground)">
          {pageFilterCount(rows.length, loaded.length)}
        </span>
      </div>

      {confirmTarget !== null && (
        <div className="flex flex-col gap-2 rounded-sm border border-(--border) bg-(--muted) p-3">
          <div className="text-xs text-(--muted-foreground)">
            Cancelling order <span className="font-mono">{confirmTarget.id}</span> releases every
            reservation it still holds. A stock hold a picklist already claimed is refused by the
            server, and the order stays as it is.
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busyId !== null}
              onClick={() => confirmCancel(confirmTarget.id)}
              className={primaryClass}
            >
              {busyId === confirmTarget.id ? 'Cancelling…' : 'Cancel this order'}
            </button>
            <button type="button" onClick={() => setConfirmId(null)} className={buttonClass}>
              Keep it
            </button>
          </div>
        </div>
      )}

      {orders.state === 'failed' ? (
        <ReadFailure word="Orders unavailable" reason={orders.reason} onRetry={orders.reload} />
      ) : (
        <DataTable<OrderEntryDto>
          key={pageEpoch}
          columns={columns}
          rows={rows}
          nextCursor={orders.state === 'ready' ? orders.data.nextCursor : null}
          onCursor={orders.onCursor}
          renderExpanded={(order) =>
            expandedId === order.id ? <OrderDetailPanel orderId={order.id} /> : null
          }
          emptyMessage={
            orders.state === 'loading'
              ? 'Loading orders…'
              : loaded.length === 0
                ? 'No orders in this warehouse yet.'
                : 'No orders on this page match that status.'
          }
        />
      )}
      {outcome !== null && (
        <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />
      )}
    </div>
  );
}

/**
 * One order's lines, fetched when the row expands. A failure is reported on
 * this row alone — the list around it is untouched, and an empty line list
 * would read as "this order has no lines", which is never true.
 *
 * Exported for the story 11-6 component test, which pins the kit
 * parent/child grouping on this panel alone rather than driving the whole
 * surface (its list, filter and warehouse picker are out of scope there).
 */
export function OrderDetailPanel({ orderId }: { orderId: string }) {
  const detail = useOrderDetail(orderId);
  const skus = useOutboundSkus();
  // The SKU map only decorates: a line falls back to its raw `skuId` rather
  // than blocking the quantities, which are what this panel exists for.
  const skuMap = skus.state === 'ready' ? skus.data : null;

  if (detail.state === 'loading') {
    return <div className="text-xs text-(--muted-foreground)">Loading lines…</div>;
  }
  if (detail.state === 'failed') {
    return (
      <div className="flex flex-col items-start gap-2">
        <div role="alert" className="text-xs text-(--destructive)">
          {detail.reason}
        </div>
        <button type="button" onClick={detail.reload} className={`${buttonClass} text-xs`}>
          Retry
        </button>
      </div>
    );
  }

  // The totals count the TOP-LEVEL lines only — a kit's children share their
  // parent's quantity, so summing the exploded flat list would double-count
  // every kit order's contents. The same groups feed the line list.
  const groups = groupKitLines(detail.data.lines);

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-(--muted-foreground)">
        {orderTotalsLabel(
          lineTotals(groups.map(({ line }) => line)),
          sharedQuantityUom(detail.data.lines, (skuId) => skuMap?.[skuId]),
        )}
      </div>
      {/* Story 11-6 — an exploded kit renders as its parent line with the
          component children grouped beneath it, not as a flat line list.
          Plain orders group into single-line groups and render exactly as
          before; waves/pick/pack already see the child lines and are not
          touched. */}
      <ul className="flex flex-col gap-1">
        {groups.map(({ line, children }) => (
          <li key={line.id} className="flex flex-col gap-1 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{skuMap?.[line.skuId]?.code ?? line.skuId}</span>
              <span className="text-(--muted-foreground)">{skuMap?.[line.skuId]?.name ?? ''}</span>
              {/* The line's own SKU names the unit and its precision — a
                  column mixing units has no single one. */}
              <span className="data">{lineQuantityLabel(line, skuMap?.[line.skuId])}</span>
              <span
                className={
                  line.status === 'backordered'
                    ? 'rounded-full border border-(--destructive) px-2 py-0.5 text-(--destructive)'
                    : 'rounded-full border border-(--border) px-2 py-0.5 text-(--muted-foreground)'
                }
              >
                {line.status === 'backordered' ? 'Backordered' : 'Open'}
              </span>
              {/* A kit parent's reservationId is always null — the holds it
                  earns belong to its children — so the ordinary hold label
                  would read "No hold" and imply it got nothing. The label
                  stays honest about the holds' state: a dispatched or
                  cancelled order's holds are retired, a backordered kit
                  holds nothing. */}
              <span className="text-(--muted-foreground)">
                {children.length > 0
                  ? kitParentHoldLabel(line, detail.data.status)
                  : `Hold: ${holdStateLabel(line)}`}
              </span>
            </div>
            {children.length > 0 ? (
              <ul className="flex flex-col gap-1 border-l border-(--border) pl-3">
                {children.map((child) => (
                  <li key={child.id} className="flex flex-wrap items-center gap-2 text-xs">
                    <span aria-hidden className="text-(--muted-foreground)">
                      └
                    </span>
                    <span className="font-mono">{skuMap?.[child.skuId]?.code ?? child.skuId}</span>
                    <span className="text-(--muted-foreground)">{skuMap?.[child.skuId]?.name ?? ''}</span>
                    <span className="data">{lineQuantityLabel(child, skuMap?.[child.skuId])}</span>
                    <span
                      className={
                        child.status === 'backordered'
                          ? 'rounded-full border border-(--destructive) px-2 py-0.5 text-(--destructive)'
                          : 'rounded-full border border-(--border) px-2 py-0.5 text-(--muted-foreground)'
                      }
                    >
                      {child.status === 'backordered' ? 'Backordered' : 'Open'}
                    </span>
                    <span className="text-(--muted-foreground)">Hold: {holdStateLabel(child)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
