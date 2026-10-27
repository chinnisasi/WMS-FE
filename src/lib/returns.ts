/**
 * Story 13-1 — return authorizations (RMAs) on the web: the pure half of the
 * order detail's "Create return" form and the /returns page — the status and
 * reason words, the kit grouping of the returnable read, the draft parser,
 * the serial filter, the list's cells, and the refusal mapper.
 *
 * Pure: no React, no fetch — every sentence and derivation is pinned by
 * `returns.test.ts` (a claim left in JSX is a claim nothing can pin).
 */
import { ApiProblem } from '@/lib/api/client';
import type {
  AwaitingDispositionDto,
  BinResponse,
  CreateReturnAuthorizationDto,
  DisposeReturnDto,
  ReturnableLineDto,
  ReturnAuthorizationDto,
  ReturnAuthorizationLineInputDto,
  ReturnDispositionResultDto,
  ReturnReceiptLineViewDto,
  ReturnReceiptViewDto,
  ReturnSerialDto,
  SkuResponse,
} from '@/lib/api/generated';
import { formatQuantity, parseQuantityInput, quantityLabel, type QuantityUom } from '@/lib/format-quantity';
import { moveTargetBins } from '@/lib/moves';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import { CLIENT_DEPARTED_REASON } from '@/lib/client-departed';
import { shortOrderId } from '@/lib/orders';
import type { UserRole } from '@/lib/users';

/**
 * Fired on `window` after a return mutation (create, cancel) so every returns
 * reader refetches. Its own event — never `OUTBOUND_CHANGED_EVENT`, which
 * returns the orders table to page one and would collapse the very order the
 * viewer just authorized a return on.
 */
export const RETURNS_CHANGED_EVENT = 'wms-returns-changed';

export function notifyReturnsChanged(): void {
  window.dispatchEvent(new Event(RETURNS_CHANGED_EVENT));
}

export type ReturnStatus = ReturnAuthorizationDto['status'];
export type ReturnReasonCode = ReturnAuthorizationDto['lines'][number]['reasonCode'];

/** The backend's bounds, mirrored (`return-authorization.command.ts`). */
export const MAX_RETURN_LINES = 200;
export const MAX_RETURN_SERIALS_PER_LINE = 500;
/** The backend's `MAX_RMA_SERIALS_PER_REQUEST` — serials named across every line of one return. */
export const MAX_RETURN_SERIALS_PER_REQUEST = 500;
export const MAX_RETURN_NOTE_LENGTH = 500;
export const MAX_RETURN_EXTERNAL_REFERENCE_LENGTH = 64;

/** Word-first status — a `Record` over the generated union, so a new status fails the compile until named. */
export const RETURN_STATUS_LABEL: Readonly<Record<ReturnStatus, string>> = {
  open: 'Open',
  // Story 13-2 — some units received, some still expected / every line received.
  partially_received: 'Partly received',
  received: 'Received',
  cancelled: 'Cancelled',
};

/** Story 13-2 — the inspection grade (human decision 1), in words; a `Record` over the generated union. */
export type ReturnCondition = ReturnReceiptLineViewDto['condition'];
export const RETURN_CONDITION_LABEL: Readonly<Record<ReturnCondition, string>> = {
  resaleable: 'Resaleable',
  opened: 'Opened',
  damaged: 'Damaged',
  'missing-parts': 'Missing parts',
};

/**
 * Story 13-2 — the badge on a line with received units still undecided:
 * amber, word-first, never glyph-only (UX: lowest in badge ordering).
 */
export const AWAITING_DISPOSITION_BADGE = '↩ Awaiting disposition';

/** Story 4-7a — the badge once every received unit of the line is decided (restocked, scrapped or out of a settled hold). */
export const DISPOSITIONED_BADGE = '✓ Dispositioned';

/** The badge state of one RMA line: nothing received, something still undecided, or everything decided. */
export type LineDispositionState = 'none' | 'awaiting' | 'dispositioned';

type ReceiptLineSplit = Pick<
  ReturnReceiptLineViewDto,
  'rmaLineId' | 'qty' | 'openQty' | 'restockedQty' | 'scrappedQty' | 'onHoldQty' | 'failedInspectionQty'
>;

/** One RMA line's received units across its receipts, split by what became of them (base units). */
export interface LineDispositionSplit {
  readonly received: number;
  readonly open: number;
  readonly restocked: number;
  readonly onHold: number;
  readonly failedInspection: number;
  readonly scrapped: number;
}

