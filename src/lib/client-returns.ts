/**
 * Story 4-7c — the return to client (RTC), the web's pure half: the words
 * (status, source, address kind), the refusal copy by `code`, the create
 * dialog's draft model (the open and pool caps checked here so a refusal is
 * rare — never relied on), the queue's one-client selection rule (A12), the
 * dispatch capture (2-8b's `lib/consignment-capture.ts` parser, minus the
 * debit note, plus the consignee GSTIN and the declared value — A2, A9), the
 * advised brand-document type (A2) and the printable note's model over the
 * shared `DispatchNoteModel`.
 *
 * Pure: no React, no fetch — pinned by `client-returns.test.ts`.
 */
import { ApiProblem } from '@/lib/api/client';
import type {
  AwaitingDispositionDto,
  ClientDto,
  ClientReturnDto,
  ClientReturnLineDto,
  ClientReturnSummaryDto,
  ConsigneeAddressDto,
  CreateClientReturnDto,
  DispatchClientReturnDto,
  ReturnableToClientArmDto,
} from '@/lib/api/generated';
import {
  BRAND_DOCUMENT_LABEL,
  ewayDispatchRefusal,
  parseConsignmentDraft,
  stateCodeLabel,
  type BrandDocumentType,
  type ConsignmentDraft,
  type DispatchNoteModel,
  type NoteLine,
  type ParsedConsignment,
} from '@/lib/consignment-capture';
import { formatCount, formatQuantity, parseQuantityInput } from '@/lib/format-quantity';
import { gstinStateName } from '@/lib/gst-states';
import { parseGstinField } from '@/lib/gstin';
import { formatRupees } from '@/lib/invoices';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import { formatIstDate, istDateOf } from '@/lib/rate-cards';
import { DISPOSITION_REASON_LABEL, RETURN_CONDITION_LABEL, type DispositionReasonCode } from '@/lib/returns';
import { parseRupees } from '@/lib/rupees';
import type { StatusTone } from '@/lib/status-tone';
import { addressLines, keyForBody, lineQuantityLabel, stampLabel, summaryQuantityLabel, summaryWhenLabel } from '@/lib/vendor-returns';

export { keyForBody, lineQuantityLabel, stampLabel, summaryQuantityLabel, summaryWhenLabel };

export type ClientReturnStatus = ClientReturnDto['status'];
export type RtcLineSource = ClientReturnLineDto['source'];
export type RtcAddressKind = ClientReturnDto['consigneeAddressKind'];
export type RtcReasonCode = DispositionReasonCode;

// ── words ────────────────────────────────────────────────────────────────────

/** Record-typed over the generated unions: a new arm fails the compile until it is named. */
export const CLIENT_RETURN_STATUS_LABEL: Readonly<Record<ClientReturnStatus, string>> = {
  draft: 'Draft — awaiting pick',
  picked: 'Picked — ready to dispatch',
  dispatched: 'Dispatched',
  cancelled: 'Cancelled',
};

/** The status filter's words (short — the chip carries the long form). */
export const CLIENT_RETURN_STATUS_FILTER_LABEL: Readonly<Record<ClientReturnStatus, string>> = {
  draft: 'Draft',
  picked: 'Picked',
  dispatched: 'Dispatched',
  cancelled: 'Cancelled',
};

export const CLIENT_RETURN_STATUSES = Object.keys(CLIENT_RETURN_STATUS_LABEL) as readonly ClientReturnStatus[];

export const CLIENT_RETURN_STATUS_TONE: Readonly<Record<ClientReturnStatus, StatusTone>> = {
  draft: 'info',
  picked: 'warning',
  dispatched: 'success',
  cancelled: 'neutral',
};

export function clientReturnStatusLabel(status: string): string {
  return Object.hasOwn(CLIENT_RETURN_STATUS_LABEL, status) ? CLIENT_RETURN_STATUS_LABEL[status as ClientReturnStatus] : status;
}

export function clientReturnStatusTone(status: string): StatusTone {
  return Object.hasOwn(CLIENT_RETURN_STATUS_TONE, status) ? CLIENT_RETURN_STATUS_TONE[status as ClientReturnStatus] : 'neutral';
}

/** Where a line's units wait on the floor (decision 13 — the pick screen says the same). */
export const RTC_SOURCE_LABEL: Readonly<Record<RtcLineSource, string>> = {
  returns: 'Returns area',
  damaged: 'Damaged area',
};

/** Which of the client's addresses the goods go to (decision 7). */
export const RTC_ADDRESS_LABEL: Readonly<Record<RtcAddressKind, string>> = {
  return: 'Return address',
  registered: 'Registered address',
};

export const RTC_ADDRESS_KINDS = Object.keys(RTC_ADDRESS_LABEL) as readonly RtcAddressKind[];

/** A9 — a line's reason defaults to the brand's instruction. */
export const RTC_DEFAULT_REASON: RtcReasonCode = 'client-instruction';

export const RTC_REASON_LABEL: Readonly<Record<RtcReasonCode, string>> = DISPOSITION_REASON_LABEL;

export const RTC_REASON_CODES = Object.keys(RTC_REASON_LABEL) as readonly RtcReasonCode[];

/** A reason in words for the detail and the note ("Other" without the form's hint). */
export function rtcReasonWord(code: string): string {
  if (code === 'other') return 'Other';
  return Object.hasOwn(RTC_REASON_LABEL, code) ? RTC_REASON_LABEL[code as RtcReasonCode] : code;
}

// ── copy ─────────────────────────────────────────────────────────────────────

/** A draft's floor instruction (decision 13 — the pick is handheld-only). */
export const RTC_PICK_GUIDANCE =
  'Pick it on the handheld (Returns out tab). Nothing moves until it is dispatched — the units stay in the Returns and Damaged areas.';

