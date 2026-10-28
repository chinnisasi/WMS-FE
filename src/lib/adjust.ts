import type {
  BatchListItemDto,
  BinResponse,
  SkuResponse,
  StockAdjustmentDto,
  StockAdjustmentPendingResponse,
  StockAdjustmentResponse,
} from '@/lib/api/generated';
import { ApiProblem } from '@/lib/api/client';
import { CLIENT_DEPARTED_REASON } from '@/lib/client-departed';
import { formatCount, formatQuantity, parseQuantityInput } from '@/lib/format-quantity';
import { parseSerialList, storageClassSatisfies } from '@/lib/moves';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';

/**
 * Story 3-2a — the web stock adjustment's pure rules (`components/inventory/
 * adjust-form.tsx`): which bins and SKUs are offered, the FEFO preview (the
 * server's own draw rule, `inventory.controller.ts` `resolveFefoBatch`), the
 * IST batch dates, the request body, the refusal words and the outcome.
 * Every sentence the form renders lives here and is pinned by
 * `adjust.test.ts`. The server decides; this module only avoids sending what
 * it would certainly refuse (guide §7).
 */

export type AdjustReasonCode = StockAdjustmentDto['reasonCode'];

/** The closed adjustment vocabulary, in the server's order (`ADJUSTMENT_REASON_CODES`). */
export const ADJUST_REASONS = [
  'stock-count',
  'damaged',
  'expired',
  'shrinkage',
  'found',
  'recall',
  'system-correction',
  'other',
] as const satisfies readonly AdjustReasonCode[];

/** Record-typed over the generated union: a reason the server adds fails the compile until it is named. */
export const ADJUST_REASON_LABEL: Readonly<Record<AdjustReasonCode, string>> = {
  'stock-count': 'Stock count',
  damaged: 'Damaged',
  expired: 'Expired',
  shrinkage: 'Shrinkage',
  found: 'Found',
  recall: 'Recall',
  'system-correction': 'System correction',
  other: 'Other',
};

/** The hint beside a reason that usually means an expired batch — FEFO never draws one. */
export const FEFO_SKIPS_EXPIRED_HINT = 'FEFO skips expired batches — pick the batch';

/** The hint shows only where it applies: a Remove of a batch-tracked SKU (the FEFO draw). */
export function adjustReasonHint(
  code: AdjustReasonCode | '',
  context: { readonly batchTracked: boolean; readonly direction: 'add' | 'remove' | '' },
): string | null {
  if (!context.batchTracked || context.direction !== 'remove') return null;
  return code === 'expired' || code === 'recall' ? FEFO_SKIPS_EXPIRED_HINT : null;
}

/** The note bound — the adjustment DTO's `Length(1, 500)` (after trimming). */
export const ADJUST_NOTE_MAX = 500;
/** The batch code bound — `BatchInputDto.code`'s `Length(1, 64)`. */
export const ADJUST_BATCH_CODE_MAX = 64;
/** The override reason bound — `BatchInputDto.overrideReason`'s `Length(1, 200)`. */
export const ADJUST_OVERRIDE_REASON_MAX = 200;
/** The serial bound — the DTO's `ArrayMaxSize(1000)`. */
export const ADJUST_MAX_SERIALS = 1000;

/** The pending queue a 202 links to. */
export const ADJUSTMENT_PENDINGS_HREF = '/conflicts?queue=adjustment-pendings';

/** The sentence a catch-weight SKU reads instead of the form (decision 4). */
export const CATCH_WEIGHT_NOT_HERE = 'Catch-weight stock is adjusted by handling unit — not on this screen yet';

/** The Adjust tab's guard for a role without `stock.adjust` (decision 2). */
export const ADJUST_ROLE_DENIED = 'Your role cannot adjust stock';

// ── eligibility ──────────────────────────────────────────────────────────────