/** A figure an older payload did not carry reads as undecided — never as a silent 0 (A7: a stale badge must not claim "Dispositioned"). */
function figure(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Story 4-7a (A7) — the receipts' lines of one RMA line summed. The RMA
 * detail is a stored snapshot (no field on its lines changes), so the split
 * is read from the detail's `receipts[].lines`, grouped by `rmaLineId`.
 * Null when nothing of the line was received.
 */
export function lineDispositionSplit(
  rmaLineId: string,
  receipts: readonly { readonly lines: readonly ReceiptLineSplit[] }[],
): (LineDispositionSplit & { readonly undecided: boolean }) | null {
  const lines = receipts.flatMap((receipt) => receipt.lines).filter((line) => line.rmaLineId === rmaLineId);
  if (lines.length === 0) return null;
  let undecided = false;
  const sum = { received: 0, open: 0, restocked: 0, onHold: 0, failedInspection: 0, scrapped: 0 };
  for (const line of lines) {
    const open = figure(line.openQty);
    const onHold = figure(line.onHoldQty);
    if (open === null || onHold === null || open > 0 || onHold > 0) undecided = true;
    sum.received += line.qty;
    sum.open += open ?? 0;
    sum.onHold += onHold ?? 0;
    sum.restocked += figure(line.restockedQty) ?? 0;
    sum.scrapped += figure(line.scrappedQty) ?? 0;
    sum.failedInspection += figure(line.failedInspectionQty) ?? 0;
  }
  return { ...sum, undecided };
}

/**
 * Story 4-7a (A7) — an RMA line awaits a disposition when any of its receipt
 * lines still has units open or on an unsettled return hold; it is
 * "Dispositioned" when everything received is decided; "none" before
 * anything is received.
 */
export function lineDispositionState(
  rmaLineId: string,
  receipts: readonly { readonly lines: readonly ReceiptLineSplit[] }[],
): LineDispositionState {
  const split = lineDispositionSplit(rmaLineId, receipts);
  if (split === null) return 'none';
  return split.undecided ? 'awaiting' : 'dispositioned';
}

/** The awaiting badge's rule (A7): true while any received unit of the line is open or on hold. */
export function lineAwaitsDisposition(
  rmaLineId: string,
  receipts: readonly { readonly lines: readonly ReceiptLineSplit[] }[],
): boolean {
  return lineDispositionState(rmaLineId, receipts) === 'awaiting';
}

/**
 * The split in words, only its non-zero parts, in the order of the work:
 * "2 restocked · 1 on hold · 1 failed inspection · 1 scrapped · 1 awaiting".
 * Null when nothing was decided yet (the badge already says so).
 */
export function lineDispositionText(split: LineDispositionSplit, uom: QuantityUom | null): string | null {
  const q = (value: number) => (uom === null ? String(value) : formatQuantity(value, uom.uomPrecision));
  const parts: string[] = [];
  if (split.restocked > 0) parts.push(`${q(split.restocked)} restocked`);
  if (split.onHold > 0) parts.push(`${q(split.onHold)} on hold`);
  if (split.failedInspection > 0) parts.push(`${q(split.failedInspection)} failed inspection`);
  if (split.scrapped > 0) parts.push(`${q(split.scrapped)} scrapped`);
  if (parts.length === 0) return null;
  if (split.open > 0) parts.push(`${q(split.open)} awaiting`);
  return parts.join(' · ');
}

/**
 * A line's received figure in its unit at its precision: "1 of 2 pcs
 * received" (the `quantityLabel` the authorized figure uses; "units" when the
 * SKU is unknown).
 */
export function receivedOfAuthorized(
  line: Pick<ReturnAuthorizationDto['lines'][number], 'receivedQty' | 'authorizedQty'>,
  uom: QuantityUom | null,
): string {
  const authorized = quantityLabel(line.authorizedQty, uom);
  const received = uom === null ? String(line.receivedQty) : formatQuantity(line.receivedQty, uom.uomPrecision);
  return `${received} of ${authorized} received`;
}

/** A receipt's heading: code · operator (or "unknown operator"). The time is formatted by the view. */
export function receiptHeading(receipt: Pick<ReturnReceiptViewDto, 'code' | 'operatorEmail'>): string {
  return `${receipt.code} · ${receipt.operatorEmail ?? 'unknown operator'}`;
}

/**
 * One received line in words: `<qty> × <condition>`, then the captures it
 * carried (batch, serial, case weight in kg) and the inspector's note.
 */
export function receiptLineText(line: ReturnReceiptLineViewDto): string {
  const parts = [`${line.qty} × ${RETURN_CONDITION_LABEL[line.condition]}`];
  if (line.batchCode !== null) parts.push(`batch ${line.batchCode}`);
  if (line.serialNumber !== null) parts.push(`serial ${line.serialNumber}`);
  if (line.weightGrams !== null) parts.push(`${(line.weightGrams / 1000).toFixed(3)} kg`);
  if (line.note !== null) parts.push(`“${line.note}”`);
  return parts.join(' · ');
}

/** The reason list (decision 3), in words — `Record` over the generated union. */
export const RETURN_REASON_LABEL: Readonly<Record<ReturnReasonCode, string>> = {
  damaged: 'Damaged',
  defective: 'Defective',
  'wrong-item': 'Wrong item',
  'not-as-described': 'Not as described',
  'changed-mind': 'Changed mind',
  other: 'Other (say why)',
};

export const RETURN_REASON_OPTIONS: readonly { value: ReturnReasonCode; label: string }[] = (
  Object.keys(RETURN_REASON_LABEL) as ReturnReasonCode[]
).map((value) => ({ value, label: RETURN_REASON_LABEL[value] }));

/**
 * Only an open authorization can be cancelled (else 409 `rma-transition-invalid`).
 * Story 13-2: an RMA with anything received is `partially_received` or
 * `received`, never `open` — so Cancel hides once anything is received.
 */
export function canCancelReturn(status: ReturnStatus): boolean {
  return status === 'open';
}

/** Create return is offered only on a dispatched order. */
export function canCreateReturn(orderStatus: string): boolean {
  return orderStatus === 'dispatched';
}

// ── the returnable read, grouped ─────────────────────────────────────────────

export interface ReturnableGroup {
  readonly line: ReturnableLineDto;
  /** A kit parent's component lines; empty for a plain line. */
  readonly children: readonly ReturnableLineDto[];
}

/** Parent-over-children, the order detail's own grouping (`groupKitLines`). */
export function groupReturnableLines(lines: readonly ReturnableLineDto[]): readonly ReturnableGroup[] {
  const ids = new Set(lines.map((line) => line.orderLineId));
  const children = new Map<string, ReturnableLineDto[]>();
  for (const line of lines) {
    if (line.parentLineId !== null && ids.has(line.parentLineId)) {
      const list = children.get(line.parentLineId) ?? [];
      list.push(line);
      children.set(line.parentLineId, list);
    }
  }
  return lines
    .filter((line) => !(line.parentLineId !== null && ids.has(line.parentLineId)))
    .map((line) => ({ line, children: children.get(line.orderLineId) ?? [] }));
}

/** The serial filter box: a case-insensitive substring match on the number. */
export function filterSerials(serials: readonly ReturnSerialDto[], query: string): readonly ReturnSerialDto[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return serials;
  return serials.filter((serial) => serial.serialNumber.toLowerCase().includes(needle));
}

/**
 * "Select all" over what the filter shows, capped at the per-line limit: the
 * already-checked serials stay, the shown ones join them, up to 500.
 */
export function selectAllSerials(
  checked: readonly string[],
  shown: readonly ReturnSerialDto[],
): string[] {
  const next = [...checked];
  for (const serial of shown) {
    if (next.length >= MAX_RETURN_SERIALS_PER_LINE) break;
    if (!next.includes(serial.serialNumber)) next.push(serial.serialNumber);
  }
  return next;
}

// ── the draft ────────────────────────────────────────────────────────────────

/** One line of the create form as it holds it. */
export interface ReturnDraftLine {
  /** The typed quantity (plain lines). */
  readonly qty: string;
  /** The checked serial numbers (serial lines) — the quantity is their count. */
  readonly serials: readonly string[];
  readonly reasonCode: ReturnReasonCode | '';
  readonly reasonNote: string;
}

export const EMPTY_RETURN_LINE: ReturnDraftLine = { qty: '', serials: [], reasonCode: '', reasonNote: '' };

export interface ReturnDraft {
  readonly externalReference: string;
  /** Keyed by order line id. */
  readonly lines: Readonly<Record<string, ReturnDraftLine>>;
}

/**
 * The create body, or the first problem (nothing is sent while one stands).
 * Only lines above zero are sent; a kit parent never is. The client checks
 * only what it genuinely knows — the shape (a positive decimal, a reason, a
 * note for "other", the bounds); precision and the returnable bound are the
 * server's to refuse (the client's figure may be stale).
 */
export function parseReturnDraft(
  orderId: string,
  draft: ReturnDraft,
  lines: readonly ReturnableLineDto[],
): { body: CreateReturnAuthorizationDto | null; problem: string | null } {
  const external = draft.externalReference.trim();
  if ([...external].length > MAX_RETURN_EXTERNAL_REFERENCE_LENGTH) {
    return { body: null, problem: `The external reference is at most ${MAX_RETURN_EXTERNAL_REFERENCE_LENGTH} characters.` };
  }
  const body: ReturnAuthorizationLineInputDto[] = [];
  for (const line of lines) {
    if (line.kitParent) continue;
    const entry = draft.lines[line.orderLineId];
    if (entry === undefined) continue;
    let qty: number;
    let serialNumbers: string[] | undefined;
    if (line.serialTracked) {
      if (entry.serials.length === 0) continue;
      if (entry.serials.length > MAX_RETURN_SERIALS_PER_LINE) {
        return { body: null, problem: `At most ${MAX_RETURN_SERIALS_PER_LINE} serials per line.` };
      }
      qty = entry.serials.length;
      serialNumbers = [...entry.serials];
    } else {
      if (entry.qty.trim() === '') continue;
      const parsed = parseQuantityInput(entry.qty);
      if (parsed === null) return { body: null, problem: 'Every quantity is a decimal — or leave it blank.' };
      if (parsed === 0) continue;
      qty = parsed;
    }
    if (entry.reasonCode === '') return { body: null, problem: 'Every returned line needs a reason.' };
    const note = entry.reasonNote.trim();
    if (entry.reasonCode === 'other' && note === '') {
      return { body: null, problem: 'A line returned for "Other" needs a note saying why.' };
    }
    if ([...note].length > MAX_RETURN_NOTE_LENGTH) {
      return { body: null, problem: `A note is at most ${MAX_RETURN_NOTE_LENGTH} characters.` };
    }
    body.push({
      orderLineId: line.orderLineId,
      qty,
      reasonCode: entry.reasonCode,
      // Blank stays ABSENT, never `''`.
      ...(note === '' ? {} : { reasonNote: note }),
      ...(serialNumbers === undefined ? {} : { serialNumbers }),
    });
  }
  if (body.length === 0) return { body: null, problem: 'Enter a quantity above zero on at least one line.' };
  const serialTotal = body.reduce((total, line) => total + (line.serialNumbers?.length ?? 0), 0);
  if (serialTotal > MAX_RETURN_SERIALS_PER_REQUEST) {
    return { body: null, problem: `A return names at most ${MAX_RETURN_SERIALS_PER_REQUEST} serials in all — split it.` };
  }
  if (body.length > MAX_RETURN_LINES) return { body: null, problem: `A return carries at most ${MAX_RETURN_LINES} lines.` };
  return {
    body: { orderId, ...(external === '' ? {} : { externalReference: external }), lines: body },
    problem: null,
  };
}

/**
 * The draft as the CURRENT returnable read allows it: a serial line keeps
 * only serials still returnable (a refused or now-authorized one is dropped,
 * never hidden-but-counted), and a line with nothing left to return — or no
 * longer on the read, or a kit parent — is dropped. Applied whenever the read
 * changes (after a 409 reload), so a stale draft cannot resend the refusal
 * forever. Idempotent.
 */
export function pruneReturnDraft(draft: ReturnDraft, lines: readonly ReturnableLineDto[]): ReturnDraft {
  const byId = new Map(lines.map((line) => [line.orderLineId, line]));
  const next: Record<string, ReturnDraftLine> = {};
  let changed = false;
  for (const [orderLineId, entry] of Object.entries(draft.lines)) {
    const line = byId.get(orderLineId);
    if (line === undefined || line.kitParent || line.returnableQty === 0) {
      changed = true;
      continue;
    }
    if (line.serialTracked) {
      const allowed = new Set(line.returnableSerials.map((serial) => serial.serialNumber));
      const serials = entry.serials.filter((number) => allowed.has(number));
      if (serials.length !== entry.serials.length) {
        changed = true;
        next[orderLineId] = { ...entry, serials };
        continue;
      }
    }
    next[orderLineId] = entry;
  }
  return changed ? { ...draft, lines: next } : draft;
}

/** The success sentence, built from the RESPONSE. */
export function returnCreatedWord(rma: Pick<ReturnAuthorizationDto, 'code'>): string {
  return `Return ${rma.code} created`;
}

/** The success banner's second line, beside the link to /returns. */
export const RETURN_CREATED_REASON = 'Expected back — it waits on the Returns page until it is received.';

/** A cancel reason: 1–500 characters once trimmed (the backend's rule). */
export function parseCancelReason(reason: string): { reason: string | null; problem: string | null } {
  const trimmed = reason.trim();
  const length = [...trimmed].length;
  if (length === 0) return { reason: null, problem: 'Say why — a reason is required.' };
  if (length > MAX_RETURN_NOTE_LENGTH) return { reason: null, problem: `A reason is at most ${MAX_RETURN_NOTE_LENGTH} characters.` };
  return { reason: trimmed, problem: null };
}

// ── the list's cells ─────────────────────────────────────────────────────────

/**
 * The order column: the RMA's stored order reference (story 4-1b: the
 * client's order number, else the channel's reference), else the order id's
 * short form — the label rule's fallback, as the Outbound list shows it.
 */
export function returnOrderLabel(rma: Pick<ReturnAuthorizationDto, 'orderReference' | 'orderId'>): string {
  return rma.orderReference ?? shortOrderId(rma.orderId);
}

/**
 * The lines summary: how many lines and how many SKUs — never a summed
 * quantity, which across different UoMs (`kg` beside `each`) means nothing.
 * The per-line quantities, each in its own unit, are in the expanded row.
 */
export function returnLinesSummary(rma: Pick<ReturnAuthorizationDto, 'lines'>): string {
  const lines = rma.lines.length;
  const skus = new Set(rma.lines.map((line) => line.skuId)).size;
  return `${lines} line${lines === 1 ? '' : 's'} · ${skus} SKU${skus === 1 ? '' : 's'}`;
}

/** A line's reason in words, with its note. */
export function returnReasonText(line: Pick<ReturnAuthorizationDto['lines'][number], 'reasonCode' | 'reasonNote'>): string {
  const word = line.reasonCode === 'other' ? 'Other' : RETURN_REASON_LABEL[line.reasonCode];
  return line.reasonNote === null ? word : `${word} — ${line.reasonNote}`;
}

// ── refusals ─────────────────────────────────────────────────────────────────

/** The refusals after which the form reloads the returnable read and clears its key. */
export function refreshesReturnable(error: unknown): boolean {
  return (
    error instanceof ApiProblem &&
    (error.code === 'exceeds-returnable' || error.code === 'serial-not-dispatched' || error.code === 'serial-already-authorized')
  );
}

/** A cancel refused 409 means the row moved (cancelled elsewhere, units received): the list re-reads. */
export function cancelRefusalReloads(error: unknown): boolean {
  return error instanceof ApiProblem && error.status === 409;
}

/** The cancel's banner, built from the RESPONSE. */
export function returnCancelledOutcome(rma: Pick<ReturnAuthorizationDto, 'code'>): { word: string; reason: string } {
  return { word: `Return ${rma.code} cancelled`, reason: 'Its units can be authorized for return again.' };
}

/** The returns refusals, branching on the problem `code` — never on prose. */
export function returnReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'role-denied':
        return "You can't manage returns";
      case 'not-found':
        return 'Order or return not found';
      // Story 1-2a — the client has departed (it takes no new work).
      case 'client-departed':
        return CLIENT_DEPARTED_REASON;
      case 'order-not-dispatched':
        return 'Only a dispatched order can be returned';
      case 'line-not-of-order':
        return "That line isn't on this order";
      case 'kit-parent-not-returnable':
        return "Return the kit's components";
      case 'exceeds-returnable': {
        const left = error.extensions.returnableQty;
        return typeof left === 'number' ? `More than can be returned — ${left} left` : 'More than can be returned';
      }
      case 'serial-not-dispatched': {
        const serial = error.extensions.serialNumber;
        return typeof serial === 'string' ? `Serial ${serial} wasn't dispatched on this line` : "A serial wasn't dispatched on this line";
      }
      case 'serial-already-authorized': {
        const serial = error.extensions.serialNumber;
        return typeof serial === 'string' ? `Serial ${serial} is already on a return` : 'A serial is already on a return';
      }
      case 'rma-transition-invalid':
        return 'This return can no longer be cancelled';
      case 'validation-failed':
        return error.detail ?? 'Check the return and try again.';
      case 'permission-denied':
        return 'Your session belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed with different details — refresh and try again.';
      case 'conflict':
        return 'The same submission is still in flight — retry to read the settled result.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      default:
        return error.detail ?? `The return was not saved (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

// ── story 4-7a: the disposition of received returns ──────────────────────────

/**
 * Fired on `window` after a successful disposition, BESIDE
 * `RETURNS_CHANGED_EVENT`: the Returns page bumps its disposition epoch on
 * it, which joins an expanded RMA's detail refetch deps (A7) — a disposition
 * moves neither the RMA's status nor its received figures, so nothing else
 * would make the detail read again.
 */
export const RETURNS_DISPOSED_EVENT = 'wms-returns-disposed';

/** Tells every returns reader a disposition landed: the queue, the list and the open detail all re-read. */
export function notifyReturnsDisposed(): void {
  window.dispatchEvent(new Event(RETURNS_DISPOSED_EVENT));
  notifyReturnsChanged();
}

export type DispositionOutcome = DisposeReturnDto['outcome'];
export type DispositionReasonCode = NonNullable<DisposeReturnDto['reasonCode']>;
/** One row of the awaiting-disposition queue. */
export type AwaitingReturnLine = AwaitingDispositionDto;

/** The backend's bound on a quarantine or scrap note (`return-disposition.command.ts`). */
export const MAX_DISPOSITION_NOTE_LENGTH = 200;

/** The three outcomes, in words — a `Record` over the generated union, so a fourth fails the compile until named. */
export const DISPOSITION_OUTCOME_LABEL: Readonly<Record<DispositionOutcome, string>> = {
  restock: 'Restock',
  quarantine: 'Quarantine',
  scrap: 'Scrap',
};

/** What each outcome does, one line under its choice. */
export const DISPOSITION_OUTCOME_HINT: Readonly<Record<DispositionOutcome, string>> = {
  restock: 'Back on a storage shelf, sellable again.',
  quarantine: 'Held on the QC desk for a closer look — released units come back here.',
  scrap: 'Written off — the units leave stock for good.',
};

/** The display order of the outcomes (an allowlist — never "everything but"). */
export const DISPOSITION_OUTCOMES: readonly DispositionOutcome[] = ['restock', 'quarantine', 'scrap'];

/** The quarantine and scrap reasons (decision 7), in words — a `Record` over the generated union. */
export const DISPOSITION_REASON_LABEL: Readonly<Record<DispositionReasonCode, string>> = {
  damaged: 'Damaged',
  defective: 'Defective',
  expired: 'Expired',
  'missing-parts': 'Missing parts',
  contaminated: 'Contaminated',
  'needs-inspection': 'Needs inspection',
  'client-instruction': 'Client instruction',
  other: 'Other (say why)',
};

export const DISPOSITION_REASON_OPTIONS: readonly { value: DispositionReasonCode; label: string }[] = (
  Object.keys(DISPOSITION_REASON_LABEL) as DispositionReasonCode[]
).map((value) => ({ value, label: DISPOSITION_REASON_LABEL[value] }));

/** A stored reason code in words; one the generated union does not know reads as itself (a newer backend's). */
export function dispositionReasonWord(code: string | null): string | null {
  if (code === null) return null;
  if (code === 'other') return 'Other';
  return Object.hasOwn(DISPOSITION_REASON_LABEL, code) ? DISPOSITION_REASON_LABEL[code as DispositionReasonCode] : code;
}

/** A serial unit or a returned case (catch weight) is one indivisible unit: disposed whole, qty 1. */
export function disposedWhole(line: Pick<AwaitingReturnLine, 'serialNumber' | 'weightGrams'>): boolean {
  return line.serialNumber !== null || line.weightGrams !== null;
}

/**
 * Why Quarantine is not offered on this line, or null: a QC hold cannot carry
 * a serial or a returned case yet (2-8a decision 1), so the server refuses
 * it (409 `disposition-not-supported`) — the choice is disabled with this
 * sentence instead.
 */
export function quarantineUnavailable(line: Pick<AwaitingReturnLine, 'serialNumber' | 'weightGrams'>): string | null {
  if (line.serialNumber !== null) return "A serial unit can't be quarantined yet — QC holds don't carry serials. Restock or scrap it.";
  if (line.weightGrams !== null) return "A returned case can't be quarantined yet — QC holds don't carry cases. Restock or scrap it.";
  return null;
}

/** A quantity of the line's unit: at the SKU's precision when the catalog row is known, else as sent. */
export function dispositionQuantity(qty: number, uom: string, precision: number | null): string {
  return `${precision === null ? String(qty) : formatQuantity(qty, precision)} ${uom}`;
}

/** What the unit carried in: "batch B1 · serial SN-1 · 2.340 kg", or "—". */
export function awaitingCaptureText(line: Pick<AwaitingReturnLine, 'batchCode' | 'serialNumber' | 'weightGrams'>): string {
  const parts: string[] = [];
  if (line.batchCode !== null) parts.push(`batch ${line.batchCode}`);
  if (line.serialNumber !== null) parts.push(`serial ${line.serialNumber}`);
  if (line.weightGrams !== null) parts.push(`${(line.weightGrams / 1000).toFixed(3)} kg`);
  return parts.length === 0 ? '—' : parts.join(' · ');
}

/** A line waiting this many days or more is flagged (amber, word-first) — exceptions first. */
export const RETURN_AGE_ATTENTION_DAYS = 7;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** How long the unit has waited since it was received: "Just now", "40 min", "5 h", "1 day", "12 days". */
export function returnAgeLabel(receivedAt: string, nowMs: number): string {
  const at = Date.parse(receivedAt);
  if (Number.isNaN(at)) return '—';
  const elapsed = Math.max(0, nowMs - at);
  if (elapsed < MINUTE) return 'Just now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h`;
  const days = Math.floor(elapsed / DAY);
  return days === 1 ? '1 day' : `${days} days`;
}