/** A11 — a short pick's RETURNS units stay awaiting disposition. */
export const RTC_SHORT_PICK_NOTE = 'Units you could not find stay awaiting disposition — raise a count for the RETURNS area';

/** A short pick's DAMAGED units stay in DAMAGED (the pick moved nothing). */
export const RTC_DAMAGED_SHORT_PICK_NOTE = 'Units you could not find stay in DAMAGED — raise a count for the DAMAGED area';

/** The watermark on a note printed before dispatch. */
export const RTC_DRAFT_WATERMARK = 'DRAFT — not dispatched';

/** The watermark on a cancelled return's print — never a live pick list. */
export const RTC_CANCELLED_WATERMARK = 'CANCELLED — not dispatched';

/** The note's title. */
export const RTC_NOTE_TITLE = 'Return to Client — Dispatch Note';

/** The three copies of a dispatched note. */
export const RTC_NOTE_COPIES = ['Consignee copy', 'Transporter copy', 'Warehouse copy'] as const;

/** The note's footer sentence (decision 10 — the WMS issues no tax document). */
export const RTC_NOT_A_TAX_INVOICE = "Not a tax invoice — goods move under the consignor's document above.";

/** A2 — the inter-state advice (advice only; the server records whatever is sent). */
export const RTC_INVOICE_ADVICE = "Between the brand's registrations in two states, the brand issues a stock-transfer invoice";

/** A2 — the same-registration advice. */
export const RTC_CHALLAN_ADVICE = "The goods go back to the same brand registration — its delivery challan (no supply) is the document they travel under";

/** A8 — dispatch proceeds whatever the client's status; a suspended client is said, never blocked. */
export const RTC_SUSPENDED_WARNING =
  'This client is suspended. The goods are its own, so they can still go back — check with your account team before handing them over.';

/** A9 — how the declared value prints. */
export const RTC_DECLARED_BY_CONSIGNOR = 'declared by the consignor';

/** The returnable read's cap bit. */
export const RTC_RETURNABLE_TRUNCATED_HINT = 'Showing the first 500 lines of each list — dispatch some and come back for the rest.';

// ── bounds (the backend's) ───────────────────────────────────────────────────

export const RTC_LIMITS = {
  /** `CreateClientReturnDto.lines` 1–200. */
  lines: 200,
  /** The header note and the cancel reason, 1–500 after trimming. */
  note: 500,
  cancelReason: 500,
  /** A9 — the declared value, paise 0–10¹². */
  declaredValuePaiseMax: 1_000_000_000_000,
} as const;

// ── refusals ─────────────────────────────────────────────────────────────────

export type RtcAction = 'create' | 'dispatch' | 'cancel' | 'read';

const num = (value: unknown): string | null => (typeof value === 'number' && Number.isFinite(value) ? formatCount(value) : null);
const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

const ROLE_DENIED: Readonly<Record<RtcAction, string>> = {
  create: 'Your role cannot create returns to client.',
  dispatch: 'Your role cannot dispatch returns to client.',
  cancel: 'Your role cannot cancel returns to client.',
  read: 'Your role cannot read returns to client.',
};

/**
 * A refused RTC request in words, by `code` — never by prose. The figures
 * come from the problem's extension members; the server's `detail` is the
 * fallback only for a code this build does not know.
 */
