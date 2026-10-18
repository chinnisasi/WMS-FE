'use client';

import Link from 'next/link';
import { useRef, useState, useSyncExternalStore } from 'react';

import { readActiveWarehouseId, subscribeActiveWarehouse } from '@/lib/warehouses';
import { readSession, subscribeSession } from '@/lib/auth';
import { fetchApiPlaceQcHold, fetchApiReleaseQcHold, fetchApiReleaseReceiptQcHolds } from '@/lib/api/client';
import { useTenantWarehouses } from '@/lib/use-tenant-warehouses';
import {
  useBinCodeMap,
  useGoodsReceipts,
  usePurchaseOrders,
  useQcHolds,
  useSkuMap,
  useStockScopes,
  useUserMap,
  useVendorMap,
  type PurchaseOrderHeader,
} from '@/lib/use-inbound';
import {
  openQtyLabel,
  qcGrnFilterLabel,
  qcHoldKindLabel,
  qcReason,
  releaseReceiptOutcome,
  releaseReceiptReason,
} from '@/lib/over-receipt';
import { quantityLabel } from '@/lib/format-quantity';
import type {
  GoodsReceiptEntryDto,
  PurchaseOrderLineDto,
  PutawayTaskDto,
  QcHoldEntryDto,
  SkuResponse,
} from '@/lib/api/generated';
import { roleHasCapability } from '@/lib/users';
import { clientCell, showClients, skuDisplayLabel } from '@/lib/clients';
import { readyClients, useClients } from '@/lib/use-clients';
import { ulid } from '@/lib/ulid';
import { grnDocument, notifyInboundChanged } from '@/lib/asns';
import {
  drillFor,
  ledgerDocHref,
  warehouseDisplayLabel,
  type GrnsDrill,
  type ParsedDrill,
  type PutawayDrill,
} from '@/lib/drill';
import { usePutawayTasks } from '@/lib/use-putaway';
import {
  INBOUND_PAGE_TABS,
  inboundQcHoldsHref,
  inboundTabHref,
  initialInboundTab,
  tabCountLabel,
  type InboundTab,
} from '@/lib/inbound-tabs';
import { useInboundTabCounts, type InboundTabCounts } from '@/lib/use-inbound-tab-counts';

import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { DrillBanner } from '@/components/shared/drill-banner';
import { PageTabPanel, PageTabStrip, usePageTab } from '@/components/shared/page-tabs';
import { FeedbackBanner } from '@/components/feedback/banner';
import { AsnsCard } from '@/components/inbound/asn-card';
import { ReadFailure, Section } from '@/components/shared/surface';
import { WarehousesFailure, WarehousesRefreshNote } from '@/components/shared/warehouses-failure';

/**
 * The Inbound surface (stories 3.1 / 3.3) — the review half of receiving:
 * the active warehouse's purchase orders (code, vendor, per-line
 * ordered/received/open, status), its advance shipment notices (story 21-6,
 * `asn-card.tsx` — the one inbound document the web also writes) and its
 * goods receipt notes (code, the document — PO, ASN or blind + reason —
 * lines, units, recorded time). The mobile device records receipts; the web
 * surface reviews them.
 *
 * Warehouse scoping follows the sidebar switcher's pick (per-viewer, like
 * zone-bin-setup), falling back to the tenant's first warehouse.
 *
 * Story 9-1b — "Awaiting putaway" (the derived putaway tasks) is always on
 * the page, for the active warehouse (decision 6). An Overview drill names
 * ONE section: `list=grns` drills the goods receipts, `list=putaway` the
 * putaway list — each to the drill's warehouse, under a banner; every other
 * card renders normally for the active warehouse, which a drill never writes.
 */

export function InboundCards({
  drill = null,
  initialTab = null,
  qcGrnId = null,
}: { drill?: ParsedDrill; initialTab?: InboundTab | null; qcGrnId?: string | null } = {}) {
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );

  if (sessioned === null) return null;
  if (!sessioned) {
    return (
      <div className="rounded-md border border-(--border) p-3 text-sm">
        <div className="font-medium">Inbound</div>
        <div className="text-(--muted-foreground)">Sign in to review inbound work.</div>
      </div>
    );
  }
  return <InboundCardsSessioned drill={drill} initialTab={initialTab} qcGrnId={qcGrnId} />;
}

