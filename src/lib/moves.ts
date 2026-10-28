import { ApiProblem } from '@/lib/api/client';
import type {
  BatchListItemDto,
  BinResponse,
  LedgerEventDto,
  MoveStockDto,
  MoveStockResponse,
  SkuResponse,
  StockEntryDto,
} from '@/lib/api/generated';
import { formatQuantity, parseQuantityInput } from '@/lib/format-quantity';
import { UNREACHABLE_REASON, verbatim } from '@/lib/outbound-orders';
import type { UserRole } from '@/lib/users';
import { roleHasCapability } from '@/lib/users';

/**
 * Story 3-1 — the Moves page's pure decisions (`components/moves/*`): which
 * bins the form offers, the draft's one problem, the request body, the
 * outcome sentence, the refusal words and the recent moves grouped by move.
 * Every sentence the page renders lives here and is pinned by `moves.test.ts`.
 * The server decides — this module only avoids offering what it would
 * certainly refuse (guide §7: filter the options, never claim authority).
 */

/** Cross-surface invalidation: a move changes the stock list and the recent moves. */
export const MOVES_CHANGED_EVENT = 'wms:moves-changed';

export function notifyMovesChanged(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(MOVES_CHANGED_EVENT));
}

export type MoveReasonCode = MoveStockDto['reasonCode'];

/** The reason vocabulary, in the server's order (`MOVE_REASON_CODES`). */
export const MOVE_REASON_CODES = [
  'consolidate',
  're-slot',
  'make-room',
  'found-misplaced',
  'client-request',
  'other',
] as const satisfies readonly MoveReasonCode[];

/** Record-typed over the generated union: a reason the server adds fails the compile until it is named. */
export const MOVE_REASON_LABEL: Readonly<Record<MoveReasonCode, string>> = {
  consolidate: 'Consolidate',
  're-slot': 'Re-slot',
  'make-room': 'Make room',
  'found-misplaced': 'Found misplaced',
  'client-request': 'Client request',
  other: 'Other',
};

/** A stored reason in words; a code this build does not know reads as itself. */
export function moveReasonLabel(code: string | undefined | null): string {
  if (code === undefined || code === null) return '—';
  return (MOVE_REASON_LABEL as Readonly<Record<string, string>>)[code] ?? code;
}

/** The server's note ceiling (`MOVE_NOTE_MAX`, code points after trimming) and serial cap. */
export const MOVE_NOTE_MAX = 200;
export const MAX_MOVE_SERIALS = 500;

/** The reasons that need a note beside them (the server's `MOVE_NOTE_REQUIRED_CODES`). */
export function moveNoteRequired(code: MoveReasonCode | ''): boolean {
  return code === 'other';
}

// ── the bins the form offers ─────────────────────────────────────────────────

/**
 * Origins: a storage bin that is not retired — a BLOCKED bin is offered
 * (emptying it is the point) — and a secure bin only to a role holding
 * `secure.move` (the server would refuse the rest `403`, like a target).
 */
export function moveOriginBins(bins: readonly BinResponse[], role: UserRole | undefined): readonly BinResponse[] {
  const secureCapable = roleHasCapability(role, 'secure.move');
  return [...bins]
    .filter((bin) => !bin.systemOwned && bin.retiredAt === null && (bin.storageClass !== 'secure' || secureCapable))
    .sort((a, b) => a.code.localeCompare(b.code));
}

const TEMPERATURE_RANK: Readonly<Record<string, number>> = { ambient: 1, chilled: 2, frozen: 3 };

/**
 * Mirror of the server's `storageClassSatisfies` (12-1): equal classes
 * conform; otherwise only inside the temperature family, colder bin over
 * warmer SKU. Used only to FILTER the target options — the gate decides.
 */
export function storageClassSatisfies(skuClass: string, binClass: string): boolean {
  if (skuClass === binClass) return true;
  const skuRank = TEMPERATURE_RANK[skuClass];
  const binRank = TEMPERATURE_RANK[binClass];
  return skuRank !== undefined && binRank !== undefined && binRank > skuRank;
}

/**
 * Targets: the device's rules (not system, not retired, not blocked, not the
 * origin, a class that suits the SKU, not dedicated to another client) plus
 * a secure bin only for a role holding `secure.move`. Capacity, segregation,
 * bulk occupancy and a quarantine stay the server's (409 with the gate's code).
 */