/** True once a line has waited `RETURN_AGE_ATTENTION_DAYS` or more. */
export function returnAgeNeedsAttention(receivedAt: string, nowMs: number): boolean {
  const at = Date.parse(receivedAt);
  return !Number.isNaN(at) && nowMs - at >= RETURN_AGE_ATTENTION_DAYS * DAY;
}

/**
 * The line's history (A14): "Quarantined 2× · last: Damaged", "Last: Expired"
 * (a part already scrapped with a reason, never quarantined), or null for a
 * line nothing was decided on yet.
 */
export function dispositionHistoryText(line: Pick<AwaitingReturnLine, 'priorQuarantines' | 'lastReasonCode'>): string | null {
  const last = dispositionReasonWord(line.lastReasonCode);
  if (line.priorQuarantines > 0) {
    const count = `Quarantined ${line.priorQuarantines}×`;
    return last === null ? count : `${count} · last: ${last}`;
  }
  return last === null ? null : `Last: ${last}`;
}

/**
 * The storage bins a restock may target: the move rules (not system, not
 * retired, not blocked, a class that suits the SKU, a secure bin only for a
 * role holding `secure.move`) plus — even when the SKU's catalog row is not
 * known — never a bin dedicated to another client than the line's.
 * Capacity, segregation, bulk occupancy and a quarantine stay the server's
 * (409 with the gate's own code). Sorted by code.
 */