export function rtcReason(error: unknown, action: RtcAction = 'create'): string {
  if (!(error instanceof ApiProblem)) return UNREACHABLE_REASON;
  const x = error.extensions;
  const status = str(x['rtcStatus']);
  const now = status === null ? '' : ` (it is ${clientReturnStatusLabel(status).toLowerCase()} now)`;
  // Story 4-6a (A22) — the declared value judged against the e-way threshold.
  const eway = ewayDispatchRefusal(error);
  if (eway !== null) return eway;
  switch (error.code) {
    // ── create ──
    case 'exceeds-awaiting': {
      const awaiting = num(x['awaitingQty']);
      return awaiting === null
        ? 'A returned line no longer has that many units awaiting a decision — refresh and lower the quantity.'
        : `A returned line has ${awaiting} awaiting a decision now — refresh and lower the quantity.`;
    }
    case 'rtc-exceeds-damaged': {
      const onHand = num(x['onHandQty']);
      const claimed = num(x['claimedQty']);
      const available = num(x['availableQty']);
      const requested = num(x['requestedQty']);
      if (onHand === null || available === null) return 'DAMAGED no longer holds that much after the other open returns — refresh and lower the quantity.';
      return `DAMAGED holds ${onHand}${claimed !== null && claimed !== '0' ? `, ${claimed} already claimed by open returns` : ''} — at most ${available} can go on a new return${requested === null ? '' : ` (asked ${requested})`}. Refresh and lower the quantity.`;
    }
    case 'client-address-missing': {
      const kind = str(x['addressKind']);
      const words = kind === 'registered' ? 'a registered address' : 'a return address';
      return `This client has no ${words.slice(2)} on file — add ${words} on the client page, or send the goods to its other address.`;
    }
    case 'rtc-sku-unsupported': {
      const sku = str(x['skuCode']);
      return `${sku ?? 'A SKU'} cannot go on a return to client — a catch-weight case or a kit has no return path yet. Remove that line.`;
    }
    case 'mixed-client':
      return "Every line must be one client's goods — a return to client carries one brand's units.";
    case 'document-warehouse-mismatch':
      return 'A returned line was received in another warehouse — return it from there.';
    case 'review-pending':
      return 'A returned line belongs to an unannounced parcel still awaiting review — accept or reject it (Returns → Unannounced) first.';
    case 'review-rejected':
      return 'A returned line belongs to an unannounced parcel that was rejected — its units were reversed. Refresh.';
    // ── pick (device-only; a stale page may still meet them) ──
    case 'rtc-not-draft':
      return `Only a draft return is picked${now} — refresh.`;
    case 'rtc-pick-mismatch':
      return "The pick does not match the return's lines — pick it again on the handheld.";
    case 'rtc-pick-empty':
      return 'Nothing was picked — cancel the return instead.';
    // ── dispatch ──
    case 'rtc-not-picked':
      return `Only a picked return is dispatched${now} — pick it on the handheld first, or refresh.`;
    case 'partner-not-transporter':
      return 'That partner is not a transporter — pick another, or type the carrier name.';
    case 'transporter-inactive':
      return 'That transporter is inactive — pick another, or type the carrier name.';
    case 'disposition-scope-quarantined':
      return 'The Returns or Damaged stock is under a reconcile quarantine — clear it (Reports → Ledger integrity), then dispatch.';
    case 'rtc-damaged-short': {
      const onHand = num(x['onHandQty']);
      const picked = num(x['pickedQty']);
      const sku = str(x['skuCode']);
      const batch = str(x['batchCode']);
      const arm = sku === null ? 'a line' : batch === null ? sku : `${sku} batch ${batch}`;
      return `DAMAGED holds ${onHand ?? 'less'} of ${arm} but the return ships ${picked ?? 'more'} — units were taken out of DAMAGED after the return was created. Cancel the return and create it again for what is there. Nothing was dispatched.`;
    }
    case 'damaged-bin-conflict':
      return 'A location of yours uses the code DAMAGED — rename it in Settings → Zones & bins, then dispatch.';
    // ── cancel ──
    case 'rtc-closed':
      return `A dispatched or cancelled return cannot be cancelled${now} — refresh.`;
    // ── the house set ──
    case 'not-found':
      return action === 'dispatch'
        ? 'The return, or the transporter, no longer exists — refresh.'
        : action === 'create'
          ? (error.detail ?? 'Something the return names no longer exists — refresh.')
          : 'This return to client no longer exists — refresh the list.';
    case 'role-denied':
      return ROLE_DENIED[action];
    case 'permission-denied':
      return 'That return belongs to another tenant — sign in again.';
    case 'unauthenticated':
      return 'Your session expired — sign in again.';
    case 'validation-failed':
      return error.detail ?? 'The server refused the request as sent — check it and try again.';
    case 'idempotency-key-reuse':
      return 'This was already sent with different details — change something and send it again.';
    case 'conflict':
      return 'The same request is still being processed — try again to read the result.';
    case 'invalid-cursor':
      return 'The page position expired — refresh the list.';
    default:
      return error.detail ?? `Not recorded (${error.code}).`;
  }
}

/** A refusal after which the RTC moved (or vanished) — the open view re-reads it. */
export function rtcRefusalReloads(error: unknown): boolean {
  return error instanceof ApiProblem && ['rtc-not-picked', 'rtc-closed', 'rtc-not-draft', 'not-found'].includes(error.code);
}

/** A refusal after which the returnable read is stale (a claim, a disposition or a write-off moved it). */
export function rtcRefusalStalesReturnable(error: unknown): boolean {
  return (
    error instanceof ApiProblem &&
    ['exceeds-awaiting', 'rtc-exceeds-damaged', 'review-pending', 'review-rejected', 'document-warehouse-mismatch'].includes(error.code)
  );
}

/** A refusal after which the transporter list is stale. */
export function rtcTransporterRefusal(error: unknown): boolean {
  return error instanceof ApiProblem && ['partner-not-transporter', 'transporter-inactive'].includes(error.code);
}

/** The 409 `client-address-missing` (decision 7): which address, so the dialog links to the client page. Null otherwise. */
export function rtcAddressMissing(error: unknown): { readonly addressKind: RtcAddressKind; readonly clientId: string | null } | null {
  if (!(error instanceof ApiProblem) || error.code !== 'client-address-missing') return null;
  const kind = error.extensions['addressKind'];
  return { addressKind: kind === 'registered' ? 'registered' : 'return', clientId: str(error.extensions['clientId']) };
}

// ── state → affordances ──────────────────────────────────────────────────────

export const canCancelClientReturn = (status: string): boolean => status === 'draft' || status === 'picked';
export const canDispatchClientReturn = (status: string): boolean => status === 'picked';

const milli = (qty: number): number => Math.round(qty * 1000);

/** Milli-exact sum (quantities may be fractional, AD-9). */
function sumMilli(values: readonly number[]): number {
  return values.reduce((total, value) => total + Math.round(value * 1000), 0) / 1000;
}

/**
 * A11 — the staged units of a picked RTC, per floor area: what the picker
 * moved to the dock (`pickedQuantity`) from the Returns area and from the
 * Damaged area.
 */
export function stagedUnits(rtc: Pick<ClientReturnDto, 'lines'>): { readonly returns: number; readonly damaged: number } {
  const staged = (source: RtcLineSource) => sumMilli(rtc.lines.filter((line) => line.source === source).map((line) => line.pickedQuantity ?? 0));
  return { returns: staged('returns'), damaged: staged('damaged') };
}

/** A11 — the floor instruction when a picked RTC is cancelled, naming only the areas it staged units from. */
export function cancelPickedInstruction(rtc: Pick<ClientReturnDto, 'lines'>): string {
  const staged = stagedUnits(rtc);
  const areas = [
    ...(staged.returns > 0 ? [`the Returns area (${formatCount(staged.returns)})`] : []),
    ...(staged.damaged > 0 ? [`the Damaged area (${formatCount(staged.damaged)})`] : []),
  ];
  return areas.length === 0 ? 'Return any staged units to where they were picked from' : `Return the staged units to ${areas.join(' and ')}`;
}

