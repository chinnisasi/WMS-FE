'use client';

import { useRef, useState, useSyncExternalStore } from 'react';

import { fetchApiMoveStock } from '@/lib/api/client';
import type { BinResponse, SkuResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { formatQuantity, quantityInputLabel } from '@/lib/format-quantity';
import {
  EMPTY_MOVE_DRAFT,
  MOVE_NOTE_MAX,
  MOVE_REASON_CODES,
  MOVE_REASON_LABEL,
  moveBatchOptions,
  moveNoteRequired,
  moveOriginBins,
  moveOutcome,
  moveReason,
  moveSkuRefusal,
  moveTargetBins,
  notifyMovesChanged,
  originSkuRows,
  parseMoveDraft,
  parseSerialList,
  type MoveFormDraft,
} from '@/lib/moves';
import type { ActiveClientState } from '@/lib/use-active-client';
import { useKits } from '@/lib/use-catalog';
import { useBatchList, useSkuCatalog } from '@/lib/use-inventory';
import { useBinStock } from '@/lib/use-moves';
import { ulid } from '@/lib/ulid';

import { FeedbackBanner } from '@/components/feedback/banner';
import { AllClientsNote } from '@/components/shared/client-filter-chip';
import { ReadFailure, inputClass, labelClass, primaryClass, selectClass } from '@/components/shared/surface';

/**
 * Story 3-1 — move stock between two bins of the warehouse, on the web. Filled
 * in order: the origin (a storage bin that is not retired — a blocked one is
 * fine), then the SKU from what that bin holds (read per bin, with its own
 * loading, failure and Retry), then the quantity — or the batch, or the
 * serials —, the target and the reason. A kit or a catch-weight SKU is
 * refused before the submit; the target list offers only bins the device
 * would also accept (and a secure bin only to a role holding `secure.move`).
 *
 * The Idempotency-Key is per draft (minted on the first submit, reused on a
 * retry of the unchanged draft, cleared on any edit — every field is in the
 * server's hash), with an in-flight ref against a double submit. Write-side,
 * so it is never client-filtered: it says "All clients" while a client is
 * active. The parent mounts it keyed by the warehouse.
 */
export function MoveForm({
  warehouseId,
  bins,
  active,
}: {
  warehouseId: string;
  bins: readonly BinResponse[];
  active: ActiveClientState;
}) {
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );
  const [draft, setDraft] = useState<MoveFormDraft>(EMPTY_MOVE_DRAFT);
  const [problem, setProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const inFlight = useRef(false);

  const catalog = useSkuCatalog();
  const kits = useKits();
  const stock = useBinStock(warehouseId, draft.fromBinId === '' ? null : draft.fromBinId);
  const skuById: Readonly<Record<string, SkuResponse>> =
    catalog.state === 'ready' ? Object.fromEntries(catalog.data.map((sku) => [sku.id, sku])) : {};
  const sku = draft.skuId === '' ? null : (skuById[draft.skuId] ?? null);
  const isKit = kits.state === 'ready' && sku !== null && kits.data[sku.id] !== undefined;
  const batchTracked = sku !== null && sku.batchTracked && !sku.serialTracked;
  const batches = useBatchList(warehouseId, batchTracked ? draft.skuId : null, batchTracked ? draft.fromBinId : null);

  const origins = moveOriginBins(bins, role);
  const targets = moveTargetBins(bins, draft.fromBinId === '' ? null : draft.fromBinId, sku, role);
  const binCode = (id: string) => bins.find((bin) => bin.id === id)?.code ?? id.slice(-8);

  /** Every edit clears the key (each field is hashed) and the last answer. */
  function edit(patch: Partial<MoveFormDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setIdempotencyKey(null);
    setProblem(null);
    setOutcome(null);
  }

  async function submit() {
    const session = readSession();
    if (session === null || inFlight.current) return;
    // Kit-ness decides the refusal: until the kits read answers, nothing is sent.
    if (kits.state !== 'ready') {
      setProblem(kits.state === 'failed' ? `The kit list is unavailable — ${kits.reason}` : 'Still reading the kit list — try again in a moment.');
      return;
    }
    const parsed = parseMoveDraft(draft, sku, isKit);
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
      const response = await fetchApiMoveStock(session.tenant.id, warehouseId, parsed.body, key);
      setOutcome(
        moveOutcome(response, {
          sku: sku?.code ?? '',
          from: binCode(parsed.body.fromBinId),
          to: binCode(parsed.body.toBinId),
          precision: sku?.uomPrecision ?? 0,
        }),
      );
      setIdempotencyKey(null);
      setDraft(EMPTY_MOVE_DRAFT);
      // Every reader refetches: the recent moves and the origin's stock.
      notifyMovesChanged();
    } catch (error) {
      // The draft is kept as typed — a retry of it replays under the same key.
      setProblem(moveReason(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const skuRows = stock.state === 'ready' ? originSkuRows(stock.data.rows) : [];
  const skuRefusal = sku === null ? null : moveSkuRefusal(sku, isKit);
  const precision = sku?.uomPrecision ?? 0;

  return (
    <form
      aria-label="Move stock"
      // The parser is the only gate (guide §7): precision is the server's to refuse.
      noValidate
      className="flex flex-col gap-3 rounded-sm border border-(--border) p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">Move stock</span>
        <AllClientsNote active={active} />
      </div>
      {outcome !== null && <FeedbackBanner tone="accepted" word="Moved" reason={outcome} />}
      {problem !== null && <FeedbackBanner tone="rejected" word="Not moved" reason={problem} />}
      <fieldset disabled={busy} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>From bin</span>
          <select
            aria-label="From bin"
            className={selectClass}
            value={draft.fromBinId}
            onChange={(event) => edit({ ...EMPTY_MOVE_DRAFT, reasonCode: draft.reasonCode, note: draft.note, fromBinId: event.target.value })}
          >
            <option value="">Pick the bin the stock leaves…</option>
            {origins.map((bin) => (
              <option key={bin.id} value={bin.id}>
                {bin.blocked ? `${bin.code} (blocked)` : bin.code}
              </option>
            ))}
          </select>
        </label>

        {draft.fromBinId !== '' && (
          <>
            {stock.state === 'loading' && <span className="text-xs text-(--muted-foreground)">Loading what the bin holds…</span>}
            {stock.state === 'failed' && <ReadFailure word="Bin stock unavailable" reason={stock.reason} onRetry={stock.reload} />}
            {catalog.state === 'failed' && <ReadFailure word="SKUs unavailable" reason={catalog.reason} onRetry={catalog.reload} />}
            {kits.state === 'failed' && <ReadFailure word="Kit list unavailable" reason={kits.reason} onRetry={kits.reload} />}
            {stock.state === 'ready' && skuRows.length === 0 && (
              <span className="text-xs text-(--muted-foreground)">{binCode(draft.fromBinId)} holds no stock — pick another bin.</span>
            )}
            {stock.state === 'ready' && stock.data.truncated && (
              <span className="text-xs text-(--muted-foreground)">This bin holds more SKUs than one read shows — the first 200 are listed.</span>
            )}
            {stock.state === 'ready' && skuRows.length > 0 && catalog.state === 'ready' && (
              <label className="flex flex-col gap-1">
                <span className={labelClass}>SKU</span>
                <select
                  aria-label="SKU"
                  className={selectClass}
                  value={draft.skuId}
                  onChange={(event) =>
                    edit({ skuId: event.target.value, qty: '', batchCode: '', serials: '', toBinId: '' })
                  }
                >
                  <option value="">Pick the SKU to move…</option>
                  {skuRows.map((row) => {
                    const option = skuById[row.skuId];
                    const code = option?.code ?? row.skuId.slice(-8);
                    const held = option === undefined ? String(row.quantity) : `${formatQuantity(row.quantity, option.uomPrecision)} ${option.uom}`;
                    return (
                      <option key={row.skuId} value={row.skuId}>
                        {code} — {held} here
                      </option>
                    );
                  })}
                </select>
              </label>
            )}
          </>
        )}

        {sku !== null && skuRefusal !== null && <FeedbackBanner tone="warning" word="Cannot move" reason={skuRefusal} />}

        {sku !== null && skuRefusal === null && (
          <>
            {sku.serialTracked ? (
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Serials ({parseSerialList(draft.serials).serials.length})</span>
                <textarea
                  aria-label="Serials"
                  className={inputClass}
                  rows={4}
                  value={draft.serials}
                  onChange={(event) => edit({ serials: event.target.value })}
                  placeholder="One serial per line — every unit you move"
                />
              </label>
            ) : (
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Quantity ({sku.uom})</span>
                <input
                  aria-label="Quantity"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={precision === 0 ? 1 : 1 / 10 ** precision}
                  className={inputClass}
                  value={draft.qty}
                  onChange={(event) => edit({ qty: event.target.value })}
                />
                <span className="text-xs text-(--muted-foreground)">{quantityInputLabel(precision)}</span>
              </label>
            )}
            {batchTracked && (
              <>
                {batches.state === 'loading' && <span className="text-xs text-(--muted-foreground)">Loading the batches in this bin…</span>}
                {batches.state === 'failed' && <ReadFailure word="Batches unavailable" reason={batches.reason} onRetry={batches.reload} />}
                {batches.state === 'ready' && (
                  <label className="flex flex-col gap-1">
                    <span className={labelClass}>Batch</span>
                    <select aria-label="Batch" className={selectClass} value={draft.batchCode} onChange={(event) => edit({ batchCode: event.target.value })}>
                      <option value="">Pick the batch…</option>
                      {moveBatchOptions(batches.data).map((batch) => (
                        <option key={batch.id} value={batch.code}>
                          {batch.code} — {formatQuantity(batch.quantity, precision)} here
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
            <label className="flex flex-col gap-1">
              <span className={labelClass}>To bin</span>
              <select aria-label="To bin" className={selectClass} value={draft.toBinId} onChange={(event) => edit({ toBinId: event.target.value })}>
                <option value="">Pick the bin the stock goes to…</option>
                {targets.map((bin) => (
                  <option key={bin.id} value={bin.id}>
                    {bin.code}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        <label className="flex flex-col gap-1">
          <span className={labelClass}>Reason</span>
          <select
            aria-label="Reason"
            className={selectClass}
            value={draft.reasonCode}
            onChange={(event) => edit({ reasonCode: event.target.value as MoveFormDraft['reasonCode'] })}
          >
            <option value="">Why is the stock moving…</option>
            {MOVE_REASON_CODES.map((code) => (
              <option key={code} value={code}>
                {MOVE_REASON_LABEL[code]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>{moveNoteRequired(draft.reasonCode) ? 'Note (required)' : 'Note (optional)'}</span>
          <input
            aria-label="Note"
            className={inputClass}
            maxLength={MOVE_NOTE_MAX}
            value={draft.note}
            onChange={(event) => edit({ note: event.target.value })}
          />
        </label>
        <div>
          <button type="submit" className={primaryClass} disabled={kits.state !== 'ready'}>
            {busy ? 'Moving…' : 'Move stock'}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
