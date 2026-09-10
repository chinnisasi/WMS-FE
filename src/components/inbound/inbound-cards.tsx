'use client';

import { useRef, useState, useSyncExternalStore } from 'react';

import { readActiveWarehouseId, subscribeActiveWarehouse } from '@/lib/warehouses';
import { readSession, subscribeSession } from '@/lib/auth';
import { fetchApiPlaceQcHold, fetchApiReleaseQcHold } from '@/lib/api/client';
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
import { openQtyLabel, qcReason } from '@/lib/over-receipt';
import type { GoodsReceiptEntryDto, PurchaseOrderLineDto, QcHoldDto } from '@/lib/api/generated';
import { roleHasCapability } from '@/lib/users';
import { ulid } from '@/lib/ulid';

import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { FeedbackBanner } from '@/components/feedback/banner';

/**
 * The Inbound surface (stories 3.1 / 3.3) — the review half of receiving:
 * the active warehouse's purchase orders (code, vendor, per-line
 * ordered/received/open, status) and its goods receipt notes (code, PO
 * reference or blind flag + reason, lines, units, recorded time). Reads only
 * — the mobile device records receipts; the web surface reviews them.
 *
 * Warehouse scoping follows the sidebar switcher's pick (per-viewer, like
 * zone-bin-setup), falling back to the tenant's first warehouse.
 */

/** Blind reason codes are a fixed backend enum — surfaced in plain words. */
const BLIND_REASON_LABEL: Record<GoodsReceiptEntryDto['blindReasonCode'], string> = {
  'unannounced-delivery': 'Unannounced delivery',
  'po-not-found': 'PO not found',
  other: 'Other',
};

export function InboundCards() {
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
  return <InboundCardsSessioned />;
}

function InboundCardsSessioned() {
  const { tenantId, items: warehouses } = useTenantWarehouses() ?? {
    tenantId: null,
    items: [] as readonly never[],
  };
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

  return (
    <div className="flex flex-col gap-4">
      <PurchaseOrdersCard warehouseId={warehouseId} warehouseLabel={warehouse?.name ?? warehouse?.code ?? null} />
      <GoodsReceiptsCard warehouseId={warehouseId} warehouseLabel={warehouse?.name ?? warehouse?.code ?? null} />
      <QcHoldsCard warehouseId={warehouseId} warehouseLabel={warehouse?.name ?? warehouse?.code ?? null} />
    </div>
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

  const columns: readonly DataTableColumn<PurchaseOrderHeader>[] = [
    { key: 'code', header: 'PO code', render: (po) => <span className="font-mono text-xs">{po.code}</span> },
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
              <PoLineRow key={line.id} line={line} skuCode={skus?.[line.skuId]?.code ?? null} />
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

/** One PO line: `SKU 100 ord · 40 rec · 60 open` (negative open = over-received). */
function PoLineRow({ line, skuCode }: { line: PurchaseOrderLineDto; skuCode: string | null }) {
  const open = openQtyLabel(line.openQty);
  return (
    <div className="flex flex-wrap items-center gap-x-2 text-xs">
      <span className="font-mono">{skuCode ?? '(unknown SKU)'}</span>
      <span className="text-(--muted-foreground)">
        {line.orderedQty} ord · {line.receivedQty} rec · {open} open
      </span>
      {line.status !== 'open' && <span className="text-(--muted-foreground)">[{line.status}]</span>}
    </div>
  );
}

/** The warehouse's goods receipt notes, blind receipts flagged for PO-matching. */
function GoodsReceiptsCard({
  warehouseId,
  warehouseLabel,
}: {
  warehouseId: string | null;
  warehouseLabel: string | null;
}) {
  const grns = useGoodsReceipts(warehouseId);

  const columns: readonly DataTableColumn<GoodsReceiptEntryDto>[] = [
    { key: 'code', header: 'GRN code', render: (grn) => <span className="font-mono text-xs">{grn.code}</span> },
    {
      key: 'po',
      header: 'PO',
      render: (grn) => {
        if (grn.poId === null) {
          return (
            <span className="rounded-sm bg-(--muted) px-1.5 py-0.5 text-xs">
              Blind · {BLIND_REASON_LABEL[grn.blindReasonCode]}
            </span>
          );
        }
        const code = grns?.poCodes[grn.poId];
        return code === undefined ? <span>—</span> : <span className="font-mono text-xs">{code}</span>;
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
  ];

  return (
    <section className="flex flex-col gap-3 rounded-md border border-(--border) p-3 text-sm">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-medium">Goods receipt notes</h2>
        <div className="text-(--muted-foreground)">
          {warehouseLabel === null
            ? 'Pick a warehouse to review its receipts.'
            : `${warehouseLabel} — newest first. Blind receipts are flagged for PO-matching; "(+N pending)" units wait on an over-receipt decision.`}
        </div>
      </div>

      <DataTable<GoodsReceiptEntryDto>
        columns={columns}
        rows={grns?.items ?? []}
        nextCursor={grns?.nextCursor ?? null}
        onCursor={grns?.onCursor}
        emptyMessage={warehouseId === null ? 'Create a warehouse first.' : 'No receipts recorded yet.'}
      />
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
}: {
  warehouseId: string | null;
  warehouseLabel: string | null;
}) {
  const [tab, setTab] = useState<HoldTab>('open');
  const holds = useQcHolds(warehouseId, tab);
  const skus = useSkuMap();
  const users = useUserMap();
  const bins = useBinCodeMap(warehouseId);
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
  // right after the first release succeeded.
  const releaseInFlight = useRef<Set<string>>(new Set());

  async function release(hold: QcHoldDto) {
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
    } catch (error) {
      setOutcome({ tone: 'rejected', word: 'Not released', reason: qcReason(error) });
    } finally {
      releaseInFlight.current.delete(hold.id);
      setReleasingId(null);
    }
  }

  const columns: readonly DataTableColumn<QcHoldDto>[] = [
    {
      key: 'sku',
      header: 'SKU',
      render: (hold) => (
        <span className="font-mono text-xs">{skus?.[hold.skuId]?.code ?? '(unknown SKU)'}</span>
      ),
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
            : `${warehouseLabel} — a hold quarantines a (sku, bin) scope: the stock relocates into the warehouse's system QC-hold bin and drops out of ATP until released.`}
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

      {canManage && <PlaceQcHoldForm warehouseId={warehouseId} onPlaced={() => holds?.reload()} />}

      <DataTable<QcHoldDto>
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
  const heldScopes = new Set(
    (openHolds?.items ?? []).map((hold) => `${hold.skuId}:${hold.binId}`),
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
          {offerable.map((row) => (
            <option key={`${row.skuId}:${row.binId}`} value={`${row.skuId}:${row.binId}`}>
              {skus?.[row.skuId]?.code ?? '(unknown SKU)'} @ {bins?.[row.binId] ?? row.binId} ·{' '}
              {row.quantity} on hand
            </option>
          ))}
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