/**
 * Decision 4 — the ONE eligibility rule behind the Stock row action and the
 * form's pickers. A bin: a storage bin that is not retired — every system
 * bin is out (RECEIVING belongs to putaway; QC-HOLD, IN-TRANSIT and RETURNS
 * are never adjustable; DAMAGED takes only the 2-4a write-off). A SKU, when
 * given: not a kit (from the kits read — `kitIds` null means "not read yet",
 * and the form sends nothing until it is) and not catch-weight. A blocked
 * bin is offered: the adjustment skips bin gates on the server.
 */
export function adjustOffered(
  bin: Pick<BinResponse, 'systemOwned' | 'retiredAt'> | null | undefined,
  sku: Pick<SkuResponse, 'id' | 'catchWeightTracked'> | null,
  kitIds: ReadonlySet<string> | null,
): boolean {
  if (bin === null || bin === undefined) return false;
  if (bin.systemOwned) return false;
  if (typeof bin.retiredAt === 'string') return false;
  if (sku !== null) {
    if (sku.catchWeightTracked === true) return false;
    if (kitIds !== null && kitIds.has(sku.id)) return false;
  }
  return true;
}

/** The bins the form's bin picker offers, by code. */
export function adjustBins(bins: readonly BinResponse[]): readonly BinResponse[] {
  return [...bins].filter((bin) => adjustOffered(bin, null, null)).sort((a, b) => a.code.localeCompare(b.code));
}

/** The Add rule on a SKU's status — the picker's filter and the row path's refusal (decision 9). */
export function addSkuActive(sku: { readonly status?: string }): boolean {
  return sku.status === 'active';
}

/**
 * Why a SKU the bin holds is not offered for a Remove (shown on a disabled
 * option), or null: a SKU missing from the catalog read, a kit, catch-weight.
 */
export function removeSkuBlock(sku: Pick<SkuResponse, 'catchWeightTracked'> | null, isKit: boolean): string | null {
  if (sku === null) return 'unknown SKU';
  if (isKit) return 'a kit holds no stock';
  if (sku.catchWeightTracked === true) return CATCH_WEIGHT_NOT_HERE;
  return null;
}

/** Why a chosen SKU cannot be adjusted here, or null. */
export function adjustSkuRefusal(sku: Pick<SkuResponse, 'code' | 'catchWeightTracked'>, isKit: boolean): string | null {
  if (isKit) return `${sku.code} is a kit — a kit holds no stock; adjust its component SKUs.`;
  if (sku.catchWeightTracked === true) return `${CATCH_WEIGHT_NOT_HERE}.`;
  return null;
}

/**
 * Decision 9 — the SKUs an Add offers: active, passing `adjustOffered` (not a
 * kit, not catch-weight), and — when the bin is dedicated to a client — that
 * client's only (the `moveTargetBins` precedent). Sorted by code. A kit read
 * not yet answered offers nothing (the caller waits for it).
 */
