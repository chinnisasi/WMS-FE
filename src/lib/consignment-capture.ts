/**
 * Story 2-8b (decision 9, A7, A8) — the consignment capture of a goods-out
 * document the WMS records but does not issue: the brand's movement document
 * (its challan or invoice), the e-way bill, who carries the goods and the
 * packages. The web's pure mirror of wms-be `shared/primitives/
 * consignment-capture.ts`, so the dispatch form refuses nothing the server
 * would accept and sends nothing the server can only answer 400 to.
 *
 * Kind-neutral on purpose: the return to vendor (2-8b) is its first user,
 * 4-7c's return to client reuses it unchanged through the shared
 * `components/shared/return-dispatch-form.tsx`. The document-specific part
 * — which instant the 30-day window counts back from — is the caller's
 * `createdAt`.
 *
 * Pure: no React, no fetch — pinned by `consignment-capture.test.ts`.
 */
import type { DispatchVendorReturnDto, PartnerDto } from '@/lib/api/generated';
import { GST_STATE_NAMES, gstinStateName } from '@/lib/gst-states';
import { parseGstinField } from '@/lib/gstin';
import { EWB_NO_RE, VEHICLE_NO_RE, VEHICLE_RULE, istToday, normalizeVehicleNo } from '@/lib/gate-ins';
import { formatIstDate, istDateOf } from '@/lib/rate-cards';

/**
 * The capture body every goods-out dispatch sends. Structurally the RTV's
 * `DispatchVendorReturnDto` (pinned below); 4-7c's RTC dispatch DTO carries
 * the same members.
 */
export interface ConsignmentCaptureBody {
  readonly brandDocument: { readonly type: BrandDocumentType; readonly number: string; readonly date: string };
  readonly consignorGstin?: string;
  readonly debitNoteNumber?: string;
  readonly ewayBillNumber?: string;
  readonly ewayBillDate?: string;
  readonly ewayValidUntil?: string;
  readonly transporterId?: string;
  readonly carrierName?: string;
  readonly vehicleNumber?: string;
  readonly trackingRef?: string;
  readonly packageCount: number;
}

/** The brand's movement document (A8 — a debit note is a claim, not a movement document). */
export type BrandDocumentType = DispatchVendorReturnDto['brandDocument']['type'];

/** Record-typed over the generated union: a new type must be labelled to compile. */
export const BRAND_DOCUMENT_LABEL: Readonly<Record<BrandDocumentType, string>> = {
  challan: 'Delivery challan',
  invoice: 'Tax invoice',
};

export const BRAND_DOCUMENT_TYPES = Object.keys(BRAND_DOCUMENT_LABEL) as readonly BrandDocumentType[];

/** The server's bounds (`CONSIGNMENT_CAPTURE_LIMITS`, wms-be `consignment-capture.ts`). */
export const CONSIGNMENT_LIMITS = {
  /** The gate-in document-number limit. */
  documentNumber: 40,
  debitNoteNumber: 40,
  carrierName: 100,
  trackingRef: 50,
  packageCountMin: 1,
  packageCountMax: 9999,
  /** A8 — the brand document may be dated at most this many days before the document's creation day. */
  documentDateLookbackDays: 30,
} as const;

/** The e-way bill line under its inputs (decision 9 — recorded, never generated, never judged). */
export const EWAY_THRESHOLD_HINT =
  "The WMS records the brand's e-way bill; it does not know the consignment value, so it cannot judge the ₹50,000 threshold.";

/** Why a carrier identity is required, in words (the form's hint and its problem). */
export const CARRIER_IDENTITY_RULE = 'Name who carries the goods — a transporter, a carrier name or a vehicle number (at least one).';

export { VEHICLE_RULE };

/** The form's fields — the problem names one, so the form marks it. */
export type ConsignmentField =
  | 'documentType'
  | 'documentNumber'
  | 'documentDate'
  | 'consignorGstin'
  | 'debitNoteNumber'
  | 'ewayBillNumber'
  | 'ewayBillDate'
  | 'ewayValidUntil'
  | 'carrier'
  | 'vehicleNumber'
  | 'trackingRef'
  | 'packageCount';

/** The form as typed. `carrierMode` picks the transporter partner or a typed carrier name (the gate-in idiom). */
export interface ConsignmentDraft {
  readonly documentType: BrandDocumentType;
  readonly documentNumber: string;
  readonly documentDate: string;
  readonly consignorGstin: string;
  readonly debitNoteNumber: string;
  readonly ewayBillNumber: string;
  readonly ewayBillDate: string;
  readonly ewayValidUntil: string;
  readonly carrierMode: 'partner' | 'typed';
  readonly transporterId: string;
  readonly carrierName: string;
  readonly vehicleNumber: string;
  readonly trackingRef: string;
  readonly packageCount: string;
}

/**
 * A fresh draft: a challan (the usual movement document for goods going
 * back), dated today (IST), the consignor GSTIN pre-filled with the brand's
 * frozen GSTIN (A7 — the server's own default), the transporter picker.
 */