/**
 * A11 — a short pick's note per source the RTC was picked short on: RETURNS
 * units stay awaiting disposition, DAMAGED units stay in DAMAGED. Empty when
 * nothing was short.
 */
export function shortPickNotes(rtc: Pick<ClientReturnDto, 'lines' | 'picked'>): readonly string[] {
  if (rtc.picked === null) return [];
  const short = (source: RtcLineSource) =>
    rtc.lines.some((line) => line.source === source && line.pickedQuantity !== null && milli(line.pickedQuantity) < milli(line.quantity));
  return [...(short('returns') ? [RTC_SHORT_PICK_NOTE] : []), ...(short('damaged') ? [RTC_DAMAGED_SHORT_PICK_NOTE] : [])];
}

/** What a cancel releases, naming only the sources the RTC draws from. */
function releasedPhrase(rtc: Pick<ClientReturnDto, 'lines'>): string {
  const parts = [
    ...(rtc.lines.some((line) => line.source === 'returns') ? ['its returned units go back to awaiting disposition'] : []),
    ...(rtc.lines.some((line) => line.source === 'damaged') ? ['its claim on DAMAGED is released'] : []),
  ];
  return parts.length === 0 ? 'its claims are released' : parts.join(' and ');
}

/** The cancel confirmation's sentence — a picked RTC's units are staged on the dock (A11). */
export function rtcCancelConfirmSentence(rtc: Pick<ClientReturnDto, 'code' | 'status' | 'lines'>): string {
  return rtc.status === 'picked'
    ? `Cancel ${rtc.code}? Nothing has moved in the system. ${cancelPickedInstruction(rtc)}.`
    : `Cancel ${rtc.code}? Nothing has moved — ${releasedPhrase(rtc)}.`;
}

export function parseRtcCancelReason(text: string): { readonly reason: string | null; readonly problem: string | null } {
  const reason = text.trim();
  if (reason === '') return { reason: null, problem: 'Say why the return is cancelled.' };
  if ([...reason].length > RTC_LIMITS.cancelReason) return { reason: null, problem: `The reason is at most ${RTC_LIMITS.cancelReason} characters.` };
  return { reason, problem: null };
}

// ── outcomes (built from the response) ──────────────────────────────────────

export interface RtcOutcome {
  readonly tone: 'accepted';
  readonly word: string;
  readonly reason: string;
}

const lineCount = (n: number): string => `${n} line${n === 1 ? '' : 's'}`;
const brandName = (rtc: Pick<ClientReturnDto, 'client'>): string => rtc.client.legalName ?? rtc.client.name;

export function rtcCreatedOutcome(rtc: Pick<ClientReturnDto, 'code' | 'lines' | 'client'>): RtcOutcome {
  return { tone: 'accepted', word: `${rtc.code} created`, reason: `${lineCount(rtc.lines.length)} back to ${brandName(rtc)}. ${RTC_PICK_GUIDANCE}` };
}

export function rtcDispatchedOutcome(rtc: Pick<ClientReturnDto, 'code' | 'client' | 'dispatch'>): RtcOutcome {
  const packages = rtc.dispatch?.packageCount ?? 0;
  const doc = rtc.dispatch === null ? '' : ` under ${BRAND_DOCUMENT_LABEL[rtc.dispatch.brandDocument.type].toLowerCase()} ${rtc.dispatch.brandDocument.number}`;
  return {
    tone: 'accepted',
    word: `${rtc.code} dispatched`,
    reason: `${packages} package${packages === 1 ? '' : 's'} back to ${brandName(rtc)}${doc}. The units left the Returns and Damaged areas — print the dispatch note for the transporter.`,
  };
}

export function rtcCancelledOutcome(rtc: Pick<ClientReturnDto, 'code' | 'picked' | 'lines'>): RtcOutcome {
  const phrase = releasedPhrase(rtc);
  const released = `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}.`;
  return {
    tone: 'accepted',
    word: `${rtc.code} cancelled`,
    reason: rtc.picked !== null ? `${released} ${cancelPickedInstruction(rtc)}.` : released,
  };
}

/** The list's document cell: the brand document and the AWB, once dispatched. */
export function summaryDocumentLabel(row: Pick<ClientReturnSummaryDto, 'brandDocumentNumber' | 'trackingRef'>): string | null {
  if (row.brandDocumentNumber === null) return null;
  return row.trackingRef === null ? row.brandDocumentNumber : `${row.brandDocumentNumber} · ${row.trackingRef}`;
}

// ── the queue's selection (A12) ──────────────────────────────────────────────

/** A returned case (catch weight) cannot go on an RTC (decision 12) — the queue does not offer it. */
export function rtcSelectable(line: Pick<AwaitingDispositionDto, 'weightGrams'>): boolean {
  return line.weightGrams === null;
}

/**
 * A12 — the queue's selection is one client's lines (the queue is already one
 * warehouse's). A change that would mix clients keeps only the lines of the
 * client already selected — or, from an empty selection (Select all on a
 * mixed page), the client of the first selected row in page order.
 */
export function limitSelectionToOneClient(
  rows: readonly Pick<AwaitingDispositionDto, 'receiptLineId' | 'clientId' | 'warehouseId'>[],
  previous: ReadonlySet<string>,
  next: ReadonlySet<string>,
): ReadonlySet<string> {
  const byId = new Map(rows.map((row) => [row.receiptLineId, row]));
  const anchor =
    [...previous].map((id) => byId.get(id)).find((row) => row !== undefined) ??
    rows.find((row) => next.has(row.receiptLineId));
  if (anchor === undefined) return next;
  return new Set(
    [...next].filter((id) => {
      const row = byId.get(id);
      return row !== undefined && row.clientId === anchor.clientId && row.warehouseId === anchor.warehouseId;
    }),
  );
}

