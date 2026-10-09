'use client';

import { useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { fetchApiPortalAnnounceAsn } from '@/lib/api/client';
import type { PortalAsnDetailResponse, PortalAsnRowDto, PortalPurchaseOrderRowDto } from '@/lib/api/generated';
import { MAX_ASN_CODE_LENGTH, type AsnDraftLine, type LineOption } from '@/lib/asns';
import { readSession, subscribeSession } from '@/lib/auth';
import {
  asnStatusLabel,
  lineCountLabel,
  parsePortalAsnCreate,
  PO_STATUS_LABEL,
  PORTAL_NO_SKUS_MESSAGE,
  PORTAL_SKUS_TOO_MANY_MESSAGE,
  portalAsnReason,
  portalDate,
  portalSkuOption,
  portalWarehouseOptions,
  receivedOfLabel,
  skuLabel,
} from '@/lib/portal';
import { ulid } from '@/lib/ulid';
import {
  usePortalAsn,
  usePortalAsns,
  usePortalPurchaseOrder,
  usePortalPurchaseOrders,
  usePortalSkuOptions,
  usePortalWarehouses,
} from '@/lib/use-portal';
import { roleHasCapability } from '@/lib/users';

import { DataTable, expandedRowId, type DataTableColumn } from '@/components/data-table/data-table';
import { FeedbackBanner } from '@/components/feedback/banner';
import { LineRows } from '@/components/inbound/asn-card';
import { ReadFailure, Section, buttonClass, inputClass, primaryClass, rowButtonClass, selectClass } from '@/components/outbound/shell';

/**
 * Story 21-7 — the portal's Inbound surface: this company's advance
 * shipment notices and purchase orders, each row expanding to its lines.
 *
 * Story 21-7b — read-mostly plus ASN: the notices section gains "Announce a
 * shipment", the portal's one write. The form picks a warehouse (any of the
 * tenant's — decision 1), a reference, an optional expected arrival and the
 * lines, from the portal's own reads (`portal/skus`, every page;
 * `portal/warehouses`) — never an operator route or type. The client is the
 * session's; nothing about it is sent. There is no portal amend, close or
 * cancel (decision 2): a mistaken notice is cancelled by the warehouse.
 */
export function PortalInbound() {
  return (
    <div className="flex flex-col gap-4">
      <AsnsSection />
      <PurchaseOrdersSection />
    </div>
  );
}

function toggleColumn<T extends { id: string }>(openId: string | null, setOpenId: (id: string | null) => void): DataTableColumn<T> {
  return {
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
  };
}

function AsnsSection() {
  const asns = usePortalAsns();
  const [openId, setOpenId] = useState<string | null>(null);
  // Subscribed, never a bare readSession() at render.
  const role = useSyncExternalStore(subscribeSession, () => readSession()?.user.role, () => undefined);
  const canAnnounce = roleHasCapability(role, 'asn.announce');
  const [announcing, setAnnouncing] = useState(false);
  const [announced, setAnnounced] = useState<PortalAsnDetailResponse | null>(null);
  // Remounts the table on success, so its Prev/Next state starts on page one.
  const [pageEpoch, setPageEpoch] = useState(0);
  const columns: readonly DataTableColumn<PortalAsnRowDto>[] = [
    toggleColumn<PortalAsnRowDto>(openId, setOpenId),
    { key: 'code', header: 'Notice', render: (row) => <span className="font-mono">{row.code}</span> },
    { key: 'status', header: 'Status', render: (row) => asnStatusLabel(row.status) },
    { key: 'warehouse', header: 'Warehouse', render: (row) => row.warehouseName },
    { key: 'expected', header: 'Expected', render: (row) => portalDate(row.expectedAt) },
    { key: 'lines', header: 'Lines', numeric: true, render: (row) => lineCountLabel(row.lineCount) },
    { key: 'progress', header: 'Received', numeric: true, render: (row) => receivedOfLabel(row.receivedTotal, row.announcedTotal) },
  ];
  return (
    <Section
      title="Advance shipment notices"
      action={
        canAnnounce && !announcing ? (
          <button
            type="button"
            className={primaryClass}
            onClick={() => {
              setAnnounced(null);
              setAnnouncing(true);
            }}
          >
            Announce a shipment
          </button>
        ) : undefined
      }
    >
      {canAnnounce && announcing && (
        <AnnounceForm
          onCancel={() => setAnnouncing(false)}
          onAnnounced={(asn) => {
            setAnnouncing(false);
            setAnnounced(asn);
            setOpenId(null);
            // The new notice is newest: back to page one, and refetch.
            asns.reset();
            setPageEpoch((epoch) => epoch + 1);
          }}
        />
      )}
      {announced !== null && (
        <FeedbackBanner
          tone="accepted"
          word={`Shipment ${announced.code} announced`}
          reason={`${lineCountLabel(announced.lineCount)} sent to ${announced.warehouseName} — the warehouse receives against it when it arrives.`}
        />
      )}
      {asns.state === 'loading' && <div className="text-(--muted-foreground)">Loading your shipment notices…</div>}
      {asns.state === 'failed' && <ReadFailure word="Notices not loaded" reason={asns.reason} onRetry={asns.reload} />}
      {asns.state === 'ready' && (
        <DataTable<PortalAsnRowDto>
          key={pageEpoch}
          columns={columns}
          rows={asns.data.items}
          nextCursor={asns.data.nextCursor}
          onCursor={asns.onCursor}
          emptyMessage="No shipment notices for your company yet."
          renderExpanded={(row) => (row.id === openId ? <AsnLines asnId={row.id} /> : null)}
        />
      )}
    </Section>
  );
}

/**
 * Story 21-7b — "Announce a shipment". Disabled (with the reason) until the
 * form can be filled: both reads loaded, at least one SKU, and a catalogue
 * the drain could read whole. The Idempotency-Key is per DRAFT: minted on
 * the first submit, reused across retries of an unchanged draft (a submit
 * that timed out after the server committed must replay, never raise a
 * second notice), cleared on success and on any edit; an in-flight ref
 * blocks a double submit.
 */
function AnnounceForm({
  onCancel,
  onAnnounced,
}: {
  onCancel: () => void;
  onAnnounced: (asn: PortalAsnDetailResponse) => void;
}) {
  const skus = usePortalSkuOptions();
  const warehouses = usePortalWarehouses();
  const [warehouseId, setWarehouseId] = useState('');
  const [asnCode, setAsnCode] = useState('');
  const [expectedAt, setExpectedAt] = useState('');
  const [lines, setLines] = useState<AsnDraftLine[]>([{ skuId: '', qty: '' }]);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const inFlight = useRef(false);

  const options = useMemo<LineOption[]>(() => (skus.state === 'ready' ? skus.data.skus.map(portalSkuOption) : []), [skus]);
  const byId = useMemo<Record<string, LineOption>>(() => Object.fromEntries(options.map((option) => [option.id, option])), [options]);
  const warehouseOptions = warehouses.state === 'ready' ? portalWarehouseOptions(warehouses.data) : [];
  // A tenant with one warehouse needs no pick.
  const chosenWarehouse = warehouseId !== '' ? warehouseId : warehouseOptions.length === 1 ? warehouseOptions[0]!.id : '';

  function edit<T>(setter: (value: T) => void): (value: T) => void {
    return (value) => {
      setter(value);
      setIdempotencyKey(null);
      setProblem(null);
    };
  }

  async function submit() {
    const session = readSession();
    if (session === null || inFlight.current) return;
    const parsed = parsePortalAsnCreate({ asnCode, expectedAt, lines }, chosenWarehouse);
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
      const asn = await fetchApiPortalAnnounceAsn(session.tenant.id, parsed.body, key);
      setIdempotencyKey(null);
      onAnnounced(asn);
    } catch (error) {
      setProblem(portalAsnReason(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const frame = (children: React.ReactNode) => (
    <div aria-label="Announce a shipment" className="flex flex-col gap-2 rounded-sm border border-(--border) p-3">
      <div className="text-xs font-medium">Announce a shipment</div>
      {children}
      <div className="flex justify-end">
        <button type="button" onClick={onCancel} className={buttonClass}>
          Discard
        </button>
      </div>
    </div>
  );

  if (skus.state === 'failed') return frame(<ReadFailure word="SKUs not loaded" reason={skus.reason} onRetry={skus.reload} />);
  if (warehouses.state === 'failed') {
    return frame(<ReadFailure word="Warehouses not loaded" reason={warehouses.reason} onRetry={warehouses.reload} />);
  }
  if (skus.state === 'loading' || warehouses.state === 'loading') {
    return frame(<div className="text-(--muted-foreground)">Loading the form…</div>);
  }
  if (skus.data.skus.length === 0) {
    return frame(<div role="status" className="text-(--muted-foreground)">{PORTAL_NO_SKUS_MESSAGE}</div>);
  }
  if (skus.data.truncated) {
    return frame(<div role="status" className="text-(--muted-foreground)">{PORTAL_SKUS_TOO_MANY_MESSAGE}</div>);
  }

  return (
    <form
      aria-label="Announce a shipment"
      className="flex flex-col gap-2 rounded-sm border border-(--border) p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="text-xs font-medium">Announce a shipment</div>
      {/* Disabled while the POST is in flight: an edit would clear the key
          mid-flight (a committed-but-timed-out submit then resubmits under a
          fresh key → 409 on the user's own notice), and Discard would still
          announce. */}
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
        <input
          type="text"
          aria-label="Shipment reference"
          placeholder="Your reference for this shipment"
          maxLength={MAX_ASN_CODE_LENGTH}
          value={asnCode}
          onChange={(event) => edit(setAsnCode)(event.target.value)}
          className={`${inputClass} w-auto min-w-40`}
        />
        <input
          type="datetime-local"
          aria-label="Expected arrival"
          value={expectedAt}
          onChange={(event) => edit(setExpectedAt)(event.target.value)}
          className={`${inputClass} w-auto`}
        />
      </div>
      <LineRows<LineOption> lines={lines} options={options} skus={byId} onChange={edit(setLines)} />
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
          Announce
        </button>
      </div>
      </fieldset>
    </form>
  );
}

function AsnLines({ asnId }: { asnId: string }) {
  const asn = usePortalAsn(asnId);
  if (asn.state === 'loading') return <div className="text-(--muted-foreground)">Loading lines…</div>;
  if (asn.state === 'failed') return <ReadFailure word="Lines not loaded" reason={asn.reason} onRetry={asn.reload} />;
  return (
    <ul className="flex flex-col gap-1" data-testid="asn-lines">
      {asn.data.lines.map((line, index) => (
        <li key={index}>
          {skuLabel(line)} <span className="data">· {receivedOfLabel(line.receivedQty, line.announcedQty)}</span>
        </li>
      ))}
    </ul>
  );
}

function PurchaseOrdersSection() {
  const pos = usePortalPurchaseOrders();
  const [openId, setOpenId] = useState<string | null>(null);
  const columns: readonly DataTableColumn<PortalPurchaseOrderRowDto>[] = [
    toggleColumn<PortalPurchaseOrderRowDto>(openId, setOpenId),
    { key: 'code', header: 'Purchase order', render: (row) => <span className="font-mono">{row.code}</span> },
    { key: 'status', header: 'Status', render: (row) => PO_STATUS_LABEL[row.status] },
    { key: 'warehouse', header: 'Warehouse', render: (row) => row.warehouseName },
    { key: 'lines', header: 'Lines', numeric: true, render: (row) => lineCountLabel(row.lineCount) },
    { key: 'progress', header: 'Received', numeric: true, render: (row) => receivedOfLabel(row.receivedTotal, row.orderedTotal) },
    { key: 'created', header: 'Raised', render: (row) => portalDate(row.createdAt) },
  ];
  return (
    <Section title="Purchase orders">
      {pos.state === 'loading' && <div className="text-(--muted-foreground)">Loading your purchase orders…</div>}
      {pos.state === 'failed' && <ReadFailure word="Purchase orders not loaded" reason={pos.reason} onRetry={pos.reload} />}
      {pos.state === 'ready' && (
        <DataTable<PortalPurchaseOrderRowDto>
          columns={columns}
          rows={pos.data.items}
          nextCursor={pos.data.nextCursor}
          onCursor={pos.onCursor}
          emptyMessage="No purchase orders for your company yet."
          renderExpanded={(row) => (row.id === openId ? <PoLines poId={row.id} /> : null)}
        />
      )}
    </Section>
  );
}

function PoLines({ poId }: { poId: string }) {
  const po = usePortalPurchaseOrder(poId);
  if (po.state === 'loading') return <div className="text-(--muted-foreground)">Loading lines…</div>;
  if (po.state === 'failed') return <ReadFailure word="Lines not loaded" reason={po.reason} onRetry={po.reload} />;
  return (
    <ul className="flex flex-col gap-1" data-testid="po-lines">
      {po.data.lines.map((line, index) => (
        <li key={index}>
          {skuLabel(line)} <span className="data">· {receivedOfLabel(line.receivedQty, line.orderedQty)}</span>
          {line.expectedDate !== null && <span className="text-(--muted-foreground)"> · expected {portalDate(line.expectedDate)}</span>}
        </li>
      ))}
    </ul>
  );
}
