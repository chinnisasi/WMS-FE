/**
 * Story 21-6 — advance shipment notices on the web: the pure half of the
 * Inbound surface's ASN card (status words, which transitions a row offers,
 * the create / amend / note parsers, the refusal mapper) and the GRN card's
 * "Document" column (a receipt books against a PO, an ASN, or neither).
 *
 * Pure: no React, no fetch — every sentence and derivation is pinned by
 * `asns.test.ts` (a claim left in JSX is a claim nothing can pin).
 */
import { ApiProblem } from '@/lib/api/client';
import type {
  AmendAsnDto,
  AsnDto,
  AsnLineInputDto,
  CreateAsnDto,
  GoodsReceiptEntryDto,
} from '@/lib/api/generated';
import { parseQuantityInput } from '@/lib/format-quantity';
import { UNREACHABLE_REASON, verbatim } from '@/lib/outbound-orders';

/** Fired on `window` after an ASN mutation so every inbound reader refetches. */
export const INBOUND_CHANGED_EVENT = 'wms-inbound-changed';

export function notifyInboundChanged(): void {
  window.dispatchEvent(new Event(INBOUND_CHANGED_EVENT));
}

export type AsnStatus = AsnDto['status'];

/** The backend's bounds, mirrored (`asn.command.ts` / `inbound.dto.ts`). */
export const MAX_ASN_LINES = 200;
export const MAX_ASN_CODE_LENGTH = 64;
export const MAX_ASN_NOTE_LENGTH = 500;

export const ASN_STATUS_LABEL: Readonly<Record<AsnStatus, string>> = {
  announced: 'Announced',
  partially_received: 'Partially received',
  received: 'Received',
  closed: 'Closed short',
  cancelled: 'Cancelled',
};

/** Amend lands only while the ASN is announced or partially received (else 409 `asn-not-open`). */
export function canAmendAsn(status: AsnStatus): boolean {
  return status === 'announced' || status === 'partially_received';
}

/** Close (short) is the partially received ASN's exit — never a received or untouched one. */
export function canCloseAsn(status: AsnStatus): boolean {
  return status === 'partially_received';
}

/** Cancel is the untouched ASN's exit — once anything is received, it closes short instead. */
export function canCancelAsn(status: AsnStatus): boolean {
  return status === 'announced';
}

/**
 * The list's progress figure: lines fully received of all lines — never the
 * unit totals, which sum across UoMs (`kg` beside `each` means nothing).
 */
export function asnProgressLabel(entry: { linesComplete: number; lineCount: number }): string {
  return `${entry.linesComplete} of ${entry.lineCount} lines received`;
}

/**
 * Story 21-7b — the minimal SKU option the draft line rows render: an id,
 * the code and name the picker shows, and the unit (with its precision, the
 * quantity step). The operator's `SkuResponse` satisfies it as is; the
 * portal maps its own `PortalSkuDto` through `portalSkuOption` (lib/portal),
 * so no operator type reaches the portal.
 */
export interface LineOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly uom: string;
  readonly uomPrecision: number;
}

/** One draft line as the forms hold it: the SKU, the typed quantity, and (amend) the line it updates. */
export interface AsnDraftLine {
  readonly id?: string;
  readonly skuId: string;
  readonly qty: string;
}

/** Turns draft rows into request lines, or names the first problem. Empty rows are dropped. */
export function parseAsnLines(draft: readonly AsnDraftLine[]): { lines: AsnLineInputDto[]; problem: string | null } {
  const filled = draft.filter((line) => line.skuId !== '' || line.qty.trim() !== '');
  if (filled.length === 0) {
    return { lines: [], problem: 'Add at least one line — a SKU and a quantity.' };
  }
  if (filled.length > MAX_ASN_LINES) {
    return { lines: [], problem: `An ASN carries at most ${MAX_ASN_LINES} lines.` };
  }
  const lines: AsnLineInputDto[] = [];
  for (const line of filled) {
    if (line.skuId === '') {
      return { lines: [], problem: 'Every line needs a SKU.' };
    }
    // The decimal-literal grammar (never `Number()`); precision is the
    // backend's to refuse, naming the unit — nothing is rounded here.
    const qty = parseQuantityInput(line.qty);
    if (qty === null || qty <= 0) {
      return { lines: [], problem: 'Every quantity is a decimal greater than zero.' };
    }
    lines.push({ ...(line.id === undefined ? {} : { id: line.id }), skuId: line.skuId, announcedQty: qty });
  }
  return { lines, problem: null };
}

/**
 * The `datetime-local` value (the viewer's local wall time) as the UTC
 * instant the API takes; blank is absent. Malformed text is a problem, never
 * a guess.
 */
export function parseExpectedAt(value: string): { expectedAt: string | null; problem: string | null } {
  const trimmed = value.trim();
  if (trimmed === '') return { expectedAt: null, problem: null };
  const instant = new Date(trimmed);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(trimmed) || Number.isNaN(instant.getTime())) {
    return { expectedAt: null, problem: 'The expected arrival is not a date and time.' };
  }
  return { expectedAt: instant.toISOString(), problem: null };
}

