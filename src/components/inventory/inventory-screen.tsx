'use client';

import Link from 'next/link';
import { Fragment, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';

import type { BatchListItemDto, BinResponse, ClientDto, SkuResponse, StockEntryDto } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { clientCell, showClients, skuDisplayLabel, withSkuClient } from '@/lib/clients';
import { ledgerTypeLabel, warehouseDisplayLabel, type DrillWarehouse } from '@/lib/drill';
import { quantityLabel } from '@/lib/format-quantity';
import {
  batchDetailReason,
  batchFailureWord,
  batchStatusLabel,
  TOTAL_CAPPED,
  TOTAL_PAGE_FAILED,
  batchQuantityLabel,
  NOT_BATCH_TRACKED,
  choicePrompt,
  codeEntryLabel,
  otherWarehousesLabel,
  resolveSearch,
  skuResolution,
  searchAvailability,
  searchSummary,
  splitBatchBins,
  systemBinLabel,
  totalAcrossBins,
  type CodeEntry,
  type CodeMap,
  type SearchResolution,
} from '@/lib/inventory';
import { istDateLabel } from '@/lib/audit-exports';
import { ledgerBinsLabel, ledgerQuantityLabel, ledgerRecordedLabel } from '@/lib/ledger';
import { INVENTORY_PAGE_TABS, type InventoryTab } from '@/lib/page-tabs';
import { readyClients, useClients } from '@/lib/use-clients';
import { useBatchList, useSkuCatalog, useStockList, useWarehouseBins } from '@/lib/use-inventory';
import { useBatchDetail } from '@/lib/use-replenishment';
import { useTenantWarehouses } from '@/lib/use-tenant-warehouses';
import { readActiveWarehouseId, subscribeActiveWarehouse } from '@/lib/warehouses';

import { FeedbackBanner } from '@/components/feedback/banner';
import { Ledger } from '@/components/inventory/ledger';
import { PageTabPanel, PageTabStrip, usePageTab } from '@/components/shared/page-tabs';
import { buttonClass, inputClass, ReadFailure, rowButtonClass, Section } from '@/components/shared/surface';
import { WarehousesFailure, WarehousesRefreshNote } from '@/components/shared/warehouses-failure';

/**
 * The Inventory page (inventory-screen, 2026-10-17) — three tabs on the
 * shared page-tabs module: **Stock** (on-hand per bin and SKU, searchable by
 * a bin or SKU code), **Batches** (a SKU's batches by expiry, each opening to
 * its bins and history) and **Ledger** (the existing timeline, undrilled).
 *
 * Read-only: no adjust, move or hold here. It reads the active warehouse
 * (the sidebar switcher's pick, else the first). The warehouse gate wraps
 * Stock and Batches only — the Ledger owns its own warehouse resolution and
 * failure arms, so a failed warehouses read never shows twice.
 */
export function InventoryScreen({ initialTab = null }: { initialTab?: InventoryTab | null } = {}) {
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );
  if (sessioned === null) return null;
  if (!sessioned) {
    return (
      <Section title="Inventory">
        <div className="text-(--muted-foreground)">
          Sign in to see stock —{' '}
          <Link href="/login" className="text-(--primary) underline underline-offset-2">
            go to sign in
          </Link>
          .
        </div>
      </Section>
    );
  }
  return <InventorySessioned initialTab={initialTab} />;
}

function InventorySessioned({ initialTab }: { initialTab: InventoryTab | null }) {
  // No drill on this page: ledger drills stay on /inventory/ledger.
  const [tab, selectTab] = usePageTab(INVENTORY_PAGE_TABS, INVENTORY_PAGE_TABS.initial(null, initialTab), false);
  return (
    <div className="flex flex-col gap-4">
      <PageTabStrip def={INVENTORY_PAGE_TABS} active={tab} drilled={false} onSelect={selectTab} />
      <PageTabPanel def={INVENTORY_PAGE_TABS} active={tab}>
        {tab === 'ledger' ? <Ledger /> : <WarehouseGate tab={tab} />}
      </PageTabPanel>
    </div>
  );
}

