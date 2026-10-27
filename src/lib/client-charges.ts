/**
 * Story 5-5a — ad-hoc charges on the web: one billable event (extra labour,
 * relabelling, repacking, …) for one client in one warehouse on one IST day,
 * recorded, approved by a second person when it has to be, and billed as its
 * own line on that month's invoice. The vocabularies mirrored from wms-be
 * (`billing/client-charges.ts`), the record form's parser (the backend's
 * shape rules, so a guaranteed 400 is never sent), the amount preview (the
 * backend's exact integer arithmetic), the per-charge actions (capability and
 * the second-approver rule), the billing cell, the list filters in the URL,
 * the policy editor's parser and the copy for every refusal.
 *
 * Pure: no React, no fetch — pinned by `client-charges.test.ts`. The server
 * decides every figure; the preview only says what it will compute.
 */
import { ApiProblem } from '@/lib/api/client';
import type { ClientChargeDto, ClientChargeWarningDto, RecordClientChargeDto, RecordClientChargeResponse } from '@/lib/api/generated';
import type { SearchParamsRecord } from '@/lib/drill';
import { formatRupees } from '@/lib/invoices';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import { parseRupees } from '@/lib/rupees';
import { groupDecimal } from '@/lib/usage';

/** Fired on `window` after a charge mutation so the list (and the policy) refetch. */
export const CLIENT_CHARGES_CHANGED_EVENT = 'wms-client-charges-changed';

export function notifyClientChargesChanged(): void {
  window.dispatchEvent(new Event(CLIENT_CHARGES_CHANGED_EVENT));
}

// ── vocabulary ───────────────────────────────────────────────────────────────

export type ChargeCategory = RecordClientChargeDto['category'];
export type ChargeUnit = RecordClientChargeDto['unit'];
export type ChargeSac = NonNullable<RecordClientChargeDto['sacCode']>;
export type ChargeStatus = ClientChargeDto['status'];
export type ChargeWarningCode = ClientChargeWarningDto['code'];

/** Decision 3 — the closed list, in the backend's order. */
export const CHARGE_CATEGORIES: readonly ChargeCategory[] = [
  'extra_labour',
  'special_handling',
  'returns_processing',
  'relabelling',
  'repacking',
  're_slotting',
  'extra_storage',
  'other',
];

/** A10 — the printed labels (the backend's `CHARGE_CATEGORY_LABELS`, word for word). */
export const CHARGE_CATEGORY_LABEL: Readonly<Record<ChargeCategory, string>> = {
  extra_labour: 'Extra labour',
  special_handling: 'Special handling',
  returns_processing: 'Returns processing',
  relabelling: 'Relabelling',
  repacking: 'Repacking',
  re_slotting: 'Re-slotting',
  extra_storage: 'Extra storage',
  other: 'Other service',
};

/** Decision 4 — each category fixes its SAC; `other` chooses one of `OTHER_SACS`. */
export const SAC_BY_CATEGORY: Readonly<Record<Exclude<ChargeCategory, 'other'>, ChargeSac>> = {
  extra_labour: '996719',
  special_handling: '996719',
  returns_processing: '996719',
  relabelling: '998540',
  repacking: '998540',
  re_slotting: '996729',
  extra_storage: '996729',
};

export const OTHER_SACS: readonly ChargeSac[] = ['996729', '996719', '998540', '998599'];

/** What each services SAC covers, for the `other` select and the SAC hint. */
export const SAC_LABEL: Readonly<Record<ChargeSac, string>> = {
  '996729': 'Storage and warehousing',
  '996719': 'Cargo handling',
  '998540': 'Packaging services',
  '998599': 'Other support services',
};

/** The SAC a category bills under — `other`'s is the chosen one (null until chosen). */
export function sacOf(category: ChargeCategory, chosen: ChargeSac | ''): ChargeSac | null {
  if (category === 'other') return chosen === '' ? null : chosen;
  return SAC_BY_CATEGORY[category];
}

/** Decision 5 — the unit a quantity counts. */
export const CHARGE_UNITS: readonly ChargeUnit[] = ['each', 'hour', 'day', 'carton', 'pallet', 'order', 'shipment', 'container', 'kg', 'lot'];