function InboundCardsSessioned({
  drill,
  initialTab,
  qcGrnId,
}: {
  drill: ParsedDrill;
  initialTab: InboundTab | null;
  qcGrnId: string | null;
}) {
  const grnsDrill = drillFor(drill, 'grns');
  const putawayDrill = drillFor(drill, 'putaway');
  // inbound-tabs: one card at a time. A drill opens on its own list's tab;
  // another tab leaves the drill (`?tab=` replaces the drill's URL), so the
  // other lists stay one click away, as on the stacked page.
  const drilled = grnsDrill !== null || putawayDrill !== null;
  // The tab state and its URL rules are the shared page-tabs ones
  // (`components/shared/page-tabs.tsx`): outside a drill the tab IS the live
  // URL's `?tab=`, and a click rewrites the URL in place.
  const [tab, selectTab] = usePageTab(INBOUND_PAGE_TABS, initialInboundTab(drill, initialTab), drilled);
  const warehouseRead = useTenantWarehouses();
  // Loading reads as before; a failed read renders below (21-11b).
  const { tenantId, items: warehouses } =
    warehouseRead.state === 'ready' ? warehouseRead.data : { tenantId: null, items: [] as readonly never[] };
  const activeId = useSyncExternalStore(
    subscribeActiveWarehouse,
    () => (tenantId === null ? null : readActiveWarehouseId(tenantId)),
    () => null,
  );
  // The warehouse under review: the switcher's pick when it still belongs to
  // this tenant, else the tenant's first warehouse.
  const warehouseId =
    activeId !== null && warehouses.some((w) => w.id === activeId)
      ? activeId
      : (warehouses[0]?.id ?? null);
  const warehouse = warehouses.find((w) => w.id === warehouseId);
  // inbound-tabs — counts follow the active warehouse (a drill's own
  // warehouse scopes only its card).
  const tabCounts = useInboundTabCounts(warehouseId);
  // A drilled card names the drill's warehouse with the one shared label
  // (its short id while the list is not in hand — never "Pick a warehouse").
  const drillLabel = (id: string) => warehouseDisplayLabel(warehouses, id);

  // Story 21-11b: the warehouse picker failed to load — say so, with Retry,
  // rather than four cards with no warehouse to read.
  if (warehouseRead.state === 'failed') {
    return (
      <Section title="Inbound">
        <WarehousesFailure state={warehouseRead} />
      </Section>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {warehouseRead.state === 'ready' && warehouseRead.data.refreshFailed !== null && (
        <WarehousesRefreshNote reason={warehouseRead.data.refreshFailed} onRetry={warehouseRead.reload} />
      )}
      <PageTabStrip
        def={INBOUND_PAGE_TABS}
        active={tab}
        drilled={drilled}
        onSelect={selectTab}
        badge={(id) => <InboundTabCount tab={id} counts={tabCounts} />}
      />
      <PageTabPanel def={INBOUND_PAGE_TABS} active={tab}>
        {tab === 'pos' && <PurchaseOrdersCard warehouseId={warehouseId} warehouseLabel={warehouse?.name ?? warehouse?.code ?? null} />}
        {tab === 'asns' && (
          <AsnsCard warehouseId={warehouseId} warehouseLabel={warehouse?.name ?? warehouse?.code ?? null} warehouseCode={warehouse?.code ?? null} />
        )}
        {tab === 'grns' &&
          (grnsDrill === null ? (
            <GoodsReceiptsCard warehouseId={warehouseId} warehouseLabel={warehouse?.name ?? warehouse?.code ?? null} />
          ) : (
            // The drill's warehouse (or every warehouse, when the drill names none).
            <GoodsReceiptsCard
              warehouseId={grnsDrill.warehouseId ?? null}
              warehouseLabel={grnsDrill.warehouseId === undefined ? 'All warehouses' : drillLabel(grnsDrill.warehouseId)}
              drill={grnsDrill}
              clearHref={inboundTabHref('grns')}
            />
          ))}
        {tab === 'putaway' &&
          (putawayDrill === null ? (
            <PutawayCard warehouseId={warehouseId} warehouseLabel={warehouse?.name ?? warehouse?.code ?? null} />
          ) : (
            <PutawayCard
              warehouseId={putawayDrill.warehouseId}
              warehouseLabel={drillLabel(putawayDrill.warehouseId)}
              drill={putawayDrill}
              clearHref={inboundTabHref('putaway')}
            />
          ))}
        {tab === 'qc-holds' && (
          <QcHoldsCard warehouseId={warehouseId} warehouseLabel={warehouse?.name ?? warehouse?.code ?? null} initialGrnId={qcGrnId} />
        )}
      </PageTabPanel>
    </div>
  );
}

/** inbound-tabs — a tab's count pill; none on Goods receipts (history) or a failed read. */
function InboundTabCount({ tab, counts }: { tab: InboundTab; counts: InboundTabCounts }) {
  if (tab === 'grns') return null;
  const count = counts[tab];
  if (count === undefined) return null;
  return (
    <span
      data-testid={`inbound-tab-count-${tab}`}
      className="ml-1.5 rounded-full bg-(--muted) px-1.5 text-[11px] tabular-nums text-(--muted-foreground)"
    >
      {tabCountLabel(count)}
    </span>
  );
}

/** The active warehouse's purchase orders, headers plus per-line quantities. */
function PurchaseOrdersCard({
  warehouseId,
  warehouseLabel,
}: {
  warehouseId: string | null;
  warehouseLabel: string | null;
}) {
  const pos = usePurchaseOrders(warehouseId);
  const vendors = useVendorMap();
  const skus = useSkuMap();
  // Story 21-2b — the PO's client (derived from its lines' SKUs), shown once
  // the tenant holds more than its own client. The row carries its lines
  // too, so this one column is both the list's and the detail's.
  const clients = readyClients(useClients());
  const tenantName = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.name ?? null,
    () => null,
  );

  const columns: readonly DataTableColumn<PurchaseOrderHeader>[] = [
    { key: 'code', header: 'PO code', render: (po) => <span className="font-mono text-xs">{po.code}</span> },
    ...(showClients(clients)
      ? [
          {
            key: 'client',
            header: 'Client',
            render: (po: PurchaseOrderHeader) => clientCell(po.clientId, clients ?? [], tenantName),
          } satisfies DataTableColumn<PurchaseOrderHeader>,
        ]
      : []),
    {
      key: 'vendor',
      header: 'Vendor',
      render: (po) => vendors?.[po.vendorId]?.name ?? '—',
    },
    {
      key: 'lines',
      header: 'Lines (ordered · received · open)',
      render: (po) => {
        const lines = pos?.lines[po.id];
        if (lines === undefined || lines.length === 0) return <span>—</span>;
        return (
          <div className="flex flex-col gap-1 py-1">
            {lines.map((line) => (
              // The line's own SKU names the unit and its precision — a PO
              // mixes units across its lines, so each row states its own.
              <PoLineRow key={line.id} line={line} sku={skus?.[line.skuId]} />
            ))}
          </div>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (po) => (
        <span
          className={
            po.status === 'open'
              ? 'rounded-sm bg-(--muted) px-1.5 py-0.5 text-xs'
              : 'rounded-sm bg-(--muted) px-1.5 py-0.5 text-xs text-(--muted-foreground)'
          }
        >
          {po.status === 'open' ? 'Open' : 'Closed'}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: 'Created',
      render: (po) => <time dateTime={po.createdAt}>{new Date(po.createdAt).toLocaleString()}</time>,
    },
    {
      // Story 9-3a — the PO's receipt events, in the warehouse it receives
      // into (a putaway names its GRN, not the PO — hence "Receipts").
      key: 'ledger',
      header: 'Ledger',
      render: (po) => (
        <Link
          href={ledgerDocHref('po', po.id, po.warehouseId, po.code)}
          className="text-xs text-(--primary) underline underline-offset-2"
        >
          Receipts in the ledger
        </Link>
      ),
    },
  ];

  return (
    <section className="flex flex-col gap-3 rounded-md border border-(--border) p-3 text-sm">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-medium">Purchase orders</h2>
        <div className="text-(--muted-foreground)">
          {warehouseLabel === null
            ? 'Pick a warehouse to review its purchase orders.'
            : `${warehouseLabel} — newest first. Open quantities are derived (ordered − received).`}
        </div>
      </div>

      <DataTable<PurchaseOrderHeader>
        columns={columns}
        rows={pos?.items ?? []}
        nextCursor={pos?.nextCursor ?? null}
        onCursor={pos?.onCursor}
        emptyMessage={
          warehouseId === null ? 'Create a warehouse first.' : 'No purchase orders yet.'
        }
      />
    </section>
  );
}

/** One PO line: `SKU 2.500 kg ord · 1.000 kg rec · 1.500 kg open` (negative open = over-received). */
function PoLineRow({ line, sku }: { line: PurchaseOrderLineDto; sku: SkuResponse | undefined }) {
  const open = openQtyLabel(line.openQty, sku);
  const qty = (value: number) => quantityLabel(value, sku ?? null);
  return (
    <div className="flex flex-wrap items-center gap-x-2 text-xs">
      <span className="font-mono">{sku?.code ?? '(unknown SKU)'}</span>
      <span className="text-(--muted-foreground)">
        {qty(line.orderedQty)} ord · {qty(line.receivedQty)} rec · {open} open
      </span>
      {line.status !== 'open' && <span className="text-(--muted-foreground)">[{line.status}]</span>}
    </div>
  );
}

/** The warehouse's goods receipt notes, blind receipts flagged for PO-matching. */
function GoodsReceiptsCard({
  warehouseId,
  warehouseLabel,
  drill = null,
  clearHref,
}: {
  warehouseId: string | null;
  warehouseLabel: string | null;
  /** Story 9-1b — the drill's rows, server-filtered, under the banner. */
  drill?: GrnsDrill | null;
  /** inbound-tabs — where the banner's Clear lands (this list's tab). */
  clearHref?: string;
}) {
  const grns = useGoodsReceipts(warehouseId, drill);
  // Story 1-1 — the receipt's client (the PO's, the ASN's, or a blind
  // receipt's chosen one), shown once the tenant holds more than its own
  // client. An older receipt the backfill could not attribute reads "—".
  const clients = readyClients(useClients());
  const tenantName = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.name ?? null,
    () => null,
  );

  const columns: readonly DataTableColumn<GoodsReceiptEntryDto>[] = [
    { key: 'code', header: 'GRN code', render: (grn) => <span className="font-mono text-xs">{grn.code}</span> },
    ...(showClients(clients)
      ? [
          {
            key: 'client',
            header: 'Client',
            render: (grn: GoodsReceiptEntryDto) => clientCell(grn.clientId, clients ?? [], tenantName),
          } satisfies DataTableColumn<GoodsReceiptEntryDto>,
        ]
      : []),
    {
      // Story 21-6: a receipt books against a PO, an ASN, or neither (blind).
      key: 'document',
      header: 'Document',
      render: (grn) => {
        const poCodes = grns.state === 'ready' ? grns.data.poCodes : {};
        const document = grnDocument(grn, grn.poId === null ? null : (poCodes[grn.poId] ?? null));
        return document.kind === 'blind' ? (
          <span className="rounded-sm bg-(--muted) px-1.5 py-0.5 text-xs">{document.label}</span>
        ) : (
          <span className="font-mono text-xs">{document.label}</span>
        );
      },
    },
    { key: 'lineCount', header: 'Lines', numeric: true },
    {
      key: 'units',
      header: 'Units',
      numeric: true,
      render: (grn) =>
        grn.appliedUnits === grn.totalUnits ? (
          String(grn.totalUnits)
        ) : (
          // The excess is pending an over-receipt decision (Conflicts & Reviews).
          <span>
            {grn.appliedUnits}{' '}
            <span className="text-(--muted-foreground)">
              (+{grn.totalUnits - grn.appliedUnits} pending)
            </span>
          </span>
        ),
    },
    {
      key: 'recordedAt',
      header: 'Recorded',
      render: (grn) => <time dateTime={grn.recordedAt}>{new Date(grn.recordedAt).toLocaleString()}</time>,
    },
    {
      // Story 9-3a — the GRN's receipts and putaways, in its OWN warehouse
      // (never the active one).
      key: 'ledger',
      header: 'Ledger',
      render: (grn) => (
        <Link
          href={ledgerDocHref('grn', grn.id, grn.warehouseId, grn.code)}
          className="text-xs text-(--primary) underline underline-offset-2"
        >
          View ledger
        </Link>
      ),
    },
  ];

  return (
    <section className="flex flex-col gap-3 rounded-md border border-(--border) p-3 text-sm">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-medium">Goods receipt notes</h2>
        {drill !== null && <DrillBanner drill={drill} clearHref={clearHref} />}
        <div className="text-(--muted-foreground)">
          {warehouseLabel === null
            ? 'Pick a warehouse to review its receipts.'
            : `${warehouseLabel} — newest first. Each receipt names its document — a PO, an ASN, or Blind; "(+N pending)" units wait on an over-receipt decision.`}
        </div>
      </div>

      {grns.state === 'failed' ? (
        <ReadFailure word="Goods receipts unavailable" reason={grns.reason} onRetry={grns.reload} />
      ) : (
        // Mounted while a page loads: its Prev/Next cursor is internal state.
        <DataTable<GoodsReceiptEntryDto>
          columns={columns}
          rows={grns.state === 'ready' ? grns.data.items : []}
          nextCursor={grns.state === 'ready' ? grns.data.nextCursor : null}
          onCursor={grns.onCursor}
          emptyMessage={
            grns.state === 'loading'
              ? 'Loading receipts…'
              : drill !== null
                ? 'No receipts match this figure.'
                : warehouseId === null
                  ? 'Create a warehouse first.'
                  : 'No receipts recorded yet.'
          }
        />
      )}
    </section>
  );
}

/**
 * Story 9-1b — "Awaiting putaway": the warehouse's derived putaway tasks
 * (GRN lines whose applied stock still sits in the system Receiving bin),
 * read-only and unpaged — the route returns every task at once. The
 * quantity is the task's own `qty` (min(applied, Receiving on-hand)) at the
 * SKU's declared precision; the suggested bin is the server's
 * capacity-only suggestion, or "—" when no bin has room. The Overview's
 * awaiting-putaway figure drills here (`list=putaway`), scoped to the
 * drill's warehouse under the banner.
 */
function PutawayCard({
  warehouseId,
  warehouseLabel,
  drill = null,
  clearHref,
}: {
  warehouseId: string | null;
  warehouseLabel: string | null;
  drill?: PutawayDrill | null;
  /** inbound-tabs — where the banner's Clear lands (this list's tab). */
  clearHref?: string;
}) {
  const tasks = usePutawayTasks(warehouseId);
  const skus = useSkuMap();
  // Story 1-1 — two clients may share a code: the SKU is named with its
  // client once the tenant has several (the task's own code otherwise).
  const clients = readyClients(useClients());

  const columns: readonly DataTableColumn<PutawayTaskDto & { id: string }>[] = [
    { key: 'grnCode', header: 'GRN', render: (task) => <span className="font-mono text-xs">{task.grnCode}</span> },
    {
      key: 'skuCode',
      header: 'SKU',
      render: (task) => (
        <span className="font-mono text-xs">
          {skuDisplayLabel({ code: task.skuCode, clientId: skus?.[task.skuId]?.clientId }, clients)}
        </span>
      ),
    },
    {
      key: 'batchCode',
      header: 'Batch',
      render: (task) => <span className="font-mono text-xs">{task.batchCode ?? '—'}</span>,
    },
    {
      key: 'qty',
      header: 'Quantity',
      numeric: true,
      render: (task) => quantityLabel(task.qty, skus?.[task.skuId] ?? null),
    },
    {
      key: 'suggestedBin',
      header: 'Suggested bin',
      render: (task) => <span className="font-mono text-xs">{task.suggestedBin?.binCode ?? '—'}</span>,
    },
  ];

  return (
    <section
      className="flex flex-col gap-3 rounded-md border border-(--border) p-3 text-sm"
      data-testid="awaiting-putaway"
    >
      <div className="flex flex-col gap-0.5">
        <h2 className="font-medium">Awaiting putaway</h2>
        {drill !== null && <DrillBanner drill={drill} clearHref={clearHref} />}
        <div className="text-(--muted-foreground)">
          {warehouseLabel === null
            ? 'Received stock still in the Receiving bin, oldest receipt first.'
            : `${warehouseLabel} — received stock still in the Receiving bin, oldest receipt first.`}
        </div>
      </div>
      {warehouseId === null ? (
        <div className="text-(--muted-foreground)">Create a warehouse first.</div>
      ) : tasks.state === 'failed' ? (
        <ReadFailure word="Putaway tasks unavailable" reason={tasks.reason} onRetry={tasks.reload} />
      ) : (
        <DataTable<PutawayTaskDto & { id: string }>
          columns={columns}
          rows={tasks.state === 'ready' ? tasks.data.map((task) => ({ ...task, id: task.grnLineId })) : []}
          emptyMessage={tasks.state === 'loading' ? 'Loading putaway tasks…' : 'Nothing awaiting putaway'}
        />
      )}
    </section>
  );
}

/**
 * The warehouse's QC holds (story 3.4): the holds with their reason, held-by,
 * and held-at (the AC — QC-held stock is visible on the Inbound surface with
 * its hold reason), the release action on open rows, and the place-hold form
 * scoped to the warehouse's on-hand (sku, bin) rows. Both mutations are
 * gated again here behind `qc.manage` so a direct URL visit renders
 * read-only (hide surfaces, never "blocked" screens); the buttons carry a
 * fresh ULID Idempotency-Key so a double click replays, never duplicates.
 * Mobile is untouched — the hold is a web Ops-Manager action, no new task.
 */
const holdTabs = ['open', 'released'] as const;
type HoldTab = (typeof holdTabs)[number];

type HoldOutcome = { tone: 'accepted' | 'rejected'; word: string; reason: string } | null;

function QcHoldsCard({
  warehouseId,
  warehouseLabel,
  initialGrnId = null,
}: {
  warehouseId: string | null;
  warehouseLabel: string | null;
  /** Story 1-2b — open narrowed to one receipt's holds (the `qc-receipt` notification's link). */
  initialGrnId?: string | null;
}) {
  const [tab, setTab] = useState<HoldTab>('open');
  // Story 1-2b — the GRN filter: one receipt's holds (its code once a row
  // or a click has named it). The list query takes `grnId`.
  const [grnFilter, setGrnFilter] = useState<{ grnId: string; grnCode: string | null } | null>(
    initialGrnId === null ? null : { grnId: initialGrnId, grnCode: null },
  );
  const holds = useQcHolds(warehouseId, tab, grnFilter?.grnId ?? null);
  const skus = useSkuMap();
  const users = useUserMap();
  const bins = useBinCodeMap(warehouseId);
  // Story 1-2b — a receipt hold names its client (the self client reads as the company).
  const clients = readyClients(useClients());
  const tenantName = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.name ?? null,
    () => null,
  );
  // Story 1.5 gating pattern: subscribed (not a bare readSession() at
  // render) so a /me bootstrap role rewrite re-renders the actions.
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );
  const canManage = roleHasCapability(role, 'qc.manage');

  const [outcome, setOutcome] = useState<HoldOutcome>(null);
  const [releasingId, setReleasingId] = useState<string | null>(null);
  // A pre-render double-click fires both handlers before the disabled state
  // renders — this synchronous re-entry guard makes the second click a
  // no-op instead of a NEW command whose fresh Idempotency-Key would 409
  // right after the first release succeeded. Keyed by hold id, and (story
  // 1-2b) by `grn:<id>` for a Release receipt.
  const releaseInFlight = useRef<Set<string>>(new Set());

  async function release(hold: QcHoldEntryDto) {
    const session = readSession();
    if (session === null || releaseInFlight.current.has(hold.id)) return;
    releaseInFlight.current.add(hold.id);
    setReleasingId(hold.id);
    setOutcome(null);
    try {
      await fetchApiReleaseQcHold(session.tenant.id, hold.id, ulid());
      setOutcome({
        tone: 'accepted',
        word: 'QC hold released',
        reason:
          'The held units returned to the recorded origin bin; the ledger carries the qc.released movements and the decision is audit-trailed.',
      });
      holds?.reload();
      // inbound-tabs — the tab counts re-read on any inbound change.
      notifyInboundChanged();
    } catch (error) {
      setOutcome({ tone: 'rejected', word: 'Not released', reason: qcReason(error) });
    } finally {
      releaseInFlight.current.delete(hold.id);
      setReleasingId(null);
    }
  }

  /** Story 1-2b — every open receipt hold of one GRN, in one command (per-click key). */
  async function releaseReceipt(grnId: string) {
    const session = readSession();
    const guard = `grn:${grnId}`;
    if (session === null || releaseInFlight.current.has(guard)) return;
    releaseInFlight.current.add(guard);
    setReleasingId(guard);
    setOutcome(null);
    try {
      const released = await fetchApiReleaseReceiptQcHolds(session.tenant.id, grnId, ulid());
      setOutcome({ tone: 'accepted', ...releaseReceiptOutcome(released) });
      holds?.reload();
      notifyInboundChanged();
    } catch (error) {
      setOutcome({ tone: 'rejected', word: 'Receipt not released', reason: releaseReceiptReason(error) });
    } finally {
      releaseInFlight.current.delete(guard);
      setReleasingId(null);
    }
  }

  const filterTo = (grnId: string, grnCode: string | null) => {
    setGrnFilter({ grnId, grnCode });
    setOutcome(null);
  };
  const clearFilter = () => {
    setGrnFilter(null);
    setOutcome(null);
    // The notification's `?grnId=` must not re-narrow the list on a reload.
    if (typeof window !== 'undefined' && window.location.search.includes('grnId=')) {
      window.history.replaceState(null, '', inboundQcHoldsHref());
    }
  };
  // The filter's code: the click's, else the first row's (a link names only the id).
  const filterCode = grnFilter?.grnCode ?? holds?.items.find((hold) => hold.grnCode !== null)?.grnCode ?? null;

  const columns: readonly DataTableColumn<QcHoldEntryDto>[] = [
    {
      key: 'kind',
      header: 'Kind',
      render: (hold) => <span className="text-xs">{qcHoldKindLabel(hold.kind)}</span>,
    },
    {
      key: 'grn',
      header: 'GRN',
      render: (hold) =>
        hold.grnId === null ? (
          '—'
        ) : grnFilter !== null ? (
          <span className="font-mono text-xs">{hold.grnCode ?? '—'}</span>
        ) : (
          <button
            type="button"
            aria-label={`Show the QC holds of ${hold.grnCode ?? 'this receipt'}`}
            onClick={() => filterTo(hold.grnId!, hold.grnCode)}
            className="font-mono text-xs text-(--primary) underline underline-offset-2"
          >
            {hold.grnCode ?? '—'}
          </button>
        ),
    },
    {
      key: 'sku',
      header: 'SKU',
      render: (hold) => (
        <span className="font-mono text-xs">{skus?.[hold.skuId]?.code ?? '(unknown SKU)'}</span>
      ),
    },
    ...(showClients(clients)
      ? [
          {
            key: 'client',
            header: 'Client',
            render: (hold: QcHoldEntryDto) => clientCell(hold.clientId, clients ?? [], tenantName),
          } satisfies DataTableColumn<QcHoldEntryDto>,
        ]
      : []),
    {
      key: 'batch',
      header: 'Batch',
      render: (hold) => <span className="font-mono text-xs">{hold.batchCode ?? '—'}</span>,
    },
    {
      key: 'heldQty',
      header: 'Held',
      numeric: true,
      render: (hold) => quantityLabel(hold.heldQty, skus?.[hold.skuId] ?? null),
    },
    {
      key: 'bin',
      header: 'Origin bin',
      render: (hold) => <span className="font-mono text-xs">{bins?.[hold.binId] ?? '—'}</span>,
    },
    { key: 'reason', header: 'Reason', render: (hold) => hold.reason },
    {
      key: 'heldBy',
      header: 'Held by',
      render: (hold) => users?.[hold.heldBy]?.email ?? 'unknown user',
    },
    {
      key: 'heldAt',
      header: 'Held at',
      render: (hold) => <time dateTime={hold.heldAt}>{new Date(hold.heldAt).toLocaleString()}</time>,
    },
    {
      key: 'release',
      header: 'Status',
      render: (hold) =>
        hold.status === 'released' ? (
          <span className="text-(--muted-foreground)">
            released
            {hold.releasedAt !== null && (
              <>
                {' '}
                <time dateTime={hold.releasedAt}>{new Date(hold.releasedAt).toLocaleString()}</time>
              </>
            )}
          </span>
        ) : canManage ? (
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              disabled={releasingId === hold.id}
              onClick={() => {
                void release(hold);
              }}
              className="rounded-sm border border-(--border) px-2 py-0.5 text-xs hover:bg-(--muted) disabled:opacity-60"
            >
              Release
            </button>
            {hold.kind === 'receipt' && hold.grnId !== null && (
              <button
                type="button"
                aria-label={`Release receipt ${hold.grnCode ?? ''}`.trim()}
                disabled={releasingId === `grn:${hold.grnId}`}
                onClick={() => {
                  void releaseReceipt(hold.grnId!);
                }}
                className="rounded-sm border border-(--border) px-2 py-0.5 text-xs hover:bg-(--muted) disabled:opacity-60"
              >
                Release receipt
              </button>
            )}
          </div>
        ) : (
          <span className="rounded-sm bg-(--muted) px-1.5 py-0.5 text-xs">open</span>
        ),
    },
  ];

  return (
    <section className="flex flex-col gap-3 rounded-md border border-(--border) p-3 text-sm">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-medium">QC holds</h2>
        <div className="text-(--muted-foreground)">
          {warehouseLabel === null
            ? 'Pick a warehouse to review its QC holds.'
            : `${warehouseLabel} — a hold quarantines a (sku, bin) scope: the stock relocates into the warehouse's system QC-hold bin and drops out of ATP until released. A receipt of a client with QC on receipt holds each booked line on its own; Release receipt releases all of one receipt's.`}
        </div>
      </div>

      <div className="flex gap-1 text-xs" role="tablist" aria-label="QC hold status">
        {holdTabs.map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={tab === s}
            onClick={() => setTab(s)}
            className={`rounded-sm border border-(--border) px-2 py-1 ${
              tab === s ? 'bg-(--muted) font-medium' : 'hover:bg-(--muted)'
            }`}
          >
            {s === 'open' ? 'Open' : 'Released'}
          </button>
        ))}
      </div>

      {grnFilter !== null && (
        <div role="group" aria-label="GRN filter" className="flex flex-wrap items-center gap-2 text-xs">
          <span>{qcGrnFilterLabel(filterCode, grnFilter.grnId)}</span>
          <button type="button" onClick={clearFilter} className="rounded-sm border border-(--border) px-2 py-0.5 hover:bg-(--muted)">
            Show all holds
          </button>
        </div>
      )}

      {canManage && grnFilter === null && <PlaceQcHoldForm warehouseId={warehouseId} onPlaced={() => holds?.reload()} />}

      <DataTable<QcHoldEntryDto>
        // The filter is part of the table's identity: its Prev/Next stack
        // belongs to one query (guide §1.11).
        key={grnFilter?.grnId ?? 'all'}
        columns={columns}
        rows={holds?.items ?? []}
        nextCursor={holds?.nextCursor ?? null}
        onCursor={holds?.onCursor}
        emptyMessage={warehouseId === null ? 'Create a warehouse first.' : `No ${tab} holds.`}
      />

      {outcome !== null && (
        <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />
      )}
    </section>
  );
}

