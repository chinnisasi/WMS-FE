'use client';

import { useMemo, useRef, useState } from 'react';

import {
  fetchApiAbandonStockTake,
  fetchApiCloseStockTake,
  fetchApiGetStockTake,
  fetchApiListStockTakeVariances,
  fetchApiRecountStockTakeBins,
  fetchApiStartStockTake,
  fetchApiStockTakeReport,
} from '@/lib/api/client';
import type { StockTakeDetailResponse, StockTakeListEntryDto, StockTakeSummaryDto, StockTakeVarianceEntryDto } from '@/lib/api/generated';
import { downloadBlob } from '@/lib/csv';
import { clientLabel } from '@/lib/clients';
import { countableBins, countableZones, notifyCountsChanged } from '@/lib/counts';
import { quantityLabel } from '@/lib/format-quantity';
import { ledgerQuantityLabel, ledgerRecordedLabel } from '@/lib/ledger';
import { asOfLabel } from '@/lib/overview';
import { readReason } from '@/lib/outbound-orders';
import {
  ABANDON_CONFIRM,
  FREEZE_WARNING,
  MAX_FROZEN_BINS,
  MAX_RECOUNT_BINS,
  NEW_BINS_OUTSIDE_NOTE,
  POSTING_NOTE,
  STOCK_TAKE_STATUS_LABEL,
  TOO_MANY_RECOUNT_NOTE,
  closeBlockedReason,
  closeConfirmSentence,
  closeOutcome,
  freezeCapSentence,
  progressLabel,
  progressPercent,
  recountRequiredSentence,
  startNotReadyReason,
  stockTakeReason,
  stockTakeReportFilename,
  stockTakeReportStatus,
  stockTakeScopeLabel,
  stockTakeStatusTone,
  varianceOutcomeLabel,
} from '@/lib/stock-takes';
import type { ActiveClientState } from '@/lib/use-active-client';
import { useCountZones } from '@/lib/use-counts';
import { useSkuMap } from '@/lib/use-inbound';
import { useWarehouseBins } from '@/lib/use-inventory';
import { useKeyedSubmit } from '@/lib/use-keyed-submit';
import { useStockTakeDetail, useStockTakeVariances, useStockTakes } from '@/lib/use-stock-takes';

import { KpiTile } from '@/components/kpi-tile';
import { FeedbackBanner } from '@/components/feedback/banner';
import { SubmitButton } from '@/components/shared/submit-button';
import { StatusChip } from '@/components/shared/status-chip';
import { ReadFailure, Section, buttonClass, inputClass, primaryClass, rowButtonClass, selectClass } from '@/components/shared/surface';

type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string } | null;

const thClass = 'h-10 border-b border-(--border) px-3 text-left font-medium text-(--foreground)';

/**
 * Story 3-5b — the Stock takes tab: the warehouse's takes, New stock take
 * (`counts.manage` — the whole warehouse or chosen zones), and a take's
 * dashboard: totals, per-zone progress, the variance table, Recount
 * selected, Post and close, Abandon and the report. No polling — Refresh and
 * "As of HH:MM". Every mutation calls `notifyCountsChanged`.
 */
