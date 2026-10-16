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
  CreateReturnAuthorizationDto,
  ReturnableLineDto,
  ReturnAuthorizationDto,
  ReturnAuthorizationLineInputDto,
  ReturnReceiptLineViewDto,
  ReturnReceiptViewDto,
  ReturnSerialDto,
} from '@/lib/api/generated';
import { formatQuantity, parseQuantityInput, quantityLabel, type QuantityUom } from '@/lib/format-quantity';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';

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
 * Story 13-2 — the badge on a line with received units: amber, word-first,
 * never glyph-only (UX: lowest in badge ordering). 13-2 never clears it —
 * 13-3's disposition does.
 */
export const AWAITING_DISPOSITION_BADGE = '↩ Awaiting disposition';

/** A line shows the awaiting badge once any of its units were received. */
export function lineAwaitsDisposition(line: Pick<ReturnAuthorizationDto['lines'][number], 'receivedQty'>): boolean {
  return line.receivedQty > 0;
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

/** The order column: its channel reference, else the order id as the Outbound list shows it. */
export function returnOrderLabel(rma: Pick<ReturnAuthorizationDto, 'orderReference' | 'orderId'>): string {
  return rma.orderReference ?? rma.orderId;
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
