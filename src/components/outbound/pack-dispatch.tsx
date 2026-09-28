'use client';

import { useEffect, useRef, useState } from 'react';

import { fetchApiDispatchOrder, fetchApiPackOrder } from '@/lib/api/client';
import type { DispatchDto, OrderEntryDto, OrderLineDto, PackDto, SkuResponse } from '@/lib/api/generated';
import { quantityInputLabel, quantityLabel, sharedQuantityUom } from '@/lib/format-quantity';
import { notifyOutboundChanged } from '@/lib/outbound';
import {
  DISPATCH_TERMINAL_WARNING,
  dispatchOutcome,
  dispatchReason,
  dispatchRecordLabel,
  dispatchedLineLabel,
  EMPTY_MEASUREMENTS,
  isPipelineStatus,
  PIPELINE_STATUSES,
  packOutcome,
  packReason,
  packedLineLabel,
  packScanDraftFromLines,
  parcelMeasurementLabel,
  parseDispatchDraft,
  parsePackDraft,
  type PackMeasurements,
  type PackScanDraftLine,
  type PipelineStatus,
} from '@/lib/outbound-pack-dispatch';
import { filterPage, lineQuantityLabel, orderStatusLabel, pageFilterCount } from '@/lib/outbound-orders';
import { useOrderDetail, useOutboundSkus } from '@/lib/use-outbound-orders';
import { usePipelineOrders } from '@/lib/use-outbound-pack-dispatch';
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
 * The Outbound pack & dispatch pipeline (story 4-2d) — the web consumer of
 * story 4.5's pack verification and story 4.6's dispatch: the warehouse's
 * orders page-scoped to the pipeline statuses, a row expanding into the pack
 * bench (entered scanned quantities, optional weight/dimensions, the returned
 * packing slip) and the terminal dispatch confirmation.
 *
 * The session, the warehouse and the role are resolved once by `outbound.tsx`
 * and passed in, exactly as for the orders and waves surfaces.
 *
 * Gating hides, never blocks: the list, the expanded lines and the slip are
 * readable by every role, while the pack bench renders only for `pack.execute`
 * and the dispatch affordance only for `dispatch.execute` (both Owner + Ops
 * Manager + Operator). The backend's per-command role read is the authority
 * either way.
 *
 * The bench is honest about what it does not know: no web read exposes picked
 * quantities, so the panel shows ordered-vs-scanned and the server's refusals
 * — the 422 `pack-mismatch` naming both quantities, the 409 naming the
 * outstanding lines — render verbatim. Nothing is pre-verified client-side.
 */