export function restockTargetBins(
  bins: readonly BinResponse[],
  sku: Pick<SkuResponse, 'storageClass' | 'clientId'> | null,
  clientId: string,
  role: UserRole | undefined,
): readonly BinResponse[] {
  return moveTargetBins(bins, null, sku, role).filter((bin) => bin.dedicatedClientId === null || bin.dedicatedClientId === clientId);
}

/** One disposition as the panel holds it. */
export interface DispositionDraft {
  readonly outcome: DispositionOutcome | '';
  /** The typed quantity (ignored on a whole unit: always 1). */
  readonly qty: string;
  readonly toBinId: string;
  readonly reasonCode: DispositionReasonCode | '';
  readonly note: string;
}

/** A fresh draft: no outcome yet, the whole open quantity pre-filled. */
export function emptyDispositionDraft(line: Pick<AwaitingReturnLine, 'openQty'>, precision: number | null): DispositionDraft {
  return {
    outcome: '',
    qty: precision === null ? String(line.openQty) : formatQuantity(line.openQty, precision),
    toBinId: '',
    reasonCode: '',
    note: '',
  };
}

/**
 * The disposition body, or the first problem (nothing is sent while one
 * stands). A restock names a bin and never a reason or note; a quarantine or
 * scrap names a reason (and a note for "Other") and never a bin — the
 * server's shape, so a body this sends is never a 400 for it. A serial unit
 * or a returned case is disposed whole (qty 1). The quantity is never
 * rounded: finer than the unit allows is refused here when the SKU's
 * precision is known, else by the server.
 */