export function addSkuOptions<S extends Pick<SkuResponse, 'id' | 'code' | 'status' | 'clientId' | 'catchWeightTracked'>>(
  skus: readonly S[],
  bin: Pick<BinResponse, 'dedicatedClientId' | 'systemOwned' | 'retiredAt'>,
  kitIds: ReadonlySet<string>,
): readonly S[] {
  return [...skus]
    .filter((sku) => addSkuActive(sku) && adjustOffered(bin, sku, kitIds))
    .filter((sku) => (bin.dedicatedClientId ?? null) === null || sku.clientId === bin.dedicatedClientId)
    .sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * The non-blocking warning an Add carries when the SKU's storage class does
 * not suit the bin's: the server skips bin gates on an adjustment, so the
 * operator is told rather than stopped.
 */
export function storageClassWarning(
  sku: Pick<SkuResponse, 'code' | 'storageClass'>,
  bin: Pick<BinResponse, 'code' | 'storageClass'>,
): string | null {
  // A fixture or an older payload without a class decides nothing.
  if (typeof sku.storageClass !== 'string' || typeof bin.storageClass !== 'string') return null;
  if (storageClassSatisfies(sku.storageClass, bin.storageClass)) return null;
  return `${sku.code} is ${sku.storageClass} stock and ${bin.code} is a ${bin.storageClass} bin — an adjustment skips the bin checks, so make sure this is where the units really are.`;
}

// ── FEFO, exactly as the server draws ────────────────────────────────────────

export type FefoPick =
  | { readonly kind: 'none' }
  | { readonly kind: 'one'; readonly batch: BatchListItemDto }
  /** Equal expiry: the server's pick among these is its row order, so the preview names them all. */
  | { readonly kind: 'tie'; readonly batches: readonly BatchListItemDto[] };

function expiryMs(batch: Pick<BatchListItemDto, 'expiryDate'>): number | null {
  return batch.expiryDate === null ? null : Date.parse(batch.expiryDate);
}

/**
 * Decision 6 — the server's FEFO default draw (`resolveFefoBatch`):
 * batches with stock in the bin that are neither expired nor blocked, expiry
 * ascending, nulls last. `rows` are the bin's batches (`GET
 * …/batches?skuId&binId`). Story 3-3a (code review): "expired" is the
 * SERVER's flag (`BatchListItemDto.expired`, its one `isBatchExpiredAt`
 * judgement at read time) — the web no longer re-derives it from the date;
 * a BLOCKED batch is never default-drawn either. Both stay nameable as an
 * explicit Remove (the write-off path).
 */
export function fefoBatch(rows: readonly BatchListItemDto[]): FefoPick {
  const candidates = rows
    .filter((row) => row.quantity > 0)
    .filter((row) => row.status !== 'blocked')
    .filter((row) => !row.expired)
    .sort((a, b) => {
      const x = expiryMs(a);
      const y = expiryMs(b);
      if (x === null) return y === null ? 0 : 1;
      if (y === null) return -1;
      return x - y;
    });
  const first = candidates[0];
  if (first === undefined) return { kind: 'none' };
  const head = expiryMs(first);
  const tied = candidates.filter((row) => expiryMs(row) === head);
  return tied.length === 1 ? { kind: 'one', batch: first } : { kind: 'tie', batches: tied };
}

/** What a FEFO Remove may take at most: the FEFO batch's quantity (the smallest of a tie). */
export function fefoCap(pick: FefoPick): number | null {
  if (pick.kind === 'none') return null;
  if (pick.kind === 'one') return pick.batch.quantity;
  return Math.min(...pick.batches.map((batch) => batch.quantity));
}

/** The FEFO batch(es) by name: `L1`, or `L1 or L2 — same expiry`. */
export function fefoName(pick: Exclude<FefoPick, { kind: 'none' }>): string {
  return pick.kind === 'one' ? pick.batch.code : `${pick.batches.map((batch) => batch.code).join(' or ')} — same expiry`;
}

/** The preview line under a FEFO Remove. */
export function fefoPreview(pick: FefoPick, sku: Pick<SkuResponse, 'uomPrecision'>): string {
  if (pick.kind === 'none') return 'No unexpired, unblocked batch holds stock here — pick the batch to remove, with a reason.';
  return `FEFO takes ${fefoName(pick)} (${formatQuantity(fefoCap(pick)!, sku.uomPrecision)} here).`;
}

/** The batches an explicit Remove can name: those with stock in the bin (expired ones included). */
export function removeBatchOptions(rows: readonly BatchListItemDto[]): readonly BatchListItemDto[] {
  return rows.filter((row) => row.quantity > 0);
}

/**
 * A non-blocking warning for an Add into a batch already past its expiry —
 * an existing batch by its stored expiry, a new one by the IST date typed.
 */
export function addExpiredBatchWarning(
  draft: Pick<AdjustDraft, 'batchCode' | 'expiryDate'>,
  rows: readonly BatchListItemDto[] | null,
  nowMs: number,
): string | null {
  const code = draft.batchCode.trim();
  if (code === '') return null;
  const known = existingBatch(rows, code);
  const expiry = known !== null ? known.expiryDate : draft.expiryDate === '' ? null : istDateToInstant(draft.expiryDate);
  if (expiry === null || !(Date.parse(expiry) < nowMs)) return null;
  return `Batch ${code} is already past its expiry — FEFO will never draw it; check the date before adding stock to it.`;
}

/** Whether a batch has expired at `nowMs` (the same instant compare FEFO uses). */
export function batchExpired(batch: Pick<BatchListItemDto, 'expiryDate'>, nowMs: number): boolean {
  const ms = expiryMs(batch);
  return ms !== null && ms < nowMs;
}

// ── IST dates ────────────────────────────────────────────────────────────────

const IST_OFFSET_MS = 330 * 60_000;

/**
 * Decision 7 — the web's ONE twin of the backend's `istMidnightOf`: an IST
 * calendar date (`YYYY-MM-DD`) → the Z-suffixed UTC instant its IST midnight
 * begins (`2027-03-31` → `2027-03-30T18:30:00.000Z`). Independent of the
 * viewer's own time zone. Null for anything that is not a real date.
 */
export function istDateToInstant(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== date) return null;
  return new Date(ms - IST_OFFSET_MS).toISOString();
}