/** The place-hold form: pick an on-hand (sku, bin) scope, name the reason. */
function PlaceQcHoldForm({
  warehouseId,
  onPlaced,
}: {
  warehouseId: string | null;
  onPlaced: () => void;
}) {
  const scopesData = useStockScopes(warehouseId);
  const openHolds = useQcHolds(warehouseId, 'open');
  const skus = useSkuMap();
  const bins = useBinCodeMap(warehouseId);
  const [picked, setPicked] = useState<string>('');
  const [reason, setReason] = useState('');
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The same synchronous re-entry guard the Release button carries: a
  // pre-render double-click must be a no-op, not a second command with a
  // fresh Idempotency-Key that 409s after the first placement succeeded.
  const placingRef = useRef(false);
  // `picked` is "skuId:binId" (the select's value) or '' — split into the
  // two ids the place command carries.
  const scopeParts = picked === '' ? null : picked.split(':');
  const selectedSku = scopeParts?.[0] ?? null;
  const selectedBin = scopeParts?.[1] ?? null;

  // Offerable scopes only: nothing already under an open hold (a guaranteed
  // 409) and nothing sitting in the system QC-hold bin (a guaranteed 400) —
  // until the bin codes load, nothing is offered rather than guessing.
  // Story 1-2b — only a MANUAL open hold blocks its scope (the one-open
  // index is `kind = 'manual'`); a receipt hold on the same (sku, Receiving)
  // scope leaves it holdable.
  const heldScopes = new Set(
    (openHolds?.items ?? []).filter((hold) => hold.kind !== 'receipt').map((hold) => `${hold.skuId}:${hold.binId}`),
  );
  const offerable =
    scopesData === null || bins === null
      ? []
      : scopesData.rows.filter(
          (row) => bins[row.binId] !== 'QC-HOLD' && !heldScopes.has(`${row.skuId}:${row.binId}`),
        );

  async function submit() {
    const session = readSession();
    if (
      session === null ||
      warehouseId === null ||
      selectedSku === null ||
      selectedBin === null ||
      placingRef.current
    ) {
      return;
    }
    placingRef.current = true;
    setPlacing(true);
    setError(null);
    try {
      await fetchApiPlaceQcHold(
        session.tenant.id,
        {
          warehouseId,
          skuId: selectedSku,
          binId: selectedBin,
          reason,
        },
        ulid(),
      );
      setPicked('');
      setReason('');
      // The just-held scope leaves the picker (its units moved into the QC
      // bin) and joins the open-holds list.
      scopesData?.reload();
      openHolds?.reload();
      notifyInboundChanged();
      onPlaced();
    } catch (caught) {
      setError(qcReason(caught));
    } finally {
      placingRef.current = false;
      setPlacing(false);
    }
  }

  if (warehouseId === null) return null;
  return (
    <form
      className="flex flex-col gap-2 rounded-sm border border-(--border) p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="text-xs font-medium">Place a hold</div>
      <div className="flex flex-wrap gap-2">
        <select
          aria-label="Stock scope (SKU at bin)"
          value={picked}
          onChange={(event) => setPicked(event.target.value)}
          className="rounded-sm border border-(--border) bg-(--background) px-2 py-1 text-xs"
        >
          <option value="">Pick an on-hand scope…</option>
          {offerable.map((row) => {
            // The scope's own SKU names the unit and its precision; an
            // unresolvable SKU keeps the shared unit-agnostic fallback.
            const sku = skus?.[row.skuId];
            const onHand = quantityLabel(row.quantity, sku ?? null);
            return (
              <option key={`${row.skuId}:${row.binId}`} value={`${row.skuId}:${row.binId}`}>
                {sku?.code ?? '(unknown SKU)'} @ {bins?.[row.binId] ?? row.binId} · {onHand} on hand
              </option>
            );
          })}
        </select>
        <input
          type="text"
          aria-label="Hold reason"
          value={reason}
          maxLength={200}
          placeholder="Why is this stock quarantined?"
          onChange={(event) => setReason(event.target.value)}
          className="min-w-40 flex-1 rounded-sm border border-(--border) bg-(--background) px-2 py-1"
        />
        <button
          type="submit"
          disabled={placing || selectedSku === null || reason.trim() === ''}
          className="rounded-sm bg-(--primary) px-3 py-1 text-xs font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60"
        >
          Hold scope
        </button>
      </div>
      {error !== null && (
        <div role="alert" className="text-xs text-(--destructive)">
          {error}
        </div>
      )}
      {scopesData !== null && offerable.length === 0 && (
        <div className="text-xs text-(--muted-foreground)">
          No holdable on-hand stock in this warehouse — a hold quarantines stock that exists and
          is not already held.
        </div>
      )}
    </form>
  );
}