export function parseDisposition(
  draft: DispositionDraft,
  line: AwaitingReturnLine,
  warehouseId: string,
  precision: number | null,
): { body: DisposeReturnDto | null; problem: string | null } {
  if (draft.outcome === '') return { body: null, problem: 'Choose what happens to these units — restock, quarantine or scrap.' };
  let qty: number;
  if (disposedWhole(line)) {
    qty = line.openQty;
  } else {
    const raw = draft.qty.trim();
    const parsed = parseQuantityInput(raw);
    if (parsed === null || parsed <= 0) return { body: null, problem: 'Enter a quantity greater than zero.' };
    const places = raw.split('.')[1]?.length ?? 0;
    if (precision !== null && places > precision) {
      const allowed = precision === 0 ? 'whole numbers only' : `at most ${precision} decimal place${precision === 1 ? '' : 's'}`;
      return { body: null, problem: `${line.skuCode} is counted in ${line.uom} — ${allowed} (got ${raw}).` };
    }
    if (parsed > line.openQty) {
      return { body: null, problem: `Only ${dispositionQuantity(line.openQty, line.uom, precision)} still await a decision on this line.` };
    }
    qty = parsed;
  }
  const base = { warehouseId, receiptLineId: line.receiptLineId, outcome: draft.outcome, qty };
  if (draft.outcome === 'restock') {
    if (draft.toBinId === '') return { body: null, problem: 'Pick the storage bin the units go to.' };
    return { body: { ...base, toBinId: draft.toBinId }, problem: null };
  }
  if (draft.outcome === 'quarantine') {
    const unavailable = quarantineUnavailable(line);
    if (unavailable !== null) return { body: null, problem: unavailable };
  }
  if (draft.reasonCode === '') {
    return { body: null, problem: draft.outcome === 'scrap' ? 'Pick why these units are scrapped.' : 'Pick why these units are quarantined.' };
  }
  const note = draft.note.trim();
  if (draft.reasonCode === 'other' && note === '') return { body: null, problem: 'The reason “Other” needs a note saying why.' };
  if ([...note].length > MAX_DISPOSITION_NOTE_LENGTH) {
    return { body: null, problem: `Keep the note to ${MAX_DISPOSITION_NOTE_LENGTH} characters.` };
  }
  return {
    // Blank stays ABSENT, never `''` or null.
    body: { ...base, reasonCode: draft.reasonCode, ...(note === '' ? {} : { note }) },
    problem: null,
  };
}