// ── the create draft ─────────────────────────────────────────────────────────

/** One DAMAGED arm's identity (the pool the claim counts on). */
export function rtcArmKey(arm: Pick<ReturnableToClientArmDto, 'skuId' | 'batchId'>): string {
  return `${arm.skuId}|${arm.batchId ?? ''}`;
}

/** The arm in words: `SKU-1 batch B1`. */
export function rtcArmLabel(arm: Pick<ReturnableToClientArmDto, 'skuCode' | 'batchCode' | 'batchId'>): string {
  if (arm.batchId === null) return arm.skuCode;
  return `${arm.skuCode} batch ${arm.batchCode ?? `…${arm.batchId.slice(-8)}`}`;
}

/** One draft line as typed: the quantity text and the reason (the default until changed). */
export interface RtcDraftLine {
  readonly quantity: string;
  readonly reason: RtcReasonCode;
}

export interface RtcDraft {
  readonly consigneeAddress: RtcAddressKind;
  readonly note: string;
  /** Keyed by the receipt line id. */
  readonly returns: Readonly<Record<string, RtcDraftLine>>;
  /** Keyed by `rtcArmKey`. */
  readonly damaged: Readonly<Record<string, RtcDraftLine>>;
}

/** A returned line's whole open quantity, as the draft types it (a serial line is 1). */
function wholeOpen(line: Pick<AwaitingDispositionDto, 'openQty' | 'serialNumber'>): string {
  return line.serialNumber !== null ? '1' : String(line.openQty);
}

/**
 * A fresh draft: the return address (decision 7's web default), and the
 * lines picked in the queue preselected at their whole open quantity, with
 * the default reason (A9).
 */
export function emptyRtcDraft(preselected: readonly Pick<AwaitingDispositionDto, 'receiptLineId' | 'openQty' | 'serialNumber'>[]): RtcDraft {
  const returns: Record<string, RtcDraftLine> = {};
  for (const line of preselected) returns[line.receiptLineId] = { quantity: wholeOpen(line), reason: RTC_DEFAULT_REASON };
  return { consigneeAddress: 'return', note: '', returns, damaged: {} };
}

/**
 * The draft against a fresh returnable read: a returned line no longer
 * awaiting, and a DAMAGED arm gone or with nothing available, leave the draft
 * — a line the dialog cannot show can never be cleared, and would fail every
 * Create. Returns the same object when nothing was dropped.
 */
export function pruneRtcDraft(
  draft: RtcDraft,
  sources: { readonly awaiting: readonly Pick<AwaitingDispositionDto, 'receiptLineId' | 'weightGrams'>[]; readonly damaged: readonly ReturnableToClientArmDto[] },
): RtcDraft {
  const live = new Set(sources.awaiting.filter(rtcSelectable).map((line) => line.receiptLineId));
  const arms = new Set(sources.damaged.filter((arm) => arm.available > 0).map(rtcArmKey));
  const returns = Object.fromEntries(Object.entries(draft.returns).filter(([id]) => live.has(id)));
  const damaged = Object.fromEntries(Object.entries(draft.damaged).filter(([key]) => arms.has(key)));
  if (Object.keys(returns).length === Object.keys(draft.returns).length && Object.keys(damaged).length === Object.keys(draft.damaged).length) return draft;
  return { ...draft, returns, damaged };
}

/** The draft line for an id, or the untouched default. */
export function draftLine(lines: Readonly<Record<string, RtcDraftLine>>, id: string): RtcDraftLine {
  return lines[id] ?? { quantity: '', reason: RTC_DEFAULT_REASON };
}

/** Why the client's address of a kind cannot be chosen (decision 7 — no fallback), or null. */
export function rtcAddressBlock(client: Pick<ClientDto, 'returnAddress' | 'registeredAddress'> | null, kind: RtcAddressKind): string | null {
  if (client === null) return null;
  const address = kind === 'return' ? client.returnAddress : client.registeredAddress;
  return address === null ? `This client has no ${RTC_ADDRESS_LABEL[kind].toLowerCase()} on file` : null;
}

export type BuiltRtcCreate =
  | { readonly ok: true; readonly body: CreateClientReturnDto; readonly lineCount: number }
  | { readonly ok: false; readonly problem: string; readonly lineId?: string };

function precisionProblem(name: string, uom: string, raw: string, qty: number, precision: number | null): string | null {
  if (precision === null) return null;
  const p = Math.min(Math.max(Math.trunc(precision), 0), 3);
  if (Math.round(qty * 10 ** p) / 10 ** p === qty) return null;
  return p === 0 ? `${name}: ${uom} counts in whole units — ${raw} is not one.` : `${name}: ${uom} takes at most ${p} decimal place${p === 1 ? '' : 's'}.`;
}

/**
 * The draft → the create body, or the first problem. Blank (or 0) lines are
 * not sent. Checked here because the client holds the figures (the server
 * still decides): a returned line ≤ its open quantity, a serial line exactly
 * 1, a returned case refused (decision 12); a DAMAGED arm ≤ its available
 * quantity (after RTV and RTC claims); each at its unit's precision when
 * known; `other` ⇒ a note; the bounds.
 */