export function StockTakes({
  tenantId,
  warehouseId,
  canManage,
  canResolve,
  isOwner,
  active,
  warehouseCode,
}: {
  tenantId: string;
  warehouseId: string;
  canManage: boolean;
  canResolve: boolean;
  isOwner: boolean;
  active: ActiveClientState;
  warehouseCode: string;
}) {
  const takes = useStockTakes(warehouseId);
  const zones = useCountZones(warehouseId);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const zoneList = zones.state === 'ready' ? zones.data : [];
  const items: readonly StockTakeListEntryDto[] = takes.state === 'ready' ? takes.data.data.items : [];
  // The 3,000 cap is shared: the bins the warehouse's other active takes freeze.
  const otherFrozen = items
    .filter((entry) => entry.stockTake.status === 'counting' || entry.stockTake.status === 'posting')
    .reduce((sum, entry) => sum + entry.stockTake.binCount, 0);

  if (openId !== null) {
    return (
      <StockTakeDetail
        tenantId={tenantId}
        stockTakeId={openId}
        zones={zoneList}
        canManage={canManage}
        canResolve={canResolve}
        isOwner={isOwner}
        active={active}
        warehouseCode={warehouseCode}
        onBack={() => setOpenId(null)}
      />
    );
  }
  return (
    <Section
      title="Stock takes"
      action={
        canManage && !creating ? (
          <button type="button" className={primaryClass} onClick={() => setCreating(true)}>
            New stock take
          </button>
        ) : undefined
      }
    >
      {canManage && creating && (
        <NewStockTakeForm
          tenantId={tenantId}
          warehouseId={warehouseId}
          otherFrozen={otherFrozen}
          onClose={() => setCreating(false)}
          onStarted={(id) => {
            setCreating(false);
            setOpenId(id);
          }}
        />
      )}
      {takes.state === 'loading' && <div className="text-(--muted-foreground)">Loading stock takes…</div>}
      {takes.state === 'failed' && <ReadFailure word="Stock takes not loaded" reason={takes.reason} onRetry={takes.reload} />}
      {takes.state === 'ready' && (
        <>
          <div className="overflow-x-auto rounded-md border border-(--border)">
            <table className="w-full border-collapse text-sm" data-testid="stock-takes">
              <thead className="bg-(--muted)">
                <tr>
                  <th scope="col" className={thClass}>Status</th>
                  <th scope="col" className={thClass}>Scope</th>
                  <th scope="col" className={thClass}>Started (IST)</th>
                  <th scope="col" className={thClass}>Progress</th>
                  <th scope="col" className={thClass}>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="h-24 px-3 text-center text-(--muted-foreground)">
                      No stock takes in this warehouse yet.
                    </td>
                  </tr>
                ) : (
                  items.map((entry) => (
                    <tr key={entry.stockTake.id} className="h-10 border-b border-(--border) last:border-b-0">
                      <td className="px-3 py-1">
                        <StatusChip tone={stockTakeStatusTone(entry.stockTake.status)}>{STOCK_TAKE_STATUS_LABEL[entry.stockTake.status]}</StatusChip>
                      </td>
                      <td className="px-3 py-1">{stockTakeScopeLabel(entry.stockTake.zoneIds, zoneList)}</td>
                      <td className="px-3 py-1">{ledgerRecordedLabel(entry.stockTake.startedAt)}</td>
                      <td className="px-3 py-1">{progressLabel(entry.progress.counted, entry.progress.bins)}</td>
                      <td className="px-3 py-1">
                        <button type="button" className={rowButtonClass} onClick={() => setOpenId(entry.stockTake.id)}>
                          Open
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {takes.moreError !== null && <FeedbackBanner tone="rejected" word="More stock takes not loaded" reason={takes.moreError} />}
          {takes.data.data.nextCursor !== null && (
            <button type="button" className={`${buttonClass} w-fit`} onClick={takes.loadMore} disabled={takes.loadingMore}>
              {takes.loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      )}
    </Section>
  );
}

/** New stock take: the whole warehouse or chosen zones; one key per draft. */
function NewStockTakeForm({
  tenantId,
  warehouseId,
  otherFrozen,
  onClose,
  onStarted,
}: {
  tenantId: string;
  warehouseId: string;
  otherFrozen: number;
  onClose: () => void;
  onStarted: (id: string) => void;
}) {
  const bins = useWarehouseBins(warehouseId);
  const zones = useCountZones(warehouseId);
  const [scope, setScope] = useState<'warehouse' | 'zones'>('zones');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState<Outcome>(null);
  const keyed = useKeyedSubmit();
  const zoneList = useMemo(() => (bins.state === 'ready' && zones.state === 'ready' ? countableZones(zones.data, bins.data) : []), [bins, zones]);
  const binCount =
    scope === 'warehouse'
      ? bins.state === 'ready'
        ? countableBins(bins.data).length
        : 0
      : zoneList.filter(({ zone }) => picked.has(zone.id)).reduce((sum, { binCount: n }) => sum + n, 0);
  const ready = (scope === 'warehouse' || picked.size > 0) && binCount > 0 && binCount + otherFrozen <= MAX_FROZEN_BINS;

  function edit(apply: () => void) {
    keyed.invalidate();
    setOutcome(null);
    apply();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready || keyed.busy) return;
    try {
      const sent = await keyed.run((key) =>
        fetchApiStartStockTake(tenantId, warehouseId, { zoneIds: scope === 'warehouse' ? null : [...picked], note: note.trim() === '' ? null : note.trim() }, key),
      );
      if (!sent.sent) return;
      notifyCountsChanged();
      onStarted(sent.value.stockTake.id);
    } catch (error) {
      setOutcome({ tone: 'rejected', word: 'Not started', reason: stockTakeReason(error, 'start') });
    }
  }

  return (
    <form aria-label="New stock take" onSubmit={submit} className="flex flex-col gap-3 rounded-md border border-(--border) p-3">
      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="sr-only">Scope</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="take-scope" checked={scope === 'zones'} onChange={() => edit(() => setScope('zones'))} />
          Chosen zones
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="take-scope" checked={scope === 'warehouse'} onChange={() => edit(() => setScope('warehouse'))} />
          The whole warehouse
        </label>
      </fieldset>
      {(bins.state === 'loading' || zones.state === 'loading') && <div className="text-(--muted-foreground)">Loading zones…</div>}
      {bins.state === 'failed' && <ReadFailure word="Bins not loaded" reason={bins.reason} onRetry={bins.reload} />}
      {zones.state === 'failed' && <ReadFailure word="Zones not loaded" reason={zones.reason} onRetry={zones.reload} />}
      {scope === 'zones' && zoneList.length > 0 && (
        <div className="flex flex-col gap-1 text-sm" role="group" aria-label="Zones">
          {zoneList.map(({ zone, binCount: n }) => (
            <label key={zone.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                aria-label={zone.code}
                checked={picked.has(zone.id)}
                onChange={(e) =>
                  edit(() => {
                    const next = new Set(picked);
                    if (e.target.checked) next.add(zone.id);
                    else next.delete(zone.id);
                    setPicked(next);
                  })
                }
              />
              {zone.code} {zone.name} ({n} {n === 1 ? 'bin' : 'bins'})
            </label>
          ))}
        </div>
      )}
      {scope === 'warehouse' && <div className="text-xs text-(--muted-foreground)">{NEW_BINS_OUTSIDE_NOTE}</div>}
      <label className="flex flex-col gap-1 text-sm">
        <span>Note (optional)</span>
        <input aria-label="Note" className={inputClass} maxLength={200} value={note} onChange={(e) => edit(() => setNote(e.target.value))} />
      </label>
      {binCount > 0 && <div className="text-sm">{freezeCapSentence(binCount, otherFrozen)}</div>}
      <FeedbackBanner tone="warning" word="Freeze" reason={FREEZE_WARNING} />
      {outcome !== null && <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />}
      <div className="flex gap-2">
        <SubmitButton
          busy={keyed.busy}
          ready={ready}
          label="Start stock take"
          busyLabel="Starting…"
          notReadyReason={startNotReadyReason(scope, picked.size, binCount, otherFrozen)}
        />
        <button type="button" className={buttonClass} onClick={onClose}>
          Close
        </button>
      </div>
    </form>
  );
}

/** The confirm's own read: the detail and the variances fetched together (A2 — the digest sent is the one fetched with the table shown). */
interface Review {
  readonly detail: StockTakeDetailResponse;
  readonly rows: readonly StockTakeVarianceEntryDto[];
}

async function readReview(tenantId: string, stockTakeId: string, withRows: boolean): Promise<Review> {
  const detail = await fetchApiGetStockTake(tenantId, stockTakeId);
  const rows: StockTakeVarianceEntryDto[] = [];
  if (withRows) {
    let cursor: string | undefined;
    do {
      const page = await fetchApiListStockTakeVariances(tenantId, stockTakeId, { limit: 500, ...(cursor === undefined ? {} : { cursor }) });
      rows.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
  }
  return { detail, rows };
}

/** A take's dashboard. */
function StockTakeDetail({
  tenantId,
  stockTakeId,
  zones,
  canManage,
  canResolve,
  isOwner,
  active,
  warehouseCode,
  onBack,
}: {
  tenantId: string;
  stockTakeId: string;
  zones: readonly { id: string; code: string }[];
  canManage: boolean;
  canResolve: boolean;
  isOwner: boolean;
  active: ActiveClientState;
  warehouseCode: string;
  onBack: () => void;
}) {
  const detail = useStockTakeDetail(stockTakeId);
  const canInspect = canManage || canResolve;
  const variances = useStockTakeVariances(stockTakeId, canInspect);
  const skus = useSkuMap();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirm, setConfirm] = useState<'close' | 'abandon' | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const recountKey = useKeyedSubmit();
  const closeKey = useKeyedSubmit();
  const abandonKey = useKeyedSubmit();

  const rowsRead: readonly StockTakeVarianceEntryDto[] = variances.state === 'ready' ? variances.data.data : [];
  // While the close confirm is open, the table shows the confirm's own read.
  const rows = confirm === 'close' && review !== null ? review.rows : rowsRead;
  const latest = rows.filter((row) => row.latest);
  const binOf = useMemo(() => new Map(latest.map((row) => [row.binId, row.binCode])), [latest]);
  if (detail.state === 'loading') return <Section title="Stock take"><div className="text-(--muted-foreground)">Loading the stock take…</div></Section>;
  if (detail.state === 'failed') return <Section title="Stock take"><ReadFailure word="Stock take not loaded" reason={detail.reason} onRetry={detail.reload} /></Section>;
  const d = confirm === 'close' && review !== null ? review.detail : detail.data.data;
  const take = d.stockTake;
  const counting = take.status === 'counting';
  const posting = take.status === 'posting';
  const blocked = closeBlockedReason(d.totals, d.recountRequiredCount, isOwner);

  async function recount(binIds: readonly string[]) {
    try {
      const sent = await recountKey.run((key) => fetchApiRecountStockTakeBins(tenantId, take.id, binIds, key));
      if (!sent.sent) return;
      setOutcome({ tone: 'accepted', word: 'Recount planned', reason: `${sent.value.recounts.length} bin(s) to count again on the handhelds: ${sent.value.recounts.map((r) => r.binCode).join(', ')}.` });
      setSelected(new Set());
      notifyCountsChanged();
    } catch (error) {
      setOutcome({ tone: 'rejected', word: 'Not recounted', reason: stockTakeReason(error, 'recount') });
    }
  }

  async function openClose() {
    setReviewing(true);
    setOutcome(null);
    try {
      setReview(await readReview(tenantId, take.id, canInspect));
      closeKey.invalidate();
      setConfirm('close');
    } catch (error) {
      setOutcome({ tone: 'rejected', word: 'Not refreshed', reason: readReason(error, 'the stock take') });
    } finally {
      setReviewing(false);
    }
  }

  async function close(digest: string) {
    try {
      const sent = await closeKey.run((key) => fetchApiCloseStockTake(tenantId, take.id, digest, key));
      if (!sent.sent) return;
      setConfirm(null);
      setReview(null);
      setOutcome(closeOutcome(sent.value));
      notifyCountsChanged();
    } catch (error) {
      setOutcome({ tone: 'rejected', word: 'Not closed', reason: stockTakeReason(error, 'close') });
    }
  }

  async function abandon() {
    try {
      const sent = await abandonKey.run((key) => fetchApiAbandonStockTake(tenantId, take.id, null, key));
      if (!sent.sent) return;
      setConfirm(null);
      setOutcome({
        tone: 'accepted',
        word: 'Stock take abandoned',
        reason: `${sent.value.cancelledTaskCount} pending count(s) cancelled${sent.value.releasedTaskCount > 0 ? `, ${sent.value.releasedTaskCount} kept as cycle counts (a variance waits on them)` : ''}; the freeze is lifted.`,
      });
      notifyCountsChanged();
    } catch (error) {
      setOutcome({ tone: 'rejected', word: 'Not abandoned', reason: stockTakeReason(error, 'abandon') });
    }
  }

  const reviewBlocked = review === null ? null : closeBlockedReason(review.detail.totals, review.detail.recountRequiredCount, isOwner);
  // The selection, pruned to bins the latest read still shows (a stale id is never sent).
  const recountBins = [...selected].filter((id) => binOf.has(id));
  const tooMany = recountBins.length > MAX_RECOUNT_BINS;

  return (
    <Section
      title={`Stock take — ${stockTakeScopeLabel(take.zoneIds, zones)}`}
      action={
        <div className="flex items-center gap-2 text-xs">
          <span className="text-(--muted-foreground)">{asOfLabel(detail.data.asOf)}</span>
          <button
            type="button"
            className={rowButtonClass}
            onClick={() => {
              setConfirm(null);
              setReview(null);
              detail.reload();
              variances.reload();
            }}
          >
            Refresh
          </button>
          <button type="button" className={rowButtonClass} onClick={onBack}>
            Back to the list
          </button>
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <StatusChip tone={stockTakeStatusTone(take.status)}>{STOCK_TAKE_STATUS_LABEL[take.status]}</StatusChip>
        <span>Started {ledgerRecordedLabel(take.startedAt)}</span>
        {take.note !== null && <span className="text-(--muted-foreground)">· {take.note}</span>}
        {take.abandonNote !== null && <span className="text-(--muted-foreground)">· Abandoned: {take.abandonNote}</span>}
      </div>
      {take.zoneIds === null && counting && <div className="text-xs text-(--muted-foreground)">{NEW_BINS_OUTSIDE_NOTE}</div>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiTile label="Bins counted" value={`${d.totals.counted} / ${d.totals.bins}`} />
        <KpiTile label="Counts pending" value={String(d.totals.pending)} delta={d.totals.recountPending > 0 ? `${d.totals.recountPending} recount(s)` : undefined} />
        <KpiTile label="Open variances" value={String(d.totals.openVariances)} delta={`${d.totals.withVariance} bin(s)`} />
        <KpiTile label="Over threshold" value={String(d.totals.overThreshold)} delta={d.totals.overThreshold > 0 ? 'owner decides' : undefined} />
      </div>
      {d.recountRequiredCount > 0 && (
        <FeedbackBanner
          tone="warning"
          word="Recount needed"
          reason={recountRequiredSentence(d.recountRequiredBins, d.recountRequiredCount, d.totals.deviceWrites)}
          action={
            canResolve && counting ? (
              <button type="button" className={rowButtonClass} disabled={recountKey.busy} onClick={() => void recount(d.recountRequiredBins.map((bin) => bin.binId))}>
                Recount these bins
              </button>
            ) : undefined
          }
        />
      )}
      {posting && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-(--border) p-3 text-sm">
          <span>{POSTING_NOTE}</span>
          {canResolve && (
            <button type="button" className={primaryClass} disabled={closeKey.busy} onClick={() => void close(d.openVarianceDigest)}>
              {closeKey.busy ? 'Posting…' : 'Resume posting'}
            </button>
          )}
        </div>
      )}
      <table className="w-full border-collapse text-sm" aria-label="Zones">
        <thead>
          <tr>
            <th scope="col" className={thClass}>Zone</th>
            <th scope="col" className={thClass}>Progress</th>
            <th scope="col" className={`${thClass} text-right`}>Pending</th>
            <th scope="col" className={`${thClass} text-right`}>With variance</th>
          </tr>
        </thead>
        <tbody>
          {d.zones.map((zone) => {
            const percent = progressPercent(zone.counted, zone.bins);
            return (
              <tr key={zone.zoneId} className="border-b border-(--border) last:border-b-0">
                <td className="px-3 py-1 font-medium">{zone.zoneCode}</td>
                <td className="px-3 py-1">
                  <div className="flex items-center gap-2">
                    <span role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={`Zone ${zone.zoneCode} progress`} className="h-2 w-32 overflow-hidden rounded-full bg-(--muted)">
                      <span className="block h-full rounded-full bg-(--accent)" style={{ width: `${percent}%` }} />
                    </span>
                    <span className="text-xs tabular-nums">{progressLabel(zone.counted, zone.bins)}</span>
                  </div>
                </td>
                <td className="data px-3 py-1 text-right">{zone.pending}</td>
                <td className="data px-3 py-1 text-right">{zone.withVariance}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {canInspect && (
        <div className="flex flex-col gap-2">
          <h3 className="font-medium">Variances</h3>
          {variances.state === 'loading' && <div className="text-(--muted-foreground)">Loading variances…</div>}
          {variances.state === 'failed' && <ReadFailure word="Variances not loaded" reason={variances.reason} onRetry={variances.reload} />}
          {variances.state === 'ready' && (
            <div className="overflow-x-auto rounded-md border border-(--border)">
              <table className="w-full border-collapse text-sm" data-testid="stock-take-variances">
                <thead className="bg-(--muted)">
                  <tr>
                    {canResolve && counting && <th scope="col" className={thClass}><span className="sr-only">Select</span></th>}
                    <th scope="col" className={thClass}>Bin</th>
                    <th scope="col" className={thClass}>SKU</th>
                    <th scope="col" className={`${thClass} text-right`}>Book</th>
                    <th scope="col" className={`${thClass} text-right`}>Counted</th>
                    <th scope="col" className={`${thClass} text-right`}>Variance</th>
                    <th scope="col" className={thClass}>Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {latest.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="h-16 px-3 text-center text-(--muted-foreground)">No variance yet — every counted line matched.</td>
                    </tr>
                  ) : (
                    latest.map((row) => {
                      const sku = skus?.[row.skuId] ?? null;
                      return (
                        <tr key={row.id} data-variance-id={row.id} className="border-b border-(--border) last:border-b-0">
                          {canResolve && counting && (
                            <td className="px-3 py-1">
                              <input
                                type="checkbox"
                                aria-label={`Recount ${row.binCode}`}
                                checked={selected.has(row.binId)}
                                onChange={(e) => {
                                  recountKey.invalidate();
                                  const next = new Set(selected);
                                  if (e.target.checked) next.add(row.binId);
                                  else next.delete(row.binId);
                                  setSelected(next);
                                }}
                              />
                            </td>
                          )}
                          <td className="px-3 py-1 font-medium">
                            {row.binCode}
                            {row.epochConflict && (
                              <StatusChip tone="warning" className="ml-2">
                                moved — recount
                              </StatusChip>
                            )}
                          </td>
                          <td className="px-3 py-1">
                            {row.skuCode}
                            {row.overThreshold && (
                              <StatusChip tone="warning" className="ml-2">
                                Owner decides
                              </StatusChip>
                            )}
                          </td>
                          <td className="data px-3 py-1 text-right">{quantityLabel(row.expectedQuantity, sku)}</td>
                          <td className="data px-3 py-1 text-right">{quantityLabel(row.countedQuantity, sku)}</td>
                          <td className="data px-3 py-1 text-right">{ledgerQuantityLabel(row.delta, sku)}</td>
                          <td className="px-3 py-1">{varianceOutcomeLabel(row)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
          {canResolve && counting && (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={`${buttonClass} w-fit`} disabled={recountBins.length === 0 || tooMany || recountKey.busy} onClick={() => void recount(recountBins)}>
                {recountKey.busy ? 'Planning…' : `Recount selected${recountBins.length > 0 ? ` (${recountBins.map((id) => binOf.get(id)).join(', ')})` : ''}`}
              </button>
              {tooMany && <span className="text-xs text-(--destructive)">{TOO_MANY_RECOUNT_NOTE}</span>}
            </div>
          )}
        </div>
      )}

      {outcome !== null && <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />}

      {counting && (canResolve || canManage) && (
        <div className="flex flex-col gap-2 rounded-md border border-(--border) p-3">
          {confirm === 'close' && review !== null && (
            <>
              <div className="text-sm">{closeConfirmSentence(review.detail)}</div>
              {reviewBlocked !== null && <div className="text-xs text-(--destructive)">{reviewBlocked}</div>}
              <div className="flex gap-2">
                <button
                  type="button"
                  className={primaryClass}
                  disabled={closeKey.busy || reviewBlocked !== null}
                  onClick={() => void close(review.detail.openVarianceDigest)}
                >
                  {closeKey.busy ? 'Posting…' : 'Yes, post and close'}
                </button>
                <button type="button" className={buttonClass} onClick={() => { setConfirm(null); setReview(null); }}>
                  Keep counting
                </button>
              </div>
            </>
          )}
          {confirm === 'abandon' && (
            <>
              <div className="text-sm">{ABANDON_CONFIRM}</div>
              <div className="flex gap-2">
                <button type="button" className={primaryClass} disabled={abandonKey.busy} onClick={() => void abandon()}>
                  {abandonKey.busy ? 'Abandoning…' : 'Yes, abandon'}
                </button>
                <button type="button" className={buttonClass} onClick={() => setConfirm(null)}>Keep counting</button>
              </div>
            </>
          )}
          {confirm === null && (
            <div className="flex flex-wrap items-center gap-2">
              {canResolve && (
                <button type="button" className={primaryClass} disabled={blocked !== null || reviewing} onClick={() => void openClose()}>
                  {reviewing ? 'Refreshing…' : 'Post and close'}
                </button>
              )}
              {canManage && (
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => {
                    abandonKey.invalidate();
                    setConfirm('abandon');
                  }}
                >
                  Abandon
                </button>
              )}
              {canResolve && blocked !== null && <span className="text-xs text-(--muted-foreground)">{blocked}</span>}
            </div>
          )}
        </div>
      )}

      {canInspect && <ReportDownload tenantId={tenantId} take={take} active={active} warehouseCode={warehouseCode} />}
    </Section>
  );
}

/** The report: client select + CSV/XLSX, the operational-reports pattern; the client follows the switcher until picked. */
function ReportDownload({
  tenantId,
  take,
  active,
  warehouseCode,
}: {
  tenantId: string;
  take: Pick<StockTakeSummaryDto, 'id' | 'startedAt' | 'status'>;
  active: ActiveClientState;
  warehouseCode: string;
}) {
  const clients = active.clients;
  const clientList = clients.state === 'ready' ? clients.data : [];
  const activeClient = active.state === 'client' ? active.client : null;
  // null = follow the active client; '' = all clients; else a picked id.
  const [picked, setPicked] = useState<string | null>(null);
  const clientId = picked ?? activeClient?.id ?? '';
  const [format, setFormat] = useState<'csv' | 'xlsx'>('csv');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const status = stockTakeReportStatus(take.status);

  async function download() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setOutcome(null);
    try {
      const blob = await fetchApiStockTakeReport(tenantId, take.id, { format, clientId: clientId === '' ? null : clientId });
      const client = clientList.find((c) => c.id === clientId) ?? (activeClient !== null && activeClient.id === clientId ? activeClient : null);
      const filename = stockTakeReportFilename({ take, format, clientCode: clientId === '' ? null : (client?.code ?? null), warehouseCode });
      downloadBlob(filename, blob);
      setOutcome({ tone: 'accepted', word: 'Downloaded', reason: filename });
    } catch (error) {
      setOutcome({ tone: 'rejected', word: 'Not downloaded', reason: stockTakeReason(error, 'report') });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-(--border) pt-3">
      <h3 className="font-medium">Report</h3>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select aria-label="Client" className={`${selectClass} w-auto`} value={clientId} onChange={(e) => setPicked(e.target.value)} disabled={clients.state !== 'ready'}>
          <option value="">All clients</option>
          {clientList.map((c) => (
            <option key={c.id} value={c.id}>
              {clientLabel(c, null)}
            </option>
          ))}
        </select>
        <select aria-label="Format" className={`${selectClass} w-auto`} value={format} onChange={(e) => setFormat(e.target.value as 'csv' | 'xlsx')}>
          <option value="csv">CSV</option>
          <option value="xlsx">Excel</option>
        </select>
        <button type="button" className={buttonClass} disabled={busy} onClick={() => void download()}>
          {busy ? 'Preparing…' : status === 'final' ? 'Download report' : status === 'abandoned' ? 'Download report (abandoned)' : 'Download provisional report'}
        </button>
      </div>
      {outcome !== null && <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />}
    </div>
  );
}