/** A unit's nouns: one, many. */
const UNIT_NOUNS: Readonly<Record<ChargeUnit, readonly [string, string]>> = {
  each: ['unit', 'units'],
  hour: ['hour', 'hours'],
  day: ['day', 'days'],
  carton: ['carton', 'cartons'],
  pallet: ['pallet', 'pallets'],
  order: ['order', 'orders'],
  shipment: ['shipment', 'shipments'],
  container: ['container', 'containers'],
  kg: ['kg', 'kg'],
  lot: ['lot', 'lots'],
};

/** The unit select's label: `Hour`, `Each (unit)`, `Kg`. */
export function unitOptionLabel(unit: ChargeUnit): string {
  if (unit === 'each') return 'Each (unit)';
  return unit === 'kg' ? 'Kg' : `${unit.charAt(0).toUpperCase()}${unit.slice(1)}`;
}

const isOne = (quantity: string): boolean => /^0*1(\.0*)?$/.test(quantity);

/** `2.5 hours`, `1 pallet` — the server's exact decimal string, grouped only. An unknown unit is named as given. */
export function chargeQuantityText(quantity: string, unit: string | null): string {
  const nouns = unit !== null && Object.prototype.hasOwnProperty.call(UNIT_NOUNS, unit) ? UNIT_NOUNS[unit as ChargeUnit] : null;
  const noun = nouns === null ? (unit ?? 'units') : isOne(quantity) ? nouns[0] : nouns[1];
  return `${groupDecimal(quantity)} ${noun}`;
}

/** The plural noun of a unit (`hours`, `kg`) — the quantity field's label. */
export function unitPlural(unit: ChargeUnit): string {
  return UNIT_NOUNS[unit][1];
}

/** `per hour`, `per unit` — the rate's basis for an ad-hoc charge. */
export function perUnitLabel(unit: string | null): string {
  const nouns = unit !== null && Object.prototype.hasOwnProperty.call(UNIT_NOUNS, unit) ? UNIT_NOUNS[unit as ChargeUnit] : null;
  return `per ${nouns === null ? (unit ?? 'unit') : nouns[0]}`;
}

export const CHARGE_STATUSES: readonly ChargeStatus[] = ['pending', 'approved', 'rejected', 'cancelled'];