export function buildRtcCreateBody(
  draft: RtcDraft,
  sources: { readonly awaiting: readonly AwaitingDispositionDto[]; readonly damaged: readonly ReturnableToClientArmDto[] },
  context: {
    readonly warehouseId: string;
    readonly client: Pick<ClientDto, 'returnAddress' | 'registeredAddress'> | null;
    /** The SKU's unit precision when the catalog knows it (a returned line carries none). */
    readonly precisionOf?: (skuId: string) => number | null;
  },
): BuiltRtcCreate {
  const block = rtcAddressBlock(context.client, draft.consigneeAddress);
  if (block !== null) return { ok: false, problem: `${block} — pick the other, or add it on the client page.` };
  const note = draft.note.trim();
  if ([...note].length > RTC_LIMITS.note) return { ok: false, problem: `The note is at most ${RTC_LIMITS.note} characters.` };
  const precisionOf = context.precisionOf ?? (() => null);

  const lines: CreateClientReturnDto['lines'] = [];
  let needsNote: string | null = null;
  const awaitingById = new Map(sources.awaiting.map((line) => [line.receiptLineId, line]));
  for (const [id, entry] of Object.entries(draft.returns)) {
    const raw = entry.quantity.trim();
    if (raw === '') continue;
    const line = awaitingById.get(id);
    if (line === undefined) {
      return { ok: false, problem: 'A selected returned line is no longer awaiting a decision — refresh and check the lines.', lineId: `r:${id}` };
    }
    const name = `${line.rmaCode} ${line.skuCode}`;
    const qty = parseQuantityInput(raw);
    if (qty === null) return { ok: false, problem: `${name}: enter a quantity in ${line.uom} (a number), or leave it blank.`, lineId: `r:${id}` };
    if (qty === 0) continue;
    if (!rtcSelectable(line)) {
      return { ok: false, problem: `${name}: a returned case cannot go on a return to client yet — remove it.`, lineId: `r:${id}` };
    }
    if (line.serialNumber !== null && qty !== 1) {
      return { ok: false, problem: `${name}: serial ${line.serialNumber} is one unit — return 1 or leave it blank.`, lineId: `r:${id}` };
    }
    const precision = precisionProblem(name, line.uom, raw, qty, precisionOf(line.skuId));
    if (precision !== null) return { ok: false, problem: precision, lineId: `r:${id}` };
    if (milli(qty) > milli(line.openQty)) {
      return {
        ok: false,
        problem: `${name}: ${formatCount(line.openQty)} ${line.uom} await a decision — the line asks ${raw}.`,
        lineId: `r:${id}`,
      };
    }
    if (entry.reason === 'other') needsNote ??= `r:${id}`;
    lines.push({ source: 'returns', returnReceiptLineId: id, quantity: qty, reasonCode: entry.reason });
  }
  const armsByKey = new Map(sources.damaged.map((arm) => [rtcArmKey(arm), arm]));
  for (const [key, entry] of Object.entries(draft.damaged)) {
    const raw = entry.quantity.trim();
    if (raw === '') continue;
    const arm = armsByKey.get(key);
    if (arm === undefined) return { ok: false, problem: 'A DAMAGED line is no longer returnable — refresh and check it.', lineId: `d:${key}` };
    const name = rtcArmLabel(arm);
    const qty = parseQuantityInput(raw);
    if (qty === null) return { ok: false, problem: `${name}: enter a quantity in ${arm.uom} (a number), or leave it blank.`, lineId: `d:${key}` };
    if (qty === 0) continue;
    const precision = precisionProblem(name, arm.uom, raw, qty, arm.uomPrecision);
    if (precision !== null) return { ok: false, problem: precision, lineId: `d:${key}` };
    if (milli(qty) > milli(arm.available)) {
      const p = arm.uomPrecision;
      const claimed = sumMilli([arm.claimedRtv, arm.claimedRtc]);
      return {
        ok: false,
        problem: `${name}: at most ${formatQuantity(arm.available, p)} ${arm.uom} can go back (DAMAGED holds ${formatQuantity(arm.onHand, p)}${claimed > 0 ? `, ${formatQuantity(claimed, p)} claimed by ${arm.claimedBy.join(', ')}` : ''}) — the line asks ${raw}.`,
        lineId: `d:${key}`,
      };
    }
    if (entry.reason === 'other') needsNote ??= `d:${key}`;
    lines.push({ source: 'damaged', skuId: arm.skuId, ...(arm.batchId === null ? {} : { batchId: arm.batchId }), quantity: qty, reasonCode: entry.reason });
  }
  if (lines.length === 0) return { ok: false, problem: 'Enter a quantity on at least one line — the units to send back.' };
  if (lines.length > RTC_LIMITS.lines) return { ok: false, problem: `A return to client carries at most ${RTC_LIMITS.lines} lines — split it.` };
  if (needsNote !== null && note === '') return { ok: false, problem: 'The reason Other needs the note to say why.', lineId: needsNote };
  return {
    ok: true,
    lineCount: lines.length,
    body: {
      warehouseId: context.warehouseId,
      consigneeAddress: draft.consigneeAddress,
      ...(note === '' ? {} : { note }),
      lines,
    },
  };
}

// ── the dispatch ─────────────────────────────────────────────────────────────

/** The RTC-only fields beside the shared capture (A2, A9). */
export interface RtcDispatchExtra {
  readonly consigneeGstin: string;
  /** Rupees as typed ('' — none). */
  readonly declaredValue: string;
}

export type RtcExtraField = 'consigneeGstin' | 'declaredValue';

export type ParsedRtcDispatch =
  | { readonly ok: true; readonly body: DispatchClientReturnDto }
  | { readonly ok: false; readonly field: Exclude<ParsedConsignment, { ok: true }>['field']; readonly extra?: never; readonly problem: string }
  | { readonly ok: false; readonly extra: RtcExtraField; readonly field?: never; readonly problem: string };

/** A fresh RTC extra: the consignee GSTIN pre-filled with the brand's frozen GSTIN (A2 — the server's own default). */
export function emptyRtcDispatchExtra(clientGstin: string | null): RtcDispatchExtra {
  return { consigneeGstin: clientGstin ?? '', declaredValue: '' };
}