// ── quantity (shared with the 2-4a write-off) ────────────────────────────────

/**
 * A positive quantity at the SKU's declared precision, or the problem. A
 * value finer than the unit allows is refused, never rounded. `emptyProblem`
 * is the caller's own words for a blank or non-positive field.
 */
export function parseAdjustQuantity(
  raw: string,
  sku: Pick<SkuResponse, 'uom' | 'uomPrecision'>,
  emptyProblem: string,
): { readonly qty: number; readonly problem: null } | { readonly qty: null; readonly problem: string } {
  const qty = parseQuantityInput(raw);
  if (qty === null || qty <= 0) return { qty: null, problem: emptyProblem };
  const places = Math.min(Math.max(Math.trunc(sku.uomPrecision), 0), 3);
  if (Math.round(qty * 10 ** places) / 10 ** places !== qty) {
    return {
      qty: null,
      problem:
        places === 0
          ? `${sku.uom} counts in whole units — ${raw.trim()} is not one.`
          : `${sku.uom} takes at most ${places} decimal place(s) — ${raw.trim()} has more.`,
    };
  }
  return { qty, problem: null };
}

// ── the draft ────────────────────────────────────────────────────────────────

export type AdjustDirection = 'add' | 'remove';

export interface AdjustDraft {
  readonly binId: string;
  readonly skuId: string;
  readonly direction: AdjustDirection | '';
  readonly quantity: string;
  readonly reasonCode: AdjustReasonCode | '';
  readonly note: string;
  /** Remove of a batch-tracked SKU: the FEFO default, or a named batch. */
  readonly batchMode: 'fefo' | 'pick';
  /** Remove + pick: the named batch; Add: the batch code typed. */
  readonly batchCode: string;
  /** Remove + pick: why FEFO is overridden (the server requires it). */
  readonly overrideReason: string;
  /** Add of a NEW batch code: optional IST dates (`YYYY-MM-DD`). */
  readonly mfgDate: string;
  readonly expiryDate: string;
  /** Serial-tracked: one per line (or comma-separated). */
  readonly serials: string;
}

export const EMPTY_ADJUST_DRAFT: AdjustDraft = {
  binId: '',
  skuId: '',
  direction: '',
  quantity: '',
  reasonCode: '',
  note: '',
  batchMode: 'fefo',
  batchCode: '',
  overrideReason: '',
  mfgDate: '',
  expiryDate: '',
  serials: '',
};

export type AdjustParse =
  | { readonly kind: 'ok'; readonly body: StockAdjustmentDto }
  | { readonly kind: 'refused'; readonly problem: string };

