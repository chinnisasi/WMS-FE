'use client';

import Link from 'next/link';
import { useRef, useState, useSyncExternalStore } from 'react';

import {
  ADJUST_BATCH_CODE_MAX,
  ADJUST_NOTE_MAX,
  ADJUST_OVERRIDE_REASON_MAX,
  ADJUST_REASON_LABEL,
  ADJUST_REASONS,
  EMPTY_ADJUST_DRAFT,
  addExpiredBatchWarning,
  addSkuOptions,
  adjustBins,
  adjustOutcome,
  adjustReason,
  adjustReasonHint,
  adjustSkuRefusal,
  batchExpired,
  existingBatch,
  fefoBatch,
  fefoPreview,
  parseAdjustment,
  removeBatchOptions,
  removeSkuBlock,
  storageClassWarning,
  type AdjustDraft,
  type AdjustOutcome,
} from '@/lib/adjust';
import { ApiProblem, fetchApiAdjustStock } from '@/lib/api/client';
import type { BinResponse, ClientDto, KitResponse, SkuResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { istDateLabel } from '@/lib/audit-exports';
import { skuDisplayLabel } from '@/lib/clients';
import { formatQuantity, quantityInputLabel } from '@/lib/format-quantity';
import { originSkuRows, parseSerialList } from '@/lib/moves';
import type { Reloadable, ResourceState } from '@/lib/resource-state';
import { useBatchList } from '@/lib/use-inventory';
import { useBinStock } from '@/lib/use-moves';
import { ulid } from '@/lib/ulid';

import { FeedbackBanner } from '@/components/feedback/banner';
import { ReadFailure, buttonClass, inputClass, labelClass, primaryClass, selectClass } from '@/components/shared/surface';

type Catalog = ResourceState<readonly SkuResponse[]> & Reloadable;
type Kits = ResourceState<Readonly<Record<string, KitResponse>>> & Reloadable;

/** The submit's FEFO clock — read in the event handler, never during a render. */
function submitClock(): number {
  return Date.now();
}

/** The bin and SKU a Stock row's Adjust pre-fills, and what the row says the bin holds. */
export interface AdjustFixed {
  readonly binId: string;
  readonly skuId: string;
  readonly held: number;
}

/**
 * Story 3-2a — the web stock adjustment form. Two entry points share it:
 * the Inventory → Adjust tab (blank: the bin, Add or Remove, then the SKU —
 * what the bin holds for a Remove, the catalog's active non-kit SKUs for an
 * Add) and a Stock row's Adjust (`fixed`: that bin and SKU, an inline panel
 * whose success calls `onDone`). Then the quantity at the SKU's precision,
 * the batch (FEFO preview or a named batch with an override reason for a
 * Remove; a code — existing, its dates shown, or new with optional IST
 * dates — for an Add) and/or the serials, the reason and the note.
 *
 * The Idempotency-Key is per draft: minted at submit, reused on a retry of
 * the unchanged draft, cleared on any edit and after success; an in-flight
 * ref guards a double submit. Nothing is sent until the kits read answers.
 */
export function AdjustForm({
  warehouseId,
  bins,
  catalog,
  kits,
  clients,
  fixed = null,
  onDone,
  onClose,
  onBusy,
}: {
  warehouseId: string;
  bins: readonly BinResponse[];
  catalog: Catalog;
  kits: Kits;
  clients: readonly ClientDto[] | null;
  fixed?: AdjustFixed | null;
  onDone?: (outcome: AdjustOutcome) => void;
  onClose?: () => void;
  /** Story 3-2a — the parent disables its row actions while this panel's request is in flight. */
  onBusy?: (busy: boolean) => void;
}) {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const initial: AdjustDraft = fixed === null ? EMPTY_ADJUST_DRAFT : { ...EMPTY_ADJUST_DRAFT, binId: fixed.binId, skuId: fixed.skuId };
  const [draft, setDraft] = useState<AdjustDraft>(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<AdjustOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  // The FEFO preview's clock (a render reads no clock): the mount instant,
  // refreshed on every edit, after a success and on each batches re-read;
  // the submit judges FEFO at its own instant.
  const [shownAt, setShownAt] = useState(() => Date.now());
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);

  const bin = bins.find((candidate) => candidate.id === draft.binId) ?? null;
  const skuById: Readonly<Record<string, SkuResponse>> =
    catalog.state === 'ready' ? Object.fromEntries(catalog.data.map((sku) => [sku.id, sku])) : {};
  const sku = draft.skuId === '' ? null : (skuById[draft.skuId] ?? null);
  const kitIds = kits.state === 'ready' ? new Set(Object.keys(kits.data)) : null;
  const isKit = kitIds !== null && sku !== null && kitIds.has(sku.id);
  // What the bin holds — read for a blank-form Remove only (the row knows its own).
  const binStock = useBinStock(warehouseId, fixed === null && draft.direction === 'remove' && draft.binId !== '' ? draft.binId : null);
  const batchTracked = sku !== null && sku.batchTracked && adjustSkuRefusal(sku, isKit) === null;
  const batches = useBatchList(warehouseId, batchTracked ? sku.id : null, batchTracked ? draft.binId : null);
  const batchRows = batches.state === 'ready' ? batches.data : null;
  // No unexpired batch with stock here: FEFO has nothing to draw, so a Remove
  // must name its batch (decision 6) — the mode is "pick" whatever was chosen.
  const noFefo =
    batchTracked && draft.direction === 'remove' && batchRows !== null && fefoBatch(batchRows).kind === 'none';
  const batchMode = noFefo ? 'pick' : draft.batchMode;

  const heldRows = binStock.state === 'ready' ? originSkuRows(binStock.data.rows) : [];
  /** A batches re-read moves the FEFO clock with it. */
  const reloadBatches = () => {
    setShownAt(submitClock());
    batches.reload();
  };
  const held =
    fixed !== null ? fixed.held : draft.direction === 'remove' ? (heldRows.find((row) => row.skuId === draft.skuId)?.quantity ?? null) : null;

  /** Every edit clears the key (each field is in the server's hash) and the last answer. */
  function edit(patch: Partial<AdjustDraft>) {
    keyRef.current = null;
    setProblem(null);
    setOutcome(null);
    setShownAt(submitClock());
    setDraft((current) => ({ ...current, ...patch }));
  }
  const ARM_RESET: Partial<AdjustDraft> = {
    quantity: '',
    batchMode: 'fefo',
    batchCode: '',
    overrideReason: '',
    mfgDate: '',
    expiryDate: '',
    serials: '',
  };

  async function submit() {
    if (tenantId === null || inFlight.current) return;
    // Kit-ness decides a refusal: until the kits read answers, nothing is sent.
    if (kits.state !== 'ready') {
      setProblem(kits.state === 'failed' ? `The kit list is unavailable — ${kits.reason}` : 'Still reading the kit list — try again in a moment.');
      return;
    }
    if (sku !== null && sku.batchTracked && batches.state === 'failed') {
      setProblem('The batches could not be read — retry.');
      return;
    }
    const parsed = parseAdjustment({ warehouseId, draft: { ...draft, batchMode }, sku, isKit, batches: batchRows, held, nowMs: submitClock() });
    if (parsed.kind === 'refused') {
      setProblem(parsed.problem);
      return;
    }
    const body = parsed.body;
    keyRef.current ??= ulid();
    inFlight.current = true;
    setBusy(true);
    onBusy?.(true);
    setProblem(null);
    const submittedAtMs = submitClock();
    try {
      const answer = await fetchApiAdjustStock(tenantId, body, keyRef.current);
      keyRef.current = null;
      const result = adjustOutcome(answer, {
        warehouseId,
        binId: body.binId,
        binCode: bin?.code ?? body.binId.slice(-8),
        sku: sku!,
        submittedAtMs,
      });
      if (onDone !== undefined) {
        onDone(result);
      } else {
        setOutcome(result);
        setDraft({ ...EMPTY_ADJUST_DRAFT, binId: draft.binId, direction: draft.direction });
        binStock.reload();
        reloadBatches();
      }
    } catch (error) {
      // The draft is kept as typed — a retry of it replays under the same key.
      const named = body.quantityDelta < 0 && body.batch !== undefined ? body.batch.code : null;
      setProblem(adjustReason(error, { batchCode: named }));
      // The world moved: re-read what the bin and its batches hold now.
      if (error instanceof ApiProblem && (error.code === 'insufficient-on-hand' || error.code === 'not-found')) {
        binStock.reload();
        reloadBatches();
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
      onBusy?.(false);
    }
  }

  const binOptions = adjustBins(bins);
  // Every row the bin holds is listed; one not offered (unknown to the
  // catalog read, a kit, catch-weight) is disabled with its reason.
  const removeSkus = heldRows.map((row) => {
    const option = skuById[row.skuId] ?? null;
    return { row, option, block: removeSkuBlock(option, kitIds !== null && kitIds.has(row.skuId)) };
  });
  const addSkus = bin !== null && catalog.state === 'ready' && kitIds !== null ? addSkuOptions(catalog.data, bin, kitIds) : [];
  const precision = sku?.uomPrecision ?? 0;
  const nowMs = shownAt;
  const fefo = batchRows === null ? null : fefoBatch(batchRows);
  const known = draft.direction === 'add' ? existingBatch(batchRows, draft.batchCode) : null;
  const classWarning = draft.direction === 'add' && sku !== null && bin !== null ? storageClassWarning(sku, bin) : null;
  const reasonHint = adjustReasonHint(draft.reasonCode, { batchTracked: sku?.batchTracked === true, direction: draft.direction });
  const expiredWarning = draft.direction === 'add' && sku?.batchTracked === true ? addExpiredBatchWarning(draft, batchRows, nowMs) : null;
  const serialCount = parseSerialList(draft.serials).serials.length;

  return (
    <form
      aria-label={fixed === null ? 'Adjust stock' : `Adjust ${sku?.code ?? 'stock'}`}
      data-testid="adjust-form"
      // The parser is the only gate (guide §7).
      noValidate
      className="flex flex-col gap-3 rounded-sm border border-(--border) p-3 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {fixed !== null && (
        <div className="text-xs font-medium">
          Adjust {sku === null ? '—' : skuDisplayLabel(sku, clients)} in {bin?.code ?? '—'} —{' '}
          {sku === null ? fixed.held : `${formatQuantity(fixed.held, sku.uomPrecision)} ${sku.uom}`} on hand
        </div>
      )}
      {outcome !== null && <AdjustBanner outcome={outcome} />}
      {problem !== null && <FeedbackBanner tone="rejected" word="Not adjusted" reason={problem} />}
      {kits.state === 'failed' && <ReadFailure word="Kit list unavailable" reason={kits.reason} onRetry={kits.reload} />}
      {catalog.state === 'failed' && <ReadFailure word="SKUs unavailable" reason={catalog.reason} onRetry={catalog.reload} />}
      <fieldset disabled={busy} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
        {fixed === null && (
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Bin</span>
            <select
              aria-label="Bin"
              className={selectClass}
              value={draft.binId}
              onChange={(event) => edit({ ...EMPTY_ADJUST_DRAFT, direction: draft.direction, binId: event.target.value })}
            >
              <option value="">Pick the bin…</option>
              {binOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.blocked ? `${option.code} (blocked)` : option.code}
                </option>
              ))}
            </select>
          </label>
        )}

        <fieldset className="m-0 flex flex-wrap items-center gap-3 border-0 p-0">
          <legend className={`${labelClass} mb-1`}>Direction</legend>
          {(['add', 'remove'] as const).map((direction) => (
            <label key={direction} className="flex items-center gap-1">
              <input
                type="radio"
                name="adjust-direction"
                aria-label={direction === 'add' ? 'Add' : 'Remove'}
                value={direction}
                checked={draft.direction === direction}
                onChange={() => edit({ ...ARM_RESET, direction, ...(fixed === null ? { skuId: '' } : {}) })}
              />
              <span>{direction === 'add' ? 'Add (units found)' : 'Remove (units gone)'}</span>
            </label>
          ))}
        </fieldset>

        {fixed === null && draft.binId !== '' && draft.direction === 'remove' && (
          <>
            {binStock.state === 'loading' && <span className="text-xs text-(--muted-foreground)">Loading what the bin holds…</span>}
            {binStock.state === 'failed' && <ReadFailure word="Bin stock unavailable" reason={binStock.reason} onRetry={binStock.reload} />}
            {binStock.state === 'ready' && removeSkus.length === 0 && (
              <span className="text-xs text-(--muted-foreground)">{bin?.code ?? 'This bin'} holds no stock — choose Add, or pick another bin.</span>
            )}
            {binStock.state === 'ready' && binStock.data.truncated && (
              <span className="text-xs text-(--muted-foreground)">This bin holds more SKUs than one read shows — the first 200 are listed.</span>
            )}
            {binStock.state === 'ready' && removeSkus.length > 0 && (catalog.state === 'loading' || kits.state === 'loading') && (
              <span className="text-xs text-(--muted-foreground)">Loading the SKUs…</span>
            )}
            {binStock.state === 'ready' && removeSkus.length > 0 && catalog.state === 'ready' && kitIds !== null && (
              <label className="flex flex-col gap-1">
                <span className={labelClass}>SKU</span>
                <select aria-label="SKU" className={selectClass} value={draft.skuId} onChange={(event) => edit({ ...ARM_RESET, skuId: event.target.value })}>
                  <option value="">Pick the SKU…</option>
                  {removeSkus.map(({ row, option, block }) => {
                    const label = option === null ? row.skuId.slice(-8) : skuDisplayLabel(option, clients);
                    const here = option === null ? String(row.quantity) : `${formatQuantity(row.quantity, option.uomPrecision)} ${option.uom}`;
                    return (
                      <option key={row.skuId} value={row.skuId} disabled={block !== null}>
                        {label} — {here} here{block === null ? '' : ` (${block})`}
                      </option>
                    );
                  })}
                </select>
              </label>
            )}
          </>
        )}

        {fixed === null && draft.binId !== '' && draft.direction === 'add' && (
          <>
            {(catalog.state === 'loading' || kits.state === 'loading') && (
              <span className="text-xs text-(--muted-foreground)">Loading the SKUs…</span>
            )}
            {catalog.state === 'ready' && kitIds !== null && (
              <label className="flex flex-col gap-1">
                <span className={labelClass}>SKU</span>
                <select aria-label="SKU" className={selectClass} value={draft.skuId} onChange={(event) => edit({ ...ARM_RESET, skuId: event.target.value })}>
                  <option value="">{addSkus.length === 0 ? 'No active SKU can go in this bin' : 'Pick the SKU…'}</option>
                  {addSkus.map((option) => (
                    <option key={option.id} value={option.id}>
                      {skuDisplayLabel(option, clients)} — {option.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}

        {/* A kit or catch-weight SKU is never offered (the pickers and the row action filter it); the parser still refuses one. */}
        {sku !== null && adjustSkuRefusal(sku, isKit) === null && draft.direction !== '' && (
          <>
            {classWarning !== null && (
              <div data-testid="class-warning">
                <FeedbackBanner tone="warning" word="Check the bin" reason={classWarning} />
              </div>
            )}
            {expiredWarning !== null && (
              <div data-testid="expired-warning">
                <FeedbackBanner tone="warning" word="Expired batch" reason={expiredWarning} />
              </div>
            )}
            <label className="flex flex-col gap-1">
              <span className={labelClass}>
                Quantity to {draft.direction === 'add' ? 'add' : 'remove'} ({sku.uom})
              </span>
              <input
                aria-label="Quantity"
                inputMode="decimal"
                className={`${inputClass} w-40`}
                value={draft.quantity}
                onChange={(event) => edit({ quantity: event.target.value })}
              />
              <span className="text-xs text-(--muted-foreground)">{quantityInputLabel(precision)}</span>
            </label>

            {sku.batchTracked && (
              <>
                {batches.state === 'loading' && <span className="text-xs text-(--muted-foreground)">Loading the batches…</span>}
                {batches.state === 'failed' && (
                  <ReadFailure word="Batches unavailable" reason="The batches could not be read — retry." onRetry={reloadBatches} />
                )}
                {batchRows !== null && draft.direction === 'remove' && fefo !== null && (
                  <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
                    <legend className={`${labelClass} mb-1`}>Batch</legend>
                    <label className="flex items-center gap-1">
                      <input
                        type="radio"
                        name="adjust-batch-mode"
                        aria-label="FEFO batch"
                        checked={batchMode === 'fefo'}
                        disabled={fefo.kind === 'none'}
                        onChange={() => edit({ batchMode: 'fefo', batchCode: '', overrideReason: '' })}
                      />
                      <span>The FEFO batch (first to expire)</span>
                    </label>
                    <span className="text-xs text-(--muted-foreground)" data-testid="fefo-preview">
                      {fefoPreview(fefo, sku)}
                    </span>
                    <label className="flex items-center gap-1">
                      <input
                        type="radio"
                        name="adjust-batch-mode"
                        aria-label="Pick a batch"
                        checked={batchMode === 'pick'}
                        onChange={() => edit({ batchMode: 'pick' })}
                      />
                      <span>Pick a batch (overrides FEFO — needs a reason)</span>
                    </label>
                    {batchMode === 'pick' && (
                      <>
                        <select aria-label="Batch" className={selectClass} value={draft.batchCode} onChange={(event) => edit({ batchCode: event.target.value })}>
                          <option value="">Pick the batch…</option>
                          {removeBatchOptions(batchRows).map((row) => (
                            <option key={row.id} value={row.code}>
                              {row.code} — {formatQuantity(row.quantity, precision)} here
                              {row.expiryDate === null ? '' : ` · exp ${istDateLabel(row.expiryDate)}`}
                              {batchExpired(row, nowMs) ? ' (expired)' : ''}
                            </option>
                          ))}
                        </select>
                        <input
                          aria-label="Override reason"
                          className={inputClass}
                          maxLength={ADJUST_OVERRIDE_REASON_MAX}
                          placeholder="Why this batch — e.g. the expired lot was the one counted short"
                          value={draft.overrideReason}
                          onChange={(event) => edit({ overrideReason: event.target.value })}
                        />
                      </>
                    )}
                  </fieldset>
                )}
                {batchRows !== null && draft.direction === 'add' && (
                  <div className="flex flex-col gap-2">
                    <label className="flex flex-col gap-1">
                      <span className={labelClass}>Batch code</span>
                      <input
                        aria-label="Batch code"
                        className={inputClass}
                        list="adjust-batch-codes"
                        maxLength={ADJUST_BATCH_CODE_MAX}
                        value={draft.batchCode}
                        onChange={(event) => edit({ batchCode: event.target.value })}
                      />
                      <datalist id="adjust-batch-codes">
                        {batchRows.map((row) => (
                          <option key={row.id} value={row.code} />
                        ))}
                      </datalist>
                    </label>
                    {known !== null ? (
                      <span className="text-xs text-(--muted-foreground)" data-testid="batch-dates">
                        Existing batch — manufactured {known.mfgDate === null ? '—' : istDateLabel(known.mfgDate)}, expires{' '}
                        {known.expiryDate === null ? '—' : istDateLabel(known.expiryDate)}. Its dates stay as recorded.
                      </span>
                    ) : draft.batchCode.trim() !== '' ? (
                      <div className="flex flex-wrap gap-3">
                        <label className="flex flex-col gap-1">
                          <span className={labelClass}>Manufactured (IST, optional)</span>
                          <input
                            aria-label="Manufactured"
                            type="date"
                            className={inputClass}
                            value={draft.mfgDate}
                            onChange={(event) => edit({ mfgDate: event.target.value })}
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className={labelClass}>Expires (IST, optional)</span>
                          <input
                            aria-label="Expires"
                            type="date"
                            className={inputClass}
                            value={draft.expiryDate}
                            onChange={(event) => edit({ expiryDate: event.target.value })}
                          />
                        </label>
                      </div>
                    ) : null}
                  </div>
                )}
              </>
            )}

            {sku.serialTracked && (
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Serials ({serialCount})</span>
                <textarea
                  aria-label="Serials"
                  className={inputClass}
                  rows={4}
                  value={draft.serials}
                  onChange={(event) => edit({ serials: event.target.value })}
                  placeholder="One serial per line — one per unit"
                />
              </label>
            )}
          </>
        )}

        <label className="flex flex-col gap-1">
          <span className={labelClass}>Reason</span>
          <select
            aria-label="Reason"
            className={selectClass}
            value={draft.reasonCode}
            onChange={(event) => edit({ reasonCode: event.target.value as AdjustDraft['reasonCode'] })}
          >
            <option value="">Why is the stock changing…</option>
            {ADJUST_REASONS.map((code) => (
              <option key={code} value={code}>
                {ADJUST_REASON_LABEL[code]}
              </option>
            ))}
          </select>
          {reasonHint !== null && (
            <span className="text-xs text-(--muted-foreground)" data-testid="reason-hint">
              {reasonHint}
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Note (required)</span>
          <textarea
            aria-label="Note"
            className={inputClass}
            rows={2}
            maxLength={ADJUST_NOTE_MAX}
            value={draft.note}
            onChange={(event) => edit({ note: event.target.value })}
            placeholder="What was found — counted short, crushed in the bin, found behind the rack…"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={primaryClass} disabled={busy || tenantId === null || kits.state !== 'ready'}>
            {busy ? 'Adjusting…' : 'Adjust stock'}
          </button>
          {onClose !== undefined && (
            <button type="button" className={buttonClass} onClick={onClose} disabled={busy}>
              Cancel
            </button>
          )}
        </div>
      </fieldset>
    </form>
  );
}

/** A finished adjustment's banner: the ledger link (applied) or the approval queue (pending). */
export function AdjustBanner({ outcome }: { outcome: AdjustOutcome }) {
  return (
    <div data-testid="adjust-outcome">
      <FeedbackBanner
        tone={outcome.tone}
        word={outcome.word}
        reason={outcome.reason}
        action={
          <Link href={outcome.link.href} className="text-xs text-(--primary) underline underline-offset-2">
            {outcome.link.label}
          </Link>
        }
      />
    </div>
  );
}
