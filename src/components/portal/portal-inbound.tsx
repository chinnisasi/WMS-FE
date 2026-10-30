'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { fetchApiPortalAnnounceAsn, fetchApiPortalGoodsReceiptFile } from '@/lib/api/client';
import type {
  PortalAsnDetailResponse,
  PortalAsnRowDto,
  PortalGoodsReceiptDetailDto,
  PortalGoodsReceiptLineDto,
  PortalGoodsReceiptRowDto,
  PortalPurchaseOrderRowDto,
  PortalReceiptPhotoDto,
} from '@/lib/api/generated';
import { istDateTimeLabel } from '@/lib/audit-exports';
import { damageReasonLabel, shortReasonLabel } from '@/lib/grn-lines';
import { downloadBlob } from '@/lib/csv';
import {
  GRN_DOCUMENTS_OMITTED_NOTE,
  GRN_NOT_FROZEN_NOTE,
  GRN_UNAVAILABLE,
  grnDocumentFilename,
  grnDocumentKindLabel,
  grnExpiryLabel,
  grnPartyLines,
  grnPortalExcessLabel,
  grnPortalQcLabel,
  grnSealLabel,
  grnSerialsLabel,
  grnTotalsLabels,
  isMalformedGrnParam,
  parseGrnParam,
  writeGrnParam,
} from '@/lib/grn-document';
import { PORTAL_REMOVED_PHOTO, createUrlRefresher, photoCountLabel, type UrlRefresher } from '@/lib/receipt-photos';
import { MAX_ASN_CODE_LENGTH, type AsnDraftLine, type LineOption } from '@/lib/asns';
import { readSession, subscribeSession } from '@/lib/auth';
import {
  asnStatusLabel,
  lineCountLabel,
  parsePortalAsnCreate,
  PO_STATUS_LABEL,
  PORTAL_NO_SKUS_MESSAGE,
  PORTAL_SESSION_EXPIRED,
  PORTAL_SKUS_TOO_MANY_MESSAGE,
  portalAsnReason,
  portalDate,
  portalQuantity,
  portalReadReason,
  portalSkuOption,
  portalWarehouseOptions,
  receivedOfLabel,
  skuLabel,
} from '@/lib/portal';
import { ulid } from '@/lib/ulid';
import {
  usePortalAsn,
  usePortalAsns,
  usePortalGoodsReceipt,
  usePortalGoodsReceipts,
  usePortalPurchaseOrder,
  usePortalPurchaseOrders,
  usePortalSkuOptions,
  usePortalWarehouses,
  usePortalTenantId,
} from '@/lib/use-portal';
import { roleHasCapability } from '@/lib/users';