type AdjustSku = Pick<
  SkuResponse,
  'id' | 'code' | 'uom' | 'uomPrecision' | 'batchTracked' | 'serialTracked' | 'catchWeightTracked' | 'status'
>;

/** The existing batch an Add names, by its exact code (the server's identity match). */
export function existingBatch(rows: readonly BatchListItemDto[] | null, code: string): BatchListItemDto | null {
  const wanted = code.trim();
  if (rows === null || wanted === '') return null;
  return rows.find((row) => row.code === wanted) ?? null;
}

/**
 * The adjustment body for a draft, or the ONE problem that stops it —
 * sending nothing. `batches` are the bin's batches of the SKU (null while
 * unread — a batch-tracked draft waits for them); `held` is what the bin
 * holds of the SKU (an untracked Remove past it is refused here, the
 * server's `insufficient-on-hand` in advance); `nowMs` is the FEFO clock.
 */
export function parseAdjustment(args: {
  readonly warehouseId: string;
  readonly draft: AdjustDraft;
  readonly sku: AdjustSku | null;
  readonly isKit: boolean;
  readonly batches: readonly BatchListItemDto[] | null;
  readonly held: number | null;
  readonly nowMs: number;
}): AdjustParse {
  const { draft, sku } = args;
  const refused = (problem: string): AdjustParse => ({ kind: 'refused', problem });
  if (draft.binId === '') return refused('Pick the bin.');
  if (draft.direction === '') return refused('Choose Add or Remove.');
  if (draft.skuId === '' || sku === null) return refused('Pick the SKU.');
  const refusal = adjustSkuRefusal(sku, args.isKit);
  if (refusal !== null) return refused(refusal);
  // The row path pre-fills any SKU the bin holds; an Add takes active SKUs only (the picker's rule).
  if (draft.direction === 'add' && !addSkuActive(sku)) return refused(`${sku.code} is inactive — an Add takes active SKUs only.`);
  const verb = draft.direction === 'add' ? 'add' : 'remove';
  const quantity = parseAdjustQuantity(draft.quantity, sku, `Type how many units to ${verb} — a positive number.`);
  if (quantity.problem !== null) return refused(quantity.problem);
  const qty = quantity.qty;
  const amount = (value: number) => `${formatQuantity(value, sku.uomPrecision)} ${sku.uom}`;

  let batch: StockAdjustmentDto['batch'];
  if (sku.batchTracked) {
    if (args.batches === null) return refused('Still reading the batches — try again in a moment.');
    if (draft.direction === 'remove') {
      if (draft.batchMode === 'fefo') {
        const pick = fefoBatch(args.batches);
        if (pick.kind === 'none') {
          return refused('No unexpired, unblocked batch holds stock here — pick the batch to remove, with a reason.');
        }
        const cap = fefoCap(pick)!;
        if (qty > cap) {
          return refused(`FEFO takes ${fefoName(pick)} (${formatQuantity(cap, sku.uomPrecision)} here) — remove at most ${formatQuantity(cap, sku.uomPrecision)}, or pick a batch.`);
        }
      } else {
        const code = draft.batchCode;
        if (code === '') return refused(`${sku.code} is batch-tracked — pick the batch to remove.`);
        const chosen = removeBatchOptions(args.batches).find((row) => row.code === code);
        if (chosen === undefined) return refused(`Batch ${code} holds no stock in this bin now — pick another.`);
        const reason = draft.overrideReason.trim();
        if (reason === '') return refused('Say why this batch and not the FEFO one — an override needs a reason.');
        if ([...reason].length > ADJUST_OVERRIDE_REASON_MAX) {
          return refused(`Keep the override reason to ${ADJUST_OVERRIDE_REASON_MAX} characters.`);
        }
        if (qty > chosen.quantity) {
          return refused(`Batch ${code} holds ${amount(chosen.quantity)} here — remove at most that.`);
        }
        batch = { code, overrideReason: reason };
      }
    } else {
      const code = draft.batchCode.trim();
      if (code === '') return refused(`${sku.code} is batch-tracked — type the batch code the units carry.`);
      if ([...code].length > ADJUST_BATCH_CODE_MAX) return refused(`A batch code is at most ${ADJUST_BATCH_CODE_MAX} characters.`);
      if (existingBatch(args.batches, code) !== null) {
        // An existing code keeps its stored dates — the server ignores new ones (decision 7).
        batch = { code };
      } else {
        const mfg = draft.mfgDate === '' ? null : istDateToInstant(draft.mfgDate);
        const expiry = draft.expiryDate === '' ? null : istDateToInstant(draft.expiryDate);
        if (draft.mfgDate !== '' && mfg === null) return refused('The manufacturing date is not a real date.');
        if (draft.expiryDate !== '' && expiry === null) return refused('The expiry date is not a real date.');
        if (mfg !== null && expiry !== null && expiry < mfg) return refused('The expiry date is before the manufacturing date.');
        batch = { code, ...(mfg === null ? {} : { mfgDate: mfg }), ...(expiry === null ? {} : { expiryDate: expiry }) };
      }
    }
  }

  let serials: string[] | undefined;
  if (sku.serialTracked) {
    const { serials: list, duplicates } = parseSerialList(draft.serials);
    if (duplicates.length > 0) {
      return refused(`${duplicates.join(', ')} ${duplicates.length === 1 ? 'is' : 'are'} listed twice — one serial per unit.`);
    }
    if (list.length > ADJUST_MAX_SERIALS) return refused(`An adjustment carries at most ${ADJUST_MAX_SERIALS} serials — split it.`);
    if (list.length !== qty) {
      return refused(`${sku.code} is serial-tracked — list one serial per unit: ${list.length} listed for ${formatQuantity(qty, sku.uomPrecision)}.`);
    }
    serials = [...list];
  }

  if (draft.direction === 'remove' && !sku.batchTracked && args.held !== null && qty > args.held) {
    return refused(`The bin holds ${amount(args.held)} of ${sku.code} — remove at most that.`);
  }
  if (draft.reasonCode === '') return refused('Pick a reason for the adjustment.');
  const note = draft.note.trim();
  if (note === '') return refused('Add a note — what was found, and why the stock changes.');
  if ([...note].length > ADJUST_NOTE_MAX) return refused(`The note is at most ${ADJUST_NOTE_MAX} characters.`);

  return {
    kind: 'ok',
    body: {
      warehouseId: args.warehouseId,
      skuId: sku.id,
      binId: draft.binId,
      quantityDelta: draft.direction === 'add' ? qty : -qty,
      reasonCode: draft.reasonCode,
      note,
      ...(batch === undefined ? {} : { batch }),
      ...(serials === undefined ? {} : { serials }),
    },
  };
}