/** The submit button's words: "Restock 3 each", "Quarantine 1 each", "Scrap 2 kg…" (scrap asks to confirm first). */
export function dispositionActionLabel(outcome: DispositionOutcome | '', quantity: string | null): string {
  if (outcome === '') return 'Record decision';
  const verb = DISPOSITION_OUTCOME_LABEL[outcome];
  const what = quantity === null ? verb : `${verb} ${quantity}`;
  return outcome === 'scrap' ? `${what}…` : what;
}

/** The scrap confirmation's sentence — a write-off is the one outcome that cannot come back. */
export function scrapConfirmText(line: Pick<AwaitingReturnLine, 'skuCode' | 'rmaCode'>, quantity: string, reason: string): string {
  return `Scrap ${quantity} of ${line.skuCode} from ${line.rmaCode} (${reason})? The units are written off and leave stock — this can't be undone.`;
}

/** The success banner, built from the RESPONSE (the dispositions the server recorded). */
export function dispositionOutcome(
  result: ReturnDispositionResultDto,
  line: Pick<AwaitingReturnLine, 'skuCode' | 'uom' | 'rmaCode'>,
  binLabel: string | null,
  precision: number | null,
): { word: string; reason: string } {
  const total = result.dispositions.reduce((sum, entry) => sum + entry.qty, 0);
  const quantity = dispositionQuantity(total, line.uom, precision);
  const outcome = result.dispositions[0]?.outcome;
  switch (outcome) {
    case 'restock':
      return {
        word: `Restocked ${quantity} of ${line.skuCode}`,
        reason: `Moved from the Returns bin to ${binLabel ?? 'the storage bin'} (${line.rmaCode}).`,
      };
    case 'quarantine':
      return {
        word: `Quarantined ${quantity} of ${line.skuCode}`,
        reason: `Held on the QC desk (Inbound → QC holds) — release or inspect it there; released units come back to this queue (${line.rmaCode}).`,
      };
    case 'scrap':
      return {
        word: `Scrapped ${quantity} of ${line.skuCode}`,
        reason: `Written off from the Returns bin — the client sees it in their portal (${line.rmaCode}).`,
      };
    default:
      return { word: 'Decision recorded', reason: `${line.skuCode} · ${line.rmaCode}` };
  }
}