/**
 * The dispatch capture for this RTC: the shared parser (its 30-day window from
 * the RTC's creation), the debit note dropped — an RTC records none and the
 * server answers 400 to one (D8) — then the consignee GSTIN (shape and
 * state, upper-cased) and the declared value (rupees → integer paise, 0–10¹²).
 */
export function parseRtcDispatch(
  draft: ConsignmentDraft,
  extra: RtcDispatchExtra,
  rtc: Pick<ClientReturnDto, 'created'>,
  nowMs: number,
): ParsedRtcDispatch {
  const parsed = parseConsignmentDraft({ ...draft, debitNoteNumber: '' }, { createdAt: rtc.created.at, nowMs });
  if (!parsed.ok) return { ok: false, field: parsed.field, problem: parsed.problem };
  const consignee = parseGstinField(extra.consigneeGstin, 'The consignee GSTIN');
  if (consignee.problem !== null) return { ok: false, extra: 'consigneeGstin', problem: consignee.problem };
  // Story 4-6a (A25) — required on the web: the e-way threshold is judged from it.
  if (extra.declaredValue.trim() === '') {
    return { ok: false, extra: 'declaredValue', problem: "Enter the value on the brand's document (including tax) — the e-way threshold is judged from it." };
  }
  const rupees = parseRupees(extra.declaredValue);
  if ('problem' in rupees) return { ok: false, extra: 'declaredValue', problem: rupees.problem };
  if (rupees.paise > RTC_LIMITS.declaredValuePaiseMax) {
    return { ok: false, extra: 'declaredValue', problem: `The declared value is at most ${formatRupees(RTC_LIMITS.declaredValuePaiseMax)}.` };
  }
  const declaredValuePaise = rupees.paise;
  const { debitNoteNumber: _dropped, ...capture } = parsed.body;
  void _dropped;
  return {
    ok: true,
    body: {
      ...capture,
      ...(consignee.gstin === undefined ? {} : { consigneeGstin: consignee.gstin }),
      declaredValuePaise,
    },
  };
}

/**
 * A2 — the brand-document type the web advises, from the two GSTINs' state
 * prefixes (never the free-text return state): a challan when the
 * registrations are the same, or either is unknown; a stock-transfer invoice
 * when the states differ. Advice only — the server records what is sent.
 */
export function advisedBrandDocument(
  consignorGstinText: string,
  consigneeGstinText: string,
): { readonly type: BrandDocumentType; readonly advice: string } {
  const consignor = consignorGstinText.trim().toUpperCase();
  const consignee = consigneeGstinText.trim().toUpperCase();
  const consignorState = gstinStateName(consignor);
  const consigneeState = gstinStateName(consignee);
  if (consignorState === null || consigneeState === null || consignor === consignee || consignor.slice(0, 2) === consignee.slice(0, 2)) {
    return { type: 'challan', advice: RTC_CHALLAN_ADVICE };
  }
  return { type: 'invoice', advice: `${RTC_INVOICE_ADVICE} (${consignorState} → ${consigneeState})` };
}

// ── the printable note's model (the shared `return-dispatch-note.tsx`) ──────

function gstinFact(label: string, gstin: string | null): { label: string; value: string } {
  if (gstin === null) return { label, value: 'Unregistered' };
  const state = gstinStateName(gstin);
  return { label, value: state === null ? gstin : `${gstin} (${state})` };
}

/** The frozen consignee address as note lines (A2 — a return address's state is free text, a registered one's a code). */
export function consigneeAddressLines(address: ConsigneeAddressDto): readonly string[] {
  return [
    ...(address.contactName === null || address.contactName === '' ? [] : [`Attn: ${address.contactName}`]),
    address.line1,
    ...(address.line2 === null || address.line2 === '' ? [] : [address.line2]),
    `${address.city} — ${address.pincode}`,
    address.stateCode !== null ? `State: ${stateCodeLabel(address.stateCode)}` : address.state !== null && address.state !== '' ? `State: ${address.state}` : null,
    ...(address.phone === null || address.phone === '' ? [] : [`Phone: ${address.phone}`]),
  ].filter((line): line is string => line !== null);
}

/** The consignee address's state in words: the typed state, else the GST state code's label (A2), else null. */
export function consigneeStateLabel(address: Pick<ConsigneeAddressDto, 'state' | 'stateCode'>): string | null {
  if (address.state !== null && address.state !== '') return address.state;
  return address.stateCode === null ? null : stateCodeLabel(address.stateCode);
}

/** A returned line's group on the note: its RMA and the order it came back from (A9). */
function returnsGroup(line: Pick<ClientReturnLineDto, 'rmaCode' | 'orderReference'>): string {
  const rma = line.rmaCode ?? 'Return';
  return line.orderReference === null || line.orderReference === '' ? `${rma} — customer return` : `${rma} — customer return of order ${line.orderReference}`;
}

/** The DAMAGED lines' group heading. */
export const RTC_DAMAGED_GROUP = 'Damaged stock';

/**
 * The note's model from the detail read — every party as frozen on the RTC:
 * the brand as consignor (the GSTIN its challan names: as dispatched, else
 * the frozen client GSTIN), the warehouse "operated by" the 3PL, and the
 * brand again as consignee — "Return to <brand> — <address kind>" at the
 * frozen address, with the effective consignee GSTIN or "Unregistered" (A2).
 * The lines group returns by RMA (condition and order reference printed),
 * then the DAMAGED lines (A9). Before dispatch it is a pick list: the asked
 * quantities, one copy, the draft watermark, no capture. Once dispatched: the
 * shipped (picked) lines only, three copies, the declared value "declared by
 * the consignor".
 */