// ── the answer ───────────────────────────────────────────────────────────────

/** A signed quantity at the SKU's precision: `+3`, `−2.500`. */
export function signedQuantityLabel(delta: number, precision: number): string {
  return `${delta < 0 ? '−' : '+'}${formatQuantity(Math.abs(delta), precision)}`;
}

/**
 * The ledger link of an applied adjustment: this warehouse's ledger filtered
 * to the SKU, the bin and `stock.adjusted` (the ledger has no event-id
 * filter), recorded from one minute before the submit.
 */
export function adjustLedgerHref(warehouseId: string, skuId: string, binId: string, submittedAtMs: number): string {
  const from = new Date(submittedAtMs - 60_000).toISOString();
  const params = new URLSearchParams({ list: 'ledger', warehouseId, skuId, binId, type: 'stock.adjusted', from });
  return `/inventory/ledger?${params.toString()}`;
}

export interface AdjustOutcome {
  readonly tone: 'accepted' | 'warning';
  readonly word: string;
  readonly reason: string;
  readonly link: { readonly href: string; readonly label: string };
}

/**
 * Decision 11 — the outcome from the RESPONSE: 201 "Adjusted — {SKU} {±qty}
 * in {bin}" with the ledger link; 202 "Pending approval — over the
 * {threshold} threshold" (the pend's `thresholdQuantityAtRequest`, at the
 * SKU's precision) with the approval-queue link.
 */