import { DataTable, expandedRowId, type DataTableColumn } from '@/components/data-table/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { FeedbackBanner } from '@/components/feedback/banner';
import { LineRows } from '@/components/shared/line-rows';
import { CameraGlyph, LightboxStage, ModalFrame, PlaceholderBody, PresignedImage, TileFrame } from '@/components/shared/photo-viewer';
import { ReadFailure, Section, buttonClass, inputClass, primaryClass, rowButtonClass, selectClass } from '@/components/shared/surface';
import { WarehousesFailure } from '@/components/shared/warehouses-failure';

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
  // Story 2-9a (A18) — `?grn=<id>` (the receipt email's link) opens THAT
  // receipt's detail, read by id — independent of the paginated list, so a
  // receipt on any page opens. Read from the live URL after mount (the page
  // is static; no server parse).
  const [deepLink, setDeepLink] = useState<{ raw: string } | null>(null);
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('grn');
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the live URL is read once, after hydration
    if (raw !== null) setDeepLink({ raw });
  }, []);
  return (
    <div className="flex flex-col gap-4">
      {deepLink !== null && (
        <ReceiptDeepLink
          raw={deepLink.raw}
          onClose={() => {
            setDeepLink(null);
            writeGrnParam(null);
          }}
        />
      )}
      <AsnsSection />
      <PurchaseOrdersSection />
      <ReceiptsSection />
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
  const tenantId = usePortalTenantId();
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
      {/* Story UI-2 (A1) — ONE table across every page load, so its cursor
          stack survives and Prev returns to the previous page; a failure
          shows above it and the table is kept (hidden), so Retry keeps Prev. */}
      {asns.state === 'failed' && <ReadFailure word="Notices not loaded" reason={asns.reason} onRetry={asns.reload} />}
      <div hidden={asns.state === 'failed'}>
        <DataTable<PortalAsnRowDto>
          key={`${tenantId ?? 'none'}|${pageEpoch}`}
          columns={columns}
          rows={asns.state === 'ready' ? asns.data.items : []}
          nextCursor={asns.state === 'ready' ? asns.data.nextCursor : null}
          onCursor={asns.onCursor}
          emptyMessage={<EmptyState kind="first-use">No shipment notices for your company yet.</EmptyState>}
          renderExpanded={(row) => (row.id === openId ? <AsnLines asnId={row.id} /> : null)}
          loading={asns.state === 'loading' ? 'Loading your shipment notices…' : undefined}
        />
      </div>
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
    return frame(<WarehousesFailure state={warehouses} />);
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
  const tenantId = usePortalTenantId();
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
      {/* Story UI-2 (A1) — ONE table across every page load, so its cursor
          stack survives and Prev returns to the previous page; a failure
          shows above it and the table is kept (hidden), so Retry keeps Prev. */}
      {pos.state === 'failed' && <ReadFailure word="Purchase orders not loaded" reason={pos.reason} onRetry={pos.reload} />}
      <div hidden={pos.state === 'failed'}>
        <DataTable<PortalPurchaseOrderRowDto>
          key={tenantId ?? 'none'}
          columns={columns}
          rows={pos.state === 'ready' ? pos.data.items : []}
          nextCursor={pos.state === 'ready' ? pos.data.nextCursor : null}
          onCursor={pos.onCursor}
          emptyMessage={<EmptyState kind="first-use">No purchase orders for your company yet.</EmptyState>}
          renderExpanded={(row) => (row.id === openId ? <PoLines poId={row.id} /> : null)}
          loading={pos.state === 'loading' ? 'Loading your purchase orders…' : undefined}
        />
      </div>
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

// ── Story 2-5a — Receipts ────────────────────────────────────────────────────

/**
 * Story 2-5a — the client's goods receipts (decision 10: the minimal read
 * 2.9 extends): what arrived, what was damaged or short, and the damage
 * photos taken at the dock. A row expands to its lines and their photos; a
 * photo opens the lightbox. A photo the warehouse removed is a placeholder,
 * "Removed by the warehouse" — no image, no reason, no remover (A4).
 */
function ReceiptsSection() {
  const grns = usePortalGoodsReceipts();
  const [openId, setOpenId] = useState<string | null>(null);
  const columns: readonly DataTableColumn<PortalGoodsReceiptRowDto>[] = [
    toggleColumn<PortalGoodsReceiptRowDto>(openId, setOpenId),
    { key: 'code', header: 'Receipt', render: (row) => <span className="font-mono">{row.code}</span> },
    { key: 'warehouse', header: 'Warehouse', render: (row) => row.warehouseName },
    { key: 'against', header: 'Against', render: (row) => receiptAgainst(row) },
    { key: 'lines', header: 'Lines', numeric: true, render: (row) => lineCountLabel(row.lineCount) },
    { key: 'good', header: 'Received', numeric: true, render: (row) => portalQuantity(row.receivedTotal) },
    {
      key: 'damaged',
      header: 'Damaged',
      numeric: true,
      render: (row) => (row.damagedTotal > 0 ? <span className="font-medium">{portalQuantity(row.damagedTotal)}</span> : <span className="text-(--muted-foreground)">—</span>),
    },
    {
      key: 'short',
      header: 'Short',
      numeric: true,
      render: (row) => (row.shortTotal > 0 ? portalQuantity(row.shortTotal) : <span className="text-(--muted-foreground)">—</span>),
    },
    {
      key: 'photos',
      header: 'Photos',
      render: (row) =>
        row.photoCount > 0 ? (
          <span className="inline-flex items-center gap-1" aria-label={photoCountLabel(row.photoCount)}>
            <CameraGlyph />
            <span className="data">{row.photoCount}</span>
          </span>
        ) : (
          <span className="text-(--muted-foreground)">—</span>
        ),
    },
    { key: 'received', header: 'Received on', render: (row) => portalDate(row.receivedAt) },
  ];
  return (
    <Section title="Receipts">
      <div className="text-(--muted-foreground)">
        What the warehouse received for you, newest first — with damaged and short units, and photos of any damage taken at the dock.
      </div>
      {grns.state === 'loading' && <div className="text-(--muted-foreground)">Loading your receipts…</div>}
      {grns.state === 'failed' && <ReadFailure word="Receipts not loaded" reason={grns.reason} onRetry={grns.reload} />}
      {grns.state === 'ready' && (
        <DataTable<PortalGoodsReceiptRowDto>
          columns={columns}
          rows={grns.data.items}
          nextCursor={grns.data.nextCursor}
          onCursor={grns.onCursor}
          emptyMessage="No receipts for your company yet."
          renderExpanded={(row) => (row.id === openId ? <ReceiptLines grnId={row.id} /> : null)}
        />
      )}
    </Section>
  );
}

/** The document a receipt booked against, in the client's words. */
function receiptAgainst(row: Pick<PortalGoodsReceiptRowDto, 'poCode' | 'asnCode'>): React.ReactNode {
  if (row.asnCode !== null) return <span className="font-mono">{row.asnCode}</span>;
  if (row.poCode !== null) return <span className="font-mono">{row.poCode}</span>;
  return <span className="text-(--muted-foreground)">—</span>;
}

/** `good 90 · damaged 10 (Crushed) · short 5 (Not shipped)`. */
function portalLineCondition(line: PortalGoodsReceiptLineDto): string {
  const parts = [`good ${portalQuantity(line.qty)}`];
  if (line.damagedQty > 0) parts.push(`damaged ${portalQuantity(line.damagedQty)} (${damageReasonLabel(line.damageReasonCode ?? undefined)})`);
  if (line.shortQty > 0) parts.push(`short ${portalQuantity(line.shortQty)} (${shortReasonLabel(line.shortReasonCode ?? undefined)})`);
  return parts.join(' · ');
}

function ReceiptLines({ grnId }: { grnId: string }) {
  return <ReceiptLinesView grn={usePortalGoodsReceipt(grnId)} />;
}

/** One receipt's header and lines from a read the CALLER holds (the deep link reads once and passes it here). */
function ReceiptLinesView({ grn }: { grn: ReturnType<typeof usePortalGoodsReceipt> }) {
  // A28 — one refresher per receipt; it reads the newest `refresh` at call time.
  const [refresher] = useState(() => createUrlRefresher(grn.refresh));
  useEffect(() => refresher.bind(grn.refresh), [refresher, grn.refresh]);
  const [openPhotoId, setOpenPhotoId] = useState<string | null>(null);

  if (grn.state === 'loading') return <div className="text-(--muted-foreground)">Loading lines…</div>;
  if (grn.state === 'failed') return <ReadFailure word="Lines not loaded" reason={grn.reason} onRetry={grn.reload} />;
  const all = grn.data.lines.flatMap((line) => line.photos.map((photo) => ({ photo, line })));
  const index = openPhotoId === null ? -1 : all.findIndex((entry) => entry.photo.id === openPhotoId);
  const open = index === -1 ? null : all[index]!;
  return (
    <>
      <ReceiptHeader grn={grn.data} />
      <ul className="flex flex-col gap-3 py-1" data-testid="receipt-lines">
        {grn.data.lines.map((line) => (
          <li key={line.lineNo} className="flex flex-col gap-1.5">
            <div>
              {skuLabel(line)} <span className="data text-(--muted-foreground)">· {portalLineCondition(line)}</span>
            </div>
            <ReceiptLineFacts line={line} />
            {line.photos.length > 0 && (
              <ul className="flex flex-wrap gap-2" aria-label={`Damage photos of ${line.skuCode}`}>
                {line.photos.map((photo, at) => (
                  <li key={photo.id} className="w-20">
                    <PortalPhotoTile photo={photo} label={`${line.skuCode} photo ${at + 1}`} refresher={refresher} onOpen={() => setOpenPhotoId(photo.id)} />
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {open !== null && (
        <ModalFrame
          title={`Damage photo · ${grn.data.code}`}
          subtitle={skuLabel(open.line)}
          wide
          onClose={() => setOpenPhotoId(null)}
          onEscape={() => setOpenPhotoId(null)}
        >
          <LightboxStage
            photo={open.photo}
            alt={`${open.line.skuCode} damage photo`}
            position={index + 1}
            total={all.length}
            onPrevious={() => setOpenPhotoId(all[(index - 1 + all.length) % all.length]!.photo.id)}
            onNext={() => setOpenPhotoId(all[(index + 1) % all.length]!.photo.id)}
            onBack={() => setOpenPhotoId(null)}
            refresher={refresher}
            placeholder={<PortalPlaceholder photo={open.photo} />}
            meta={
              <div className="text-xs text-(--muted-foreground)">
                Line {open.line.lineNo} · {open.line.skuCode}
                {open.photo.status === 'removed' ? ` · ${PORTAL_REMOVED_PHOTO}` : ''}
                {open.photo.capturedAt !== null && ` · taken ${istDateTimeLabel(open.photo.capturedAt)} IST`}
              </div>
            }
          />
        </ModalFrame>
      )}
    </>
  );
}

/**
 * Story 2-9a — the receipt's GRN header in the portal: the parties (frozen at
 * receipt, or the current ones with the note), the document, the arrival as
 * recorded on the gate-in, the totals, and the two downloads (the SAME
 * document the warehouse holds).
 */
function ReceiptHeader({ grn }: { grn: PortalGoodsReceiptDetailDto }) {
  const tenantId = usePortalTenantId();
  const [busy, setBusy] = useState<'pdf' | 'csv' | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const download = async (format: 'pdf' | 'csv') => {
    if (tenantId === null) {
      setRefused(PORTAL_SESSION_EXPIRED);
      return;
    }
    setBusy(format);
    setRefused(null);
    try {
      downloadBlob(grnDocumentFilename(grn.code, format), await fetchApiPortalGoodsReceiptFile(tenantId, grn.id, format));
    } catch (error) {
      setRefused(portalReadReason(error, 'The GRN file'));
    } finally {
      setBusy(null);
    }
  };
  const { parties, arrival } = grn;
  return (
    <div className="flex flex-col gap-2 py-1" data-testid="receipt-header">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{grn.document.label}</span>
        <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => void download('pdf')}>
          {busy === 'pdf' ? 'Preparing…' : 'Download GRN (PDF)'}
        </button>
        <button type="button" className={buttonClass} disabled={busy !== null} onClick={() => void download('csv')}>
          {busy === 'csv' ? 'Preparing…' : 'Export lines (CSV)'}
        </button>
      </div>
      {refused !== null && <FeedbackBanner tone="rejected" word="Download failed" reason={refused} />}
      <div className="grid gap-2 text-xs md:grid-cols-3">
        <div>
          <div className="font-medium">Received at</div>
          <div>{parties.warehouse.name}</div>
          {grnPartyLines(parties.warehouse).slice(1).map((text, index) => (
            <div key={index}>{text}</div>
          ))}
          <div>Operated by {parties.warehouse.operatorName}</div>
        </div>
        <div>
          <div className="font-medium">Your company</div>
          {(parties.client === null ? ['—'] : grnPartyLines(parties.client)).map((text, index) => (
            <div key={index}>{text}</div>
          ))}
        </div>
        <div>
          <div className="font-medium">Supplier</div>
          {(parties.vendor === null ? [parties.supplierNote ?? '—'] : grnPartyLines(parties.vendor)).map((text, index) => (
            <div key={index}>{text}</div>
          ))}
        </div>
      </div>
      {!parties.frozen && <div className="text-xs text-(--muted-foreground)">{GRN_NOT_FROZEN_NOTE}</div>}
      {arrival !== null && (
        <div className="text-xs">
          <span className="font-medium">Arrival</span> — as recorded on gate-in {arrival.gateInCode}
          {arrival.vehicleNo !== null ? ` · vehicle ${arrival.vehicleNo}` : ''}
          {arrival.containerNo !== null ? ` · container ${arrival.containerNo}` : ''}
          {arrival.transporterName !== null ? ` · ${arrival.transporterName}` : ''}
          {arrival.lrNumber !== null ? ` · LR/AWB ${arrival.lrNumber}` : ''}
          {` · seal ${grnSealLabel(arrival.sealStatus)}`}
          {arrival.sealNumber !== null ? ` ${arrival.sealNumber}` : ''} · gated in {istDateTimeLabel(arrival.gatedInAt)} IST
          {arrival.documents.map((document, index) => (
            <div key={index} className="data">
              {grnDocumentKindLabel(document.kind)} {document.number} dated {document.date}
              {document.ewayBillNo !== null ? ` · e-way bill ${document.ewayBillNo}` : ''}
            </div>
          ))}
          {arrival.documentsOmitted && <div className="text-(--muted-foreground)">{GRN_DOCUMENTS_OMITTED_NOTE}</div>}
        </div>
      )}
      <div className="data text-xs text-(--muted-foreground)">
        {grnTotalsLabels(grn.totals.byUom, grn.lines).join(' — ')}
      </div>
    </div>
  );
}

/** Story 2-9a — a line's batch, dates, over-receipt and QC outcome in the client's words. */
function ReceiptLineFacts({ line }: { line: PortalGoodsReceiptLineDto }) {
  const precision = line.uomPrecision;
  const parts = [
    line.uom,
    line.batchCode === null ? null : `batch ${line.batchCode}`,
    line.mfgDate === null ? null : `mfg ${line.mfgDate}`,
    line.expiryDate === null ? null : `expiry ${grnExpiryLabel(line)}`,
    grnPortalExcessLabel(line.excess, precision) || null,
    grnPortalQcLabel(line.qc, precision) || null,
    grnSerialsLabel(line),
  ].filter((part): part is string => part !== null && part !== '');
  return <div className="data text-xs text-(--muted-foreground)">{parts.join(' · ')}</div>;
}

/** Story 2-9a (A18) — `?grn=<id>`: one receipt's detail, read by id; unknown or malformed → inline "not available". */
function ReceiptDeepLink({ raw, onClose }: { raw: string; onClose: () => void }) {
  const grnId = parseGrnParam(raw);
  // ONE read: the panel's title and its lines share it.
  const grn = usePortalGoodsReceipt(grnId);
  const unavailable = isMalformedGrnParam(raw) || (grn.state === 'failed' && grn.notFound);
  return (
    <Section
      title={grn.state === 'ready' ? `Receipt ${grn.data.code}` : 'Receipt'}
      action={
        <button type="button" className={buttonClass} onClick={onClose}>
          All receipts
        </button>
      }
    >
      <div data-testid="receipt-deep-link">
        {unavailable ? (
          <div className="flex flex-col items-start gap-1">
            <FeedbackBanner tone="rejected" word={GRN_UNAVAILABLE} reason="It may have been removed, or the link is wrong." />
            <button type="button" className={buttonClass} onClick={onClose}>
              Go to your receipts
            </button>
          </div>
        ) : grnId === null ? null : (
          <ReceiptLinesView grn={grn} />
        )}
      </div>
    </Section>
  );
}

function PortalPlaceholder({ photo }: { photo: PortalReceiptPhotoDto }) {
  return photo.status === 'removed' ? (
    <PlaceholderBody glyph="⊘" word={PORTAL_REMOVED_PHOTO} />
  ) : (
    <PlaceholderBody glyph="▢" word="Image unavailable" />
  );
}

function PortalPhotoTile({
  photo,
  label,
  refresher,
  onOpen,
}: {
  photo: PortalReceiptPhotoDto;
  label: string;
  refresher: UrlRefresher;
  onOpen: () => void;
}) {
  return (
    <TileFrame tone={photo.status === 'removed' ? 'muted' : 'plain'} testId={`portal-photo-${photo.status}`}>
      {photo.status === 'attached' && photo.url !== null ? (
        <div className="relative h-full w-full">
          <PresignedImage photo={{ ...photo, url: photo.url }} alt={label} refresher={refresher} />
          <button type="button" aria-label={`Open ${label}`} onClick={onOpen} className="absolute inset-0 focus-visible:outline-2 focus-visible:outline-(--ring)" />
        </div>
      ) : (
        <button type="button" aria-label={`${label}: ${photo.status === 'removed' ? PORTAL_REMOVED_PHOTO : 'image unavailable'}`} onClick={onOpen} className="h-full w-full">
          <PortalPlaceholder photo={photo} />
        </button>
      )}
    </TileFrame>
  );
}
