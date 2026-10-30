/**
 * Story 4-6a — the client consignment record on the web: the brand's tax
 * document (invoice, delivery challan or bill of supply), its declared value
 * and the e-way bill (or an exemption), recorded per client order by staff or
 * by the brand in its portal. The WMS records the brand's numbers and never
 * issues them (D4).
 *
 * This file holds every word and rule the staff panel, the Documents
 * worklist, the handover builder and the portal share: the gate's states and
 * reasons in words, the form draft and its parse (the mirror of wms-be
 * `shared/primitives/consignment-record.ts`'s shape rules, A8), the money and
 * e-way number formatters, and the refusal copy for every code the story
 * adds. The gate itself is `consignment-gate.ts` (a byte copy of the
 * backend's).
 *
 * Pure: no React, no hooks — the portal may import it (portal boundary).
 * Pinned by `consignment.test.ts`.
 */
import { ApiProblem } from '@/lib/api/client';
import type {
  ConsignmentBrandDocumentDto,
  ConsignmentEwayViewDto,
  ConsignmentExemptionInputDto,
  ConsignmentGateDto,
  ConsignmentViewDto,
  PortalConsignmentViewDto,
  RecordConsignmentDto,
} from '@/lib/api/generated';
import { CLIENT_DEPARTED_REASON } from '@/lib/client-departed';
import type { ConsignmentDocumentRule, ConsignmentGateCode, ConsignmentGateState, ConsignmentRequiredBecause } from '@/lib/consignment-gate';
import { brandDocumentDateWindow } from '@/lib/consignment-capture';
import { GST_STATE_NAMES } from '@/lib/gst-states';
import { parseGstinField } from '@/lib/gstin';
import { istToday } from '@/lib/gate-ins';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import { formatIstDate } from '@/lib/rate-cards';
import { parseRupees } from '@/lib/rupees';
import type { StatusTone } from '@/lib/status-tone';

export type OrderBrandDocumentType = ConsignmentBrandDocumentDto['type'];
export type EwayExemptionReason = ConsignmentExemptionInputDto['reason'];
export type ConsignmentEwayStatus = ConsignmentEwayViewDto['status'];
// One vocabulary: the gate's states, reasons, codes and rules are the mirrored gate's.
export type { ConsignmentDocumentRule, ConsignmentGateCode, ConsignmentGateState, ConsignmentRequiredBecause } from '@/lib/consignment-gate';
/** A version as either surface reads it (the portal's omits the staff user ids). */
export type AnyConsignmentView = ConsignmentViewDto | PortalConsignmentViewDto;

// ── money and numbers ──────────────────────────────────────────────────────

/**
 * `11800000` paise → `₹1,18,000`; `5000050` → `₹50,000.50` — Indian digit
 * grouping, integer arithmetic, whole rupees without `.00` (the backend's
 * `formatRupees` in `consignment-record.ts`, so the web says the same figure
 * the emails and prints do).
 */