export function OutboundPackDispatch({
  tenantId,
  warehouseId,
  warehouseLabel,
  role,
}: OutboundSurfaceProps) {
  const canPack = roleHasCapability(role, 'pack.execute');
  const canDispatch = roleHasCapability(role, 'dispatch.execute');
  return (
    <Section title="Pack & Dispatch">
      <div className="text-(--muted-foreground)">
        {warehouseLabel === null
          ? 'The pack and dispatch pipeline.'
          : `${warehouseLabel} — packing verifies the parcel against what was actually picked; dispatch hands it to the courier and is terminal.`}
      </div>
      <PackDispatchTable
        tenantId={tenantId}
        warehouseId={warehouseId}
        canPack={canPack}
        canDispatch={canDispatch}
      />
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* The list                                                            */
/* ------------------------------------------------------------------ */

function PackDispatchTable({
  tenantId,
  warehouseId,
  canPack,
  canDispatch,
}: {
  tenantId: string;
  warehouseId: string;
  canPack: boolean;
  canDispatch: boolean;
}) {
  const orders = usePipelineOrders(warehouseId);
  const [statusFilter, setStatusFilter] = useState<PipelineStatus | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // The pipeline page-scoped to its statuses: a cancelled order is not on it.
  // The list endpoint offers cursor + limit and nothing else — no status
  // filter, no sort, no search — so this control filters the LOADED page and
  // says so, exactly like the sibling surfaces' controls.
  const loaded = orders.state === 'ready' ? orders.data.items : [];
  const pipeline = loaded.filter((order) => isPipelineStatus(order.status));
  const rows = filterPage(pipeline, statusFilter);

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
    {
      key: 'createdAt',
      header: 'Created',
      render: (order) => (
        <time dateTime={order.createdAt}>{new Date(order.createdAt).toLocaleString()}</time>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-(--muted-foreground)">Filter this page</span>
          <select
            className={`${selectClass} w-auto py-1`}
            value={statusFilter ?? ''}
            onChange={(e) =>
              setStatusFilter(e.target.value === '' ? null : (e.target.value as PipelineStatus))
            }
          >
            <option value="">All pipeline statuses</option>
            {PIPELINE_STATUS_OPTIONS.map((status) => (
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

      {orders.state === 'failed' ? (
        <ReadFailure word="Orders unavailable" reason={orders.reason} onRetry={orders.reload} />
      ) : (
        <DataTable<OrderEntryDto>
          columns={columns}
          rows={rows}
          nextCursor={orders.state === 'ready' ? orders.data.nextCursor : null}
          onCursor={orders.onCursor}
          renderExpanded={(order) =>
            expandedId === order.id ? (
              <PackDispatchPanel
                tenantId={tenantId}
                orderId={order.id}
                canPack={canPack}
                canDispatch={canDispatch}
              />
            ) : null
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
    </div>
  );
}

/** The filter's arms, as the plain status labels — derived, never hand-listed. */
const PIPELINE_STATUS_OPTIONS: readonly PipelineStatus[] = [...PIPELINE_STATUSES];

/* ------------------------------------------------------------------ */
/* The expanded panel                                                  */
/* ------------------------------------------------------------------ */

/**
 * One order's bench panel, fetched when its row expands — the 4-2b shape
 * (there is no `[id]` route and the list row cannot carry lines).
 *
 * The panel adapts to the row's status: an accepted order shows the pack
 * bench (`pack.execute` only), a `ready_to_dispatch` one the dispatch
 * confirmation (`dispatch.execute`), and a dispatched one a terminal note —
 * a dispatched row offers nothing, because dispatch has no reverse arm. The
 * slip and dispatch record returned by THIS panel's own mutations render at
 * the top and outlive the status flip the broadcaster's refetch brings.
 */
function PackDispatchPanel({
  tenantId,
  orderId,
  canPack,
  canDispatch,
}: {
  tenantId: string;
  orderId: string;
  canPack: boolean;
  canDispatch: boolean;
}) {
  const detail = useOrderDetail(orderId);
  // The SKU map only decorates: it names each line's SKU code and unit, and a
  // line falls back to its raw `skuId` and the unit-agnostic quantity copy
  // when its SKU cannot be resolved — the pack flow is never blocked on it.
  const skus = useOutboundSkus();
  const skuMap = skus.state === 'ready' ? skus.data : null;
  const uomOf = (skuId: string) => skuMap?.[skuId];

  // The slip and the dispatch record are THIS panel's mutation results. The
  // refetch the broadcaster triggers flips the row's status, and these keep
  // rendering through it — a retry (same key, same payload) re-serves both
  // byte-for-byte, so nothing here can disagree with the server.
  const [slip, setSlip] = useState<PackDto | null>(null);
  const [record, setRecord] = useState<DispatchDto | null>(null);

  if (detail.state === 'loading') {
    return <div className="text-xs text-(--muted-foreground)">Loading order…</div>;
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

  const order = detail.data;
  // The detail read is the live status — the row prop can lag one refetch
  // behind it after a pack or dispatch, and the bench must follow the truth.
  const status = order.status;

  return (
    <div className="flex flex-col gap-3">
      {slip !== null && (
        <div className="flex flex-col gap-2">
          <FeedbackBanner {...packOutcome(slip, uomOf)} />
          <div className="flex flex-col gap-2 rounded-sm border border-(--border) bg-(--muted) p-3">
            <div className="text-xs font-medium">Packing slip</div>
            <div className="text-xs text-(--muted-foreground)">
              Packed by {slip.packedBy} ·{' '}
              <time dateTime={slip.packedAt}>{new Date(slip.packedAt).toLocaleString()}</time> ·{' '}
              {parcelMeasurementLabel(slip)}
            </div>
            <ul className="flex flex-col gap-1">
              {slip.lines.map((line) => (
                <li key={line.orderLineId} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-mono">{line.skuCode}</span>
                  <span className="text-(--muted-foreground)">{line.skuName}</span>
                  <span className="data">{packedLineLabel(line, uomOf(line.skuId))}</span>
                </li>
              ))}
            </ul>
            <div className="data text-xs">
              {quantityLabel(slip.totalUnits, sharedQuantityUom(slip.lines, uomOf))} in the parcel
            </div>
          </div>
        </div>
      )}
      {record !== null && (
        <div className="flex flex-col gap-2">
          <FeedbackBanner {...dispatchOutcome(record)} />
          <div className="flex flex-col gap-2 rounded-sm border border-(--border) bg-(--muted) p-3">
            <div className="text-xs font-medium">Dispatch record</div>
            <div className="text-xs text-(--muted-foreground)">
              {dispatchRecordLabel(record)} · dispatched by {record.dispatchedBy} ·{' '}
              <time dateTime={record.dispatchedAt}>
                {new Date(record.dispatchedAt).toLocaleString()}
              </time>
            </div>
            <ul className="flex flex-col gap-1">
              {record.lines.map((line) => (
                <li key={line.orderLineId} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-mono">{line.skuCode}</span>
                  <span className="text-(--muted-foreground)">{line.skuName}</span>
                  <span className="data">{dispatchedLineLabel(line, uomOf(line.skuId))}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {status === 'accepted' ? (
        canPack ? (
          <PackBench
            tenantId={tenantId}
            orderId={orderId}
            lines={order.lines}
            skuMap={skuMap}
            onPacked={setSlip}
          />
        ) : (
          <ReadOnlyLines lines={order.lines} skuMap={skuMap} />
        )
      ) : (
        <>
          <ReadOnlyLines lines={order.lines} skuMap={skuMap} />
          {status === 'ready_to_dispatch' &&
            (canDispatch ? (
              <DispatchSection
                tenantId={tenantId}
                orderId={orderId}
                onDispatched={setRecord}
              />
            ) : (
              <div className="text-xs text-(--muted-foreground)">
                Packed and waiting for dispatch.
              </div>
            ))}
          {status === 'dispatched' && (
            <div className="text-xs text-(--muted-foreground)">
              Dispatched — terminal. There is no un-dispatch.
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** The line list a panel shows when it has no bench affordance to offer. */
function ReadOnlyLines({
  lines,
  skuMap,
}: {
  lines: readonly OrderLineDto[];
  skuMap: Readonly<Record<string, SkuResponse>> | null;
}) {
  return (
    <ul className="flex flex-col gap-1">
      {lines.map((line) => (
        <li key={line.id} className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-mono">{skuMap?.[line.skuId]?.code ?? line.skuId}</span>
          <span className="text-(--muted-foreground)">{skuMap?.[line.skuId]?.name ?? ''}</span>
          <span className="data">{lineQuantityLabel(line, skuMap?.[line.skuId])}</span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* The pack bench                                                      */
/* ------------------------------------------------------------------ */

/**
 * The pack bench (capability `pack.execute`). One entered quantity per order
 * line, seeded from the line's ORDERED quantity — the fast common full pack —
 * and the packer edits down; a short-picked order gets the server's 422
 * naming both quantities and corrects here. Weight and dimensions are
 * optional, the dimensions all-or-nothing client-side (the backend refuses a
 * two-sided box with a 400, so nothing is sent that it would only 400).
 *
 * The `Idempotency-Key` is minted once per DRAFT: a pack that times out after
 * the server committed replays on retry instead of packing a second parcel,
 * and the replay re-serves the slip byte-for-byte. Any draft edit — a scanned
 * entry or a measurement — mints a fresh key, because the same key with a
 * changed body is what the backend answers 422 `idempotency-key-reuse` to.
 */
function PackBench({
  tenantId,
  orderId,
  lines,
  skuMap,
  onPacked,
}: {
  tenantId: string;
  orderId: string;
  lines: readonly OrderLineDto[];
  /** Decorates each line with its SKU's code, name and unit — never a gate. */
  skuMap: Readonly<Record<string, SkuResponse>> | null;
  onPacked: (pack: PackDto) => void;
}) {
  const skuOf = (skuId: string) => skuMap?.[skuId];
  const [scans, setScans] = useState<readonly PackScanDraftLine[]>(() =>
    packScanDraftFromLines(lines),
  );
  const [measurements, setMeasurements] = useState<PackMeasurements>(EMPTY_MEASUREMENTS);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A mutation that settles after its tree unmounts: the panel collapses, the
  // warehouse switches, or the pack's own broadcaster refetch flips the row's
  // status and unmounts this bench.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Any draft edit invalidates the key the previous attempt would replay. */
  function editScan(orderLineId: string, scanned: string) {
    setIdempotencyKey(null);
    setScans((current) =>
      current.map((entry) => (entry.orderLineId === orderLineId ? { ...entry, scanned } : entry)),
    );
  }

  function editMeasurements(patch: Partial<PackMeasurements>) {
    setIdempotencyKey(null);
    setMeasurements((current) => ({ ...current, ...patch }));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = parsePackDraft(scans, measurements);
    if (parsed.body === null) {
      // Nothing is requested that the backend would only answer 400 to.
      setProblem(parsed.problem ?? '');
      return;
    }
    setProblem(null);
    // Reused across retries of an unchanged draft; minted afresh otherwise.
    const key = idempotencyKey ?? ulid();
    setIdempotencyKey(key);
    setPending(true);
    setError(null);
    try {
      const { pack } = await fetchApiPackOrder(tenantId, orderId, parsed.body, key);
      if (!mounted.current) return;
      onPacked(pack);
      setIdempotencyKey(null);
      notifyOutboundChanged();
    } catch (error) {
      if (!mounted.current) return;
      // The refusal names the discrepancy verbatim and nothing was written —
      // the draft stays on screen with its key, so a retry replays.
      setError(packReason(error));
    } finally {
      if (mounted.current) setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-sm border border-(--border) p-3">
      <div className="text-xs text-(--muted-foreground)">
        Count what is in the parcel, per line — the entries start from what each line ordered, and
        the server verifies them against what was actually picked, refusing a mismatch naming both
        quantities.
      </div>
      <ul className="flex flex-col gap-2">
        {scans.map((entry) => (
          <li key={entry.orderLineId} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-wrap items-center gap-2 text-xs">
              <span className="font-mono">{skuOf(entry.skuId)?.code ?? entry.skuId}</span>
              <span className="text-(--muted-foreground)">{skuOf(entry.skuId)?.name ?? ''}</span>
              <span className="data">{quantityLabel(entry.orderedQty, skuOf(entry.skuId) ?? null)} ordered</span>
            </div>
            <label className="flex flex-col gap-1 sm:w-40">
              <span className={labelClass}>Scanned</span>
              <input
                className={inputClass}
                type="number"
                inputMode="decimal"
                // The input constrains NOTHING (`step="any"`, no `min`): the
                // backend's precision and positivity refusals naming the unit
                // are the authority, and a cleared field is "none counted".
                step="any"
                value={entry.scanned}
                onChange={(e) => editScan(entry.orderLineId, e.target.value)}
                title={quantityInputLabel(skuOf(entry.skuId)?.uomPrecision ?? 0)}
              />
            </label>
          </li>
        ))}
      </ul>
      <fieldset className="flex flex-col gap-2 rounded-sm border border-(--border) p-3">
        <legend className="px-1 text-xs text-(--muted-foreground)">Parcel measurements (optional)</legend>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="flex flex-1 flex-col gap-1">
            <span className={labelClass}>Weight (g)</span>
            <input
              className={inputClass}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={measurements.weightGrams}
              onChange={(e) => editMeasurements({ weightGrams: e.target.value })}
              placeholder="—"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className={labelClass}>Length (mm)</span>
            <input
              className={inputClass}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={measurements.lengthMm}
              onChange={(e) => editMeasurements({ lengthMm: e.target.value })}
              placeholder="—"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className={labelClass}>Width (mm)</span>
            <input
              className={inputClass}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={measurements.widthMm}
              onChange={(e) => editMeasurements({ widthMm: e.target.value })}
              placeholder="—"
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className={labelClass}>Height (mm)</span>
            <input
              className={inputClass}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={measurements.heightMm}
              onChange={(e) => editMeasurements({ heightMm: e.target.value })}
              placeholder="—"
            />
          </label>
        </div>
      </fieldset>
      <div>
        <button type="submit" disabled={pending} className={primaryClass}>
          {pending ? 'Packing…' : 'Pack this order'}
        </button>
      </div>
      {problem !== null && (
        <FeedbackBanner tone="rejected" word="Not packed" reason={problem} />
      )}
      {error !== null && (
        <FeedbackBanner tone="rejected" word="Not packed" reason={error} />
      )}
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Dispatch                                                            */
/* ------------------------------------------------------------------ */

/**
 * The dispatch confirmation (capability `dispatch.execute`). Dispatch is
 * TERMINAL — the confirm says so — and its carrier / tracking fields are
 * optional labeled free text: no client-side vocabulary is invented here
 * (4-6c structures them). An empty body is a complete dispatch.
 *
 * The `Idempotency-Key` is minted when the confirmation OPENS and reused
 * across retries of it — a dispatch that times out after the server committed
 * replays rather than re-dispatching — and a carrier / tracking edit mints a
 * fresh key, because the same key with a changed body is what the backend
 * answers 422 `idempotency-key-reuse` to.
 */
function DispatchSection({
  tenantId,
  orderId,
  onDispatched,
}: {
  tenantId: string;
  orderId: string;
  onDispatched: (record: DispatchDto) => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [fields, setFields] = useState({ carrierName: '', trackingNumber: '' });
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function editFields(patch: Partial<typeof fields>) {
    setIdempotencyKey(null);
    setFields((current) => ({ ...current, ...patch }));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const key = idempotencyKey ?? ulid();
    setIdempotencyKey(key);
    setPending(true);
    setError(null);
    try {
      const { dispatch } = await fetchApiDispatchOrder(
        tenantId,
        orderId,
        parseDispatchDraft(fields),
        key,
      );
      if (!mounted.current) return;
      onDispatched(dispatch);
      setConfirmOpen(false);
      setIdempotencyKey(null);
      notifyOutboundChanged();
    } catch (error) {
      if (!mounted.current) return;
      // The refusal stays on screen with the confirmation still open — "not
      // packed" is a race with a pack this client cannot see, so the server's
      // own words are what gets rendered.
      setError(dispatchReason(error));
    } finally {
      if (mounted.current) setPending(false);
    }
  }

  if (!confirmOpen) {
    return (
      <div className="flex flex-col gap-2">
        <button
          type="button"
          className={primaryClass}
          onClick={() => {
            setIdempotencyKey(ulid());
            setConfirmOpen(true);
          }}
        >
          Dispatch this order
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 rounded-sm border border-(--border) bg-(--muted) p-3">
      <div className="text-xs text-(--muted-foreground)">
        {DISPATCH_TERMINAL_WARNING} The carrier and tracking number are optional free text.
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>Carrier (optional)</span>
          <input
            className={inputClass}
            value={fields.carrierName}
            onChange={(e) => editFields({ carrierName: e.target.value })}
            maxLength={200}
            placeholder="Blue Dart"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>Tracking number (optional)</span>
          <input
            className={inputClass}
            value={fields.trackingNumber}
            onChange={(e) => editFields({ trackingNumber: e.target.value })}
            maxLength={200}
            placeholder="BD0012345678"
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={primaryClass}>
          {pending ? 'Dispatching…' : 'Dispatch this order'}
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirmOpen(false);
            setIdempotencyKey(null);
          }}
          className={buttonClass}
        >
          Keep it as it is
        </button>
      </div>
      {error !== null && (
        <FeedbackBanner tone="rejected" word="Not dispatched" reason={error} />
      )}
    </form>
  );
}