export function adjustOutcome(
  answer: { kind: 'applied'; adjustment: StockAdjustmentResponse } | { kind: 'pending'; pending: StockAdjustmentPendingResponse },
  labels: {
    readonly warehouseId: string;
    readonly binId: string;
    readonly binCode: string;
    readonly sku: Pick<SkuResponse, 'id' | 'code' | 'uom' | 'uomPrecision'>;
    /** When the request was sent — the ledger link's `from` is a minute before it. */
    readonly submittedAtMs: number;
  },
): AdjustOutcome {
  const { sku } = labels;
  if (answer.kind === 'applied') {
    const delta = answer.adjustment.event.quantityDelta;
    return {
      tone: 'accepted',
      word: 'Adjusted',
      reason: `${sku.code} ${signedQuantityLabel(delta, sku.uomPrecision)} ${sku.uom} in ${labels.binCode}.`,
      link: { href: adjustLedgerHref(labels.warehouseId, sku.id, labels.binId, labels.submittedAtMs), label: 'See it in the ledger' },
    };
  }
  const pend = answer.pending.pendingAdjustment;
  const what = `${sku.code} ${signedQuantityLabel(pend.quantityDelta, sku.uomPrecision)} ${sku.uom} in ${labels.binCode}`;
  // Story 3-2b — a request-only holder's adjustment always pends, whatever
  // its size (`approval-required`, possibly with no threshold at all); an
  // older server sends no reason, and a threshold pend names its threshold.
  if (pend.pendReason === 'approval-required' || pend.thresholdQuantityAtRequest === null) {
    return {
      tone: 'warning',
      word: 'Sent for approval',
      reason: `${what} waits for an owner's approval — your role can request adjustments, not apply them; stock is unchanged until then.`,
      link: { href: ADJUSTMENT_PENDINGS_HREF, label: 'Open the approval queue' },
    };
  }
  return {
    tone: 'warning',
    word: 'Pending approval',
    reason: `Over the ${formatQuantity(pend.thresholdQuantityAtRequest, sku.uomPrecision)} threshold — ${what} waits for an owner's approval; stock is unchanged until then.`,
    link: { href: ADJUSTMENT_PENDINGS_HREF, label: 'Open the approval queue' },
  };
}

/**
 * Story 3-2b — why a queued adjustment pended, for the approval card:
 * `approval required` (the requester holds only `stock.adjust.request` — a
 * floor operator's request, any size) or the threshold it crossed, frozen at
 * request. A row from an older server (no reason) is a threshold pend — the
 * only reason a row could pend before 3-2b.
 */
export function pendReasonText(
  entry: { readonly pendReason?: 'threshold' | 'approval-required'; readonly thresholdQuantityAtRequest: number | null },
  qty: (value: number) => string,
): string {
  if (entry.pendReason === 'approval-required' || entry.thresholdQuantityAtRequest === null) {
    return 'approval required — the requester may only request adjustments';
  }
  return `over the ${qty(entry.thresholdQuantityAtRequest)} threshold, frozen at request`;
}

/**
 * Story 3-2b — where the request came from: the handheld's id (its last eight
 * characters — the device list is a settings read the queue does not load),
 * or null from the web.
 */
export function pendSourceText(entry: { readonly sourceDeviceId?: string | null }): string | null {
  const id = entry.sourceDeviceId ?? null;
  return id === null ? null : `from handheld …${id.slice(-8)}`;
}

