'use client';

import { useTodayIst } from '@/components/shared/use-today-ist';
import { BackorderChip, OrderFieldChips } from '@/components/shared/order-chips';
import Link from 'next/link';
import { findOrderHref } from '@/lib/palette';
import { manifestCodLabel, orderTypeLabel, paymentLine } from '@/lib/order-fields';
import { useEffect, useRef, useState } from 'react';

import {
  fetchApiCreateManifest,
  fetchApiDispatchOrder,
  fetchApiLabelOrder,
  fetchApiPackOrder,
} from '@/lib/api/client';
import type {
  DispatchDto,
  HandoverResponse,
  ManifestDto,
  OrderEntryDto,
  OrderLineDto,
  PackDto,
  ShipmentDto,
  SkuResponse,
} from '@/lib/api/generated';
import { quantityInputLabel, quantityLabel, sharedQuantityUom } from '@/lib/format-quantity';
import { notifyOutboundChanged } from '@/lib/outbound';
import {
  canLabelOrder,
  connectionOptionLabel,
  DISPATCH_TERMINAL_WARNING,
  benchIsShort,
  codShortWarning,
  dispatchFollowOn,
  dispatchOutcome,
  dispatchReason,
  dispatchRecordLabel,
  dispatchedLineLabel,
  EMPTY_MEASUREMENTS,
  formatInrPaise,
  isPipelineStatus,
  PIPELINE_STATUSES,
  labelReason,
  MANIFEST_TERMINAL_WARNING,
  manifestOutcome,
  manifestReason,
  parseDispatchDraft,
  parseLabelDraft,
  parseManifestDraft,
  packOutcome,
  SHORT_PARCEL_NOTE,
  slipIsShort,
  packReason,
  packedLineLabel,
  packScanDraftFromLines,
  parcelMeasurementLabel,
  parsePackDraft,
  shipmentRecordLabel,
  shipmentVoidedLabel,
  type PackMeasurements,
  type PackScanDraftLine,
  type PipelineStatus,
} from '@/lib/outbound-pack-dispatch';
import { filterPage, lineQuantityLabel, orderStatusLabel, pageFilterCount } from '@/lib/outbound-orders';
import { orderLabel, shortOrderId } from '@/lib/orders';
import { useCarrierConnections, useManifests, useOrderRates, useOrderShipment } from '@/lib/use-outbound-labels';
import { useOrderDetail, useOutboundSkus } from '@/lib/use-outbound-orders';
import { useOrderCartons, usePackedCartonSummaries, usePipelineOrders } from '@/lib/use-outbound-pack-dispatch';
import {
  buildPackBody,
  canSplitAtPack,
  carrierMultiCartonWarning,
  CATCH_WEIGHT_PACK_NOTE,
  cartonSkusFromScanned,
  gridMatchesScan,
  splitGrid,
  type CartonGrid,
} from '@/lib/cartons';
import { dispatchesByHandover, handoverOutcome, shippingCell } from '@/lib/shipping';
import { useOrderShipments, useOrderShipping } from '@/lib/use-shipping';
import { useOrdersOnTrucks } from '@/lib/use-freight';
import { onTruckCell } from '@/lib/freight';
import { useActiveClient, type ActiveClientState } from '@/lib/use-active-client';
import { roleHasCapability } from '@/lib/users';
import { ulid } from '@/lib/ulid';