export function moveTargetBins(
  bins: readonly BinResponse[],
  originId: string | null,
  sku: Pick<SkuResponse, 'storageClass' | 'clientId'> | null,
  role: UserRole | undefined,
): readonly BinResponse[] {
  const secureCapable = roleHasCapability(role, 'secure.move');
  return [...bins]
    .filter((bin) => {
      if (bin.systemOwned || bin.retiredAt !== null || bin.blocked) return false;
      if (bin.id === originId) return false;
      if (bin.storageClass === 'secure' && !secureCapable) return false;
      if (sku !== null) {
        if (!storageClassSatisfies(sku.storageClass, bin.storageClass)) return false;
        if (bin.dedicatedClientId !== null && bin.dedicatedClientId !== sku.clientId) return false;
      }
      return true;
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}

/** The origin's batches worth offering: those with stock in that bin. */
export function moveBatchOptions(batches: readonly BatchListItemDto[]): readonly BatchListItemDto[] {
  return batches.filter((batch) => batch.quantity > 0);
}

/** One SKU row of the origin bin: the SKU and its on-hand there (rows of one SKU summed). */
export interface OriginSkuRow {
  readonly skuId: string;
  readonly quantity: number;
}

export function originSkuRows(rows: readonly StockEntryDto[]): readonly OriginSkuRow[] {
  const bySku = new Map<string, number>();
  for (const row of rows) {
    if (row.quantity > 0) bySku.set(row.skuId, (bySku.get(row.skuId) ?? 0) + row.quantity);
  }
  return [...bySku.entries()].map(([skuId, quantity]) => ({ skuId, quantity }));
}

/** Why a SKU cannot be moved here, or null — refused before submit (decision 5). */
export function moveSkuRefusal(sku: Pick<SkuResponse, 'code' | 'catchWeightTracked'>, isKit: boolean): string | null {
  if (isKit) return `${sku.code} is a kit — a kit holds no stock; move its component SKUs.`;
  if (sku.catchWeightTracked) return `${sku.code} is catch-weight — its cases carry no bin, so it cannot be moved here yet.`;
  return null;
}

/**
 * Serials typed one per line or comma-separated: trimmed, blanks dropped. A
 * serial listed twice is REPORTED (`duplicates`, first-seen order), never
 * silently dropped — dropping it would change the quantity under the viewer.
 */
export function parseSerialList(raw: string): { readonly serials: readonly string[]; readonly duplicates: readonly string[] } {
  const seen = new Set<string>();
  const serials: string[] = [];
  const duplicates: string[] = [];
  for (const piece of raw.split(/[\n,]/)) {
    const serial = piece.trim();
    if (serial === '') continue;
    if (seen.has(serial)) {
      if (!duplicates.includes(serial)) duplicates.push(serial);
      continue;
    }
    seen.add(serial);
    serials.push(serial);
  }
  return { serials, duplicates };
}

// ── the draft ────────────────────────────────────────────────────────────────

export interface MoveFormDraft {
  readonly fromBinId: string;
  readonly skuId: string;
  readonly qty: string;
  readonly batchCode: string;
  readonly serials: string;
  readonly toBinId: string;
  readonly reasonCode: MoveReasonCode | '';
  readonly note: string;
}

export const EMPTY_MOVE_DRAFT: MoveFormDraft = {
  fromBinId: '',
  skuId: '',
  qty: '',
  batchCode: '',
  serials: '',
  toBinId: '',
  reasonCode: '',
  note: '',
};

/**
 * The draft's request body, or the one problem that stops it — sending
 * nothing. Every optional arm is explicit (`null`), the server's hash shape.
 * A serial move's quantity IS its serial count; a batch move names its batch.
 */
export function parseMoveDraft(
  draft: MoveFormDraft,
  sku: Pick<SkuResponse, 'code' | 'batchTracked' | 'serialTracked' | 'catchWeightTracked'> | null,
  isKit: boolean,
): { body: MoveStockDto; problem: null } | { body: null; problem: string } {
  if (draft.fromBinId === '') return { body: null, problem: 'Pick the bin the stock leaves.' };
  if (draft.skuId === '' || sku === null) return { body: null, problem: 'Pick the SKU to move.' };
  const refusal = moveSkuRefusal(sku, isKit);
  if (refusal !== null) return { body: null, problem: refusal };
  let qty: number;
  let serials: string[] | null = null;
  let batchCode: string | null = null;
  if (sku.serialTracked) {
    const { serials: list, duplicates } = parseSerialList(draft.serials);
    if (duplicates.length > 0) {
      return { body: null, problem: `${duplicates.join(', ')} ${duplicates.length === 1 ? 'is' : 'are'} listed twice — one serial per unit.` };
    }
    if (list.length === 0) return { body: null, problem: `${sku.code} is serial-tracked — list the serial of every unit you move.` };
    if (list.length > MAX_MOVE_SERIALS) {
      return { body: null, problem: `A move carries at most ${MAX_MOVE_SERIALS} serials (got ${list.length}) — split it.` };
    }
    serials = [...list];
    qty = list.length;
  } else {
    const parsed = parseQuantityInput(draft.qty);
    if (parsed === null || !(parsed > 0)) return { body: null, problem: 'Type the quantity to move — a positive number.' };
    qty = parsed;
    if (sku.batchTracked) {
      if (draft.batchCode === '') return { body: null, problem: `${sku.code} is batch-tracked — pick the batch you move.` };
      batchCode = draft.batchCode;
    }
  }
  if (draft.toBinId === '') return { body: null, problem: 'Pick the bin the stock goes to.' };
  if (draft.toBinId === draft.fromBinId) return { body: null, problem: 'The origin and the target are the same bin — pick another target.' };
  if (draft.reasonCode === '') return { body: null, problem: 'Pick a reason for the move.' };
  const note = draft.note.trim();
  if (moveNoteRequired(draft.reasonCode) && note === '') return { body: null, problem: 'The reason “Other” needs a note saying why.' };
  if ([...note].length > MOVE_NOTE_MAX) return { body: null, problem: `Keep the note to ${MOVE_NOTE_MAX} characters.` };
  return {
    body: {
      skuId: draft.skuId,
      fromBinId: draft.fromBinId,
      toBinId: draft.toBinId,
      qty,
      batchCode,
      serials,
      reasonCode: draft.reasonCode,
      note: note === '' ? null : note,
    },
    problem: null,
  };
}

// ── the answer ───────────────────────────────────────────────────────────────

/** The accepted move, from the RESPONSE: `Moved 20 PLAIN A-01 → B-01`. */
export function moveOutcome(
  response: MoveStockResponse,
  labels: { readonly sku: string; readonly from: string; readonly to: string; readonly precision: number },
): string {
  const total = response.events.reduce((sum, event) => sum + event.quantity, 0);
  return `Moved ${formatQuantity(total, labels.precision)} ${labels.sku} ${labels.from} → ${labels.to}.`;
}

/** The move's refusals in words — clients branch on the code (guide §3). */
export function moveReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'move-source-short':
        return error.detail ?? 'The origin bin holds less than that — move what is on hand.';
      case 'move-scope-quarantined':
        return error.detail ?? 'That stock is under a reconcile quarantine — it cannot move until the quarantine is resolved.';
      case 'bin-not-movable':
        return 'A system bin (Receiving, QC-hold, In-Transit, Returns) moves only by its own task — pick a storage bin.';
      case 'bin-retired':
        return error.detail ?? 'That bin is retired — pick another.';
      case 'bin-blocked':
        return error.detail ?? 'The target bin is blocked — pick another.';
      case 'bin-frozen':
        // Story 3-5b — verbatim: the server names the bin, the take and its start.
        return verbatim(error);
      case 'bin-full':
      case 'bin-overweight':
      case 'bin-volume-exceeded':
      case 'bin-item-oversize':
        return error.detail ?? 'The target bin has no room for this — pick another.';
      case 'bin-storage-mismatch':
      case 'bin-client-mismatch':
      case 'bin-segregation-conflict':
      case 'bin-occupancy-conflict':
        return error.detail ?? 'The target bin cannot take this stock — pick another.';
      case 'kit-cannot-hold-stock':
        return 'A kit holds no stock — move its component SKUs.';
      case 'serial-elsewhere':
        return error.detail ?? 'A serial is in another bin — check the serials against the origin.';
      case 'serial-unknown':
        return error.detail ?? 'A serial is unknown for this SKU — check the serials.';
      case 'not-found':
        return error.detail ?? 'A bin, the SKU or the batch no longer exists — reload and pick again.';
      case 'role-denied':
        return error.detail ?? 'Your role cannot move this stock.';
      case 'permission-denied':
        return 'That warehouse belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This move was already sent with different details — change something and send it again.';
      case 'conflict':
        return error.detail ?? 'The same move is still being processed — try again to read the result.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the move and try again.';
      default:
        return error.detail ?? `Not moved (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

// ── the recent moves ─────────────────────────────────────────────────────────

/** One move as the recent list shows it: its events grouped by `moveId`. */
export interface RecentMove {
  readonly moveId: string;
  readonly recordedAt: string;
  readonly occurredAt: string;
  readonly skuId: string;
  readonly fromBinId: string | null;
  readonly toBinId: string | null;
  /** The moved quantity — the sum of the move's events on this page. */
  readonly quantity: number;
  readonly batchRefs: readonly string[];
  readonly serialCount: number;
  readonly actorUserId: string;
  readonly reasonCode: string | null;
  readonly note: string | null;
}

/**
 * Groups one ledger page of `stock.moved` events by their `moveId`, in the
 * page's order (newest first). An event without a moveId (never written
 * today) stands alone under its own id. A serial move's N events become one
 * row whose quantity is their sum.
 */
export function groupMoves(events: readonly LedgerEventDto[]): readonly RecentMove[] {
  const order: string[] = [];
  const byMove = new Map<string, RecentMove>();
  for (const event of events) {
    const moveId = event.referenceDoc?.moveId ?? event.id;
    const existing = byMove.get(moveId);
    const quantity = Math.abs(event.quantityDelta);
    if (existing === undefined) {
      order.push(moveId);
      byMove.set(moveId, {
        moveId,
        recordedAt: event.recordedAt,
        occurredAt: event.occurredAt,
        skuId: event.skuId,
        fromBinId: event.fromBinId,
        toBinId: event.toBinId,
        quantity,
        batchRefs: event.batchRef === null ? [] : [event.batchRef],
        serialCount: event.serialRef === null ? 0 : 1,
        actorUserId: event.actorUserId,
        reasonCode: event.referenceDoc?.reasonCode ?? null,
        note: event.referenceDoc?.note ?? null,
      });
    } else {
      byMove.set(moveId, {
        ...existing,
        quantity: existing.quantity + quantity,
        batchRefs: event.batchRef === null || existing.batchRefs.includes(event.batchRef) ? existing.batchRefs : [...existing.batchRefs, event.batchRef],
        serialCount: existing.serialCount + (event.serialRef === null ? 0 : 1),
      });
    }
  }
  return order.map((id) => byMove.get(id)!);
}

/** The move an event belongs to (its own id when it carries no moveId). */
export function moveIdOf(event: Pick<LedgerEventDto, 'id' | 'referenceDoc'>): string {
  return event.referenceDoc?.moveId ?? event.id;
}

/** A page's events without the leading run of one move (the previous page finished it). */
function dropLeadingMove(items: readonly LedgerEventDto[], moveId: string | null): readonly LedgerEventDto[] {
  if (moveId === null) return items;
  let start = 0;
  while (start < items.length && moveIdOf(items[start]!) === moveId) start++;
  return items.slice(start);
}

/** The most extra pages one move page reads to finish its last move (a 500-serial move at 50 per page is 10). */
export const MAX_MOVE_PAGE_HOPS = 20;

/**
 * One page of the recent moves with WHOLE moves only: a serial move's events
 * can straddle the ledger's page boundary, so the page's last move is read on
 * into the following pages until its moveId changes (its events appended),
 * and the next page skips the leading events of the move this page finished.
 * The cursors are the server's own, passed back verbatim (guide §1.6): the
 * returned `nextCursor` is the cursor of the page where the last move ended
 * (that page is read again, `skipMoveId` dropping its head), or of the page
 * after it when the move ended exactly on a boundary.
 */
export async function readMovePage(
  fetchPage: (cursor: string | null) => Promise<{ items: readonly LedgerEventDto[]; nextCursor?: string | null }>,
  cursor: string | null,
  skipMoveId: string | null,
): Promise<{ items: readonly LedgerEventDto[]; nextCursor: string | null; trailingMoveId: string | null }> {
  let page = await fetchPage(cursor);
  let items = dropLeadingMove(page.items, skipMoveId);
  let next = page.nextCursor ?? null;
  // A page wholly the previous move's tail: read on.
  for (let hop = 0; items.length === 0 && next !== null && hop < MAX_MOVE_PAGE_HOPS; hop++) {
    page = await fetchPage(next);
    items = dropLeadingMove(page.items, skipMoveId);
    next = page.nextCursor ?? null;
  }
  const result = [...items];
  const last = result.length === 0 ? null : moveIdOf(result[result.length - 1]!);
  for (let hop = 0; last !== null && next !== null && hop < MAX_MOVE_PAGE_HOPS; hop++) {
    const following = await fetchPage(next);
    const lead: LedgerEventDto[] = [];
    for (const event of following.items) {
      if (moveIdOf(event) !== last) break;
      lead.push(event);
    }
    result.push(...lead);
    if (lead.length < following.items.length) break; // the move ended inside this page: it is the next page, read again
    next = following.nextCursor ?? null;
  }
  return { items: result, nextCursor: next, trailingMoveId: last };
}

/** The batch cell: each batch's code when the caller resolved it, else its short id; "—" with none. */
export function moveBatchLabel(move: Pick<RecentMove, 'batchRefs' | 'serialCount'>, batchCode: (batchId: string) => string | null): string {
  const parts = move.batchRefs.map((id) => batchCode(id) ?? id.slice(-8));
  if (move.serialCount > 0) parts.push(`${move.serialCount} serial${move.serialCount === 1 ? '' : 's'}`);
  return parts.length === 0 ? '—' : parts.join(' · ');
}

/** The reason cell: the reason in words, then the note in quotes. */
export function moveReasonCell(move: Pick<RecentMove, 'reasonCode' | 'note'>): string {
  const reason = moveReasonLabel(move.reasonCode);
  return move.note === null ? reason : `${reason} — “${move.note}”`;
}