export const CHARGE_STATUS_LABEL: Readonly<Record<ChargeStatus, string>> = {
  pending: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

/** The chip's tone and glyph — a word always, never colour alone (UI-PATTERNS §9.2). */
export const CHARGE_STATUS_TONE: Readonly<Record<ChargeStatus, { readonly tone: 'warning' | 'success' | 'danger' | 'neutral'; readonly glyph: string }>> = {
  pending: { tone: 'warning', glyph: '◷' },
  approved: { tone: 'success', glyph: '✓' },
  rejected: { tone: 'danger', glyph: '✕' },
  cancelled: { tone: 'neutral', glyph: '–' },
};

export const CHARGE_WARNING_LABEL: Readonly<Record<ChargeWarningCode, string>> = {
  'charge-late': 'Recorded late',
  'charge-billed-later': 'Bills on a later invoice',
  'charge-may-bring-minimum': 'May bring the minimum',
  'charge-disables-minimum': 'Turns off the minimum',
};

/** A warning this build does not know still renders — by its code, never dropped. */
export function chargeWarningLabel(code: string): string {
  return CHARGE_WARNING_LABEL[code as ChargeWarningCode] ?? code;
}

// ── bounds (the backend's A29 / text CHECKs) ────────────────────────────────

export const CHARGE_DESCRIPTION_MAX = 200;
export const CHARGE_REFERENCE_MAX = 100;
export const CHARGE_NOTE_MAX = 500;
export const MAX_CHARGE_QUANTITY_MILLI = 10_000_000n;
export const MAX_CHARGE_RATE_PAISE = 10_000_000;
export const MAX_CHARGE_AMOUNT_PAISE = 1_000_000_000;
export const DEFAULT_SELF_APPROVE_LIMIT_PAISE = 1_000_000;
export const MAX_SELF_APPROVE_LIMIT_PAISE = 1_000_000_000;

const codePoints = (value: string): number => [...value].length;

// ── months and dates ─────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-10-01` (or `2026-10`) → `Oct 2026`. */
export function billMonthLabel(month: string): string {
  return `${MONTHS[Number(month.slice(5, 7)) - 1] ?? month.slice(5, 7)} ${month.slice(0, 4)}`;
}

/** `2026-10-05` → `5 Oct 2026`. */
export function chargeDateLabel(date: string): string {
  return `${Number(date.slice(8, 10))} ${billMonthLabel(date)}`;
}

/**
 * A10 — the earliest `chargeDate` the server takes: 1 April of the PREVIOUS
 * financial year of `today` (IST). Today 2026-10-27 (FY 2026-27) → 2025-04-01;
 * today 2027-02-01 (still FY 2026-27) → 2025-04-01; today 2027-04-01 → 2026-04-01.
 */
export function earliestChargeDate(today: string): string {
  const year = Number(today.slice(0, 4));
  const fyStart = Number(today.slice(5, 7)) >= 4 ? year : year - 1;
  return `${fyStart - 1}-04-01`;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

// ── the amount (the backend's arithmetic, exactly) ──────────────────────────

/** `"2.5"` → 2500n milli-units; null unless a non-negative decimal of ≤ 3 places (the backend's `parseChargeQuantity`). */
export function parseQuantityMilli(text: string): bigint | null {
  const match = /^(\d{1,8})(?:\.(\d{1,3}))?$/.exec(text.trim());
  if (match === null) return null;
  return BigInt(match[1]!) * 1000n + BigInt((match[2] ?? '').padEnd(3, '0'));
}

/** `round_half_up(quantity_milli × rate / 1000)` in BigInt — the A29 CHECK's arithmetic; no float anywhere. */
export function chargeAmountPaise(quantityMilli: bigint, unitRatePaise: number): number {
  return Number((quantityMilli * BigInt(unitRatePaise) + 500n) / 1000n);
}

type QuantityResult = { milli: bigint; problem: null } | { milli: null; problem: string };
type RateResult = { paise: number; problem: null } | { paise: null; problem: string };

function quantityOf(text: string): QuantityResult {
  if (text.trim() === '') return { milli: null, problem: 'Enter the quantity.' };
  const milli = parseQuantityMilli(text);
  if (milli === null) return { milli: null, problem: 'Enter a number like 2 or 2.5 (at most three decimal places).' };
  if (milli < 1n) return { milli: null, problem: 'The quantity must be more than 0.' };
  if (milli > MAX_CHARGE_QUANTITY_MILLI) return { milli: null, problem: 'At most 10,000 per charge — record a larger job as several charges.' };
  return { milli, problem: null };
}

function rateOf(text: string): RateResult {
  if (text.trim() === '') return { paise: null, problem: 'Enter the rate per unit.' };
  const parsed = parseRupees(text);
  if ('problem' in parsed) return { paise: null, problem: parsed.problem };
  if (parsed.paise < 1) return { paise: null, problem: 'The rate must be at least ₹0.01.' };
  if (parsed.paise > MAX_CHARGE_RATE_PAISE) return { paise: null, problem: `At most ${formatRupees(MAX_CHARGE_RATE_PAISE)} per unit.` };
  return { paise: parsed.paise, problem: null };
}

/** The bound the amount must sit in, worded; null when it does. */
function amountProblem(paise: number): string | null {
  if (paise < 1) return 'Quantity × rate rounds to ₹0.00 — nothing to bill.';
  if (paise > MAX_CHARGE_AMOUNT_PAISE) return `Quantity × rate is over the ${formatRupees(MAX_CHARGE_AMOUNT_PAISE)} cap for one charge.`;
  return null;
}

/**
 * The live preview under the quantity and rate: the amount the server will
 * compute (`₹875.00`), a problem once both are typed but the amount cannot be
 * billed, or null while either is incomplete or malformed (their own fields
 * say why).
 */
export function chargeAmountPreview(quantityText: string, rateText: string): { paise: number; problem: null } | { paise: null; problem: string } | null {
  const quantity = quantityOf(quantityText);
  const rate = rateOf(rateText);
  if (quantity.milli === null || rate.paise === null) return null;
  const paise = chargeAmountPaise(quantity.milli, rate.paise);
  const problem = amountProblem(paise);
  return problem === null ? { paise, problem: null } : { paise: null, problem };
}

// ── the record form ──────────────────────────────────────────────────────────

export interface ChargeForm {
  readonly clientId: string;
  readonly warehouseId: string;
  /** IST date, `YYYY-MM-DD`. */
  readonly chargeDate: string;
  readonly category: ChargeCategory | '';
  readonly description: string;
  /** Chosen only for `other`. */
  readonly sacCode: ChargeSac | '';
  readonly unit: ChargeUnit | '';
  /** The decimal text typed. */
  readonly quantity: string;
  /** The rupee text typed, per unit. */
  readonly rate: string;
  readonly reference: string;
  readonly clientAuthorizationRef: string;
  readonly evidenceNote: string;
}

export function emptyChargeForm(today: string, clientId = '', warehouseId = ''): ChargeForm {
  return {
    clientId,
    warehouseId,
    chargeDate: today,
    category: '',
    description: '',
    sacCode: '',
    unit: '',
    quantity: '',
    rate: '',
    reference: '',
    clientAuthorizationRef: '',
    evidenceNote: '',
  };
}

export type ChargeFormField = keyof ChargeForm | 'amount';
export interface ChargeFormProblem {
  readonly field: ChargeFormField;
  readonly problem: string;
}

/** The field labels the problem summary names. */
export const CHARGE_FIELD_LABEL: Readonly<Record<ChargeFormField, string>> = {
  clientId: 'Client',
  warehouseId: 'Warehouse',
  chargeDate: 'Date of work',
  category: 'Category',
  description: 'Description',
  sacCode: 'SAC',
  unit: 'Unit',
  quantity: 'Quantity',
  rate: 'Rate',
  reference: 'Reference',
  clientAuthorizationRef: 'Client authorisation',
  evidenceNote: 'Internal note',
  amount: 'Amount',
};

function optionalText(value: string, field: ChargeFormField, max: number, problems: ChargeFormProblem[]): string | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  if (codePoints(trimmed) > max) {
    problems.push({ field, problem: `At most ${max} characters (now ${codePoints(trimmed)}).` });
    return undefined;
  }
  return trimmed;
}

/**
 * The form → the record body, or every problem at once (nothing is sent).
 * The backend's shape rules mirrored: the vocabularies, the lengths (code
 * points, trimmed; blank optional text is omitted), the quantity format and
 * range, the rate range, the amount ₹0.01 .. ₹1 crore, `other` ⇒ a SAC from
 * the four and no SAC on any other category, and the date window (≤ today,
 * ≥ 1 April of the previous FY — `today` is the IST date). The server still
 * decides; this only never sends a guaranteed 400.
 */
export function parseChargeForm(form: ChargeForm, today: string): { body: RecordClientChargeDto; problems: [] } | { body: null; problems: ChargeFormProblem[] } {
  const problems: ChargeFormProblem[] = [];
  if (form.clientId === '') problems.push({ field: 'clientId', problem: 'Pick the client to bill.' });
  if (form.warehouseId === '') problems.push({ field: 'warehouseId', problem: 'Pick the warehouse the work was done in — it decides the invoice’s GSTIN.' });
  const earliest = earliestChargeDate(today);
  if (!isRealDate(form.chargeDate)) problems.push({ field: 'chargeDate', problem: 'Pick the date the work was done.' });
  else if (form.chargeDate > today) problems.push({ field: 'chargeDate', problem: 'A charge is recorded for work already done — today or earlier.' });
  else if (form.chargeDate < earliest) problems.push({ field: 'chargeDate', problem: `Too far back — the earliest date is ${chargeDateLabel(earliest)} (1 April of the previous financial year).` });
  if (form.category === '' || !CHARGE_CATEGORIES.includes(form.category)) problems.push({ field: 'category', problem: 'Pick what the charge is for.' });
  const description = form.description.trim();
  if (description === '') problems.push({ field: 'description', problem: 'Say what was done — it is printed on the invoice line.' });
  else if (codePoints(description) > CHARGE_DESCRIPTION_MAX) {
    problems.push({ field: 'description', problem: `At most ${CHARGE_DESCRIPTION_MAX} characters (now ${codePoints(description)}).` });
  }
  if (form.category === 'other' && (form.sacCode === '' || !OTHER_SACS.includes(form.sacCode))) {
    problems.push({ field: 'sacCode', problem: 'Pick the services SAC an “other” charge bills under.' });
  }
  if (form.unit === '' || !CHARGE_UNITS.includes(form.unit)) problems.push({ field: 'unit', problem: 'Pick the unit the quantity counts.' });
  const quantity = quantityOf(form.quantity);
  if (quantity.problem !== null) problems.push({ field: 'quantity', problem: quantity.problem });
  const rate = rateOf(form.rate);
  if (rate.problem !== null) problems.push({ field: 'rate', problem: rate.problem });
  if (quantity.milli !== null && rate.paise !== null) {
    const problem = amountProblem(chargeAmountPaise(quantity.milli, rate.paise));
    if (problem !== null) problems.push({ field: 'amount', problem });
  }
  const reference = optionalText(form.reference, 'reference', CHARGE_REFERENCE_MAX, problems);
  const clientAuthorizationRef = optionalText(form.clientAuthorizationRef, 'clientAuthorizationRef', CHARGE_REFERENCE_MAX, problems);
  const evidenceNote = optionalText(form.evidenceNote, 'evidenceNote', CHARGE_NOTE_MAX, problems);
  if (problems.length > 0) return { body: null, problems };
  const category = form.category as ChargeCategory;
  return {
    body: {
      clientId: form.clientId,
      warehouseId: form.warehouseId,
      chargeDate: form.chargeDate,
      category,
      description,
      // A SAC is sent only for `other` — the backend refuses one on any other category.
      ...(category === 'other' ? { sacCode: form.sacCode as ChargeSac } : {}),
      unit: form.unit as ChargeUnit,
      quantity: form.quantity.trim(),
      unitRatePaise: rate.paise!,
      ...(reference === undefined ? {} : { reference }),
      ...(clientAuthorizationRef === undefined ? {} : { clientAuthorizationRef }),
      ...(evidenceNote === undefined ? {} : { evidenceNote }),
    },
    problems: [],
  };
}

/** The decision / cancel note: required, 1..500 code points. */
export function parseChargeNote(text: string, verb: 'reject' | 'cancel'): { note: string; problem: null } | { note: null; problem: string } {
  const trimmed = text.trim();
  if (trimmed === '') return { note: null, problem: `Say why — a note is required to ${verb} a charge.` };
  if (codePoints(trimmed) > CHARGE_NOTE_MAX) return { note: null, problem: `At most ${CHARGE_NOTE_MAX} characters.` };
  return { note: trimmed, problem: null };
}

/**
 * The hint beside Record: what the server will do with this amount for this
 * recorder (A22) — the server still decides (the policy may change meanwhile).
 */
export function approvalForecast(canInvoice: boolean, limitPaise: number | null, amountPaise: number | null): string {
  if (!canInvoice) return 'It will wait for approval by an owner or an accountant.';
  if (limitPaise === null || amountPaise === null) return `Your own charge is approved as you record it when it is within the self-approval limit; above it, a second person approves it.`;
  return amountPaise <= limitPaise
    ? `Within your self-approval limit of ${formatRupees(limitPaise)} — it is approved as you record it.`
    : `Above your self-approval limit of ${formatRupees(limitPaise)} — another member with billing rights must approve it.`;
}

/** The banner after a 201, from the response. */
export function recordOutcome(result: RecordClientChargeResponse): { word: string; reason: string } {
  const { charge } = result;
  const amount = formatRupees(charge.amountPaise);
  const month = billMonthLabel(charge.billMonth);
  if (charge.status === 'approved') {
    return { word: 'Charge recorded and approved', reason: `${amount} bills on the ${month} invoice${charge.supplierGstin === null ? '' : ` under ${charge.supplierGstin}`}.` };
  }
  return { word: 'Charge recorded — awaiting approval', reason: `${amount} bills on the ${month} invoice once an owner or accountant (not you) approves it. Until then that month’s draft cannot issue.` };
}

// ── the actions a viewer has on a charge ────────────────────────────────────

export interface ChargeViewer {
  readonly userId: string | undefined;
  /** Holds `billing.invoice` (owner, accountant). */
  readonly canInvoice: boolean;
}

export interface ChargeActions {
  readonly approve: boolean;
  /** Approve is shown disabled with this reason (the recorder of a pending charge). */
  readonly approveBlocked: string | null;
  readonly reject: boolean;
  readonly cancel: boolean;
  /** Why nothing (or less) is offered — shown under the row's actions. */
  readonly hint: string | null;
}

const BILLED_STATUSES: readonly string[] = ['issued', 'disputed', 'settled'];

/**
 * A14 — per capability and the recorder rule:
 * - approve / reject a PENDING charge: `billing.invoice`; never the recorder's own approve (second approver);
 * - cancel a PENDING charge: its recorder, or a `billing.invoice` holder;
 * - cancel an APPROVED charge: `billing.invoice`, until an issued invoice bills it;
 * - a rejected or cancelled charge is final.
 */
export function chargeActions(charge: Pick<ClientChargeDto, 'status' | 'recordedBy' | 'billing'>, viewer: ChargeViewer): ChargeActions {
  const own = viewer.userId !== undefined && charge.recordedBy === viewer.userId;
  if (charge.status === 'pending') {
    return {
      approve: viewer.canInvoice,
      approveBlocked: viewer.canInvoice && own ? 'You recorded this charge — another member with billing rights must approve it.' : null,
      reject: viewer.canInvoice,
      cancel: viewer.canInvoice || own,
      hint: viewer.canInvoice ? null : own ? 'Awaiting approval by an owner or an accountant. You can cancel it while it waits.' : 'Awaiting approval by an owner or an accountant.',
    };
  }
  if (charge.status === 'approved') {
    const billed = charge.billing !== null && BILLED_STATUSES.includes(charge.billing.status);
    return {
      approve: false,
      approveBlocked: null,
      reject: false,
      cancel: viewer.canInvoice && !billed,
      hint: billed
        ? `Billed on issued invoice ${charge.billing?.invoiceNo ?? '(unnumbered)'} — it can no longer change; correct it with a credit note.`
        : viewer.canInvoice
          ? null
          : 'Approved — only an owner or an accountant can cancel it.',
    };
  }
  return { approve: false, approveBlocked: null, reject: false, cancel: false, hint: null };
}

/** The Billing cell: where the charge is (or will be) billed. */
export function chargeBillingLabel(charge: Pick<ClientChargeDto, 'status' | 'billMonth' | 'billing'>): string {
  if (charge.billing !== null) {
    return charge.billing.invoiceNo === null
      ? `Draft invoice · ${billMonthLabel(charge.billMonth)}`
      : `${charge.billing.invoiceNo} · ${charge.billing.status === 'issued' ? 'issued' : charge.billing.status}`;
  }
  switch (charge.status) {
    case 'approved':
      return `Bills on the ${billMonthLabel(charge.billMonth)} invoice`;
    case 'pending':
      return `${billMonthLabel(charge.billMonth)} invoice, once approved`;
    default:
      return 'Never billed';
  }
}

/** The bill month differs from the service month (A4 — the charge's month was already invoiced). */
export function billedLater(charge: Pick<ClientChargeDto, 'chargeDate' | 'billMonth'>): boolean {
  return charge.chargeDate.slice(0, 7) !== charge.billMonth.slice(0, 7);
}

/** The outcome banner after a decision. */
export function decisionOutcome(verb: 'approve' | 'reject' | 'cancel', charge: Pick<ClientChargeDto, 'amountPaise' | 'billMonth'>): { word: string; reason: string } {
  const amount = formatRupees(charge.amountPaise);
  switch (verb) {
    case 'approve':
      return { word: 'Charge approved', reason: `${amount} bills on the ${billMonthLabel(charge.billMonth)} invoice — refresh that month’s draft to add the line.` };
    case 'reject':
      return { word: 'Charge rejected', reason: `${amount} will never be billed. The note is kept with the charge.` };
    case 'cancel':
      return { word: 'Charge cancelled', reason: `${amount} will not be billed — refresh the ${billMonthLabel(charge.billMonth)} draft if one exists. Record it again if it was wrong.` };
  }
}

// ── the list filters (in the URL) ────────────────────────────────────────────

export interface ChargeFilters {
  readonly clientId: string | null;
  readonly warehouseId: string | null;
  readonly status: ChargeStatus | null;
  /** The billing month, `YYYY-MM`. */
  readonly month: string | null;
}

export const NO_CHARGE_FILTERS: ChargeFilters = { clientId: null, warehouseId: null, status: null, month: null };

/** A UUID (8-4-4-4-12) — anything else is dropped from the filters, never sent (code review E5). */
const ID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const single = (value: string | readonly string[] | undefined): string | null => (typeof value === 'string' && value !== '' ? value : null);

/** `?clientId&warehouseId&status&month` → the filters; anything malformed is dropped (the list opens unfiltered on it). */
export function parseChargeFilters(params: SearchParamsRecord): ChargeFilters {
  const clientId = single(params.clientId);
  const warehouseId = single(params.warehouseId);
  const status = single(params.status);
  const month = single(params.month);
  return {
    clientId: clientId !== null && ID_RE.test(clientId) ? clientId : null,
    warehouseId: warehouseId !== null && ID_RE.test(warehouseId) ? warehouseId : null,
    status: status !== null && (CHARGE_STATUSES as readonly string[]).includes(status) ? (status as ChargeStatus) : null,
    month: month !== null && MONTH_RE.test(month) ? month : null,
  };
}

/** The link that opens the Ad-hoc charges tab under these filters (UI-PATTERNS §3.3 — a filtered list is bookmarkable). */
export function chargesHref(filters: ChargeFilters): string {
  const params = new URLSearchParams({ tab: 'client-charges' });
  if (filters.clientId !== null) params.set('clientId', filters.clientId);
  if (filters.warehouseId !== null) params.set('warehouseId', filters.warehouseId);
  if (filters.month !== null) params.set('month', filters.month);
  if (filters.status !== null) params.set('status', filters.status);
  return `/compliance?${params.toString()}`;
}

/** A28 — the `adhoc-charge-pending` gap's link: that client's pending charges billed in the invoice's month. */
export function pendingChargesHref(clientId: string, periodStart: string): string {
  return chargesHref({ clientId, warehouseId: null, status: 'pending', month: periodStart.slice(0, 7) });
}

/** The filtered list's empty sentence (UI-PATTERNS §5). */
export function chargesEmptyMessage(filters: ChargeFilters, describe: { client?: string; warehouse?: string }): string {
  const parts = [
    filters.status === null ? null : `status ${CHARGE_STATUS_LABEL[filters.status].toLowerCase()}`,
    filters.clientId === null ? null : `client ${describe.client ?? 'picked'}`,
    filters.warehouseId === null ? null : `warehouse ${describe.warehouse ?? 'picked'}`,
    filters.month === null ? null : `billed in ${billMonthLabel(filters.month)}`,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return 'No ad-hoc charges yet — record the first one above.';
  return `No ad-hoc charges match ${parts.join(', ')}.`;
}

// ── the self-approval policy ─────────────────────────────────────────────────

/** The limit's rupee text → paise (₹0 .. ₹1 crore), or a problem. ₹0 means every charge needs a second person. */
export function parseSelfApproveLimit(text: string): { paise: number; problem: null } | { paise: null; problem: string } {
  if (text.trim() === '') return { paise: null, problem: 'Enter a limit in rupees (0 for none).' };
  const parsed = parseRupees(text);
  if ('problem' in parsed) return { paise: null, problem: parsed.problem };
  if (parsed.paise > MAX_SELF_APPROVE_LIMIT_PAISE) return { paise: null, problem: `At most ${formatRupees(MAX_SELF_APPROVE_LIMIT_PAISE)}.` };
  return { paise: parsed.paise, problem: null };
}

/** The policy's sentence. */
export function selfApproveLimitLabel(policy: { selfApproveLimitPaise: number; isDefault: boolean }): string {
  if (policy.selfApproveLimitPaise === 0) return 'Every charge needs a second person to approve it.';
  return `An owner or accountant’s own charge up to ${formatRupees(policy.selfApproveLimitPaise)} is approved as they record it${policy.isDefault ? ' (the default)' : ''}; above it — and anything an ops manager records — waits for a second person.`;
}

// ── refusals ─────────────────────────────────────────────────────────────────

export type ChargeVerb = 'record' | 'approve' | 'reject' | 'cancel';

const VERB_PAST: Readonly<Record<ChargeVerb, string>> = { record: 'recorded', approve: 'approved', reject: 'rejected', cancel: 'cancelled' };

/** Every refusal a charge command answers, worded for the operator. */
export function chargeRefusalReason(error: unknown, verb: ChargeVerb): string {
  if (!(error instanceof ApiProblem)) return UNREACHABLE_REASON;
  switch (error.code) {
    case 'charge-needs-second-approver':
      return 'You recorded this charge — another member with billing rights must approve it.';
    case 'charge-not-pending':
      return 'This charge is no longer awaiting approval — someone decided it meanwhile. The list has been refreshed.';
    case 'charge-not-cancellable':
      return 'Only a pending or approved charge can be cancelled — the list has been refreshed.';
    case 'charge-period-invoiced':
      // The server's copy names the month and the GSTIN (A4).
      return error.detail ?? 'This charge’s billing month is already invoiced — it can no longer change.';
    case 'charge-not-found':
      return 'That charge no longer exists — refresh the list.';
    case 'client-not-billable':
      return 'Your own company is never billed — pick a client brand.';
    case 'client-not-active':
      return error.detail ?? 'This client is suspended or departed — a new charge is recorded only for an active client.';
    case 'not-found':
      return 'That client or warehouse no longer exists — refresh the page.';
    case 'permission-denied':
      // The cancel rule's own refusal carries its reason; otherwise the session's tenant is wrong.
      return error.detail ?? 'That data belongs to another tenant — sign in again.';
    case 'role-denied':
      return verb === 'record'
        ? 'Only an owner, an ops manager or an accountant can record ad-hoc charges.'
        : 'Only an owner or an accountant can approve, reject or cancel an approved charge.';
    case 'validation-failed':
      return error.detail ?? 'Check the charge and try again.';
    case 'unauthenticated':
      return 'Your session expired — sign in again.';
    case 'idempotency-key-reuse':
      return 'This request was already processed with different details — refresh and try again.';
    case 'conflict':
      return 'The same request is still being processed — wait a moment and refresh.';
    default:
      return error.detail ?? `Charge not ${VERB_PAST[verb]} (${error.code}).`;
  }
}

/** The refusals whose recovery is a re-read (the charge moved under the operator). */
export function chargeNeedsReread(error: unknown): boolean {
  return error instanceof ApiProblem && ['charge-not-pending', 'charge-not-cancellable', 'charge-not-found', 'charge-period-invoiced'].includes(error.code);
}

/** The policy PUT's refusals. */
export function chargePolicyReason(error: unknown): string {
  if (error instanceof ApiProblem && error.code === 'role-denied') return 'Only an owner or an accountant can change the self-approval limit.';
  if (error instanceof ApiProblem && error.code === 'validation-failed') return error.detail ?? 'Enter a limit between ₹0 and ₹1 crore.';
  return chargeRefusalReason(error, 'approve');
}

/** The reads' refusals. */
export function chargeReadReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'role-denied':
        return 'Ad-hoc charges are an operator surface — this session cannot read them.';
      case 'invalid-cursor':
        return 'That page reference is stale — Retry restarts from the first page.';
      case 'validation-failed':
        return error.detail ?? 'A filter is malformed — clear the filters.';
      case 'permission-denied':
        return 'That data belongs to another tenant — sign in again.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      default:
        return error.detail ?? `Could not load the ad-hoc charges (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}
