'use client';

import { useState, useSyncExternalStore, type ReactNode } from 'react';

import { fetchApiRecallReport } from '@/lib/api/client';
import type { RecallBinDto, RecallDetailResponse, RecallLotDto, RecallReceiptDto, RecallShipmentDto } from '@/lib/api/generated';
import { istDateLabel } from '@/lib/audit-exports';
import { readSession, subscribeSession } from '@/lib/auth';
import { istInstantLabel } from '@/lib/client-webhooks';
import {
  MOCK_RECALL_NOTE,
  addBatchesOutcome,
  adjustedOutByReasonLabel,
  closeRecallOutcome,
  notifyRecallsChanged,
  recallLotStatusLabel,
  recallQuantity,
  recallRoleLabel,
  timeToReportLabel,
} from '@/lib/recalls';
import { roleHasCapability } from '@/lib/users';
import { useRecallDetail, useRecallTrace, type RecallTraceKind } from '@/lib/use-recalls';

import { DataTable, expandedRowId, type DataTableColumn } from '@/components/data-table/data-table';
import { FeedbackBanner } from '@/components/feedback/banner';
import { AddLotsForm } from '@/components/inventory/recalls/add-lots-form';
import { CloseRecallForm } from '@/components/inventory/recalls/close-recall-form';
import { EmptyState } from '@/components/shared/empty-state';
import { RecallChips, RecallFiguresTable, RecallOnHandTable } from '@/components/shared/recall-figures';
import { RecallReportButtons } from '@/components/shared/recall-report-buttons';
import { SkeletonBar } from '@/components/shared/skeleton';
import { StatusChip } from '@/components/shared/status-chip';
import { ReadFailure, buttonClass, primaryClass, rowButtonClass } from '@/components/shared/surface';

type Panel = 'close' | 'add' | null;

/**
 * Story 3-7a — one recall, as a document (decision 11): the header (code,
 * client, status, MOCK, who opened and closed it and when, the time to the
 * first report), its lots with live figures beside the figures frozen at
 * close, where the lots sit (per warehouse and location role, then the paged
 * bin list), the open orders holding them (dispatch refuses those), the
 * planned picks that will refuse, every shipment and receipt (paged), the
 * report downloads, and — `qc.manage`, while open — Add lots and Close.
 */
export function RecallDetail({ recallId, onBack }: { readonly recallId: string; readonly onBack: () => void }) {
  const detail = useRecallDetail(recallId);
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const canManage = roleHasCapability(role, 'qc.manage');
  const [panel, setPanel] = useState<Panel>(null);
  const [banner, setBanner] = useState<{ word: string; reason: string } | null>(null);

  const back = (
    <button type="button" className={rowButtonClass} onClick={onBack}>
      ← All recalls
    </button>
  );
  if (detail.state === 'loading') {
    return (
      <div className="flex flex-col gap-3" role="status" aria-label="Loading the recall">
        <div>{back}</div>
        <SkeletonBar className="h-6 w-48" />
        <SkeletonBar className="h-4 w-full" />
        <SkeletonBar className="h-32 w-full" />
      </div>
    );
  }
  if (detail.state === 'failed') {
    return (
      <div className="flex flex-col gap-3">
        <div>{back}</div>
        <ReadFailure word="Recall not loaded" reason={detail.reason} onRetry={detail.reload} />
      </div>
    );
  }
  const data = detail.data;
  const { recall } = data;
  const open = recall.status === 'open';
  return (
    <div className="flex flex-col gap-6" data-testid="recall-detail">
      <div>{back}</div>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
            <span className="font-mono">{recall.code}</span>
            <RecallChips status={recall.status} mode={recall.mode} />
          </h2>
          <p className="text-sm text-(--muted-foreground)">
            {recall.clientCode} — {recall.clientName} · {data.lots.length} {data.lots.length === 1 ? 'lot' : 'lots'} · figures as of {istInstantLabel(data.asOf)}
          </p>
        </div>
        {canManage && open && panel === null && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass} onClick={() => {
                setBanner(null);
                setPanel('add');
              }}>
              Add lots
            </button>
            <button type="button" className={primaryClass} onClick={() => {
                setBanner(null);
                setPanel('close');
              }}>
              Close recall
            </button>
          </div>
        )}
      </header>

      {recall.mode === 'mock' && <FeedbackBanner tone="warning" word="Mock recall" reason={MOCK_RECALL_NOTE} />}
      {banner !== null && <FeedbackBanner tone="accepted" word={banner.word} reason={banner.reason} />}

      <RecallFacts detail={data} />

      {panel === 'close' && (
        <CloseRecallForm
          detail={data}
          onCancel={() => setPanel(null)}
          onClosed={(snapshot) => {
            setPanel(null);
            setBanner(closeRecallOutcome(snapshot));
          }}
        />
      )}
      {panel === 'add' && (
        <AddLotsForm
          recall={recall}
          lotCount={data.lots.length}
          onCancel={() => setPanel(null)}
          onAdded={(snapshot, added) => {
            setPanel(null);
            setBanner(addBatchesOutcome(snapshot, added));
          }}
        />
      )}

      <DetailSection title="Report" hint="One table for the brand: on hand, held orders, every shipment and receipt. Every download is recorded.">
        {tenantId !== null && (
          <RecallReportButtons code={recall.code} mode={recall.mode} fetchReport={(format) => fetchApiRecallReport(tenantId, recall.id, format)} onDownloaded={notifyRecallsChanged} />
        )}
      </DetailSection>

      <LotsSection detail={data} />

      <DetailSection title="Where it sits" hint="On hand per warehouse and location — what the client sees. The bins below are staff only.">
        <RecallOnHandTable rows={data.onHandByWarehouse} uomOf={uomOfLot(data.lots)} />
        <TraceSection kind="bins" recallId={recall.id} title="Bins" uomOf={uomOfLot(data.lots)} />
      </DetailSection>

      <HeldOrdersSection detail={data} />
      <PlannedPicksSection detail={data} />

      <DetailSection title="Shipments" hint="Where the lots went: one row per dispatched pick — consignee, destination, carrier and AWB.">
        <TraceSection kind="shipments" recallId={recall.id} title="Shipments" uomOf={uomOfLot(data.lots)} />
      </DetailSection>
      <DetailSection title="Receipts" hint="Where the lots came from: one row per goods receipt — its GRN, document and vendor.">
        <TraceSection kind="receipts" recallId={recall.id} title="Receipts" uomOf={uomOfLot(data.lots)} />
      </DetailSection>
    </div>
  );
}

