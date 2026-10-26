'use client';

import { useTodayIst } from '@/components/shared/use-today-ist';
import { OrderFieldsFieldset } from '@/components/shared/order-fields-fieldset';
import { OrderFieldChips } from '@/components/shared/order-chips';
import { emptyOrderFieldsDraft, type OrderFieldsDraft } from '@/lib/order-fields-form';
import { orderTypeLabel } from '@/lib/order-fields';
import { useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { ApiProblem, fetchApiPortalPlaceOrder } from '@/lib/api/client';
import type { PortalOrderRowDto, PortalPlacedOrderResponse } from '@/lib/api/generated';
import type { AsnDraftLine, LineOption } from '@/lib/asns';
import { readSession, subscribeSession } from '@/lib/auth';
import { emptyDestinationFields, type DestinationFields } from '@/lib/outbound-orders';
import {
  availableHereLabel,
  lineCountLabel,
  orderDestination,
  orderReference,
  orderStatusLabel,
  orderTimeline,
  parsePortalOrderCreate,
  placedOrderBanner,
  PORTAL_ORDER_NO_SKUS_MESSAGE,
  PORTAL_ORDER_NO_WAREHOUSES_MESSAGE,
  PORTAL_ORDER_SKUS_TOO_MANY_MESSAGE,
  PORTAL_SESSION_EXPIRED,
  portalDate,
  portalOrderReason,
  portalQuantity,
  portalSkuOption,
  portalWarehouseOptions,
  skuLabel,
} from '@/lib/portal';
import { ulid } from '@/lib/ulid';
import { usePortalOrder, usePortalOrders, usePortalSkuOptions, usePortalStockRows, usePortalWarehouses } from '@/lib/use-portal';
import { roleHasCapability } from '@/lib/users';

import { DataTable, TableSkeleton, expandedRowId, type DataTableColumn } from '@/components/data-table/data-table';
import { FeedbackBanner } from '@/components/feedback/banner';
import { LineRows } from '@/components/shared/line-rows';
import { OrderSearch } from '@/components/shared/order-search';
import { ShipToFieldset } from '@/components/shared/ship-to-fieldset';
import { ReadFailure, Section, buttonClass, inputClass, labelClass, primaryClass, rowButtonClass, selectClass } from '@/components/shared/surface';
import { WarehousesFailure } from '@/components/shared/warehouses-failure';
import { StatusChip } from '@/components/shared/status-chip';
import { StatusTimeline } from '@/components/shared/status-timeline';
import { ORDER_STATUS_TONE } from '@/lib/status-tone';

/**
 * Story 21-7 — the portal's Orders surface: this company's orders, newest
 * first; a row expands to its lines, a kit's components nested beneath it.
 *
 * Story 4-1a — the section gains "Place an order" (the portal's second
 * write, `orders.place`): a warehouse, the lines (this client's active
 * non-kit SKUs, from `portal/skus`), the ship-to address and the optional
 * buyer GSTIN and legal name. The client is the session's — nothing about it
 * is sent, and no line carries a rate. A shortage refuses the whole order,
 * naming the SKUs; each line shows what is free at the chosen warehouse
 * (`portal/stock`) as a non-blocking hint.
 */
export function PortalOrders() {
  // Story 4-2a — today's IST date for the ship-by chips (re-read every minute).
  const todayIst = useTodayIst();
  // Story 4-1b — the exact-match search over this company's own orders (null: none).
  const [reference, setReference] = useState<string | null>(null);
  const orders = usePortalOrders(null, reference);
  const [openId, setOpenId] = useState<string | null>(null);
  // Subscribed, never a bare readSession() at render.
  const role = useSyncExternalStore(subscribeSession, () => readSession()?.user.role, () => undefined);
  const canPlace = roleHasCapability(role, 'orders.place');
  const [placing, setPlacing] = useState(false);
  const [placed, setPlaced] = useState<PortalPlacedOrderResponse | null>(null);
  // Remounts the table on success, so its Prev/Next state starts on page one.
  const [pageEpoch, setPageEpoch] = useState(0);

  const columns: readonly DataTableColumn<PortalOrderRowDto>[] = [
    {
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
    },
    { key: 'ref', header: 'Reference', render: (row) => orderReference(row) },
    { key: 'status', header: 'Status', render: (row) => <StatusChip tone={ORDER_STATUS_TONE[row.status]}>{orderStatusLabel(row.status)}</StatusChip> },
    // Story 4-2a — priority, ship-by and the payment line; the type beside them.
    { key: 'fields', header: 'Priority · ship-by · payment', render: (row) => <OrderFieldChips order={row} todayIst={todayIst} /> },
    { key: 'orderType', header: 'Type', render: (row) => orderTypeLabel(row.orderType) },
    { key: 'warehouse', header: 'Warehouse', render: (row) => row.warehouseName },
    { key: 'destination', header: 'Destination', render: (row) => orderDestination(row) },
    { key: 'lines', header: 'Lines', numeric: true, render: (row) => lineCountLabel(row.lineCount) },
    { key: 'created', header: 'Placed', render: (row) => portalDate(row.createdAt) },
  ];

  return (
    <Section
      title="Orders"
      action={
        canPlace && !placing ? (
          <button
            type="button"
            className={primaryClass}
            onClick={() => {
              setPlaced(null);
              setPlacing(true);
            }}
          >
            Place an order
          </button>
        ) : undefined
      }
    >
      {/* Mounted by the gated button; kept while open even if the session
          changes under it, so a submit then says why it cannot send. */}
      {placing && (
        <PlaceOrderForm
          onCancel={() => setPlacing(false)}
          onPlaced={(order) => {
            setPlacing(false);
            setPlaced(order);
            setOpenId(null);
            // Story 4-1b — the new order must be visible: drop any search.
            setReference(null);
            // The new order is newest: back to page one, and refetch.
            orders.reset();
            setPageEpoch((epoch) => epoch + 1);
          }}
        />
      )}
      {placed !== null && <FeedbackBanner tone="accepted" {...placedOrderBanner(placed)} />}
      <OrderSearch
        // Remounted when the search changes from outside (a placed order clears it), so the box never shows a stale query.
        key={JSON.stringify(reference)}
        applied={reference}
        onSearch={(next) => {
          // Story 4-1b — forget the current scope's cursor first, so no
          // stale page-2 cursor is replayed when a search returns to it.
          orders.reset();
          setReference(next);
          setOpenId(null);
        }}
        label="Find an order"
        placeholder="Your order number or channel ref"
      />
      {orders.state === 'loading' && <TableSkeleton columns={columns} label="Loading your orders…" />}
      {orders.state === 'failed' && <ReadFailure word="Orders not loaded" reason={orders.reason} onRetry={orders.reload} />}
      {orders.state === 'ready' && (
        <DataTable<PortalOrderRowDto>
          key={`${pageEpoch}|${JSON.stringify(reference)}`}
          columns={columns}
          rows={orders.data.items}
          nextCursor={orders.data.nextCursor}
          onCursor={orders.onCursor}
          emptyMessage={
            reference === null
              ? 'No orders for your company yet.'
              : `None of your orders has the order number or channel reference "${reference}".`
          }
          renderExpanded={(row) => (row.id === openId ? <OrderLines orderId={row.id} /> : null)}
        />
      )}
    </Section>
  );
}

/**
 * Story 4-1a — "Place an order". Closed by default; Discard unmounts it, so
 * the draft and its key go with it. Disabled (with the reason) until it can
 * be filled: the SKU and warehouse reads loaded, at least one SKU, and a
 * catalogue the drain could read whole. The Idempotency-Key is per DRAFT:
 * minted on the first submit, reused across retries of an unchanged draft (a
 * submit that timed out after the server committed must replay, never place
 * a second order), cleared on success and on any edit; an in-flight ref
 * blocks a double submit.
 */
function PlaceOrderForm({
  onCancel,
  onPlaced,
}: {
  onCancel: () => void;
  onPlaced: (order: PortalPlacedOrderResponse) => void;
}) {
  // Story 4-2a — today's IST date for the ship-by chips (re-read every minute).
  const todayIst = useTodayIst();
  const skus = usePortalSkuOptions();
  const warehouses = usePortalWarehouses();
  const stock = usePortalStockRows();
  const [warehouseId, setWarehouseId] = useState('');
  const [lines, setLines] = useState<AsnDraftLine[]>([{ skuId: '', qty: '' }]);
  const [destination, setDestination] = useState<DestinationFields>(emptyDestinationFields());
  const [consigneeGstin, setConsigneeGstin] = useState('');
  const [consigneeLegalName, setConsigneeLegalName] = useState('');
  // Story 4-1b — "Your order number (optional)": in the request hash when sent.
  const [clientOrderRef, setClientOrderRef] = useState('');
  // Story 4-2a — type, priority (Normal / High), ship-by and COD.
  const [orderFields, setOrderFields] = useState<OrderFieldsDraft>(emptyOrderFieldsDraft());
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const inFlight = useRef(false);

  const options = useMemo<LineOption[]>(() => (skus.state === 'ready' ? skus.data.skus.map(portalSkuOption) : []), [skus]);
  const byId = useMemo<Record<string, LineOption>>(() => Object.fromEntries(options.map((option) => [option.id, option])), [options]);
  const warehouseOptions = warehouses.state === 'ready' ? portalWarehouseOptions(warehouses.data) : [];
  // A tenant with one warehouse needs no pick.
  const chosenWarehouse = warehouseId !== '' ? warehouseId : warehouseOptions.length === 1 ? warehouseOptions[0]!.id : '';
  const stockRows = stock.state === 'ready' ? stock.data.rows : null;
  const stockTruncated = stock.state === 'ready' && stock.data.truncated;

  /** Every field is in the request hash: an edit clears the key the last attempt would replay. */
  function edit<T>(setter: (value: T) => void): (value: T) => void {
    return (value) => {
      setter(value);
      setIdempotencyKey(null);
      setProblem(null);
    };
  }

  async function submit() {
    if (inFlight.current) return;
    const session = readSession();
    if (session === null) {
      setProblem(PORTAL_SESSION_EXPIRED);
      return;
    }
    const parsed = parsePortalOrderCreate({ lines, destination, consigneeGstin, consigneeLegalName, clientOrderRef, orderFields }, chosenWarehouse, byId, todayIst);
    if (parsed.body === null) {
      setProblem(parsed.problem);
      return;
    }
    const key = idempotencyKey ?? ulid();
    setIdempotencyKey(key);
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const order = await fetchApiPortalPlaceOrder(session.tenant.id, parsed.body, key);
      setIdempotencyKey(null);
      onPlaced(order);
    } catch (error) {
      setProblem(portalOrderReason(error, parsed.body.clientOrderRef ?? null));
      // A shortage means the hints were stale: re-read the stock.
      if (error instanceof ApiProblem && error.code === 'order-backorder-rejected') stock.reload();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const frame = (children: React.ReactNode) => (
    <div aria-label="Place an order" className="flex flex-col gap-2 rounded-sm border border-(--border) p-3">
      <div className="text-xs font-medium">Place an order</div>
      {children}
      {/* A submit refused before sending (the session went away under the form). */}
      {problem !== null && (
        <div role="alert" className="text-xs text-(--destructive)">
          {problem}
        </div>
      )}
      <div className="flex justify-end">
        <button type="button" onClick={onCancel} className={buttonClass}>
          Discard
        </button>
      </div>
    </div>
  );

  if (skus.state === 'failed') return frame(<ReadFailure word="SKUs not loaded" reason={skus.reason} onRetry={skus.reload} />);
  if (warehouses.state === 'failed') return frame(<WarehousesFailure state={warehouses} />);
  if (skus.state === 'loading' || warehouses.state === 'loading') {
    return frame(<div className="text-(--muted-foreground)">Loading the form…</div>);
  }
  if (warehouses.data.length === 0) {
    return frame(<div role="status" className="text-(--muted-foreground)">{PORTAL_ORDER_NO_WAREHOUSES_MESSAGE}</div>);
  }
  if (skus.data.skus.length === 0) {
    return frame(<div role="status" className="text-(--muted-foreground)">{PORTAL_ORDER_NO_SKUS_MESSAGE}</div>);
  }
  if (skus.data.truncated) {
    return frame(<div role="status" className="text-(--muted-foreground)">{PORTAL_ORDER_SKUS_TOO_MANY_MESSAGE}</div>);
  }

  return (
    <form
      aria-label="Place an order"
      className="flex flex-col gap-2 rounded-sm border border-(--border) p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="text-xs font-medium">Place an order</div>
      <div className="text-xs text-(--muted-foreground)">
        Every line must be in stock at the warehouse you choose — a short line refuses the whole order, naming it.
      </div>
      {/* Disabled while the POST is in flight: an edit would clear the key
          mid-flight (a committed-but-timed-out submit then resubmits under a
          fresh key and places a second order), and Discard would still place. */}
      <fieldset disabled={busy} className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <select
            aria-label="Warehouse"
            value={chosenWarehouse}
            onChange={(event) => edit(setWarehouseId)(event.target.value)}
            className={`${selectClass} w-auto`}
          >
            <option value="">Pick the warehouse…</option>
            {warehouseOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <label className="flex flex-col gap-1 sm:max-w-md">
          <span className={labelClass}>Your order number (optional)</span>
          <input
            className={inputClass}
            value={clientOrderRef}
            onChange={(event) => edit(setClientOrderRef)(event.target.value)}
            placeholder="SO-1042"
            autoComplete="off"
          />
          <span className="text-xs text-(--muted-foreground)">
            Your own reference — shown on the order and searchable. Up to 64 letters, digits, spaces and punctuation.
          </span>
        </label>
        <OrderFieldsFieldset draft={orderFields} onDraft={edit(setOrderFields)} todayIst={todayIst} surface="portal" />
        <LineRows<LineOption>
          lines={lines}
          options={options}
          skus={byId}
          onChange={edit(setLines)}
          hint={(line) =>
            stockRows === null ? null : availableHereLabel(stockRows, line.skuId, chosenWarehouse, byId[line.skuId]?.uom, stockTruncated)
          }
        />
        {/* The hints only: a failed stock read never blocks the order. */}
        {stock.state === 'failed' && <ReadFailure word="Stock not loaded" reason={stock.reason} onRetry={stock.reload} />}
        <ShipToFieldset
          destination={destination}
          onDestination={edit(setDestination)}
          consigneeGstin={consigneeGstin}
          onConsigneeGstin={edit(setConsigneeGstin)}
          consigneeLegalName={consigneeLegalName}
          onConsigneeLegalName={edit(setConsigneeLegalName)}
        />
        {problem !== null && (
          <div role="alert" className="text-xs text-(--destructive)">
            {problem}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={buttonClass}>
            Discard
          </button>
          <button type="submit" disabled={busy} className={primaryClass}>
            Place order
          </button>
        </div>
      </fieldset>
    </form>
  );
}

function OrderLines({ orderId }: { orderId: string }) {
  const order = usePortalOrder(orderId);
  if (order.state === 'loading') return <div className="text-(--muted-foreground)">Loading lines…</div>;
  if (order.state === 'failed') return <ReadFailure word="Lines not loaded" reason={order.reason} onRetry={order.reload} />;
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:gap-8">
      {/* Story UI-1 — where the order is, from its status and its placed time only. */}
      <StatusTimeline label={`Order ${orderReference(order.data)} progress`} steps={orderTimeline(order.data)} />
      <ul className="flex flex-col gap-1" data-testid="order-lines">
        {order.data.lines.map((line, index) => (
          <li key={index}>
            <span>{skuLabel(line)}</span> <span className="data">× {portalQuantity(line.qty)}</span>
            {line.components.length > 0 && (
              <ul className="ml-6 flex flex-col gap-0.5 text-(--muted-foreground)" data-testid="kit-components">
                {line.components.map((component, inner) => (
                  <li key={inner}>
                    {skuLabel(component)} <span className="data">× {portalQuantity(component.qty)}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