const SECTION_TITLE: Record<Exclude<InventoryTab, 'ledger'>, string> = { stock: 'Stock', batches: 'Batches' };

function WarehouseGate({ tab }: { tab: Exclude<InventoryTab, 'ledger'> }) {
  const title = SECTION_TITLE[tab];
  const warehouses = useTenantWarehouses();
  const tenantId = warehouses.state === 'ready' ? warehouses.data.tenantId : null;
  const items = warehouses.state === 'ready' ? warehouses.data.items : [];
  const activeId = useSyncExternalStore(
    subscribeActiveWarehouse,
    () => (tenantId === null ? null : readActiveWarehouseId(tenantId)),
    () => null,
  );

  if (warehouses.state === 'loading') {
    return (
      <Section title={title}>
        <div className="text-(--muted-foreground)">Loading warehouses…</div>
      </Section>
    );
  }
  if (warehouses.state === 'failed') {
    return (
      <Section title={title}>
        <WarehousesFailure state={warehouses} />
      </Section>
    );
  }
  const warehouseId =
    activeId !== null && items.some((w) => w.id === activeId) ? activeId : (items[0]?.id ?? null);
  if (warehouseId === null) {
    return (
      <Section title={title}>
        <div className="text-(--muted-foreground)">Create a warehouse first — stock is kept per warehouse.</div>
      </Section>
    );
  }
  const refreshNote =
    warehouses.data.refreshFailed !== null ? (
      <WarehousesRefreshNote reason={warehouses.data.refreshFailed} onRetry={warehouses.reload} />
    ) : null;
  // Keyed on the warehouse: a switch remounts the section, so the search
  // and every loaded page go with it (frontend guide §1.5).
  return tab === 'stock' ? (
    <StockSection key={warehouseId} warehouseId={warehouseId} warehouses={items} refreshNote={refreshNote} />
  ) : (
    <BatchesSection key={warehouseId} warehouseId={warehouseId} warehouses={items} refreshNote={refreshNote} />
  );
}

/* ------------------------------------------------------------------ */
/* Shared bits                                                         */
/* ------------------------------------------------------------------ */

interface SectionProps {
  readonly warehouseId: string;
  readonly warehouses: readonly DrillWarehouse[];
  readonly refreshNote: ReactNode;
}

/**
 * The SKU codes the search resolves, each labelled `CODE · Client` once the
 * tenant has more than one client (story 1-1: two clients may share a code,
 * and the chooser and summary must say which is which).
 */
function skuCodes(state: ReturnType<typeof useSkuCatalog>, clients: readonly ClientDto[] | null): CodeMap {
  if (state.state !== 'ready') return state.state === 'failed' ? { state: 'failed', reason: state.reason } : { state: 'loading' };
  return {
    state: 'ready',
    data: state.data.map((sku) => {
      const label = skuDisplayLabel(sku, clients);
      return label === sku.code ? { id: sku.id, code: sku.code } : { id: sku.id, code: sku.code, label };
    }),
  };
}

/**
 * Story 1-1 — several SKUs answer to the typed code (two clients' `TSHIRT-M`):
 * one button per match, labelled with its client, which applies that SKU.
 */
function SkuChooser({
  resolution,
  onPick,
}: {
  resolution: Extract<SearchResolution, { kind: 'choice' }>;
  onPick: (entry: CodeEntry) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="search-choice">
      <span>{choicePrompt(resolution)}</span>
      {resolution.matches.map((entry) => (
        <button key={entry.id} type="button" className={rowButtonClass} data-sku-id={entry.id} onClick={() => onPick(entry)}>
          {codeEntryLabel(entry)}
        </button>
      ))}
    </div>
  );
}