export function emptyConsignmentDraft(defaultConsignorGstin: string | null, nowMs: number = Date.now()): ConsignmentDraft {
  return {
    documentType: 'challan',
    documentNumber: '',
    documentDate: istToday(nowMs),
    consignorGstin: defaultConsignorGstin ?? '',
    debitNoteNumber: '',
    ewayBillNumber: '',
    ewayBillDate: '',
    ewayValidUntil: '',
    carrierMode: 'partner',
    transporterId: '',
    carrierName: '',
    vehicleNumber: '',
    trackingRef: '',
    packageCount: '',
  };
}

export type ParsedConsignment =
  | { readonly ok: true; readonly body: ConsignmentCaptureBody }
  | { readonly ok: false; readonly field: ConsignmentField; readonly problem: string };

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WHOLE_RE = /^\d+$/;

function codePoints(value: string): number {
  return [...value].length;
}

function isIsoDate(value: string): boolean {
  if (!ISO_DATE_RE.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

/** `date` (YYYY-MM-DD) moved by `days` calendar days. */
export function addIsoDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The brand document's accepted dates (A8): no later than today (IST), no
 * earlier than the document's creation IST date minus 30 days — the
 * server's `assertBrandDocumentDateWindow`, read on the browser's clock (the
 * server's clock still decides).
 */
export function brandDocumentDateWindow(createdAt: string, nowMs: number): { readonly earliest: string; readonly latest: string } {
  return {
    earliest: addIsoDays(istDateOf(createdAt), -CONSIGNMENT_LIMITS.documentDateLookbackDays),
    latest: istToday(nowMs),
  };
}

const trimmed = (value: string): string => value.trim();
const fail = (field: ConsignmentField, problem: string): ParsedConsignment => ({ ok: false, field, problem });

/**
 * The draft → the body, or the first problem naming its field. The server's
 * normalise step mirrored: text trimmed, blank → absent (never `''`), the
 * vehicle normalised (`normalizeVehicleNo`), the GSTIN upper-cased; then its
 * shape rules in field order, then the date window.
 */
export function parseConsignmentDraft(
  draft: ConsignmentDraft,
  context: { readonly createdAt: string; readonly nowMs: number },
): ParsedConsignment {
  const L = CONSIGNMENT_LIMITS;
  // The brand's movement document — required: goods cannot legally travel without one.
  const number = trimmed(draft.documentNumber);
  if (number === '') return fail('documentNumber', "Enter the brand's challan or invoice number — the goods travel under it.");
  if (codePoints(number) > L.documentNumber) return fail('documentNumber', `The document number is at most ${L.documentNumber} characters.`);
  const date = trimmed(draft.documentDate);
  if (date === '') return fail('documentDate', "Enter the date on the brand's document.");
  if (!isIsoDate(date)) return fail('documentDate', 'The document date is not a calendar date.');
  const window = brandDocumentDateWindow(context.createdAt, context.nowMs);
  if (date > window.latest) {
    return fail('documentDate', `The document is dated after today (${formatIstDate(window.latest)}, IST) — it is dated on or before the dispatch.`);
  }
  if (date < window.earliest) {
    return fail(
      'documentDate',
      `The document date is more than ${L.documentDateLookbackDays} days before the return was created — the earliest accepted is ${formatIstDate(window.earliest)}.`,
    );
  }

  const gstin = parseGstinField(draft.consignorGstin, 'The consignor GSTIN');
  if (gstin.problem !== null) return fail('consignorGstin', gstin.problem);

  const debitNote = trimmed(draft.debitNoteNumber);
  if (codePoints(debitNote) > L.debitNoteNumber) return fail('debitNoteNumber', `The debit note number is at most ${L.debitNoteNumber} characters.`);

  // The e-way bill — optional, recorded only; a number carries its date.
  const ewb = trimmed(draft.ewayBillNumber);
  const ewbDate = trimmed(draft.ewayBillDate);
  const ewbUntil = trimmed(draft.ewayValidUntil);
  if (ewb !== '') {
    if (!EWB_NO_RE.test(ewb)) return fail('ewayBillNumber', 'An e-way bill number is 12 digits.');
    if (ewbDate === '') return fail('ewayBillDate', 'Enter the e-way bill date — it goes with the number.');
  } else if (ewbDate !== '' || ewbUntil !== '') {
    return fail('ewayBillNumber', 'Enter the e-way bill number too — its date and validity go with it, or clear them.');
  }
  if (ewbDate !== '' && !isIsoDate(ewbDate)) return fail('ewayBillDate', 'The e-way bill date is not a calendar date.');
  if (ewbUntil !== '') {
    if (!isIsoDate(ewbUntil)) return fail('ewayValidUntil', 'The validity date is not a calendar date.');
    if (ewbUntil < ewbDate) return fail('ewayValidUntil', 'The e-way bill is valid until a date on or after its own date.');
  }

  // Who carries the goods — a transporter or a typed carrier, and/or a vehicle.
  const transporterId = draft.carrierMode === 'partner' ? trimmed(draft.transporterId) : '';
  const carrierName = draft.carrierMode === 'typed' ? trimmed(draft.carrierName) : '';
  if (codePoints(carrierName) > L.carrierName) return fail('carrier', `The carrier name is at most ${L.carrierName} characters.`);
  const vehicle = normalizeVehicleNo(draft.vehicleNumber);
  if (vehicle !== null && !VEHICLE_NO_RE.test(vehicle)) return fail('vehicleNumber', `The vehicle number is ${VEHICLE_RULE}.`);
  if (transporterId === '' && carrierName === '' && vehicle === null) return fail('carrier', CARRIER_IDENTITY_RULE);

  const tracking = trimmed(draft.trackingRef);
  if (codePoints(tracking) > L.trackingRef) return fail('trackingRef', `The AWB or LR number is at most ${L.trackingRef} characters.`);

  const packages = trimmed(draft.packageCount);
  const count = WHOLE_RE.test(packages) ? Number(packages) : NaN;
  if (!Number.isInteger(count) || count < L.packageCountMin || count > L.packageCountMax) {
    return fail('packageCount', `Enter the number of packages — a whole number, ${L.packageCountMin}–${L.packageCountMax}.`);
  }

  return {
    ok: true,
    body: {
      brandDocument: { type: draft.documentType, number, date },
      ...(gstin.gstin === undefined ? {} : { consignorGstin: gstin.gstin }),
      ...(debitNote === '' ? {} : { debitNoteNumber: debitNote }),
      ...(ewb === '' ? {} : { ewayBillNumber: ewb, ewayBillDate: ewbDate }),
      ...(ewbUntil === '' ? {} : { ewayValidUntil: ewbUntil }),
      ...(transporterId === '' ? {} : { transporterId }),
      ...(carrierName === '' ? {} : { carrierName }),
      ...(vehicle === null ? {} : { vehicleNumber: vehicle }),
      ...(tracking === '' ? {} : { trackingRef: tracking }),
      packageCount: count,
    },
  };
}

/**
 * A7 — the consignor GSTIN's state against the warehouse's (its GSTIN
 * prefix, when it has one): the brand's challan must name its registration in
 * the state the goods leave from. A warning, never a block — the note prints
 * the GSTIN as entered. Null when they agree, or either is unknown.
 */
export function consignorStateWarning(consignorGstinText: string, warehouseGstin: string | null): string | null {
  const consignorState = gstinStateName(consignorGstinText);
  if (consignorState === null || warehouseGstin === null) return null;
  const warehouseState = gstinStateName(warehouseGstin);
  if (warehouseState === null || warehouseState === consignorState) return null;
  return `This GSTIN is registered in ${consignorState}, but the goods leave from ${warehouseState}. The brand's challan normally names its registration in the dispatching state — check it, or enter the brand's GSTIN for ${warehouseState}.`;
}

/** A state code as words: `29 Karnataka`, the code alone when unknown, '—' when absent. */
export function stateCodeLabel(stateCode: string | null | undefined): string {
  if (stateCode === null || stateCode === undefined || stateCode === '') return '—';
  const name = GST_STATE_NAMES[stateCode];
  return name === undefined ? stateCode : `${stateCode} ${name}`;
}

/** The transporter options the form offers: active `transporter` partners, by code. */
export type TransporterOption = Pick<PartnerDto, 'id' | 'code' | 'name'>;

// ── the printable dispatch note's model (kind-neutral, `return-dispatch-note.tsx`) ──

export interface NoteParty {
  readonly heading: string;
  readonly name: string;
  /** Lines under the name (code, address, …). */
  readonly lines: readonly string[];
  /** Labelled facts (GSTIN, state) — absent when the party prints none. */
  readonly facts: readonly { readonly label: string; readonly value: string }[];
}

export interface NoteLine {
  readonly key: string;
  readonly lineNo: number;
  readonly skuCode: string;
  readonly skuName: string;
  readonly hsn: string;
  readonly batch: string;
  readonly quantity: string;
  readonly uom: string;
  readonly reason: string;
}

export interface DispatchNoteModel {
  readonly title: string;
  readonly code: string;
  readonly dateLabel: string;
  /** False — the note prints as a pick list under the draft watermark. */
  readonly dispatched: boolean;
  readonly watermark: string | null;
  readonly copies: readonly string[];
  readonly consignor: NoteParty;
  readonly dispatchedFrom: NoteParty;
  readonly consignee: NoteParty;
  readonly lines: readonly NoteLine[];
  /** The capture (brand document, e-way bill, carrier…) as label / value pairs; empty before dispatch. */
  readonly capture: readonly { readonly label: string; readonly value: string }[];
  readonly note: string | null;
  readonly footer: string;
  readonly signatures: readonly string[];
}

// The body is assignable to the generated RTV DTO (a drift is a compile error).
const _bodyFitsRtvDto: (body: ConsignmentCaptureBody) => DispatchVendorReturnDto = (body) => body;
void _bodyFitsRtvDto;
