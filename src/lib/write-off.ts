import type { BatchListItemDto, SkuResponse, StockAdjustmentDto } from '@/lib/api/generated';
import { ApiProblem } from '@/lib/api/client';
import { ADJUST_NOTE_MAX, ADJUSTMENT_PENDINGS_HREF as PENDINGS_HREF, parseAdjustQuantity } from '@/lib/adjust';
import { formatQuantity } from '@/lib/format-quantity';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';

/**
 * Story 2-4a — the damaged write-off: the web's first stock-adjustment write,
 * scoped to ONE thing — taking units out of the system DAMAGED bin (decision
 * 3). The server allows only a NEGATIVE adjustment there
 * (`damaged-bin-write-off-only`); the dialog only ever sends one. Pure words
 * and derivations, pinned in `write-off.test.ts`.
 */

/** The system bin a write-off acts on (`wms-be` `DAMAGED_BIN_CODE`). */
export const DAMAGED_BIN_CODE = 'DAMAGED';

/** The reason every write-off carries (the closed adjustment vocabulary's `damaged`). */
export const WRITE_OFF_REASON_CODE = 'damaged';

/** The batch override reason a per-batch write-off sends (an explicit draw names its batch — FEFO skips expired ones). */
export const WRITE_OFF_OVERRIDE_REASON = 'damaged write-off';

/** The pending queue a 202 links to (story 3-2a: shared with the stock adjustment, `lib/adjust.ts`). */
export const ADJUSTMENT_PENDINGS_HREF = PENDINGS_HREF;

/** The note bound — the adjustment DTO's `Length(1, 500)` (story 3-2a: the shared `ADJUST_NOTE_MAX`). */
export const WRITE_OFF_NOTE_MAX = ADJUST_NOTE_MAX;

/** Whether a stock row offers "Write off": the system DAMAGED bin, and the role holds `stock.adjust`. */
export function writeOffOffered(row: { readonly binCode?: string; readonly binSystemOwned?: boolean }, canAdjust: boolean): boolean {
  return canAdjust && row.binSystemOwned === true && row.binCode === DAMAGED_BIN_CODE;
}

/** The batches a write-off can name: those with stock in the bin, by code. */
export function writeOffBatches(items: readonly BatchListItemDto[]): readonly BatchListItemDto[] {
  return [...items].filter((batch) => batch.quantity > 0).sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

export interface WriteOffDraft {
  readonly quantity: string;
  readonly note: string;
  /** The chosen batch code (batch-tracked SKUs only); null until chosen. */
  readonly batchCode: string | null;
}

export type WriteOffParse =
  | { readonly kind: 'ok'; readonly body: StockAdjustmentDto }
  | { readonly kind: 'refused'; readonly problem: string };

/**
 * The adjustment body for a draft, or why it cannot be sent. The quantity is
 * positive in the field and NEGATIVE on the wire; a batch-tracked SKU names
 * its batch with the override reason; the note is required (1–500).
 * `available` is what the bin (or the chosen batch) holds — a write-off past
 * it is refused here, the server's insufficient-on-hand answer in advance.
 */
export function parseWriteOff(args: {
  readonly warehouseId: string;
  readonly binId: string;
  readonly sku: Pick<SkuResponse, 'id' | 'code' | 'uom' | 'uomPrecision' | 'batchTracked'>;
  readonly draft: WriteOffDraft;
  readonly available: number;
}): WriteOffParse {
  const { sku, draft } = args;
  if (sku.batchTracked && draft.batchCode === null) {
    return { kind: 'refused', problem: `${sku.code} is batch-tracked — choose the batch to write off.` };
  }
  // Story 3-2a — the shared quantity rule (the same words, the same precision refusal).
  const parsed = parseAdjustQuantity(draft.quantity, sku, 'Type how many units to write off — a positive number.');
  if (parsed.problem !== null) return { kind: 'refused', problem: parsed.problem };
  const qty = parsed.qty;
  if (qty > args.available) {
    return {
      kind: 'refused',
      problem: `Only ${formatQuantity(args.available, sku.uomPrecision)} ${sku.uom} ${sku.batchTracked ? 'of this batch are' : 'are'} in DAMAGED — write off at most that.`,
    };
  }
  const note = draft.note.trim();
  if (note.length === 0) return { kind: 'refused', problem: 'Add a note — what happened to the damaged units.' };
  if ([...note].length > WRITE_OFF_NOTE_MAX) {
    return { kind: 'refused', problem: `The note is at most ${WRITE_OFF_NOTE_MAX} characters.` };
  }
  return {
    kind: 'ok',
    body: {
      warehouseId: args.warehouseId,
      skuId: sku.id,
      binId: args.binId,
      quantityDelta: -qty,
      reasonCode: WRITE_OFF_REASON_CODE,
      note,
      ...(sku.batchTracked && draft.batchCode !== null
        ? { batch: { code: draft.batchCode, overrideReason: WRITE_OFF_OVERRIDE_REASON } }
        : {}),
    },
  };
}

/** A refused write-off in words, by `code` — never by prose. */
export function writeOffReason(error: unknown): string {
  if (!(error instanceof ApiProblem)) return UNREACHABLE_REASON;
  switch (error.code) {
    case 'damaged-bin-write-off-only':
      return 'The DAMAGED bin only takes a write-off (units out) — nothing was changed.';
    case 'bin-retired':
      return 'The bin is retired — nothing was changed.';
    case 'insufficient-on-hand':
      return 'DAMAGED holds fewer units than that now — refresh the stock and try a smaller write-off.';
    case 'role-denied':
      return 'Your role cannot adjust stock.';
    case 'request-failed':
      return UNREACHABLE_REASON;
    default:
      return error.message;
  }
}

/** The success words: written off now, or pending an owner's approval (202). */
export function writeOffOutcome(
  kind: 'applied' | 'pending',
  qty: number,
  sku: Pick<SkuResponse, 'code' | 'uom' | 'uomPrecision'>,
): { readonly word: string; readonly reason: string } {
  const amount = `${formatQuantity(qty, sku.uomPrecision)} ${sku.uom} of ${sku.code}`;
  return kind === 'applied'
    ? { word: 'Written off', reason: `${amount} written off from DAMAGED.` }
    : { word: 'Pending approval', reason: `The write-off of ${amount} is over the approval threshold — an owner approves it in Conflicts & Reviews.` };
}