function binCodes(state: ReturnType<typeof useWarehouseBins>): CodeMap {
  if (state.state !== 'ready') return state.state === 'failed' ? { state: 'failed', reason: state.reason } : { state: 'loading' };
  return { state: 'ready', data: state.data.map((bin) => ({ id: bin.id, code: bin.code })) };
}

function skuIndex(state: ReturnType<typeof useSkuCatalog>): Readonly<Record<string, SkuResponse>> | null {
  return state.state === 'ready' ? Object.fromEntries(state.data.map((sku) => [sku.id, sku])) : null;
}

function BinCell({ code, systemOwned }: { code: string; systemOwned: boolean }) {
  const label = systemBinLabel(code, systemOwned);
  return (
    <span className="flex flex-col">
      <span className="font-mono text-xs">{code}</span>
      {label !== null && <span className="text-xs text-(--muted-foreground)">{label}</span>}
    </span>
  );
}

interface Column<T> {
  readonly key: string;
  readonly header: string;
  readonly numeric?: boolean;
  readonly render: (row: T) => ReactNode;
}

/** A plain table for a Load-more list (DataTable's Prev/Next would mislead here). */
function ListTable<T extends { id: string }>({
  columns,
  rows,
  emptyMessage,
  rowAttrs,
  footer,
  expanded,
}: {
  columns: readonly Column<T>[];
  rows: readonly T[];
  emptyMessage: string;
  rowAttrs?: (row: T) => { className?: string; 'data-zero'?: string };
  footer?: ReactNode;
  expanded?: (row: T) => ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-(--border)">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-(--muted)">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={`h-10 border-b border-(--border) px-3 text-left font-medium text-(--muted-foreground) ${c.numeric ? 'data text-right' : ''}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="h-24 px-3 text-center text-(--muted-foreground)">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const attrs = rowAttrs?.(row) ?? {};
              const detail = expanded?.(row);
              return (
                <Fragment key={row.id}>
                  <tr
                    data-row-id={row.id}
                    data-zero={attrs['data-zero']}
                    className={`h-10 border-b border-(--border) last:border-b-0 ${attrs.className ?? ''}`}
                  >
                    {columns.map((c) => (
                      <td key={c.key} className={`px-3 py-1 ${c.numeric ? 'data text-right' : ''}`}>
                        {c.render(row)}
                      </td>
                    ))}
                  </tr>
                  {detail ? (
                    <tr id={`inventory-detail-${row.id}`} className="border-b border-(--border) last:border-b-0">
                      <td colSpan={columns.length} className="bg-(--muted) px-3 py-2">
                        {detail}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })
          )}
        </tbody>
        {footer}
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stock                                                               */
/* ------------------------------------------------------------------ */

type AppliedSearch = Extract<SearchResolution, { kind: 'bin' | 'sku' | 'choice' | 'miss' | 'ambiguous' }>;

function StockSection({ warehouseId, warehouses, refreshNote }: SectionProps) {
  const skus = useSkuCatalog();
  const bins = useWarehouseBins(warehouseId);
  const clients = readyClients(useClients());
  const tenantName = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.name ?? null,
    () => null,
  );
  const [draft, setDraft] = useState('');
  const [applied, setApplied] = useState<AppliedSearch | null>(null);

  const skuMap = skuCodes(skus, clients);
  const binMap = binCodes(bins);
  const availability = searchAvailability(binMap, skuMap);
  const skuById = skuIndex(skus);

  const filter =
    applied?.kind === 'bin'
      ? { skuId: null, binId: applied.id }
      : applied?.kind === 'sku'
        ? { skuId: applied.id, binId: null }
        : { skuId: null, binId: null };
  // A miss reads nothing: the message stands in for the list; a choice
  // reads nothing until one SKU is picked.
  const unresolved = applied?.kind === 'miss' || applied?.kind === 'ambiguous' || applied?.kind === 'choice';
  const stock = useStockList(unresolved ? null : warehouseId, filter, applied?.kind === 'sku');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (availability.disabled) return;
    const resolution = resolveSearch(draft, binMap, skuMap);
    setApplied(resolution.kind === 'blank' ? null : resolution);
  };
  const clear = () => {
    setDraft('');
    setApplied(null);
  };

  const skuOf = (row: StockEntryDto) => skuById?.[row.skuId] ?? null;
  const columns: Column<StockEntryDto>[] = [];
  if (applied?.kind !== 'bin') {
    columns.push({
      key: 'bin',
      header: 'Bin',
      render: (row) => <BinCell code={row.binCode ?? '—'} systemOwned={row.binSystemOwned === true} />,
    });
  }
  if (applied?.kind !== 'sku') {
    columns.push(
      { key: 'sku', header: 'SKU', render: (row) => <span className="font-mono text-xs">{skuOf(row)?.code ?? '—'}</span> },
      { key: 'name', header: 'Name', render: (row) => skuOf(row)?.name ?? '—' },
    );
  }
  if (showClients(clients)) {
    columns.push({
      key: 'client',
      header: 'Client',
      render: (row) => clientCell(skuOf(row)?.clientId, clients ?? [], tenantName),
    });
  }
  columns.push({ key: 'quantity', header: 'On hand', numeric: true, render: (row) => quantityLabel(row.quantity, skuOf(row)) });

  const warehouseLabel = warehouseDisplayLabel(warehouses, warehouseId);
  const emptyMessage =
    applied?.kind === 'bin'
      ? `Bin ${applied.code} holds no stock.`
      : applied?.kind === 'sku'
        ? `No stock of ${applied.label ?? applied.code} in this warehouse.`
        : 'No stock in this warehouse yet.';

  return (
    <Section title="Stock">
      {refreshNote}
      <div className="text-(--muted-foreground)">
        {warehouseLabel} — on hand per bin and SKU, bin by bin. Empty bins are not listed.
      </div>
      <form className="flex flex-wrap items-center gap-2" onSubmit={submit} role="search" aria-label="Search stock">
        <input
          className={`${inputClass} w-64 max-w-full`}
          name="code"
          aria-label="Bin or SKU code"
          placeholder={availability.placeholder}
          value={draft}
          disabled={availability.disabled}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className={buttonClass} disabled={availability.disabled}>
          Search
        </button>
        {applied !== null && (
          <button type="button" className={buttonClass} onClick={clear}>
            Clear
          </button>
        )}
      </form>
      {availability.note !== null && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-(--muted-foreground)" data-testid="search-note">
          <span>{availability.note}</span>
          {skus.state === 'failed' && (
            <button type="button" className={rowButtonClass} onClick={skus.reload}>
              Retry SKU codes
            </button>
          )}
          {bins.state === 'failed' && (
            <button type="button" className={rowButtonClass} onClick={bins.reload}>
              Retry bin codes
            </button>
          )}
        </div>
      )}
      {applied?.kind === 'miss' || applied?.kind === 'ambiguous' ? (
        <div data-testid="search-miss">
          <FeedbackBanner tone="warning" word="No match" reason={applied.message} />
        </div>
      ) : applied?.kind === 'choice' ? (
        <SkuChooser resolution={applied} onPick={(entry) => setApplied(skuResolution(entry))} />
      ) : (
        <>
          {applied !== null && (
            <div className="text-xs" data-testid="search-summary">
              {searchSummary(applied)}
            </div>
          )}
          {stock.state === 'failed' ? (
            <ReadFailure word="Stock unavailable" reason={stock.reason} onRetry={stock.reload} />
          ) : (
            <StockRowsView
              stock={stock}
              columns={columns}
              emptyMessage={emptyMessage}
              skuSearch={applied?.kind === 'sku' ? applied : null}
              skuOfId={(id) => skuById?.[id] ?? null}
            />
          )}
        </>
      )}
    </Section>
  );
}

function StockRowsView({
  stock,
  columns,
  emptyMessage,
  skuSearch,
  skuOfId,
}: {
  stock: Exclude<ReturnType<typeof useStockList>, { state: 'failed' }>;
  columns: readonly Column<StockEntryDto>[];
  emptyMessage: string;
  skuSearch: { id: string; code: string } | null;
  skuOfId: (id: string) => SkuResponse | null;
}) {
  if (stock.state === 'loading') {
    return <ListTable columns={columns} rows={[]} emptyMessage="Loading stock…" />;
  }
  const { rows, nextCursor, loadingMore, moreFailed } = stock.data;
  // A SKU search walks every page before it totals (never a partial sum).
  const { capped } = stock.data;
  const total =
    moreFailed !== null
      ? TOTAL_PAGE_FAILED
      : capped
        ? TOTAL_CAPPED
        : nextCursor === null
          ? totalAcrossBins(rows, skuOfId(skuSearch?.id ?? ''))
          : 'Loading every bin…';
  const footer =
    skuSearch !== null && rows.length > 0 ? (
      <tfoot>
        <tr className="h-10 border-t border-(--border) font-medium">
          {/* The label spans every column but the last, so the total sits under On hand. */}
          <td className="px-3" colSpan={columns.length - 1}>
            Total across bins
          </td>
          <td className="data px-3 text-right" data-testid="stock-total">
            {total}
          </td>
        </tr>
      </tfoot>
    ) : undefined;
  return (
    <div className="flex flex-col gap-2">
      <ListTable columns={columns} rows={rows} emptyMessage={emptyMessage} footer={footer} />
      {moreFailed !== null ? (
        <ReadFailure word="More stock unavailable" reason={moreFailed} onRetry={stock.reload} />
      ) : skuSearch === null && nextCursor !== null ? (
        <div>
          <button type="button" className={buttonClass} onClick={stock.loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Batches                                                             */
/* ------------------------------------------------------------------ */

type BatchPick =
  | { readonly kind: 'sku'; readonly sku: SkuResponse }
  | { readonly kind: 'choice'; readonly resolution: Extract<SearchResolution, { kind: 'choice' }> }
  | { readonly kind: 'problem'; readonly message: string };

const BATCH_SKU_LIST_ID = 'inventory-batch-skus';

function BatchesSection({ warehouseId, warehouses, refreshNote }: SectionProps) {
  const skus = useSkuCatalog();
  const bins = useWarehouseBins(warehouseId);
  const clients = readyClients(useClients());
  const [draft, setDraft] = useState('');
  const [pick, setPick] = useState<BatchPick | null>(null);
  const [openBatch, setOpenBatch] = useState<string | null>(null);

  const ready = skus.state === 'ready';
  const tracked = ready ? skus.data.filter((sku) => sku.batchTracked) : [];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    const resolution = resolveSearch(draft, { state: 'failed', reason: '' }, skuCodes(skus, clients));
    setOpenBatch(null);
    if (resolution.kind === 'blank') {
      setPick(null);
      return;
    }
    if (resolution.kind === 'choice') {
      setPick({ kind: 'choice', resolution });
      return;
    }
    if (resolution.kind === 'ambiguous') {
      setPick({ kind: 'problem', message: resolution.message });
      return;
    }
    if (resolution.kind !== 'sku') {
      setPick({ kind: 'problem', message: `No SKU with code ${draft.trim()} found.` });
      return;
    }
    pickSku(resolution.id);
  };
  const pickSku = (id: string) => {
    if (!ready) return;
    const sku = skus.data.find((s) => s.id === id)!;
    // Decided from the catalog before any read: the batch list has no
    // "not batch-tracked" arm of its own.
    setPick(sku.batchTracked ? { kind: 'sku', sku } : { kind: 'problem', message: NOT_BATCH_TRACKED });
  };

  return (
    <Section title="Batches">
      {refreshNote}
      <div className="text-(--muted-foreground)">
        {warehouseDisplayLabel(warehouses, warehouseId)} — a SKU&apos;s batches by expiry (first to expire first).
      </div>
      <form className="flex flex-wrap items-center gap-2" onSubmit={submit} role="search" aria-label="Find batches">
        <input
          className={`${inputClass} w-64 max-w-full`}
          name="sku"
          aria-label="SKU code"
          list={BATCH_SKU_LIST_ID}
          placeholder={ready ? 'Batch-tracked SKU code' : skus.state === 'failed' ? 'SKU codes not loaded' : 'Loading codes…'}
          value={draft}
          disabled={!ready}
          onChange={(e) => setDraft(e.target.value)}
        />
        <datalist id={BATCH_SKU_LIST_ID}>
          {tracked.map((sku) => (
            <option key={sku.id} value={sku.code}>
              {withSkuClient(sku.name, sku, clients)}
            </option>
          ))}
        </datalist>
        <button type="submit" className={buttonClass} disabled={!ready}>
          Show batches
        </button>
      </form>
      {skus.state === 'failed' && <ReadFailure word="SKU codes not loaded" reason={skus.reason} onRetry={skus.reload} />}
      {bins.state === 'failed' && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-(--muted-foreground)" data-testid="bin-codes-note">
          <span>Bin codes not loaded — bins show as —.</span>
          <button type="button" className={rowButtonClass} onClick={bins.reload}>
            Retry bin codes
          </button>
        </div>
      )}
      {bins.state === 'loading' && pick?.kind === 'sku' && (
        <div className="text-xs text-(--muted-foreground)" data-testid="bin-codes-note">
          Loading bin codes…
        </div>
      )}
      {ready && tracked.length === 0 && (
        <div className="text-xs text-(--muted-foreground)">No SKU in the catalog is batch-tracked.</div>
      )}
      {pick?.kind === 'problem' && (
        <div data-testid="batch-problem">
          <FeedbackBanner tone="warning" word="No batches" reason={pick.message} />
        </div>
      )}
      {pick?.kind === 'choice' && (
        <SkuChooser resolution={pick.resolution} onPick={(entry) => pickSku(entry.id)} />
      )}
      {pick?.kind === 'sku' && (
        <BatchList
          label={skuDisplayLabel(pick.sku, clients)}
          key={pick.sku.id}
          warehouseId={warehouseId}
          sku={pick.sku}
          bins={bins.state === 'ready' ? bins.data : null}
          warehouses={warehouses}
          openBatch={openBatch}
          onToggle={(id) => setOpenBatch((current) => (current === id ? null : id))}
        />
      )}
    </Section>
  );
}

function BatchList({
  label,
  warehouseId,
  sku,
  bins,
  warehouses,
  openBatch,
  onToggle,
}: {
  label: string;
  warehouseId: string;
  sku: SkuResponse;
  bins: readonly BinResponse[] | null;
  warehouses: readonly DrillWarehouse[];
  openBatch: string | null;
  onToggle: (id: string) => void;
}) {
  const batches = useBatchList(warehouseId, sku.id);
  const columns: Column<BatchListItemDto>[] = [
    { key: 'code', header: 'Batch', render: (b) => <span className="font-mono text-xs">{b.code}</span> },
    { key: 'mfg', header: 'Manufactured', render: (b) => (b.mfgDate === null ? '—' : istDateLabel(b.mfgDate)) },
    { key: 'expiry', header: 'Expires', render: (b) => (b.expiryDate === null ? '—' : istDateLabel(b.expiryDate)) },
    { key: 'status', header: 'Status', render: (b) => batchStatusLabel(b.status) },
    { key: 'quantity', header: 'Here', numeric: true, render: (b) => batchQuantityLabel(b.quantity, sku) },
    {
      key: 'open',
      header: '',
      render: (b) => (
        <button
          type="button"
          className={rowButtonClass}
          aria-expanded={openBatch === b.id}
          aria-controls={`inventory-detail-${b.id}`}
          onClick={() => onToggle(b.id)}
        >
          {openBatch === b.id ? 'Close' : 'Open'}
        </button>
      ),
    },
  ];
  if (batches.state === 'failed') {
    return <ReadFailure word="Batches unavailable" reason={batches.reason} onRetry={batches.reload} />;
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs">
        Batches of <span className="font-mono">{label}</span> — {sku.name}
      </div>
      <ListTable
        columns={columns}
        rows={batches.state === 'ready' ? batches.data : []}
        emptyMessage={batches.state === 'loading' ? 'Loading batches…' : `No batches of ${sku.code} yet.`}
        rowAttrs={(b) => (b.quantity === 0 ? { className: 'text-(--muted-foreground)', 'data-zero': 'true' } : {})}
        expanded={(b) =>
          openBatch === b.id ? (
            <BatchDetail batchId={b.id} warehouseId={warehouseId} sku={sku} bins={bins} warehouses={warehouses} />
          ) : null
        }
      />
    </div>
  );
}

function BatchDetail({
  batchId,
  warehouseId,
  sku,
  bins,
  warehouses,
}: {
  batchId: string;
  warehouseId: string;
  sku: SkuResponse;
  bins: readonly BinResponse[] | null;
  warehouses: readonly DrillWarehouse[];
}) {
  const detail = useBatchDetail(batchId, batchDetailReason);
  if (detail.state === 'loading') return <div className="text-xs text-(--muted-foreground)">Loading the batch…</div>;
  if (detail.state === 'failed') {
    return <ReadFailure word={batchFailureWord(detail.reason)} reason={detail.reason} onRetry={detail.reload} />;
  }
  const binCode = bins === null ? null : Object.fromEntries(bins.map((bin) => [bin.id, bin.code]));
  const binById = bins === null ? null : Object.fromEntries(bins.map((bin) => [bin.id, bin]));
  const { here, elsewhere } = splitBatchBins(detail.data.bins, warehouseId);
  const others = otherWarehousesLabel(elsewhere, warehouses);
  const history = detail.data.history.filter((event) => event.warehouseId === warehouseId);
  return (
    <div className="flex flex-col gap-2 text-xs" data-testid="batch-detail">
      <div className="font-medium">Bins in this warehouse</div>
      {here.length === 0 ? (
        <div className="text-(--muted-foreground)">None of this batch is in this warehouse.</div>
      ) : (
        <ul className="flex flex-col gap-1">
          {here.map((bin) => (
            <li key={bin.binId} className="flex gap-3">
              <BinCell code={binCode?.[bin.binId] ?? '—'} systemOwned={binById?.[bin.binId]?.systemOwned === true} />
              <span className="data">{quantityLabel(bin.quantity, sku)}</span>
            </li>
          ))}
        </ul>
      )}
      {others !== null && <div data-testid="batch-elsewhere">{others}</div>}
      <div className="font-medium">History in this warehouse (oldest first)</div>
      {history.length === 0 ? (
        <div className="text-(--muted-foreground)">No movements in this warehouse.</div>
      ) : (
        <ul className="flex flex-col gap-1" data-testid="batch-history">
          {history.map((event) => (
            <li key={`${event.warehouseId}-${event.seq}`} className="flex flex-wrap gap-3">
              <time dateTime={event.recordedAt}>{ledgerRecordedLabel(event.recordedAt)}</time>
              <span>{ledgerTypeLabel(event.type)}</span>
              <span className="data">{ledgerQuantityLabel(event.quantityDelta, sku)}</span>
              <span className="font-mono">{ledgerBinsLabel(event, binCode)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