/** The `datetime-local` value for a stored instant (local wall time, minutes). */
export function expectedAtInputValue(instant: string | null): string {
  if (instant === null) return '';
  const date = new Date(instant);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export interface AsnCreateDraft {
  readonly clientId: string;
  readonly asnCode: string;
  readonly expectedAt: string;
  readonly lines: readonly AsnDraftLine[];
}

/** The create body, or the first problem (nothing is sent while one stands). */
export function parseAsnCreate(
  draft: AsnCreateDraft,
  warehouseId: string,
): { body: CreateAsnDto | null; problem: string | null } {
  if (draft.clientId === '') return { body: null, problem: 'Choose the client this shipment is for.' };
  const code = draft.asnCode.trim();
  if (code.length === 0 || code.length > MAX_ASN_CODE_LENGTH) {
    return { body: null, problem: `The ASN code is 1–${MAX_ASN_CODE_LENGTH} characters — the client's own reference.` };
  }
  const expected = parseExpectedAt(draft.expectedAt);
  if (expected.problem !== null) return { body: null, problem: expected.problem };
  const parsed = parseAsnLines(draft.lines);
  if (parsed.problem !== null) return { body: null, problem: parsed.problem };
  return {
    body: {
      clientId: draft.clientId,
      warehouseId,
      asnCode: code,
      // Blank stays ABSENT, never `null` or `''`.
      ...(expected.expectedAt === null ? {} : { expectedAt: expected.expectedAt }),
      lines: parsed.lines,
    },
    problem: null,
  };
}

/**
 * The amend body: the FULL line set (rows carrying an `id` update that line,
 * rows without one are new, a line left out is removed) and `expectedAt` —
 * sent ONLY when the viewer changed it (the input holds minutes, so resending
 * an untouched value would truncate the stored seconds), as `null` when
 * cleared so the server clears it too.
 */
export function parseAsnAmend(
  draft: { readonly expectedAt: string; readonly lines: readonly AsnDraftLine[] },
  storedExpectedAt: string | null,
): { body: AmendAsnDto | null; problem: string | null } {
  const changed = draft.expectedAt !== expectedAtInputValue(storedExpectedAt);
  const expected = changed ? parseExpectedAt(draft.expectedAt) : { expectedAt: null, problem: null };
  if (expected.problem !== null) return { body: null, problem: expected.problem };
  const parsed = parseAsnLines(draft.lines);
  if (parsed.problem !== null) return { body: null, problem: parsed.problem };
  return {
    body: { ...(changed ? { expectedAt: expected.expectedAt } : {}), lines: parsed.lines },
    problem: null,
  };
}

/** The amend form's starting rows: the ASN's own lines, by id. */
export function amendDraftOf(asn: Pick<AsnDto, 'lines'>): AsnDraftLine[] {
  return asn.lines.map((line) => ({ id: line.id, skuId: line.skuId, qty: String(line.announcedQty) }));
}

/** A close / cancel note: 1–500 characters once trimmed, counted in code points (the backend's rule). */
export function parseAsnNote(note: string): { note: string | null; problem: string | null } {
  const trimmed = note.trim();
  const length = [...trimmed].length;
  if (length === 0) return { note: null, problem: 'Say why — a note is required.' };
  if (length > MAX_ASN_NOTE_LENGTH) {
    return { note: null, problem: `A note is at most ${MAX_ASN_NOTE_LENGTH} characters.` };
  }
  return { note: trimmed, problem: null };
}

/** The ASN mutations' refusals, branching on the problem `code` — never on prose. */
export function asnReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'duplicate-asn-code':
        return error.detail ?? 'This client already has an ASN with that code.';
      case 'sku-client-mismatch':
      case 'mixed-client':
        return error.detail ?? "An ASN carries only its own client's SKUs.";
      case 'asn-not-open':
        return 'This ASN is no longer open (received, closed or cancelled) — refresh the list.';
      case 'asn-line-received':
        return error.detail ?? 'A line that has received stock cannot be removed, change SKU, or announce less than it received.';
      case 'asn-transition-invalid':
        // The server names the state it saw — invisible to a stale row.
        return verbatim(error);
      case 'over-receipt-pending':
        return 'An over-receipt of this ASN awaits a decision — approve or reject it in Conflicts & Reviews first.';
      case 'not-found':
        return error.detail ?? 'The ASN, a line, the client or a SKU no longer exists — refresh the page.';
      case 'role-denied':
        return 'Your role cannot manage advance shipment notices.';
      case 'permission-denied':
        return 'Your session belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed with different details — refresh and try again.';
      case 'conflict':
        return 'The same submission is still in flight — retry to read the settled result.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the ASN and try again.';
      default:
        return error.detail ?? `The ASN was not saved (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/** Blind reason codes are a fixed backend enum — surfaced in plain words. */
export const BLIND_REASON_LABEL: Readonly<Record<NonNullable<GoodsReceiptEntryDto['blindReasonCode']>, string>> = {
  'unannounced-delivery': 'Unannounced delivery',
  'po-not-found': 'PO not found',
  other: 'Other',
};

/**
 * The GRN card's "Document" column: a receipt books against exactly one of
 * a PO, an ASN, or neither (blind, with its reason). The PO's code is
 * resolved by the caller (`poCode`, null while unknown); the ASN's rides the
 * row. A row with neither and no reason cannot exist (0064's CHECK).
 */
export function grnDocument(
  grn: Pick<GoodsReceiptEntryDto, 'poId' | 'asnId' | 'asnCode' | 'blindReasonCode'>,
  poCode: string | null,
): { kind: 'po' | 'asn' | 'blind'; label: string } {
  if (grn.poId !== null) return { kind: 'po', label: poCode === null ? 'PO —' : `PO ${poCode}` };
  if (grn.asnId !== undefined) return { kind: 'asn', label: `ASN ${grn.asnCode ?? '—'}` };
  const reason = grn.blindReasonCode === null ? 'no reason' : BLIND_REASON_LABEL[grn.blindReasonCode];
  return { kind: 'blind', label: `Blind · ${reason}` };
}