function uomOfLot(lots: readonly RecallLotDto[]): (batchCode: string) => string {
  const byCode = new Map(lots.map((lot) => [lot.batchCode, lot.uom]));
  return (code) => byCode.get(code) ?? 'units';
}

function DetailSection({ title, hint, children }: { readonly title: string; readonly hint?: string; readonly children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <div className="flex flex-col gap-0.5">
        <h3 className="font-medium">{title}</h3>
        {hint !== undefined && <p className="text-xs text-(--muted-foreground)">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-(--muted-foreground)">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function RecallFacts({ detail }: { readonly detail: RecallDetailResponse }) {
  const { recall } = detail;
  const report = timeToReportLabel(recall.timeToReportSeconds);
  return (
    <dl className="grid max-w-5xl grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="recall-facts">
      <Fact label="Reason (the client sees this)">{recall.reasonNote}</Fact>
      <Fact label="Brand reference">{recall.externalRef ?? '—'}</Fact>
      <Fact label="Opened">
        {istInstantLabel(recall.openedAt)}
        {recall.openedByName !== null && <span className="text-(--muted-foreground)"> · by {recall.openedByName}</span>}
      </Fact>
      <Fact label="First report">
        {recall.firstReportAt === null ? (
          <span className="text-(--muted-foreground)">Not downloaded yet</span>
        ) : (
          <>
            {istInstantLabel(recall.firstReportAt)}
            {report !== null && <span className="text-(--muted-foreground)"> · {report}</span>}
          </>
        )}
      </Fact>
      {recall.closedAt !== null && (
        <Fact label="Closed">
          {istInstantLabel(recall.closedAt)}
          {recall.closedByName !== null && <span className="text-(--muted-foreground)"> · by {recall.closedByName}</span>}
        </Fact>
      )}
      {recall.closeNote !== null && <Fact label="Close note">{recall.closeNote}</Fact>}
      {recall.evidenceRef !== null && <Fact label="Evidence">{recall.evidenceRef}</Fact>}
      {recall.acknowledgedUnaccounted === true && <Fact label="Unaccounted stock">Acknowledged at close</Fact>}
    </dl>
  );
}

type LotRow = RecallLotDto & { readonly id: string };

function LotsSection({ detail }: { readonly detail: RecallDetailResponse }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const closed = detail.recall.status === 'closed';
  const rows: LotRow[] = detail.lots.map((lot) => ({ ...lot, id: lot.batchId }));
  const q = (lot: LotRow, key: keyof RecallLotDto['figures']) => recallQuantity(lot.figures[key], lot.uom);
  const columns: DataTableColumn<LotRow>[] = [
    {
      key: 'lot',
      header: 'Lot',
      render: (lot) => (
        <span className="flex flex-col">
          <span className="font-mono text-xs">{lot.batchCode}</span>
          <span className="text-xs text-(--muted-foreground)">
            {lot.skuCode} — {lot.skuName}
          </span>
        </span>
      ),
    },
    { key: 'expiry', header: 'Expires', priority: 3, render: (lot) => (lot.expiryDate === null ? '—' : istDateLabel(lot.expiryDate)) },
    { key: 'status', header: 'Status now', render: (lot) => <span className="text-xs">{recallLotStatusLabel(lot, detail.recall.mode)}</span> },
    { key: 'received', header: 'Received', numeric: true, priority: 3, render: (lot) => q(lot, 'received') },
    { key: 'onHand', header: 'On hand', numeric: true, render: (lot) => q(lot, 'onHand') },
    { key: 'inTransit', header: 'In transit', numeric: true, priority: 2, render: (lot) => q(lot, 'inTransit') },
    { key: 'held', header: 'In open orders', numeric: true, render: (lot) => q(lot, 'heldInOpenOrders') },
    { key: 'dispatched', header: 'Dispatched', numeric: true, render: (lot) => q(lot, 'dispatched') },
    {
      key: 'unaccounted',
      header: 'Unaccounted',
      numeric: true,
      render: (lot) =>
        lot.figures.unaccounted === 0 ? (
          q(lot, 'unaccounted')
        ) : (
          <StatusChip tone="warning" glyph="⚠">
            {q(lot, 'unaccounted')}
          </StatusChip>
        ),
    },
    {
      key: 'figures',
      header: '',
      render: (lot) => (
        <button
          type="button"
          className={rowButtonClass}
          aria-expanded={openId === lot.id}
          aria-controls={expandedRowId(lot.id)}
          onClick={() => setOpenId(openId === lot.id ? null : lot.id)}
        >
          {openId === lot.id ? 'Hide figures' : closed ? 'Live and at close' : 'All figures'}
        </button>
      ),
    },
  ];
  return (
    <DetailSection title="Lots" hint={closed ? 'Live figures beside those frozen at close, in base units.' : 'Live figures, in base units.'}>
      <DataTable<LotRow>
        columns={columns}
        rows={rows}
        rowNoun={{ one: 'lot', many: 'lots' }}
        renderExpanded={(lot) =>
          lot.id === openId ? (
            <div className="flex flex-col gap-2 py-1" data-testid="recall-lot-figures">
              <RecallFiguresTable figures={lot.figures} closeFigures={lot.closeFigures} uom={lot.uom} caption={`Figures of ${lot.batchCode}`} />
              <LotNotes lot={lot} />
            </div>
          ) : null
        }
      />
    </DetailSection>
  );
}

function LotNotes({ lot }: { readonly lot: RecallLotDto }) {
  const live = adjustedOutByReasonLabel(lot.adjustedOutByReason, lot.uom);
  const atClose = adjustedOutByReasonLabel(lot.closeAdjustedOutByReason, lot.uom);
  const lines: [string, string][] = [];
  if (live !== null) lines.push(['Written off, by reason', `${live} — the trace stops there: the units left stock by adjustment.`]);
  if (atClose !== null && atClose !== live) lines.push(['Written off at close', atClose]);
  if (lot.dispositionNote !== null) lines.push(['Disposition', lot.dispositionNote]);
  if (lot.overrideReason !== null) lines.push(['Released with stock because', lot.overrideReason]);
  if (lines.length === 0) return null;
  return (
    <dl className="flex flex-col gap-1 text-xs">
      {lines.map(([label, value]) => (
        <div key={label} className="flex flex-wrap gap-2">
          <dt className="font-medium">{label}:</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function HeldOrdersSection({ detail }: { readonly detail: RecallDetailResponse }) {
  const uomOf = uomOfLot(detail.lots);
  const live = detail.recall.mode === 'live' && detail.recall.status === 'open';
  const rows = detail.heldOrders.map((row) => ({ ...row, id: `${row.orderId}|${row.batchId}` }));
  const columns: DataTableColumn<(typeof rows)[number]>[] = [
    {
      key: 'order',
      header: 'Order',
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-mono text-xs">{row.orderLabel}</span>
          {row.channelOrderRef !== null && row.channelOrderRef !== row.orderLabel && <span className="text-xs text-(--muted-foreground)">{row.channelOrderRef}</span>}
        </span>
      ),
    },
    { key: 'warehouse', header: 'Warehouse', render: (row) => <span className="font-mono text-xs">{row.warehouseCode}</span> },
    { key: 'lot', header: 'Lot', render: (row) => <span className="font-mono text-xs">{row.batchCode}</span> },
    { key: 'quantity', header: 'Picked', numeric: true, render: (row) => recallQuantity(row.quantity, uomOf(row.batchCode)) },
    { key: 'picked', header: 'Last picked', priority: 2, render: (row) => istInstantLabel(row.lastPickedAt) },
  ];
  return (
    <DetailSection
      title="Held in open orders"
      hint={
        live
          ? 'Picked or packed orders holding a recalled lot. Dispatch refuses them while the recall is open — release the lot at close, or keep the order back until it can be unpacked.'
          : 'Picked or packed orders holding a recalled lot.'
      }
    >
      <DataTable
        columns={columns}
        rows={rows}
        rowNoun={{ one: 'order line', many: 'order lines' }}
        emptyMessage={<EmptyState kind="cleared">No open order holds a recalled lot.</EmptyState>}
      />
    </DetailSection>
  );
}

function PlannedPicksSection({ detail }: { readonly detail: RecallDetailResponse }) {
  if (detail.plannedPicks.length === 0) return null;
  const rows = detail.plannedPicks.map((row) => ({ ...row, id: row.picklistLineId }));
  const columns: DataTableColumn<(typeof rows)[number]>[] = [
    { key: 'order', header: 'Order', render: (row) => <span className="font-mono text-xs">{row.orderLabel}</span> },
    { key: 'warehouse', header: 'Warehouse', render: (row) => <span className="font-mono text-xs">{row.warehouseCode}</span> },
    { key: 'bin', header: 'Bin', render: (row) => <span className="font-mono text-xs">{row.binCode}</span> },
    { key: 'sku', header: 'SKU', render: (row) => <span className="font-mono text-xs">{row.skuCode}</span> },
    { key: 'quantity', header: 'To pick', numeric: true, render: (row) => row.quantity.toLocaleString('en-IN', { maximumFractionDigits: 20 }) },
  ];
  return (
    <DetailSection
      title="Planned picks that will refuse"
      hint="These picks are in a bin that holds a recalled lot. A picker cannot tell the recalled units from good ones, so the pick refuses until the recalled units are moved out of the bin."
    >
      <DataTable columns={columns} rows={rows} rowNoun={{ one: 'pick', many: 'picks' }} />
    </DetailSection>
  );
}

const TRACE_EMPTY: Readonly<Record<RecallTraceKind, string>> = {
  bins: 'No bin holds a recalled lot.',
  shipments: 'No recalled unit has shipped.',
  receipts: 'No receipt of these lots.',
};

function TraceSection({
  kind,
  recallId,
  title,
  uomOf,
}: {
  readonly kind: RecallTraceKind;
  readonly recallId: string;
  readonly title: string;
  readonly uomOf: (batchCode: string) => string;
}) {
  const trace = useRecallTrace(kind, recallId);
  if (trace.state === 'failed') return <ReadFailure word={`${title} not loaded`} reason={trace.reason} onRetry={trace.reload} />;
  const loading = trace.state === 'loading' ? `Loading ${title.toLowerCase()}…` : undefined;
  const items = trace.state === 'ready' ? trace.data.items : [];
  const nextCursor = trace.state === 'ready' ? trace.data.nextCursor : null;
  const empty = <EmptyState kind="first-use">{TRACE_EMPTY[kind]}</EmptyState>;
  const during = (yes: boolean) =>
    yes ? (
      <StatusChip tone="warning" glyph="!">
        During the recall
      </StatusChip>
    ) : null;

  if (kind === 'bins') {
    const rows = (items as readonly RecallBinDto[]).map((row, i) => ({ ...row, id: `${row.warehouseCode}|${row.binCode}|${row.batchCode}|${i}` }));
    const columns: DataTableColumn<(typeof rows)[number]>[] = [
      { key: 'warehouse', header: 'Warehouse', render: (row) => <span className="font-mono text-xs">{row.warehouseCode}</span> },
      { key: 'bin', header: 'Bin', render: (row) => <span className="font-mono text-xs">{row.binCode}</span> },
      { key: 'role', header: 'Location', render: (row) => recallRoleLabel(row.role) },
      { key: 'lot', header: 'Lot', render: (row) => <span className="font-mono text-xs">{row.batchCode}</span> },
      { key: 'sku', header: 'SKU', priority: 2, render: (row) => <span className="font-mono text-xs">{row.skuCode}</span> },
      { key: 'quantity', header: 'Quantity', numeric: true, render: (row) => recallQuantity(row.quantity, uomOf(row.batchCode)) },
    ];
    return (
      <DataTable key={trace.epoch} columns={columns} rows={rows} nextCursor={nextCursor} onCursor={trace.onCursor} loading={loading} emptyMessage={empty} rowNoun={{ one: 'bin', many: 'bins' }} />
    );
  }
  if (kind === 'shipments') {
    const rows = (items as readonly RecallShipmentDto[]).map((row, i) => ({ ...row, id: `${row.orderId}|${row.batchCode}|${i}` }));
    const columns: DataTableColumn<(typeof rows)[number]>[] = [
      {
        key: 'order',
        header: 'Order',
        render: (row) => (
          <span className="flex flex-col">
            <span className="font-mono text-xs">{row.orderLabel}</span>
            {row.channelOrderRef !== null && row.channelOrderRef !== row.orderLabel && <span className="text-xs text-(--muted-foreground)">{row.channelOrderRef}</span>}
          </span>
        ),
      },
      {
        key: 'consignee',
        header: 'Consignee',
        render: (row) => (
          <span className="flex flex-col">
            <span>{row.consigneeLegalName ?? '—'}</span>
            {row.consigneeGstin !== null && <span className="font-mono text-xs text-(--muted-foreground)">{row.consigneeGstin}</span>}
          </span>
        ),
      },
      {
        key: 'destination',
        header: 'Destination',
        priority: 2,
        render: (row) => [row.destinationCity, row.destinationState, row.destinationPincode].filter((part) => part !== null && part !== '').join(', ') || '—',
      },
      { key: 'lot', header: 'Lot', render: (row) => <span className="font-mono text-xs">{row.batchCode}</span> },
      { key: 'quantity', header: 'Quantity', numeric: true, render: (row) => recallQuantity(row.quantity, uomOf(row.batchCode)) },
      { key: 'dispatched', header: 'Dispatched', render: (row) => (row.dispatchedAt === null ? '—' : istInstantLabel(row.dispatchedAt)) },
      {
        key: 'carrier',
        header: 'Carrier · AWB',
        priority: 2,
        render: (row) => [row.carrier, row.awb].filter((part) => part !== null && part !== '').join(' · ') || '—',
      },
      { key: 'during', header: '', render: (row) => during(row.duringRecall) },
    ];
    return (
      <DataTable
        key={trace.epoch}
        columns={columns}
        rows={rows}
        nextCursor={nextCursor}
        onCursor={trace.onCursor}
        loading={loading}
        emptyMessage={empty}
        rowNoun={{ one: 'shipment', many: 'shipments' }}
      />
    );
  }
  const rows = (items as readonly RecallReceiptDto[]).map((row, i) => ({ ...row, id: `${row.grnCode}|${row.batchCode}|${i}` }));
  const columns: DataTableColumn<(typeof rows)[number]>[] = [
    { key: 'grn', header: 'Receipt', render: (row) => <span className="font-mono text-xs">{row.grnCode}</span> },
    { key: 'document', header: 'Document', priority: 2, render: (row) => row.document ?? '—' },
    { key: 'vendor', header: 'Vendor', render: (row) => row.vendorName ?? '—' },
    { key: 'warehouse', header: 'Warehouse', render: (row) => <span className="font-mono text-xs">{row.warehouseCode}</span> },
    { key: 'lot', header: 'Lot', render: (row) => <span className="font-mono text-xs">{row.batchCode}</span> },
    { key: 'quantity', header: 'Quantity', numeric: true, render: (row) => recallQuantity(row.quantity, uomOf(row.batchCode)) },
    { key: 'received', header: 'Received', render: (row) => istInstantLabel(row.receivedAt) },
    { key: 'during', header: '', render: (row) => during(row.duringRecall) },
  ];
  return (
    <DataTable key={trace.epoch} columns={columns} rows={rows} nextCursor={nextCursor} onCursor={trace.onCursor} loading={loading} emptyMessage={empty} rowNoun={{ one: 'receipt', many: 'receipts' }} />
  );
}