/**
 * Story 2-8b (A2) — a DAMAGED write-off refused because open returns to
 * vendor claim the units (409 `damaged-claimed-by-rtv`): the RTV codes and
 * the figures from the problem's extensions.
 */
export function damagedClaimedByRtvReason(error: ApiProblem): string {
  const raw = error.extensions['vendorReturnCodes'];
  const codes = Array.isArray(raw) ? raw.filter((code): code is string => typeof code === 'string') : [];
  const claimed = typeof error.extensions['claimedQty'] === 'number' ? (error.extensions['claimedQty'] as number) : null;
  const onHand = typeof error.extensions['onHandQty'] === 'number' ? (error.extensions['onHandQty'] as number) : null;
  const by = codes.length === 0 ? 'an open return to vendor' : codes.join(', ');
  const figures =
    claimed === null || onHand === null ? '' : ` (${formatCount(claimed)} of the ${formatCount(onHand)} on hand)`;
  return `These damaged units are claimed by ${by}${figures} — cancel the return to vendor first, or write off fewer units.`;
}

/**
 * A refused adjustment in words, by `code` — a fixed sentence for every
 * code, never the server's detail. Two codes are split by the problem's
 * fixed TITLE (a controller constant, never the detail): `insufficient-on-hand`
 * titled `'No batch to draw'` (the FEFO draw found no unexpired batch), and a
 * `not-found` on a draw that named its batch titled `'Batch not found'`.
 */
export function adjustReason(error: unknown, context: { readonly batchCode?: string | null } = {}): string {
  if (!(error instanceof ApiProblem)) return UNREACHABLE_REASON;
  switch (error.code) {
    case 'insufficient-on-hand':
      if (error.title === 'No batch to draw') return 'No unexpired, unblocked batch holds stock here now — pick the batch, with a reason.';
      return 'The bin (or the batch) holds fewer units than that now — refresh and try a smaller quantity.';
    case 'bin-retired':
      return 'The bin is retired — nothing was changed.';
    case 'qc-bin-not-adjustable':
      return 'A QC-hold or in-transit bin cannot be adjusted — its stock moves by its own task.';
    case 'returns-bin-not-adjustable':
      return 'The RETURNS bin cannot be adjusted — returned units move by a return receipt and its disposition.';
    case 'damaged-bin-write-off-only':
      return 'The DAMAGED bin only takes a write-off — use Write off on its row.';
    case 'kit-cannot-hold-stock':
      return 'A kit holds no stock — adjust its component SKUs.';
    case 'damaged-claimed-by-rtv':
      return damagedClaimedByRtvReason(error);
    case 'duplicate-serial':
      return 'A serial is already in stock — an Add takes only serials that are not on hand.';
    case 'serial-elsewhere':
      return 'A serial is in another bin — check the serials against this bin.';
    case 'serial-unknown':
      return 'A serial is unknown for this SKU — check the serials.';
    case 'client-departed':
      return CLIENT_DEPARTED_REASON;
    case 'not-found':
      if (context.batchCode !== undefined && context.batchCode !== null && error.title === 'Batch not found') {
        return `Batch ${context.batchCode} no longer exists for this SKU — reload the batches and pick again.`;
      }
      return 'The bin or the SKU no longer exists — reload and pick again.';
    case 'role-denied':
      return 'Your role cannot adjust stock.';
    case 'permission-denied':
      return 'That warehouse belongs to another tenant — sign in again.';
    case 'unauthenticated':
      return 'Your session expired — sign in again.';
    case 'validation-failed':
      return 'The server refused the adjustment as sent — check the quantity, the batch and the serials, then try again.';
    case 'idempotency-key-reuse':
      return 'This adjustment was already sent with different details — change something and send it again.';
    case 'conflict':
      return 'The same adjustment is still being processed — try again to read the result.';
    case 'request-failed':
      return 'The server could not record the adjustment — try again.';
    default:
      return `Not adjusted (${error.code}).`;
  }
}