export function formatRupees(paise: number): string {
  const negative = paise < 0;
  const abs = Math.abs(Math.trunc(paise));
  const whole = String(Math.trunc(abs / 100));
  const fraction = abs % 100;
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest === '' ? last3 : `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
  return `${negative ? '-' : ''}₹${grouped}${fraction === 0 ? '' : `.${String(fraction).padStart(2, '0')}`}`;
}

/** An e-way bill number as printed: `1234 5678 9012`. Anything else is returned as given (the backend's twin). */
export function formatEwayBillNumber(value: string): string {
  return /^[0-9]{12}$/.test(value) ? `${value.slice(0, 4)} ${value.slice(4, 8)} ${value.slice(8)}` : value;
}

/** The national threshold the screens quote when no figure is in hand (CGST Rule 138(1)). */
export const NATIONAL_EWAY_THRESHOLD_PAISE = 5_000_000;

// ── vocabularies (Record-typed over the generated unions) ──────────────────

/** The brand document's type as the form offers it. */
export const ORDER_BRAND_DOCUMENT_LABEL: Readonly<Record<OrderBrandDocumentType, string>> = {
  invoice: 'Tax invoice',
  challan: 'Delivery challan',
  'bill-of-supply': 'Bill of supply',
};
export const ORDER_BRAND_DOCUMENT_TYPES = Object.keys(ORDER_BRAND_DOCUMENT_LABEL) as readonly OrderBrandDocumentType[];

/** The type in running text — the backend's `brandDocumentWords` (the slip, the sheet, the email). */
export function brandDocumentWords(type: string): string {
  return type === 'challan' ? 'Delivery challan' : type === 'bill-of-supply' ? 'Bill of supply' : 'Invoice';
}

/** The short tag a label prints — `INV`, `DC`, `BOS`. */
export function brandDocumentTag(type: string): string {
  return type === 'challan' ? 'DC' : type === 'bill-of-supply' ? 'BOS' : 'INV';
}

export const EWAY_EXEMPTION_LABEL: Readonly<Record<EwayExemptionReason, string>> = {
  'exempt-goods': 'Exempt goods',
  'non-motorised': 'Non-motorised conveyance',
  customs: 'Under customs supervision',
  other: 'Other — say why',
};
export const EWAY_EXEMPTION_REASONS = Object.keys(EWAY_EXEMPTION_LABEL) as readonly EwayExemptionReason[];

/** An exemption reason in running text (the backend's `ewayExemptionWords`). */
export function ewayExemptionWords(reason: string): string {
  switch (reason) {
    case 'exempt-goods':
      return 'exempt goods';
    case 'non-motorised':
      return 'non-motorised conveyance';
    case 'customs':
      return 'under customs supervision';
    default:
      return 'exempt';
  }
}

export const DOCUMENT_RULE_LABEL: Readonly<Record<ConsignmentDocumentRule, { readonly label: string; readonly explain: string }>> = {
  b2b: { label: 'B2B orders (recommended)', explain: 'Every B2B order needs the brand’s invoice or challan before it leaves — B2B goods travel with a tax document.' },
  all: { label: 'Every order', explain: 'Every order of this client needs the brand’s document before it leaves, B2C included.' },
  'high-value': { label: 'Only high-value orders', explain: 'Only an order whose own value is above the e-way threshold needs the brand’s documents.' },
};
export const DOCUMENT_RULES = Object.keys(DOCUMENT_RULE_LABEL) as readonly ConsignmentDocumentRule[];

/** The rule's standing note (A24). */
export const DOCUMENT_RULE_NOTE = 'Any order whose own value is above the e-way threshold always needs the brand’s documents.';

/** The version's lifecycle in words. */
export const CONSIGNMENT_STATUS_WORD: Readonly<Record<AnyConsignmentView['status'], string>> = {
  live: 'Live',
  superseded: 'Amended',
  withdrawn: 'Withdrawn',
};

/** A46 — why the Exempt choice is disabled on the staff form. */
export const EXEMPTION_OFFICE_ONLY = 'Only an office role can record an e-way exemption.';
export const EXEMPTION_KEEP_OFFICE_ONLY = 'Only an office role can keep or change the exemption.';

export const EWAY_STATUS_WORD: Readonly<Record<ConsignmentEwayStatus, string>> = {
  recorded: 'E-way bill recorded',
  pending: 'E-way bill needed',
  'not-required': 'No e-way bill needed',
  exempt: 'Exempt from the e-way bill',
};

// ── the gate in words ──────────────────────────────────────────────────────

export interface GateChip {
  readonly word: string;
  readonly tone: StatusTone;
}

/**
 * The gate's chip — the word first, the tone second (A24): "Invoice needed"
 * amber, "E-way bill needed" / "E-way bill expired" red, "Expires today"
 * amber. Null for a state nobody needs to act on in a list (the Docs cell
 * prints a muted dash).
 */
export function gateChip(state: ConsignmentGateState | undefined, expiresToday = false): GateChip | null {
  switch (state) {
    case 'missing':
      return { word: 'Invoice needed', tone: 'warning' };
    case 'eway-required':
      return { word: 'E-way bill needed', tone: 'danger' };
    case 'eway-expired':
      return { word: 'E-way bill expired', tone: 'danger' };
    case 'ready':
      return expiresToday ? { word: 'Expires today', tone: 'warning' } : { word: 'Documents recorded', tone: 'success' };
    case 'not-required':
      return { word: 'Not required', tone: 'neutral' };
    default:
      return null;
  }
}

/** True for the three states that keep an order from leaving. */
export function gateBlocks(state: ConsignmentGateState | undefined): boolean {
  return state === 'missing' || state === 'eway-required' || state === 'eway-expired';
}

/** Why a record is required, short (the worklist's column). */
export function requiredBecauseWords(
  because: ConsignmentRequiredBecause | null | undefined,
  valueFloorPaise: number | null | undefined,
  thresholdPaise: number = NATIONAL_EWAY_THRESHOLD_PAISE,
): string {
  switch (because) {
    case 'policy-b2b':
      return 'B2B rule';
    case 'policy-all':
      return 'Every order';
    case 'value':
      return valueFloorPaise === null || valueFloorPaise === undefined
        ? `Value above ${formatRupees(thresholdPaise)}`
        : `Value ${formatRupees(valueFloorPaise)} by the order’s own figures — above ${formatRupees(thresholdPaise)}`;
    default:
      return '—';
  }
}

/**
 * The panel's gate line (A24): "Required — B2B order for BRAND-A. Not
 * recorded." `clientCode` names the client when known; `orderStatus` tells
 * a cancelled order from the tenant's own goods (both read not-applicable).
 */
export function gateLine(
  gate: Pick<ConsignmentGateDto, 'state' | 'requiredBecause' | 'valueFloorPaise' | 'expiresToday'> & { readonly nationalThresholdPaise?: number },
  context: { readonly clientCode?: string | null; readonly orderStatus?: string } = {},
): string {
  const threshold = gate.nationalThresholdPaise ?? NATIONAL_EWAY_THRESHOLD_PAISE;
  const forClient = context.clientCode === null || context.clientCode === undefined ? '' : ` for ${context.clientCode}`;
  switch (gate.state) {
    case 'missing':
      switch (gate.requiredBecause) {
        case 'policy-b2b':
          return `Required — B2B order${forClient}. Not recorded.`;
        case 'policy-all':
          return `Required — every order${forClient} carries the brand’s document. Not recorded.`;
        default:
          return `Required — the order’s own value${gate.valueFloorPaise === null ? '' : ` (${formatRupees(gate.valueFloorPaise)})`} is above the e-way threshold of ${formatRupees(threshold)}. Not recorded.`;
      }
    case 'eway-required':
      return 'Recorded — but the declared value is above the e-way threshold and no e-way bill is recorded. The order cannot leave until it is.';
    case 'eway-expired':
      return 'The e-way bill has expired — record the extended bill before the order can leave.';
    case 'ready':
      return gate.expiresToday ? 'Recorded — the order can leave. The e-way bill expires today.' : 'Recorded — the order can leave.';
    case 'not-required':
      return gate.valueFloorPaise === null
        ? 'Not required by the client’s rule. The order carries no rates and no COD amount, so its value cannot be judged — set the client’s rule to “Every order” to require documents on every order.'
        : `Not required — the client’s rule does not ask for it, and the order’s own value (${formatRupees(gate.valueFloorPaise)}) is not above ${formatRupees(threshold)}.`;
    case 'dispatched':
      return 'Dispatched — the documents the goods left under are below.';
    case 'not-applicable':
      return context.orderStatus === 'cancelled'
        ? 'Not needed — the order is cancelled.'
        : 'Not needed — the tenant’s own goods are invoiced by the WMS (Compliance → Invoices).';
    default:
      return '—';
  }
}

/** The portal's gate line, in the client's words (A26). */
export function portalGateLine(gate: Pick<ConsignmentGateDto, 'state' | 'requiredBecause' | 'valueFloorPaise' | 'expiresToday'>): string {
  switch (gate.state) {
    case 'missing':
      return gate.requiredBecause === 'value'
        ? 'We need your tax invoice (or challan) before this order can leave — its value is above the e-way threshold.'
        : 'We need your tax invoice (or challan) before this order can leave.';
    case 'eway-required':
      return 'We need your e-way bill before this order can leave — the declared value is above the e-way threshold.';
    case 'eway-expired':
      return 'Your e-way bill has expired — record the extended bill so the order can leave.';
    case 'ready':
      return gate.expiresToday ? 'Your documents are recorded. The e-way bill expires today.' : 'Your documents are recorded — the order can leave.';
    case 'not-required':
      return 'No tax document is needed for this order. You may still record one.';
    case 'dispatched':
      return 'This order has left. The documents it left under are below.';
    default:
      return 'No documents are needed for this order.';
  }
}

/** Why a candidate cannot be handed over, by its gate (A24's builder mark). */
export function consignmentBlockerWord(state: ConsignmentGateState | undefined): string | null {
  switch (state) {
    case 'missing':
      return 'Invoice not recorded — record it first';
    case 'eway-required':
      return 'E-way bill not recorded — record it first';
    case 'eway-expired':
      return 'E-way bill expired — record the extended bill first';
    default:
      return null;
  }
}

/** The handover's per-parcel refusal words for the three codes (appended to `HANDOVER_REFUSAL_WORD`). */
export const CONSIGNMENT_REFUSAL_WORD: Readonly<Record<ConsignmentGateCode, string>> = {
  'consignment-documents-missing': 'Invoice not recorded — record it first',
  'eway-bill-required': 'E-way bill not recorded — record it first',
  'eway-bill-expired': 'E-way bill expired — record the extended bill first',
};

/** A device handover's exception flag, in words (the sheet, the worklist). */
export const COMPLIANCE_EXCEPTION_WORD: Readonly<Record<ConsignmentGateCode, string>> = {
  'consignment-documents-missing': 'Left without the brand’s invoice',
  'eway-bill-required': 'Left without the e-way bill',
  'eway-bill-expired': 'Left with an expired e-way bill',
};

/** The worklist's stage column. */
export const CONSIGNMENT_STAGE_WORD: Readonly<Record<'accepted' | 'packed', string>> = {
  accepted: 'Accepted',
  packed: 'Packed',
};

// ── a version in words ─────────────────────────────────────────────────────

/** `Invoice INV/26-27/0042 dated 30 Oct 2026`. */
export function brandDocumentLine(document: { readonly type: string; readonly number: string; readonly date: string }): string {
  return `${brandDocumentWords(document.type)} ${document.number} dated ${formatIstDate(document.date)}`;
}

/** `national, inter-state` / `29 Karnataka intra-state limit` / `national, destination unknown`. */
export function thresholdRuleWords(rule: string, supplyType: string | null): string {
  const supply = supplyType === 'inter' ? 'inter-state' : supplyType === 'intra' ? 'intra-state' : 'destination unknown';
  const state = /^state:([0-9]{2})$/.exec(rule);
  if (state !== null) {
    const name = GST_STATE_NAMES[state[1]!];
    return `${name ?? `state ${state[1]}`} intra-state limit, ${supply}`;
  }
  return `national, ${supply}`;
}

/**
 * The version's e-way verdict (A24): "Required — ₹1,18,000 is above
 * ₹50,000 (national, inter-state)". Strictly above (D17): a value equal to
 * the threshold is not above it.
 */
export function ewayVerdictLine(view: Pick<AnyConsignmentView, 'declaredValuePaise' | 'thresholdPaise' | 'thresholdRule' | 'supplyType' | 'ewayRequired'>): string {
  if (view.thresholdPaise === null) {
    return `Not required — no e-way threshold applies to this movement (${thresholdRuleWords(view.thresholdRule, view.supplyType)}).`;
  }
  const value = formatRupees(view.declaredValuePaise);
  const threshold = formatRupees(view.thresholdPaise);
  const rule = thresholdRuleWords(view.thresholdRule, view.supplyType);
  return view.ewayRequired
    ? `Required — ${value} is above ${threshold} (${rule}).`
    : `Not required — ${value} is not above ${threshold} (${rule}).`;
}

/** The version's e-way bill line: the number and dates, the exemption, or what is still owed. */
export function ewayLine(eway: ConsignmentEwayViewDto): string {
  switch (eway.status) {
    case 'recorded':
      return `E-way bill ${formatEwayBillNumber(eway.number ?? '')}${eway.date === null ? '' : ` dated ${formatIstDate(eway.date)}`}${
        eway.validUntil === null ? '' : `, valid until ${formatIstDate(eway.validUntil)}`
      }`;
    case 'exempt':
      return `Exempt — ${ewayExemptionWords(eway.exemptionReason ?? 'other')}${eway.exemptionNote === null ? '' : ` (${eway.exemptionNote})`}`;
    case 'pending':
      return 'E-way bill not recorded yet — required before the order can leave.';
    default:
      return 'No e-way bill needed.';
  }
}

/** A history row: `v1 · Amended 30 Oct 2026 — New e-way bill`. */
export function historyLine(view: Pick<AnyConsignmentView, 'seq' | 'status' | 'endedAt' | 'endReason'>, formatInstant: (iso: string) => string): string {
  const ended = view.endedAt === null ? '' : ` ${formatInstant(view.endedAt)}`;
  return `v${view.seq} · ${CONSIGNMENT_STATUS_WORD[view.status]}${ended}${view.endReason === null ? '' : ` — ${view.endReason}`}`;
}

// ── the form ───────────────────────────────────────────────────────────────

/** The backend's bounds (`CONSIGNMENT_RECORD_LIMITS`, `CONSIGNMENT_CAPTURE_LIMITS`). */
export const CONSIGNMENT_RECORD_LIMITS = {
  documentNumber: 40,
  declaredValueMaxPaise: 1_000_000_000_000,
  exemptionNote: 200,
  reason: 200,
} as const;

/** How the e-way bill is answered: the bill's number, an exemption, or nothing yet. */
export type EwayMode = 'bill' | 'exempt' | 'none';

export interface ConsignmentRecordDraft {
  readonly documentType: OrderBrandDocumentType;
  readonly documentNumber: string;
  readonly documentDate: string;
  readonly consignorGstin: string;
  /** Rupees as typed. */
  readonly declaredValue: string;
  readonly ewayMode: EwayMode;
  readonly ewayBillNumber: string;
  readonly ewayBillDate: string;
  readonly ewayValidUntil: string;
  readonly exemptionReason: EwayExemptionReason | '';
  readonly exemptionNote: string;
  readonly reason: string;
}

export type ConsignmentRecordField = Exclude<keyof ConsignmentRecordDraft, 'ewayMode'>;

/** A fresh draft: a tax invoice dated today (IST), no consignor typed (the server uses the client's GSTIN), the e-way bill's number expected. */
export function emptyConsignmentRecordDraft(nowMs: number = Date.now()): ConsignmentRecordDraft {
  return {
    documentType: 'invoice',
    documentNumber: '',
    documentDate: istToday(nowMs),
    consignorGstin: '',
    declaredValue: '',
    ewayMode: 'bill',
    ewayBillNumber: '',
    ewayBillDate: '',
    ewayValidUntil: '',
    exemptionReason: '',
    exemptionNote: '',
    reason: '',
  };
}

function rupeesText(paise: number): string {
  const whole = Math.trunc(paise / 100);
  const fraction = paise % 100;
  return fraction === 0 ? String(whole) : `${whole}.${String(fraction).padStart(2, '0')}`;
}

/**
 * An amendment's draft, prefilled from the live version (the reason starts
 * blank). A46 — a role that may not send an exemption (`canExempt: false`)
 * never starts on one: an exempt version's draft opens on "not yet", so the
 * amendment is not a guaranteed 403.
 */
export function draftFromView(view: AnyConsignmentView, options: { readonly canExempt?: boolean } = {}): ConsignmentRecordDraft {
  const eway = view.eway;
  if (eway.status === 'exempt' && options.canExempt === false) {
    return { ...draftFromView(view), ewayMode: 'none', exemptionReason: '', exemptionNote: '' };
  }
  return {
    documentType: view.brandDocument.type,
    documentNumber: view.brandDocument.number,
    documentDate: view.brandDocument.date,
    consignorGstin: view.consignorGstin,
    declaredValue: rupeesText(view.declaredValuePaise),
    ewayMode: eway.status === 'recorded' ? 'bill' : eway.status === 'exempt' ? 'exempt' : 'none',
    ewayBillNumber: eway.number ?? '',
    ewayBillDate: eway.date ?? '',
    ewayValidUntil: eway.validUntil ?? '',
    exemptionReason: eway.exemptionReason ?? '',
    exemptionNote: eway.exemptionNote ?? '',
    reason: '',
  };
}

export type ParsedConsignmentRecord =
  | { readonly ok: true; readonly body: RecordConsignmentDto }
  | { readonly ok: false; readonly field: ConsignmentRecordField; readonly problem: string };

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EWB_RE = /^[0-9]{12}$/;

function isIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

function codePoints(value: string): number {
  return [...value].length;
}

const fail = (field: ConsignmentRecordField, problem: string): ParsedConsignmentRecord => ({ ok: false, field, problem });

/**
 * The draft → the body, or the first problem naming its field. The backend's
 * order (A8, A33, A34): the brand document and its date window, the declared
 * value, the consignor GSTIN, the e-way bill (12 digits, its date, its
 * validity — required on an order's bill — never before its date, its date
 * not before the document's nor after today), the exemption (its note
 * required for "other"), the reason (required once the order is dispatched).
 * Blank optional fields are dropped, never sent as `''`.
 */
export function parseConsignmentDraft(
  draft: ConsignmentRecordDraft,
  context: { readonly createdAt: string; readonly nowMs: number; readonly reasonRequired: boolean },
): ParsedConsignmentRecord {
  const L = CONSIGNMENT_RECORD_LIMITS;
  const number = draft.documentNumber.trim();
  if (number === '') return fail('documentNumber', `Enter the number on the brand’s ${brandDocumentWords(draft.documentType).toLowerCase()}.`);
  if (codePoints(number) > L.documentNumber) return fail('documentNumber', `The document number is at most ${L.documentNumber} characters.`);
  const date = draft.documentDate.trim();
  if (date === '') return fail('documentDate', 'Enter the date on the brand’s document.');
  if (!isIsoDate(date)) return fail('documentDate', 'The document date is not a calendar date.');
  const window = brandDocumentDateWindow(context.createdAt, context.nowMs);
  if (date > window.latest) return fail('documentDate', `The document is dated after today (${formatIstDate(window.latest)}, IST).`);
  if (date < window.earliest) {
    return fail('documentDate', `The document date is more than 30 days before the order was created — the earliest accepted is ${formatIstDate(window.earliest)}.`);
  }

  const value = parseDeclaredValue(draft.declaredValue);
  if (value.problem !== null) return fail('declaredValue', value.problem);

  const gstin = parseGstinField(draft.consignorGstin, 'The consignor GSTIN');
  if (gstin.problem !== null) return fail('consignorGstin', gstin.problem);

  let ewayBill: RecordConsignmentDto['ewayBill'] | undefined;
  let ewayExemption: RecordConsignmentDto['ewayExemption'] | undefined;
  if (draft.ewayMode === 'bill') {
    const ewb = draft.ewayBillNumber.replace(/\s+/g, '');
    const ewbDate = draft.ewayBillDate.trim();
    const until = draft.ewayValidUntil.trim();
    if (ewb === '') {
      if (ewbDate !== '' || until !== '') return fail('ewayBillNumber', 'Enter the e-way bill number too — its date and validity go with it, or clear them.');
    } else {
      if (!EWB_RE.test(ewb)) return fail('ewayBillNumber', 'An e-way bill number is 12 digits.');
      if (ewbDate === '') return fail('ewayBillDate', 'Enter the e-way bill date — it goes with the number.');
      if (!isIsoDate(ewbDate)) return fail('ewayBillDate', 'The e-way bill date is not a calendar date.');
      if (until === '') return fail('ewayValidUntil', 'Enter the last day the e-way bill is valid — the goods move, so Part B is filled and the bill has a validity.');
      if (!isIsoDate(until)) return fail('ewayValidUntil', 'The validity date is not a calendar date.');
      if (until < ewbDate) return fail('ewayValidUntil', 'The e-way bill is valid until a date on or after its own date.');
      if (ewbDate < date) return fail('ewayBillDate', 'The e-way bill is dated before the brand’s document — it is generated for an issued document.');
      if (ewbDate > istToday(context.nowMs)) return fail('ewayBillDate', 'The e-way bill is dated after today (IST).');
      ewayBill = { number: ewb, date: ewbDate, validUntil: until };
    }
  } else if (draft.ewayMode === 'exempt') {
    if (draft.exemptionReason === '') return fail('exemptionReason', 'Pick why no e-way bill is needed.');
    const note = draft.exemptionNote.trim();
    if (codePoints(note) > L.exemptionNote) return fail('exemptionNote', `The note is at most ${L.exemptionNote} characters.`);
    if (draft.exemptionReason === 'other' && note === '') return fail('exemptionNote', 'Say why no e-way bill is needed.');
    ewayExemption = { reason: draft.exemptionReason, ...(note === '' ? {} : { note }) };
  }

  const reason = draft.reason.trim();
  if (codePoints(reason) > L.reason) return fail('reason', `The reason is at most ${L.reason} characters.`);
  if (context.reasonRequired && reason === '') return fail('reason', 'Say why the record is amended — the order has already left.');

  return {
    ok: true,
    body: {
      brandDocument: { type: draft.documentType, number, date },
      ...(gstin.gstin === undefined ? {} : { consignorGstin: gstin.gstin }),
      declaredValuePaise: value.paise,
      ...(ewayBill === undefined ? {} : { ewayBill }),
      ...(ewayExemption === undefined ? {} : { ewayExemption }),
      ...(reason === '' ? {} : { reason }),
    },
  };
}

/**
 * A41 / A32 — the record's own warnings, never refusals: the e-way bill's
 * validity ends before today (it would read expired), the declared value
 * under the rated value.
 */
export function ewayValidityWarning(validUntil: string | null, nowMs: number): string | null {
  if (validUntil === null) return null;
  const today = istToday(nowMs);
  if (validUntil < today) return `This e-way bill expired on ${formatIstDate(validUntil)} — the order cannot leave under it. Record the extended bill.`;
  if (validUntil === today) return 'This e-way bill expires today — hand the order over today, or record the extended bill.';
  return null;
}

// ── refusals ───────────────────────────────────────────────────────────────

function str(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** `eway-threshold-missing` (D20) — the data fault, in the web's copy. */
export const EWAY_THRESHOLD_MISSING_REASON = 'No e-way threshold is configured for that date — contact support.';

/**
 * The record's (and the withdraw's) refusals, by `code` (guide §3). The
 * transport arm is the house unreachable copy.
 */
export function consignmentReason(error: unknown): string {
  if (!(error instanceof ApiProblem)) return UNREACHABLE_REASON;
  const x = error.extensions;
  switch (error.code) {
    case 'validation-failed':
      return error.detail ?? 'Check the fields and try again.';
    case 'role-denied':
      // A46 — the server names the elevated case ("Only an office role can record an e-way exemption").
      return error.detail ?? 'Your role cannot record the brand’s documents.';
    case 'permission-denied':
      return 'That order belongs to another workspace — sign in again.';
    case 'unauthenticated':
      return 'Your session expired — sign in again.';
    case 'not-found':
      return 'This order no longer exists — refresh the list.';
    case 'order-not-open':
      return 'The order is cancelled — there is nothing to record.';
    case 'own-goods-invoiced':
      return 'The tenant’s own goods are invoiced by the WMS — see Compliance → Invoices.';
    case 'eway-bill-in-use': {
      const label = str(x['orderLabel']);
      return `This e-way bill is already recorded on ${label === null ? 'another order' : `order ${label}`} — check the number, or withdraw it there first.`;
    }
    case 'consignment-version-limit':
      return 'This order’s record has been amended 99 times — contact support.';
    case 'eway-threshold-missing':
      return EWAY_THRESHOLD_MISSING_REASON;
    case 'declared-value-below-order-value':
      return error.detail ?? 'The declared value is below the order’s COD amount — check the brand’s document.';
    case 'client-departed':
      return CLIENT_DEPARTED_REASON;
    case 'client-suspended':
      return 'Your account is suspended — contact the warehouse.';
    case 'consignment-not-found':
      return 'No record is live on this order — there is nothing to withdraw. Refresh.';
    case 'order-dispatched':
      return 'The order has left — amend the record instead; a record the goods left under stays.';
    case 'idempotency-key-reuse':
      return 'The record changed after it was first sent — submit it again.';
    case 'conflict':
      return error.detail ?? 'The same request is already being processed — wait a moment and refresh.';
    default:
      return error.detail ?? `Not recorded (${error.code}).`;
  }
}

/** Codes after which the panel's read is stale (the world moved) and is re-read. */
export function consignmentRefusalReloads(error: unknown): boolean {
  return error instanceof ApiProblem && ['order-not-open', 'consignment-not-found', 'order-dispatched', 'not-found'].includes(error.code);
}

/**
 * The gate's own refusal (409 from a per-order dispatch — A13), worded from
 * its extensions: what is missing, why it is required, and where to record
 * it. Null for any other problem.
 */
export function gateRefusalSentence(error: unknown): string | null {
  if (!(error instanceof ApiProblem)) return null;
  const x = error.extensions;
  const threshold = num(x['thresholdPaise']) ?? NATIONAL_EWAY_THRESHOLD_PAISE;
  switch (error.code) {
    case 'consignment-documents-missing': {
      const because = str(x['requiredBecause']);
      const floor = num(x['valueFloorPaise']);
      const why =
        because === 'policy-b2b'
          ? 'it is a B2B order and the client’s rule requires the brand’s document'
          : because === 'policy-all'
            ? 'the client’s rule requires the brand’s document on every order'
            : `its own value${floor === null ? '' : ` (${formatRupees(floor)})`} is above the e-way threshold of ${formatRupees(threshold)}`;
      return `Not dispatched — no brand invoice (or challan) is recorded, and ${why}. Record it under Tax documents, or the brand records it in its portal.`;
    }
    case 'eway-bill-required':
      return 'Not dispatched — the declared value is above the e-way threshold and no e-way bill is recorded. Record the brand’s e-way bill under Tax documents.';
    case 'eway-bill-expired':
      return 'Not dispatched — the e-way bill has expired. Record the extended bill under Tax documents.';
    case 'eway-threshold-missing':
      return EWAY_THRESHOLD_MISSING_REASON;
    default:
      return null;
  }
}

// ── the handover sheet (A19, A39) ──────────────────────────────────────────

/** The sheet parcel's consignment facts (optional: an older API sends none). */
export interface SheetParcelConsignment {
  readonly taxDocument?: { readonly type: string; readonly number: string; readonly date: string } | null;
  readonly ewayBillNumber?: string | null;
  readonly ewayValidUntil?: string | null;
  readonly complianceException?: string | null;
  readonly lateRecord?: {
    readonly seq: number;
    readonly brandDocument: { readonly type: string; readonly number: string; readonly date: string };
    readonly ewayBillNumber: string | null;
    readonly recordedAt: string;
  } | null;
}

/**
 * The "Invoice / challan" column, from the STAMPED version (a reprint is
 * identical): `INV INV/26-27/0042`; "Not recorded" only when no version was
 * stamped and the parcel left flagged (A39); else "—".
 */
export function sheetDocumentCell(parcel: SheetParcelConsignment): string {
  const doc = parcel.taxDocument ?? null;
  if (doc !== null) return `${brandDocumentTag(doc.type)} ${doc.number}`;
  return (parcel.complianceException ?? null) !== null ? 'Not recorded' : '—';
}

/** The "E-way bill" column: `1234 5678 9012`, with its last valid day when known. */
export function sheetEwayCell(parcel: SheetParcelConsignment): string {
  const number = parcel.ewayBillNumber ?? null;
  if (number !== null) {
    const until = parcel.ewayValidUntil ?? null;
    return until === null ? formatEwayBillNumber(number) : `${formatEwayBillNumber(number)} (to ${formatIstDate(until)})`;
  }
  return (parcel.taxDocument ?? null) === null && (parcel.complianceException ?? null) !== null ? 'Not recorded' : '—';
}

/**
 * A39 — the staff note under a flagged parcel: "Left without the brand’s
 * invoice — cleared by a late record (v2, 31 Oct 2026, 14:10 IST)", or the
 * flag alone. Null when the parcel left unflagged.
 */
export function sheetExceptionNote(parcel: SheetParcelConsignment, formatInstant: (iso: string) => string): string | null {
  const code = parcel.complianceException ?? null;
  if (code === null) return null;
  const word = (COMPLIANCE_EXCEPTION_WORD as Readonly<Record<string, string>>)[code] ?? 'Left without the brand’s documents';
  const late = parcel.lateRecord ?? null;
  return late === null ? word : `${word} — cleared by a late record (v${late.seq}, ${formatInstant(late.recordedAt)})`;
}

/** The worklist's age column: "today", "1 day", "4 days" (IST calendar days since the order was created). */
export function orderAgeWords(createdAt: string, nowMs: number): string {
  const IST_MS = 5.5 * 3600 * 1000;
  const day = (ms: number) => Math.floor((ms + IST_MS) / 86_400_000);
  const days = day(nowMs) - day(Date.parse(createdAt));
  if (days <= 0) return 'today';
  return days === 1 ? '1 day' : `${days} days`;
}

/** The portal banner (A26): "3 orders are waiting for your invoice or e-way bill". Null when none. */
export function portalNeededBanner(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? '1 order is waiting for your invoice or e-way bill' : `${count} orders are waiting for your invoice or e-way bill`;
}

/** Story 4-6a (A11) — the client documents rule's read and save refusals, by code. */
export function consignmentPolicyReason(error: unknown): string {
  if (!(error instanceof ApiProblem)) return UNREACHABLE_REASON;
  switch (error.code) {
    case 'not-found':
      return 'This client no longer exists — refresh the list.';
    case 'permission-denied':
      return 'That client belongs to another workspace — sign in again.';
    case 'role-denied':
      return 'Your role cannot change a client’s documents rule.';
    case 'unauthenticated':
      return 'Your session expired — sign in again.';
    case 'validation-failed':
      return error.detail ?? 'The rule was refused as sent — pick one and save again.';
    case 'idempotency-key-reuse':
      return 'The rule changed after it was first sent — save it again.';
    default:
      return `Not saved (${error.code}).`;
  }
}

// ── the return dispatches (A22, A25, A41) ──────────────────────────────────

/**
 * A declared value (₹ text) → paise, or a problem: required on the web (the
 * order record, and both return dispatch forms — the API keeps it optional
 * on the returns for older callers), at most `declaredValueMaxPaise`.
 */
export function parseDeclaredValue(text: string): { readonly paise: number; readonly problem: null } | { readonly paise: null; readonly problem: string } {
  if (text.trim() === '') {
    return { paise: null, problem: 'Enter the value on the brand’s document (including tax) — the e-way threshold is judged from it.' };
  }
  const parsed = parseRupees(text);
  if ('problem' in parsed) return { paise: null, problem: parsed.problem };
  if (parsed.paise > CONSIGNMENT_RECORD_LIMITS.declaredValueMaxPaise) {
    return { paise: null, problem: `The declared value is at most ${formatRupees(CONSIGNMENT_RECORD_LIMITS.declaredValueMaxPaise)}.` };
  }
  return { paise: parsed.paise, problem: null };
}

/**
 * A return dispatch's e-way refusals, worded with the server's figures
 * (`extensions.declaredValuePaise`, `thresholdPaise`, `thresholdRule`). Null
 * for any other problem.
 */
export function ewayDispatchRefusal(error: unknown): string | null {
  if (!(error instanceof ApiProblem)) return null;
  const x = error.extensions;
  const value = num(x['declaredValuePaise']);
  const threshold = num(x['thresholdPaise']);
  const rule = str(x['thresholdRule']);
  switch (error.code) {
    case 'eway-bill-required': {
      const ruleWords = rule === null ? '' : ` (${thresholdRuleWords(rule, null).replace(/, destination unknown$/, '')})`;
      const figures =
        value !== null && threshold !== null
          ? `The declared value ${formatRupees(value)} is above the e-way threshold ${formatRupees(threshold)}${ruleWords}`
          : 'The declared value is above the e-way threshold';
      return `${figures} — enter the brand’s e-way bill number and its date.`;
    }
    case 'eway-bill-expired':
      return 'The e-way bill’s validity ended before today — enter the extended bill’s validity, or its new number.';
    case 'eway-threshold-missing':
      return EWAY_THRESHOLD_MISSING_REASON;
    default:
      return null;
  }
}