export function clientReturnNoteModel(rtc: ClientReturnDto, precisionOf: (skuId: string) => number | null = () => null): DispatchNoteModel {
  const dispatch = rtc.dispatch;
  const dispatched = rtc.status === 'dispatched' && dispatch !== null;
  const brand = brandName(rtc);
  const consignorGstin = dispatched ? dispatch.consignorGstin : rtc.client.gstin;
  const consigneeGstin = dispatched ? dispatch.consigneeGstin : rtc.client.gstin;
  const wh = rtc.warehouse;
  const origin = wh.originAddress;
  const shipped = rtc.lines.filter((line) => !dispatched || (line.pickedQuantity ?? 0) > 0);
  const returns = shipped
    .filter((line) => line.source === 'returns')
    .sort((a, b) => (a.rmaCode ?? '').localeCompare(b.rmaCode ?? '') || a.lineNo - b.lineNo);
  const damaged = shipped.filter((line) => line.source === 'damaged').sort((a, b) => a.lineNo - b.lineNo);
  const lines: NoteLine[] = [...returns, ...damaged].map((line) => {
    const detail = [
      ...(line.condition === null ? [] : [`received ${(RETURN_CONDITION_LABEL[line.condition] ?? line.condition).toLowerCase()}`]),
      ...(line.serialNumber === null ? [] : [`serial ${line.serialNumber}`]),
    ];
    return {
      key: line.id,
      lineNo: line.lineNo,
      skuCode: line.skuCode,
      skuName: line.skuName,
      hsn: line.hsn ?? '—',
      batch: line.batchCode ?? '—',
      quantity: lineQuantityLabel(dispatched ? (line.pickedQuantity ?? 0) : line.quantity, precisionOf(line.skuId)),
      uom: line.uom,
      reason: rtcReasonWord(line.reasonCode),
      group: line.source === 'returns' ? returnsGroup(line) : RTC_DAMAGED_GROUP,
      ...(detail.length === 0 ? {} : { detail: detail.join(' · ') }),
    };
  });
  const capture: { label: string; value: string }[] = [];
  if (dispatched) {
    const doc = dispatch.brandDocument;
    capture.push({ label: "Consignor's document", value: `${BRAND_DOCUMENT_LABEL[doc.type] ?? doc.type} ${doc.number} · ${formatIstDate(doc.date)}` });
    capture.push({
      label: 'E-way bill',
      value:
        dispatch.ewayBill === null
          ? 'None recorded'
          : `${dispatch.ewayBill.number} · ${formatIstDate(dispatch.ewayBill.date)}${dispatch.ewayBill.validUntil === null ? '' : ` · valid until ${formatIstDate(dispatch.ewayBill.validUntil)}`}`,
    });
    if (dispatch.declaredValuePaise !== null) {
      capture.push({ label: 'Declared value', value: `${formatRupees(dispatch.declaredValuePaise)} (${RTC_DECLARED_BY_CONSIGNOR})` });
    }
    const carrier = dispatch.transporter !== null ? `${dispatch.transporter.name} (${dispatch.transporter.code})` : dispatch.carrierName;
    capture.push({ label: 'Transporter', value: carrier ?? '—' });
    if (dispatch.transporter !== null && dispatch.carrierName !== null) capture.push({ label: 'Carrier', value: dispatch.carrierName });
    capture.push({ label: 'Vehicle', value: dispatch.vehicleNumber ?? '—' });
    capture.push({ label: 'AWB / LR', value: dispatch.trackingRef ?? '—' });
    capture.push({ label: 'Packages', value: formatCount(dispatch.packageCount) });
    capture.push({ label: 'Dispatched', value: stampLabel(dispatch) });
  }
  const addressKind = RTC_ADDRESS_LABEL[rtc.consigneeAddressKind]?.toLowerCase() ?? rtc.consigneeAddressKind;
  return {
    title: RTC_NOTE_TITLE,
    code: rtc.code,
    dateLabel: formatIstDate(istDateOf(dispatched ? dispatch.at : rtc.created.at)),
    dispatched,
    watermark: dispatched ? null : rtc.status === 'cancelled' ? RTC_CANCELLED_WATERMARK : RTC_DRAFT_WATERMARK,
    copies: dispatched ? RTC_NOTE_COPIES : rtc.status === 'cancelled' ? ['Cancelled'] : ['Pick list'],
    consignor: {
      heading: 'Consignor (the brand)',
      name: brand,
      lines: [...(rtc.client.legalName !== null && rtc.client.legalName !== rtc.client.name ? [rtc.client.name] : []), ...addressLines(rtc.client.registeredAddress)],
      facts: [gstinFact('GSTIN', consignorGstin)],
    },
    dispatchedFrom: {
      heading: `Dispatched from — operated by ${wh.operatorName}`,
      name: `${wh.name} (${wh.code})`,
      lines:
        origin === null
          ? []
          : [
              origin.line1,
              ...(origin.line2 === null || origin.line2 === '' ? [] : [origin.line2]),
              `${origin.city} — ${origin.pincode}`,
              `State: ${origin.state}`,
              `Contact: ${origin.contactName} · ${origin.phone}`,
            ],
      facts: [],
    },
    consignee: {
      heading: `Return to ${brand} — ${addressKind}`,
      name: brand,
      lines: [`Client ${rtc.client.code}`, ...consigneeAddressLines(rtc.consigneeAddress)],
      facts: [gstinFact('GSTIN', consigneeGstin)],
    },
    lines,
    capture,
    note: rtc.note,
    footer: RTC_NOT_A_TAX_INVOICE,
    signatures: ['Transporter — received the goods', `For ${wh.operatorName} — warehouse`],
  };
}

/** The detail's picked cell, and the A11 short-pick note when a line was picked short. */
export function pickedShort(rtc: Pick<ClientReturnDto, 'lines' | 'picked'>): boolean {
  return rtc.picked !== null && rtc.lines.some((line) => line.pickedQuantity !== null && milli(line.pickedQuantity) < milli(line.quantity));
}