import { DataTable, expandedRowId, type DataTableColumn } from '@/components/data-table/data-table';
import { AllClientsNote, ClientFilterChip } from '@/components/shared/client-filter-chip';
import { HandlingBadges } from '@/components/shared/handling-badges';
import { FeedbackBanner } from '@/components/feedback/banner';
import type { OutboundSurfaceProps } from '@/components/outbound/outbound';
import {
  buttonClass,
  inputClass,
  labelClass,
  primaryClass,
  ReadFailure,
  rowButtonClass,
  Section,
  selectClass,
} from '@/components/outbound/shell';
import { StatusChip } from '@/components/shared/status-chip';
import { orderStatusTone } from '@/lib/status-tone';
import { CancelOrderDialog, PutBackSection, type CancelTarget } from '@/components/outbound/cancel-order-dialog';
import { HandoverBuilder } from '@/components/outbound/handover-builder';
import { ShippingPanel } from '@/components/outbound/shipping-panel';
import { ConsignmentPanel } from '@/components/outbound/consignment-panel';
import { gateChip } from '@/lib/consignment';
import { CartonGridEditor } from '@/components/outbound/carton-editor';
import { PackCartonsPanel } from '@/components/outbound/print-pack-documents';

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
  // Story 4.6c — the label station and the manifest closure ride the same
  // surface, gated on `labels.execute` (the same Owner + Ops Manager +
  // Operator grant as pack and dispatch).
  const canLabel = roleHasCapability(role, 'labels.execute');
  // Story 4-2b — a packed order's Cancel (cancel with restock) is `orders.manage`.
  const canCancel = roleHasCapability(role, 'orders.manage');
  // Story 1-5a — the screen's one active-client read. The pipeline and the
  // manifest builder act on every client (a carrier pickup is never split,
  // decision 10); only the manifests LIST is filtered.
  const active = useActiveClient();
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
        canLabel={canLabel}
        canCancel={canCancel}
        active={active}
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
  canLabel,
  canCancel = false,
  active,
}: {
  tenantId: string;
  warehouseId: string;
  canPack: boolean;
  canDispatch: boolean;
  canLabel: boolean;
  /** Story 4-2b — `orders.manage`: the packed section's Cancel. */
  canCancel?: boolean;
  active: ActiveClientState;
}) {
  // Story 4-2a — today's IST date for the ship-by chips (re-read every minute).
  const todayIst = useTodayIst();
  const orders = usePipelineOrders(warehouseId);
  const [statusFilter, setStatusFilter] = useState<PipelineStatus | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Story 4-2b — the order the Cancel dialog is open on. It renders above the
  // table, not in the row: a cancelled order leaves the pipeline on the
  // refetch, and the dialog's put-back result must outlive its row.
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);

  // The pipeline page-scoped to its statuses: a cancelled order is not on it.
  // The list endpoint offers cursor + limit and nothing else — no status
  // filter, no sort, no search — so this control filters the LOADED page and
  // says so, counting against the pipeline-filtered set: the denominator
  // names only orders this page could ever show.
  const loaded = orders.state === 'ready' ? orders.data.items : [];
  const pipeline = loaded.filter((order) => isPipelineStatus(order.status));
  const rows = filterPage(pipeline, statusFilter);
  // Story 4-4a — the live shipment of each open order on the page: the
  // Shipping cell, and (its labelled carrier rows) the manifest builder.
  const openOrderIds = pipeline
    .filter((order) => order.status === 'accepted' || order.status === 'ready_to_dispatch')
    .map((order) => order.id);
  const shipments = useOrderShipments(tenantId, openOrderIds);
  // Story 4-5a (A26) — the packed row's "3 cartons · 12.4 kg".
  const packedOrderIds = pipeline.filter((order) => order.status === 'ready_to_dispatch').map((order) => order.id);
  const cartonSummaries = usePackedCartonSummaries(tenantId, packedOrderIds);
  // Story 4-9a (A30) — the rows on an open truck: "On truck LD-0007 (stop 3)".
  const onTrucks = useOrdersOnTrucks(tenantId, openOrderIds);
  // Story 4-4a (A20) — the handover builder, opened from a row's "Hand over".
  const [handover, setHandover] = useState<{ clientId: string | null; orderId: string; more: readonly string[] } | null>(null);
  // FE14 — Hand over on another row while the builder is open: joins the open draft for the same client, else says why not.
  const [handoverNote, setHandoverNote] = useState<string | null>(null);
  function requestHandover(orderId: string, clientId: string | null) {
    if (handover === null) {
      setHandoverNote(null);
      setHandover({ orderId, clientId, more: [] });
    } else if (handover.clientId === clientId) {
      setHandoverNote(null);
      if (orderId !== handover.orderId && !handover.more.includes(orderId)) setHandover({ ...handover, more: [...handover.more, orderId] });
    } else {
      setHandoverNote('The handover builder is open for another client — confirm or discard it, then hand this order over.');
    }
  }
  const [handedOver, setHandedOver] = useState<HandoverResponse | null>(null);

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
          {/* Story 4-1b — the order label, the short id beneath. */}
          <span className="flex flex-col">
            <span className="flex items-center gap-1">
              <span className="font-mono text-xs" data-testid="order-label">
                {orderLabel(order)}
              </span>
              {/* Story 4-2c — a backorder follow-on (the rest of a short shipment). */}
              <BackorderChip followOnSeq={order.followOnSeq} />
            </span>
            <span className="font-mono text-[11px] text-(--muted-foreground)" title={order.id}>
              {shortOrderId(order.id)}
            </span>
          </span>
        </button>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (order) => (
        <span className="flex flex-col items-start gap-0.5">
          <StatusChip tone={orderStatusTone(order.status)}>{orderStatusLabel(order.status)}</StatusChip>
          {cartonSummaries.get(order.id) !== undefined && (
            <span className="text-[11px] text-(--muted-foreground)" data-testid="packed-row-cartons">
              {cartonSummaries.get(order.id)}
            </span>
          )}
        </span>
      ),
    },
    {
      // Story 4-2a — priority, ship-by and the payment line (what to collect).
      key: 'fields',
      header: 'Priority · ship-by · payment',
      render: (order) => <OrderFieldChips order={order} todayIst={todayIst} />,
    },
    {
      // Story 4-4a (A20) — who carries the parcel: word first, tone second.
      key: 'shipping',
      header: 'Shipping',
      render: (order) => {
        if (order.status !== 'accepted' && order.status !== 'ready_to_dispatch') return null;
        // FB3 — a failed read says so, with a Retry; never an endless "…".
        const failure = shipments.state === 'ready' ? shipments.failures.get(order.id) : undefined;
        if (failure !== undefined) {
          return (
            <span className="flex items-center gap-1 text-xs" data-testid="shipping-cell-failed" title={failure}>
              <StatusChip tone="danger">Not loaded</StatusChip>
              <button type="button" className={rowButtonClass} onClick={shipments.reload}>
                Retry
              </button>
            </span>
          );
        }
        const truck = onTrucks.get(order.id);
        if (truck !== undefined) {
          return (
            <span data-testid="shipping-cell-truck">
              <StatusChip tone="info">{onTruckCell(truck)}</StatusChip>
            </span>
          );
        }
        const cell = shipments.state === 'ready' ? shippingCell(shipments.data.get(order.id)) : null;
        return cell === null ? (
          <span className="text-xs text-(--muted-foreground)">…</span>
        ) : (
          <span data-testid="shipping-cell">
            <StatusChip tone={cell.tone}>{cell.word}</StatusChip>
          </span>
        );
      },
    },
    {
      // Story 4-6a (A24) — the brand's documents: the word first, the tone second.
      key: 'docs',
      header: 'Docs',
      render: (order) => {
        if (order.status !== 'accepted' && order.status !== 'ready_to_dispatch') return null;
        const chip = gateChip(order.consignmentState);
        return chip === null ? (
          <span className="text-xs text-(--muted-foreground)">—</span>
        ) : (
          <span data-testid="docs-cell">
            <StatusChip tone={chip.tone}>{chip.word}</StatusChip>
          </span>
        );
      },
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
      <AllClientsNote active={active} />
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
          {pageFilterCount(rows.length, pipeline.length)}
        </span>
      </div>

      {handedOver !== null && <FeedbackBanner tone="accepted" {...handoverOutcome(handedOver)} />}
      {handoverNote !== null && <FeedbackBanner tone="warning" word="Builder open for another client" reason={handoverNote} />}
      {handover !== null && (
        <HandoverBuilder
          tenantId={tenantId}
          warehouseId={warehouseId}
          initialClientId={handover.clientId}
          initialOrderId={handover.orderId}
          requestedOrderIds={handover.more}
          onClose={() => {
            setHandover(null);
            setHandoverNote(null);
          }}
          onCreated={(response) => {
            setHandover(null);
            setHandedOver(response);
          }}
        />
      )}

      {cancelTarget !== null && (
        <CancelOrderDialog
          key={cancelTarget.id}
          tenantId={tenantId}
          warehouseId={warehouseId}
          order={cancelTarget}
          onClose={() => setCancelTarget(null)}
        />
      )}

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
                canLabel={canLabel}
                canCancel={canCancel}
                onHandOver={canDispatch ? requestHandover : undefined}
                // One dialog at a time; the button stays mounted so focus can return to it on close.
                onCancel={canCancel ? (target) => setCancelTarget((open) => open ?? target) : undefined}
              />
            ) : null
          }
          emptyMessage={
            loaded.length === 0 ? 'No orders in this warehouse yet.' : 'No orders on this page match that status.'
          }
          // Story UI-2 (C14) — a cold load is a skeleton, never an empty-row sentence.
          loading={orders.state === 'loading' ? 'Loading orders…' : undefined}
        />
      )}

      <ManifestSection
        tenantId={tenantId}
        warehouseId={warehouseId}
        pageOrders={pipeline}
        shipments={shipments}
        canLabel={canLabel}
        active={active}
      />
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
  canLabel,
  canCancel = false,
  onCancel,
  onHandOver,
}: {
  tenantId: string;
  orderId: string;
  canPack: boolean;
  canDispatch: boolean;
  canLabel: boolean;
  /** Story 4-4a — `orders.manage`: remove a shipping document. */
  canCancel?: boolean;
  /** Story 4-2b — opens the Cancel dialog; absent without `orders.manage` (hidden, never disabled). */
  onCancel?: (target: CancelTarget) => void;
  /** Story 4-4a — opens the handover builder on this order; absent without `dispatch.execute`. */
  onHandOver?: (orderId: string, clientId: string | null) => void;
}) {
  const detail = useOrderDetail(orderId);
  // Story 4-4a (A13, A20) — a live client-arranged shipment is dispatched only by a handover.
  const shipmentRead = useOrderShipment(orderId);
  const viaHandover =
    shipmentRead.state === 'ready' && shipmentRead.data !== null && dispatchesByHandover(shipmentRead.data.shipment);
  // Story 4-9a (A30) — an order on an open truck leaves with the load: Dispatch and Hand over give way to "Open load".
  const shippingRead = useOrderShipping(orderId);
  const truck = shippingRead.state === 'ready' && shippingRead.data?.freight != null && shippingRead.data.freight.status === 'planned' ? shippingRead.data.freight : null;
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
      <ReadFailure word="Order unavailable" reason={detail.reason} onRetry={detail.reload} />
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
            {/* Story 4-2a — the type and the payment line ("—" on a slip stored before 4-2a). */}
            <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="slip-order-fields">
              <span>{orderTypeLabel(slip.orderType)}</span>
              <span className="data font-medium" data-testid="slip-payment">
                {paymentLine(slip)}
              </span>
            </div>
            <div className="text-xs text-(--muted-foreground)">
              Packed by {slip.packedBy} ·{' '}
              <time dateTime={slip.packedAt}>{new Date(slip.packedAt).toLocaleString()}</time> ·{' '}
              {parcelMeasurementLabel(slip)}
            </div>
            {/* Story 4-5a — absent on a slip stored before 4-5a: one carton. */}
            {slip.cartons !== undefined && slip.cartons.length > 1 && (
              <div className="text-xs" data-testid="slip-cartons">
                Packed in {slip.cartons.length} cartons — print the carton labels and slips below.
              </div>
            )}
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
            {/* Story 4-2c — a short parcel says the rest follows (the follow-on opens at dispatch). */}
            {slipIsShort(slip) && (
              <div className="flex items-center gap-1 text-xs font-medium" data-testid="slip-short-note">
                <span aria-hidden>↳</span>
                {SHORT_PARCEL_NOTE}
              </div>
            )}
            {codShortWarning(slip.codAmountPaise, slipIsShort(slip)) !== null && (
              <div className="text-xs" data-testid="slip-cod-short">
                {codShortWarning(slip.codAmountPaise, slipIsShort(slip))}
              </div>
            )}
          </div>
        </div>
      )}
      {record !== null && (
        <div className="flex flex-col gap-2">
          <FeedbackBanner {...dispatchOutcome(record, uomOf)} />
          <DispatchFollowOnNote record={record} />
          <div className="flex flex-col gap-2 rounded-sm border border-(--border) bg-(--muted) p-3">
            <div className="text-xs font-medium">Dispatch record</div>
            <div className="data text-xs font-medium" data-testid="dispatch-payment">
              {paymentLine(record)}
            </div>
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

      {(status === 'accepted' || status === 'ready_to_dispatch' || status === 'dispatched') && (
        <ShippingPanel
          tenantId={tenantId}
          orderId={orderId}
          orderLabel={orderLabel(order)}
          status={status}
          canLabel={canLabel}
          canPack={canPack}
          canDispatch={canDispatch}
          canRemove={canCancel}
        />
      )}

      {/* Story 4-6a (A24) — the brand's tax document and e-way bill, beside Shipping. */}
      {(status === 'accepted' || status === 'ready_to_dispatch' || status === 'dispatched') && (
        <ConsignmentPanel orderId={orderId} orderLabel={orderLabel(order)} status={status} createdAt={order.createdAt} />
      )}

      {/* Story 4-5a (A26) — the packed order's cartons, the Print group and Re-pack into cartons. */}
      {(status === 'ready_to_dispatch' || status === 'dispatched') && (
        <PackCartonsPanel
          tenantId={tenantId}
          orderId={orderId}
          orderLabel={orderLabel(order)}
          status={status}
          canPack={canPack}
          canLabel={canLabel}
          carrierLabelled={
            shipmentRead.state === 'ready' &&
            shipmentRead.data !== null &&
            (shipmentRead.data.shipment.kind ?? 'carrier') === 'carrier' &&
            shipmentRead.data.shipment.status !== 'voided'
          }
          skuMap={skuMap}
        />
      )}

      {status === 'accepted' ? (
        canPack ? (
          <PackBench
            tenantId={tenantId}
            orderId={orderId}
            lines={order.lines}
            codAmountPaise={order.codAmountPaise ?? null}
            skuMap={skuMap}
            onPacked={setSlip}
          />
        ) : (
          <ReadOnlyLines lines={order.lines} skuMap={skuMap} />
        )
      ) : (
        <>
          <ReadOnlyLines lines={order.lines} skuMap={skuMap} />
          {status === 'ready_to_dispatch' && (
            <>
              {/* FB5 — a failed shipment read is shown, never the carrier path (a Dispatch button on a client-arranged order). */}
              {shipmentRead.state === 'failed' && (
                <ReadFailure word="Shipment unavailable" reason={shipmentRead.reason} onRetry={shipmentRead.reload} />
              )}
              {truck !== null && (
                <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="on-truck-row">
                  <span>{onTruckCell(truck)} — it leaves with the truck.</span>
                  <Link href={`/outbound?tab=freight&open=${truck.loadId}`} className={primaryClass} data-testid="open-load">
                    Open load
                  </Link>
                </div>
              )}
              {truck === null && shipmentRead.state === 'ready' && !viaHandover && <LabelSection tenantId={tenantId} orderId={orderId} canLabel={canLabel} />}
              {shipmentRead.state !== 'ready' || truck !== null ? null : viaHandover ? (
                // The 4.6c Dispatch button gives way to Hand over (A20).
                onHandOver !== undefined ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="hand-over-row">
                    <button
                      type="button"
                      className={primaryClass}
                      onClick={() => onHandOver(order.id, order.clientId ?? null)}
                      data-testid="open-hand-over"
                    >
                      Hand over
                    </button>
                    <span className="text-(--muted-foreground)">
                      The client arranged this courier — the handover dispatches it.
                    </span>
                  </div>
                ) : (
                  <div className="text-xs text-(--muted-foreground)">Packed and waiting for the client&apos;s courier.</div>
                )
              ) : canDispatch ? (
                <DispatchSection
                  tenantId={tenantId}
                  orderId={orderId}
                  onDispatched={setRecord}
                />
              ) : (
                <div className="text-xs text-(--muted-foreground)">
                  Packed and waiting for dispatch.
                </div>
              )}
              {onCancel !== undefined && (
                // Story 4-2b — cancel the packed order: the parcel's units go
                // back into stock (the dialog defaults to one bin) and an
                // unmanifested label is voided.
                <div className="flex flex-wrap items-center gap-2 border-t border-(--border) pt-2 text-xs">
                  <span className="text-(--muted-foreground)">Not shipping after all?</span>
                  <button
                    type="button"
                    className={rowButtonClass}
                    onClick={(event) => onCancel({ id: order.id, label: orderLabel(order), status: order.status, opener: event.currentTarget })}
                  >
                    Cancel order
                  </button>
                </div>
              )}
            </>
          )}
          {status === 'dispatched' && (
            <div className="text-xs text-(--muted-foreground)">
              Dispatched — terminal. There is no un-dispatch.
            </div>
          )}
          {status === 'cancelled' && (
            <>
              <div className="text-xs text-(--muted-foreground)">
                Cancelled — the pipeline stops here. Any units it had picked were restocked: they are booked back
                into stock, in the bins below.
              </div>
              {/* Story 4-2b (A9) — the put-back list, and a voided label. */}
              <PutBackSection orderId={orderId} />
              <LabelSection tenantId={tenantId} orderId={orderId} canLabel={false} />
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Story 4-2c — the dispatch confirmation's follow-on: "Shipped short —
 * follow-on 1042-BO1 created; it ships when stock arrives", with a link that
 * finds it on Orders (the search strips `-BO{n}` and lists the chain). An
 * unnamed chain (its label is a short id, which the search does not match)
 * names the follow-on without a link.
 */
function DispatchFollowOnNote({ record }: { record: DispatchDto }) {
  const followOn = dispatchFollowOn(record);
  if (followOn === null) return null;
  const named = (record.clientOrderRef ?? '') !== '' || (record.externalEventId ?? '') !== '';
  return (
    <FeedbackBanner
      tone="warning"
      word="Shipped short"
      reason={`${followOn.sentence}.`}
      action={
        named ? (
          <Link href={findOrderHref(followOn.label)} className="text-xs text-(--primary) underline underline-offset-2" data-testid="dispatch-follow-on-link">
            Open {followOn.label}
          </Link>
        ) : undefined
      }
    />
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
          {/* Story 1-6a — the handling warnings of the SKU on this line. */}
          <HandlingBadges sku={skuMap?.[line.skuId]} />
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
  codAmountPaise,
  skuMap,
  onPacked,
}: {
  tenantId: string;
  orderId: string;
  lines: readonly OrderLineDto[];
  /** Story 4-2c — the order's COD amount (null: prepaid): the short-parcel warning. */
  codAmountPaise: number | null;
  /** Decorates each line with its SKU's code, name and unit — never a gate. */
  skuMap: Readonly<Record<string, SkuResponse>> | null;
  onPacked: (pack: PackDto) => void;
}) {
  const skuOf = (skuId: string) => skuMap?.[skuId];
  const [scans, setScans] = useState<readonly PackScanDraftLine[]>(() =>
    packScanDraftFromLines(lines),
  );
  const [measurements, setMeasurements] = useState<PackMeasurements>(EMPTY_MEASUREMENTS);
  // Story 4-5a (A26) — null: one carton (today's form and payload); else the split grid.
  const [grid, setGrid] = useState<CartonGrid | null>(null);
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
    const parsed = parsePackDraft(scans, grid === null ? measurements : EMPTY_MEASUREMENTS);
    if (parsed.body === null) {
      // Nothing is requested that the backend would only answer 400 to.
      setProblem(parsed.problem);
      return;
    }
    // Story 4-5a — one carton sends today's exact body; a split sends the
    // scanned total plus the cartons, and no top-level measurements. A split
    // made before the scan changed is refused here (it would not add up).
    if (grid !== null && !gridMatchesScan(grid, parsed.body.scanned)) {
      setProblem('The scanned counts changed after the split — split again from the new counts.');
      return;
    }
    const built = buildPackBody(parsed.body, grid);
    if (built.body === null) {
      setProblem(built.problem);
      return;
    }
    setProblem(null);
    // Reused across retries of an unchanged draft; minted afresh otherwise.
    const key = idempotencyKey ?? ulid();
    setIdempotencyKey(key);
    setPending(true);
    setError(null);
    try {
      const { pack } = await fetchApiPackOrder(tenantId, orderId, built.body, key);
      if (!mounted.current) {
        // The bench unmounted mid-flight (row collapsed, warehouse switched)
        // but the pack COMMITTED — the sibling outbound readers must still
        // refetch, or they stay stale until their next read.
        notifyOutboundChanged();
        return;
      }
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
              {/* Story 1-6a — the handling warnings of the SKU being packed. */}
              <HandlingBadges sku={skuOf(entry.skuId)} />
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
      <CartonsFieldset
        scans={scans}
        skuMap={skuMap}
        grid={grid}
        onGrid={(next) => {
          setIdempotencyKey(null);
          setProblem(null);
          setGrid(next);
        }}
      />
      {grid === null && (
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
      )}
      {/* Story 4-2c (decision 4) — warned before it happens: a short COD parcel collects the full amount. */}
      {codShortWarning(codAmountPaise, benchIsShort(lines, scans)) !== null && (
        <FeedbackBanner
          tone="warning"
          word="Short COD parcel"
          reason={codShortWarning(codAmountPaise, benchIsShort(lines, scans))!}
        />
      )}
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

/**
 * Story 4-5a (A26) — the bench's Cartons fieldset: "One carton" by default
 * (today's form and payload), or "Split into cartons" — the bench's per-line
 * counts become a grid, SKUs × cartons, each row's total against the scan.
 * A scan edit after splitting asks for the split again from the new counts
 * (the split must add up to what is scanned). Catch-weight orders are packed
 * on the handheld; the split is not offered for them.
 */
function CartonsFieldset({
  scans,
  skuMap,
  grid,
  onGrid,
}: {
  scans: readonly PackScanDraftLine[];
  skuMap: Readonly<Record<string, SkuResponse>> | null;
  grid: CartonGrid | null;
  onGrid: (next: CartonGrid | null) => void;
}) {
  const parsed = parsePackDraft(scans, EMPTY_MEASUREMENTS);
  const skus =
    parsed.body === null
      ? []
      : cartonSkusFromScanned(parsed.body.scanned, (skuId) => {
          const sku = skuMap?.[skuId];
          return sku === undefined
            ? undefined
            : { skuCode: sku.code, skuName: sku.name, uom: { uom: sku.uom, uomPrecision: sku.uomPrecision }, catchWeight: sku.catchWeightTracked };
        });
  const stale = grid !== null && parsed.body !== null && !gridMatchesScan(grid, parsed.body.scanned);
  const splittable = canSplitAtPack(skus);
  return (
    <fieldset className="flex flex-col gap-2 rounded-sm border border-(--border) p-3" data-testid="cartons-fieldset">
      <legend className="px-1 text-xs text-(--muted-foreground)">Cartons</legend>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-1">
          <input type="radio" name="cartons-mode" checked={grid === null} onChange={() => onGrid(null)} />
          One carton
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            name="cartons-mode"
            checked={grid !== null}
            // Offered only once the SKUs are known — before that a catch-weight SKU looks plain.
            disabled={skuMap === null || !splittable || skus.length === 0}
            onChange={() => onGrid(splitGrid(skus))}
          />
          Split into cartons
        </label>
      </div>
      {!splittable && <div className="text-xs text-(--muted-foreground)">{CATCH_WEIGHT_PACK_NOTE}</div>}
      {grid !== null && stale && (
        <FeedbackBanner
          tone="warning"
          word="Scan changed"
          reason="The scanned counts changed after the split — start the split again from the new counts."
          action={
            <button type="button" className={buttonClass} onClick={() => onGrid(splitGrid(skus))}>
              Split again
            </button>
          }
        />
      )}
      {grid !== null && <CartonGridEditor grid={grid} mode="pack" onChange={onGrid} />}
    </fieldset>
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
      if (!mounted.current) {
        // The confirm unmounted mid-flight (row collapsed, warehouse
        // switched) but the dispatch COMMITTED — the sibling outbound
        // readers must still refetch, or they stay stale until their next
        // read.
        notifyOutboundChanged();
        return;
      }
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

/* ------------------------------------------------------------------ */
/* The label station (story 4.6c)                                      */
/* ------------------------------------------------------------------ */

/**
 * The label step in the row expansion (capability `labels.execute`, hidden —
 * never disabled — without it). One labelled shipment per order, ever: the
 * form is the connection picker plus the OPTIONAL parcel measurements (the
 * pack bench's rule, verbatim), and the 501 `carrier-transport-unconfigured`
 * / 503 `carrier-encryption-unavailable` refusals render the server's own
 * words inline — they are refusals, not errors: nothing was written, the
 * order stays `ready_to_dispatch`, and the retry is a fresh submit of the
 * still-mounted draft.
 *
 * The `Idempotency-Key` is minted once per DRAFT (the pack bench's
 * convention): a label that times out after the server committed replays on
 * retry instead of generating a second label, and any edit — connection or
 * measurement — mints a fresh key.
 */
function LabelSection({
  tenantId,
  orderId,
  canLabel,
}: {
  tenantId: string;
  orderId: string;
  canLabel: boolean;
}) {
  const connections = useCarrierConnections();
  const shipmentRead = useOrderShipment(orderId);
  // Story 4.6d — the rate shopping read, beside the shipment read: one
  // quoted-or-refused item per live connection, recomputed at every refetch
  // (it is a READ — nothing is stored), rendered as a strip between the
  // connection picker and the measurements so the operator picks a carrier
  // with the prices in view.
  const rates = useOrderRates(orderId);
  // Story 4-5a (A41) — one AWB covers every carton: said before buying.
  const cartons = useOrderCartons(tenantId, canLabel ? orderId : null);
  const multiCarton = carrierMultiCartonWarning(cartons.state === 'ready' && cartons.data !== null ? cartons.data.pack.cartonCount : null);
  // The label result is THIS panel's mutation result; the broadcaster's
  // refetch re-runs the shipment read, and the local state keeps rendering
  // through the flip.
  const [labelled, setLabelled] = useState<ShipmentDto | null>(null);
  const [connectionId, setConnectionId] = useState('');
  const [measurements, setMeasurements] = useState<PackMeasurements>(EMPTY_MEASUREMENTS);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Any draft edit invalidates the key the previous attempt would replay. */
  function editMeasurements(patch: Partial<PackMeasurements>) {
    setIdempotencyKey(null);
    setMeasurements((current) => ({ ...current, ...patch }));
  }

  function pickConnection(id: string) {
    setIdempotencyKey(null);
    setConnectionId(id);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = parseLabelDraft(connectionId, measurements);
    if (parsed.body === null) {
      // Nothing is requested that the backend would only answer 400 to.
      setProblem(parsed.problem);
      return;
    }
    setProblem(null);
    // Reused across retries of an unchanged draft; minted afresh otherwise.
    const key = idempotencyKey ?? ulid();
    setIdempotencyKey(key);
    setPending(true);
    setError(null);
    try {
      const { shipment } = await fetchApiLabelOrder(tenantId, orderId, parsed.body, key);
      if (!mounted.current) {
        // The panel unmounted mid-flight but the label COMMITTED — the
        // sibling outbound readers (the list, the manifest section) must
        // still refetch.
        notifyOutboundChanged();
        return;
      }
      setLabelled(shipment);
      setIdempotencyKey(null);
      setMeasurements(EMPTY_MEASUREMENTS);
      notifyOutboundChanged();
    } catch (caught) {
      if (!mounted.current) return;
      // The refusal renders verbatim and nothing was written — the form
      // stays on screen with its draft and key, so the retry is a fresh
      // submit of the same request.
      setError(labelReason(caught));
    } finally {
      if (mounted.current) setPending(false);
    }
  }

  // The shipment read is the truth: a label generated elsewhere (another
  // operator, an API call) shows up here through the broadcaster's refetch —
  // and the read-back outranks the local `labelled` snapshot, which goes
  // stale the moment the shipment manifests (the read-back sees
  // `manifested`; `labelled` still says `labelled`).
  const shipment =
    (shipmentRead.state === 'ready' && shipmentRead.data !== null ? shipmentRead.data.shipment : null) ??
    labelled;

  if (shipment !== null) {
    // Terminal when the shipment closed onto a manifest; otherwise the record
    // names the carrier and tracking, and dispatch auto-stamps from it.
    return (
      <div className="flex flex-col gap-1 rounded-sm border border-(--border) bg-(--muted) p-3 text-xs">
        <div className="font-medium">Label</div>
        <div className="text-(--muted-foreground)">
          {shipmentRecordLabel(shipment)} · labelled by {shipment.labelledBy}
        </div>
        {shipment.status === 'voided' ? (
          // Story 4-2b — the label of an order cancelled before it was manifested.
          <div className="flex flex-wrap items-center gap-2" data-testid="label-voided">
            <StatusChip tone="neutral">Voided</StatusChip>
            <span className="text-(--muted-foreground)">{shipmentVoidedLabel(shipment)}</span>
          </div>
        ) : (
          <div className="text-(--muted-foreground)">
            {shipment.manifestId === null
              ? 'Dispatch stamps this carrier and tracking onto the record unless free text is given.'
              : 'Manifested — the shipment closed onto a manifest and is terminal.'}
          </div>
        )}
      </div>
    );
  }

  if (shipmentRead.state === 'loading') {
    return <div className="text-xs text-(--muted-foreground)">Loading label…</div>;
  }
  if (shipmentRead.state === 'failed') {
    return <ReadFailure word="Label unavailable" reason={shipmentRead.reason} onRetry={shipmentRead.reload} />;
  }

  // No label yet: the form is the affordance, gated (hidden, not disabled).
  if (!canLabel) {
    return null;
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2 rounded-sm border border-(--border) p-3">
      <div className="text-xs text-(--muted-foreground)">
        Generate the carrier label. The order stays ready to dispatch and dispatch auto-stamps this
        shipment&apos;s carrier and tracking unless free text is given.
      </div>
      {connections.state === 'loading' ? (
        <div className="text-xs text-(--muted-foreground)">Loading carrier connections…</div>
      ) : connections.state === 'failed' ? (
        <ReadFailure word="Connections unavailable" reason={connections.reason} onRetry={connections.reload} />
      ) : connections.data.length === 0 ? (
        <div className="text-xs text-(--muted-foreground)">
          No carrier connection is set up yet — connect one in Settings to generate labels.
        </div>
      ) : (
        <label className="flex flex-col gap-1 sm:w-80">
          <span className={labelClass}>Carrier connection</span>
          <select
            className={selectClass}
            value={connectionId}
            onChange={(e) => pickConnection(e.target.value)}
          >
            <option value="">Pick a connection…</option>
            {connections.data.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connectionOptionLabel(connection)}
              </option>
            ))}
          </select>
        </label>
      )}
      {rates.state === 'loading' ? (
        <div className="text-xs text-(--muted-foreground)">Loading rates…</div>
      ) : rates.state === 'failed' ? (
        <ReadFailure word="Rates unavailable" reason={rates.reason} onRetry={rates.reload} />
      ) : rates.data === null || rates.data.rates.items.length === 0 ? null : (
        <div className="flex flex-col gap-1 rounded-sm border border-(--border) bg-(--muted) p-3 text-xs">
          <div className="font-medium">Rates</div>
          <div className="text-(--muted-foreground)">
            Recomputed at every read — nothing is stored, charged or promised.
          </div>
          {rates.data.rates.items.map((item) => (
            <div key={item.connectionId} className="flex flex-col gap-0.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{item.carrierName}</span>
                {item.quote !== null ? (
                  <span>{formatInrPaise(item.quote.amountPaise)}</span>
                ) : (
                  <span className="rounded-sm border border-(--border) bg-(--background) px-1.5 py-0.5 text-(--muted-foreground)">
                    {item.refusal === null ? 'Refused' : item.refusal.detail}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <fieldset className="flex flex-col gap-2 rounded-sm border border-(--border) p-3">
        <legend className="px-1 text-xs text-(--muted-foreground)">Measurements (optional)</legend>
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
      {multiCarton !== null && <FeedbackBanner tone="warning" word="Several cartons" reason={multiCarton} />}
      <div>
        <button type="submit" disabled={pending} className={primaryClass}>
          {pending ? 'Generating…' : 'Generate label'}
        </button>
      </div>
      {problem !== null && (
        <FeedbackBanner tone="rejected" word="Label not generated" reason={problem} />
      )}
      {error !== null && (
        <FeedbackBanner tone="rejected" word="Label not generated" reason={error} />
      )}
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* The manifest section (story 4.6c)                                   */
/* ------------------------------------------------------------------ */

/**
 * The manifest section below the table. Its reads are UNGATED — the manifest
 * is the hand-over record — while the builder is gated on `labels.execute`
 * (hidden, never disabled).
 *
 * The builder is PAGE-SCOPED, and says so: there is no list-shipments route,
 * only a per-order shipment read-back, so the closure is built from the
 * labelled shipments of this page's `ready_to_dispatch` orders. The selection
 * is scoped to ONE carrier connection client-side — each labelled shipment
 * carries its connection id, so a mixed set is refused before anything is
 * sent (the backend would 409 verbatim, but the refusal is deterministic
 * client-side).
 *
 * The `Idempotency-Key` is minted per CONFIRMATION (the dispatch confirm's
 * convention — the form's presentation IS the confirm): minted at the first
 * submit, reused across retries of an unchanged selection, and any selection
 * edit mints a fresh key.
 */
function ManifestSection({
  tenantId,
  warehouseId,
  pageOrders,
  shipments,
  canLabel,
  active,
}: {
  tenantId: string;
  warehouseId: string;
  /** The page's pipeline rows (unfiltered by the status control). */
  pageOrders: readonly OrderEntryDto[];
  /** Story 4-4a — the page's live shipments (one read, shared with the Shipping cell). */
  shipments: ReturnType<typeof useOrderShipments>;
  canLabel: boolean;
  /** Story 1-5a — filters the manifests list only; the builder is all clients. */
  active: ActiveClientState;
}) {
  const manifests = useManifests(warehouseId, active.filter);
  const readyOrderIds = pageOrders
    .filter((order) => canLabelOrder(order.status))
    .map((order) => order.id);
  const labelled = carrierLabelled(shipments, readyOrderIds);
  // Narrowed once: every closure below reads the ready arm's list, and an
  // empty page reads as none to manifest.
  const labelledShipments = labelled.state === 'ready' ? labelled.data : [];

  // The builder's draft: which connection's shipments, and which of them.
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ManifestDto | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /** A selection edit invalidates the key the previous attempt would replay. */
  function toggle(shipmentId: string) {
    setIdempotencyKey(null);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(shipmentId)) next.delete(shipmentId);
      else next.add(shipmentId);
      return next;
    });
  }

  function pickBuilderConnection(id: string | null) {
    setIdempotencyKey(null);
    setConnectionId(id);
    // A fresh connection means a fresh default: all of its labelled
    // shipments, pre-checked — the manifest is the hand-over of the batch.
    const group = id === null ? [] : labelledShipments.filter((s) => s.carrierConnectionId === id);
    setSelected(new Set(group.map((s) => s.id)));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const group = labelledShipments.filter((s) => s.carrierConnectionId === connectionId);
    const selectedShipments = group.filter((s) => selected.has(s.id));
    // The body is built from the VISIBLE, connection-filtered selection —
    // the checkboxes render `selectedShipments`, so the ids the operator
    // sees are the ids that post. (A stale id lingering in `selected` from a
    // previous read would otherwise post a shipment the current list does
    // not show — and the one-connection rule the server enforces is already
    // guaranteed here: `group` is a single connection's shipments.)
    const parsed = parseManifestDraft(selectedShipments.map((s) => s.id));
    if (parsed.body === null) {
      setProblem(parsed.problem);
      return;
    }
    setProblem(null);
    // Per-CONFIRMATION: reused across retries of an unchanged selection.
    const key = idempotencyKey ?? ulid();
    setIdempotencyKey(key);
    setPending(true);
    setError(null);
    try {
      const { manifest } = await fetchApiCreateManifest(tenantId, warehouseId, parsed.body, key);
      if (!mounted.current) {
        notifyOutboundChanged();
        return;
      }
      setOutcome(manifest);
      setSelected(new Set());
      setConnectionId(null);
      setIdempotencyKey(null);
      notifyOutboundChanged();
    } catch (caught) {
      if (!mounted.current) return;
      // The 409 offender (missing, foreign, wrong state) renders verbatim.
      setError(manifestReason(caught));
    } finally {
      if (mounted.current) setPending(false);
    }
  }

  const builderConnection =
    connectionId === null
      ? null
      : labelledShipments.filter((s) => s.carrierConnectionId === connectionId);

  return (
    <div className="flex flex-col gap-2 rounded-sm border border-(--border) p-3">
      <div className="text-xs font-medium">Manifests</div>
      <div className="text-xs text-(--muted-foreground)">
        A manifest closes labelled shipments for one carrier connection as the hand-over document —
        terminal, with no un-manifest.
      </div>

      {canLabel && (
        <div className="flex flex-col gap-2">
          {labelled.state === 'loading' ? (
            <div className="text-xs text-(--muted-foreground)">Checking this page for labelled shipments…</div>
          ) : labelled.state === 'failed' ? (
            <ReadFailure word="Shipments unavailable" reason={labelled.reason} onRetry={labelled.reload} />
          ) : labelledShipments.length === 0 ? (
            <div className="text-xs text-(--muted-foreground)">
              No labelled shipments to manifest on this page — generate labels on the rows above
              first.
            </div>
          ) : (
            <form onSubmit={onSubmit} className="flex flex-col gap-2 rounded-sm border border-(--border) bg-(--muted) p-3">
              <div className="text-xs text-(--muted-foreground)">
                {MANIFEST_TERMINAL_WARNING} The closure is all-or-nothing — nothing is written
                unless every named shipment closes.
              </div>
              <label className="flex flex-col gap-1 sm:w-80">
                <span className={labelClass}>Manifest onto</span>
                <select
                  className={selectClass}
                  value={connectionId ?? ''}
                  onChange={(e) => pickBuilderConnection(e.target.value === '' ? null : e.target.value)}
                >
                  <option value="">Pick a connection…</option>
                  {connectionGroups(labelled.data).map(([id, connection]) => (
                    <option key={id} value={id}>
                      {connection}
                    </option>
                  ))}
                </select>
              </label>
              {builderConnection !== null && (
                <ul className="flex flex-col gap-1">
                  {builderConnection.map((shipment) => (
                    <li key={shipment.id} className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={selected.has(shipment.id)}
                        onChange={() => toggle(shipment.id)}
                      />
                      <span className="font-mono">{shipment.orderId}</span>
                      <span className="data">
                        {shipmentRecordLabel(shipment)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <div>
                <button type="submit" disabled={pending} className={primaryClass}>
                  {pending ? 'Manifesting…' : 'Create manifest'}
                </button>
              </div>
              {outcome !== null && <FeedbackBanner {...manifestOutcome(outcome)} />}
              {problem !== null && (
                <FeedbackBanner tone="rejected" word="No manifest" reason={problem} />
              )}
              {error !== null && (
                <FeedbackBanner tone="rejected" word="No manifest" reason={error} />
              )}
            </form>
          )}
        </div>
      )}

      <ClientFilterChip active={active} tenantName={active.tenantName} />
      {manifests.state === 'loading' ? (
        <div className="text-xs text-(--muted-foreground)">Loading manifests…</div>
      ) : manifests.state === 'failed' ? (
        <ReadFailure word="Manifests unavailable" reason={manifests.reason} onRetry={manifests.reload} />
      ) : manifests.data.items.length === 0 ? (
        <div className="text-xs text-(--muted-foreground)">No manifests yet.</div>
      ) : (
        <div className="flex flex-col gap-1">
          {manifests.data.items.map((manifest) => (
            <div key={manifest.id} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-mono">{manifest.id}</span>
              <span>{manifest.carrierCode}</span>
              <span className="data">
                {manifest.shipmentCount} {manifest.shipmentCount === 1 ? 'shipment' : 'shipments'}
              </span>
              <span className="data" data-testid="manifest-cod">
                {manifestCodLabel(manifest)}
              </span>
              <span className="text-(--muted-foreground)">
                by {manifest.createdBy} ·{' '}
                <time dateTime={manifest.createdAt}>{new Date(manifest.createdAt).toLocaleString()}</time>
              </span>
            </div>
          ))}
          {manifests.data.nextCursor !== null && (
            <button
              type="button"
              className={`${buttonClass} w-fit`}
              onClick={() => manifests.onCursor(manifests.data.nextCursor)}
            >
              Older manifests
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** The distinct connection groups among labelled shipments, as picker options. */
function connectionGroups(
  shipments: readonly CarrierShipment[],
): readonly (readonly [string, string])[] {
  const seen = new Map<string, string>();
  for (const shipment of shipments) {
    if (!seen.has(shipment.carrierConnectionId)) {
      seen.set(shipment.carrierConnectionId, shipment.carrierName);
    }
  }
  return [...seen.entries()];
}

/**
 * The labelled CARRIER shipments of the page's ready orders (story 4.6c's
 * builder input), from the page's one shipments read. A client-arranged
 * shipment never manifests (4-4a: the handover closes it), and a row without
 * a connection cannot be grouped.
 */
function carrierLabelled(
  shipments: ReturnType<typeof useOrderShipments>,
  readyOrderIds: readonly string[],
): ({ state: 'loading' } | { state: 'ready'; data: readonly CarrierShipment[] } | { state: 'failed'; reason: string }) & {
  reload: () => void;
} {
  if (shipments.state !== 'ready') return shipments;
  // FB4 — only the READY orders' reads matter here: a failed read of an accepted order never fails the builder.
  const failed = readyOrderIds.find((orderId) => shipments.failures.has(orderId));
  if (failed !== undefined) return { state: 'failed', reason: shipments.failures.get(failed)!, reload: shipments.reload };
  const data = readyOrderIds.flatMap((orderId) => {
    const shipment = shipments.data.get(orderId) ?? null;
    return shipment !== null &&
      shipment.status === 'labelled' &&
      (shipment.kind ?? 'carrier') === 'carrier' &&
      shipment.carrierConnectionId !== null
      ? [shipment as CarrierShipment]
      : [];
  });
  return { state: 'ready', data, reload: shipments.reload };
}

/** A carrier shipment: its connection is set (4-4a made the column nullable for client-arranged rows). */
type CarrierShipment = ShipmentDto & { readonly carrierConnectionId: string };