/** The refusals after which the queue re-reads and the draft's key is dropped: the line itself moved on. */
export function dispositionRefusalReloads(error: unknown): boolean {
  return (
    error instanceof ApiProblem &&
    (error.code === 'exceeds-awaiting' ||
      error.code === 'not-found' ||
      error.code === 'document-warehouse-mismatch' ||
      error.code === 'disposition-not-supported')
  );
}

function extensionNumber(error: ApiProblem, key: string): number | null {
  const value = error.extensions[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The disposition refusals in words — branching on the problem `code`, never on prose. */
export function dispositionReason(error: unknown, uom: string | null = null): string {
  if (error instanceof ApiProblem) {
    const unit = uom === null ? '' : ` ${uom}`;
    switch (error.code) {
      case 'exceeds-awaiting': {
        const left = extensionNumber(error, 'awaitingQty');
        return left === null
          ? 'More than this line still awaits — the queue has refreshed.'
          : `Only ${left}${unit} still await a decision on this line — the queue has refreshed.`;
      }
      case 'scrap-above-threshold': {
        const threshold = extensionNumber(error, 'threshold');
        return threshold === null
          ? 'Above your write-off threshold — scrap fewer at a time or raise the threshold in the adjustment policy.'
          : `Above your write-off threshold of ${threshold}${unit} — scrap at most ${threshold}${unit} at a time or raise the threshold in the adjustment policy.`;
      }
      case 'disposition-not-supported':
        return "A serial unit or a returned case can't be quarantined — restock or scrap it.";
      case 'batch-expired':
        return "This batch has expired, so it can't go back on a shelf — quarantine or scrap it.";
      case 'batch-blocked':
        return "This batch is blocked, so it can't be restocked — quarantine or scrap it, or unblock the batch on Inventory → Batches.";
      case 'disposition-scope-quarantined':
        return 'The Returns bin or the target bin is under a reconcile quarantine — nothing moves there until it is resolved.';
      case 'document-warehouse-mismatch':
        return 'This return was received in another warehouse — switch to that warehouse to decide it.';
      case 'bin-retired':
        return 'That bin is retired — pick another.';
      case 'bin-blocked':
        return 'That bin is blocked — pick another.';
      case 'bin-full':
      case 'bin-overweight':
      case 'bin-volume-exceeded':
      case 'bin-item-oversize':
        return error.detail ?? 'That bin has no room for this — pick another.';
      case 'bin-storage-mismatch':
        return error.detail ?? "That bin's storage class doesn't suit this SKU — pick another.";
      case 'bin-client-mismatch':
        return 'That bin is dedicated to another client — pick one of this client’s bins or a shared bin.';
      case 'bin-segregation-conflict':
        return error.detail ?? 'That bin holds goods that must be kept apart from this SKU — pick another.';
      case 'bin-occupancy-conflict':
        return error.detail ?? 'That bulk location already holds another SKU — pick another.';
      case 'not-found':
        return 'The return line or the bin no longer exists — the queue has refreshed.';
      case 'role-denied':
        return "Your role can't decide returns, or can't place stock in a secure bin.";
      case 'permission-denied':
        return 'Your session belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This decision was already sent with different details — change something and send it again.';
      case 'conflict':
        return 'The same decision is still being processed — try again to read the result.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the decision and try again.';
      default:
        return error.detail ?? `Not recorded (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}
