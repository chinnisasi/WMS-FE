import { ApiProblem } from '@/lib/api/client';
import type { HsnIssueLineDto, HsnSummaryGstinDto, HsnSummaryRowDto } from '@/lib/api/generated';
import { csvField } from '@/lib/csv';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';

/**
 * Story 8-2a — the HSN summary's pure decisions (GSTR-1 Table 12): the
 * period options, the CSV cells and the CSV itself, pinned to the GSTN
 * offline-tool HSN layout (sourced from India Compliance's
 * `gstr_1_export.py` `get_hsn_headers` and `constants` `UOM_MAP`, because the
 * GSTN portal blocks automated template downloads).
 *
 * Money stays integer paise until the cell is written; the only rounding
 * here is the QUANTITY's (two decimals, once per summed row, as the offline
 * tool does) — amounts are never rounded.
 */

// ── the template ─────────────────────────────────────────────────────────────

/**
 * The offline tool's HSN header row, byte for byte (B2B and B2C share it).
 * If GSTN changes the template, this constant and its pinning test are the
 * one place to update.
 */
export const HSN_CSV_HEADER =
  'HSN,Description,UQC,Total Quantity,Total Value,Rate,Taxable Value,Integrated Tax Amount,Central Tax Amount,State/UT Tax Amount,Cess Amount';

/**
 * GSTN's UQC descriptions, in the master's own spellings (`MLT-MILILITRE`,
 * `GMS-GRAMMES` are not typos). One entry for every code the backend's
 * UoM → UQC table (`wms-be/src/modules/invoicing/uqc.ts`) can produce — 25.
 * Keyed by the generated client's `uqc` enum, so a code the backend adds is
 * a BUILD error here until its description is added, never a silent OTH.
 */
export const UQC_DESCRIPTIONS: Readonly<Record<HsnSummaryRowDto['uqc'], string>> = {
  BAG: 'BAGS',
  BDL: 'BUNDLES',
  BOX: 'BOX',
  BTL: 'BOTTLES',
  CAN: 'CANS',
  CMS: 'CENTIMETERS',
  CTN: 'CARTONS',
  DOZ: 'DOZENS',
  DRM: 'DRUMS',
  GMS: 'GRAMMES',
  KGS: 'KILOGRAMS',
  KLR: 'KILOLITRE',
  LTR: 'LITRES',
  MLT: 'MILILITRE',
  MTR: 'METERS',
  NOS: 'NUMBERS',
  OTH: 'OTHERS',
  PAC: 'PACKS',
  PRS: 'PAIRS',
  ROL: 'ROLLS',
  SET: 'SETS',
  SQF: 'SQUARE FEET',
  SQM: 'SQUARE METERS',
  TON: 'TONNES',
  TUB: 'TUBES',
};

/** The UQC cell: `KGS-KILOGRAMS`. An unmapped code (a backend ahead of this build) falls back to `OTH-OTHERS`, never a bare code the tool would refuse. */
export function uqcCell(uqc: string): string {
  const description = Object.hasOwn(UQC_DESCRIPTIONS, uqc) ? UQC_DESCRIPTIONS[uqc as HsnSummaryRowDto['uqc']] : undefined;
  return description === undefined ? 'OTH-OTHERS' : `${uqc}-${description}`;
}

// ── cells ────────────────────────────────────────────────────────────────────

/**
 * Integer paise → ASCII rupees for a CSV cell: `123456` → `1234.56`. No
 * grouping, no symbol, no float (`formatRupees` is for screens and is not
 * CSV-safe: `₹1,234.56`, with U+2212 for minus).
 */
export function paiseToPlainRupees(paise: number): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  return `${negative ? '-' : ''}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * A summed quantity in milli-units → two decimals, rounded ONCE, half-up
 * (away from zero), in integers: `333` → `0.33`, `335` → `0.34`, `1500` →
 * `1.50`. This rounds a quantity, not money — the offline tool keeps two
 * decimals of quantity; amounts are never rounded.
 */
export function qtyMilliToTwoDecimals(qtyMilli: number): string {
  const negative = qtyMilli < 0;
  const abs = Math.abs(qtyMilli);
  const centi = Math.trunc((abs + 5) / 10);
  return `${negative && centi !== 0 ? '-' : ''}${Math.trunc(centi / 100)}.${String(centi % 100).padStart(2, '0')}`;
}

/**
 * A summed quantity on SCREEN: milli-units exact to three places, in
 * integers (`2500` → `2.500`). The screen shows the unrounded sum — a row can
 * merge units (OTH), so no single unit precision applies; the unit rides
 * beside it. The CSV's two-decimal rounding is `qtyMilliToTwoDecimals`.
 */
export function qtyMilliExact(qtyMilli: number): string {
  const negative = qtyMilli < 0;
  const abs = Math.abs(qtyMilli);
  return `${negative ? '-' : ''}${Math.trunc(abs / 1000)}.${String(abs % 1000).padStart(3, '0')}`;
}

/** GST basis points → the Rate cell, a plain number: `1800` → `18`, `25` → `0.25`, `1250` → `12.5`. */
export function rateCell(bps: number): string {
  const whole = Math.trunc(bps / 100);
  const rest = bps % 100;
  if (rest === 0) return String(whole);
  return `${whole}.${String(rest).padStart(2, '0').replace(/0+$/, '')}`;
}

// ── the CSV ──────────────────────────────────────────────────────────────────

export type HsnSection = 'b2b' | 'b2c';

/**
 * Whether a row goes into the Table 12 CSV: a valid HSN AND (story 8-1d) a
 * rate on the GST rate master. A flagged row stays in the on-screen totals.
 */
export function isCsvRow(row: Pick<HsnSummaryRowDto, 'hsn' | 'hsnIssue' | 'rateIssue'>): boolean {
  return !row.hsnIssue && !row.rateIssue && row.hsn !== null;
}

/**
 * One section's Table 12 CSV: the pinned header, then one line per row,
 * every cell quoted with `csvField`, `\n` separated, **no BOM** (the offline
 * tool matches the header exactly). HSN-issue rows are EXCLUDED — the portal
 * accepts only HSNs from its master list — and so are rate-issue rows (8-1d:
 * a rate off the GST rate master); the screen states the shortfall.
 * Description is blank (Phase III auto-fills it from the HSN master); Cess is
 * `0.00` (cess is not modelled).
 */
export function hsnSummaryCsv(rows: readonly HsnSummaryRowDto[], section: HsnSection): string {
  void section; // B2B and B2C share one layout; the section names the file, not the columns.
  const lines = rows
    .filter(isCsvRow)
    .map((row) =>
      [
        row.hsn ?? '',
        '',
        uqcCell(row.uqc),
        qtyMilliToTwoDecimals(row.qtyMilli),
        paiseToPlainRupees(row.totalValuePaise),
        rateCell(row.gstBps),
        paiseToPlainRupees(row.taxablePaise),
        paiseToPlainRupees(row.igstPaise),
        paiseToPlainRupees(row.cgstPaise),
        paiseToPlainRupees(row.sgstPaise),
        '0.00',
      ]
        .map(csvField)
        .join(','),
    );
  return [HSN_CSV_HEADER, ...lines].join('\n') + '\n';
}

export function hsnCsvFilename(section: HsnSection, gstin: string, period: string): string {
  return `hsn-${section}-${gstin}-${period}.csv`;
}

// ── periods ──────────────────────────────────────────────────────────────────

/** India is UTC+05:30 year-round — the backend's IST_OFFSET_MS. */
const IST_OFFSET_MS = 5.5 * 3600 * 1000;

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const QUARTER_SPANS = ['Apr–Jun', 'Jul–Sep', 'Oct–Dec', 'Jan–Mar'];

/** The IST calendar month an instant falls in: `{year, month0}`. */
export function istMonthOf(instant: string | number | Date): { year: number; month0: number } {
  const ms = typeof instant === 'number' ? instant : instant instanceof Date ? instant.getTime() : Date.parse(instant);
  const ist = new Date(ms + IST_OFFSET_MS);
  return { year: ist.getUTCFullYear(), month0: ist.getUTCMonth() };
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** The FY quarter value of a calendar month: Apr–Jun of 2026 → `FY-2627-Q1`, Jan–Mar 2027 → `FY-2627-Q4`. */
export function quarterOf(year: number, month0: number): string {
  const fyStart = month0 >= 3 ? year : year - 1;
  const q = month0 >= 3 ? Math.floor((month0 - 3) / 3) + 1 : 4;
  return `FY-${pad2(fyStart % 100)}${pad2((fyStart + 1) % 100)}-Q${q}`;
}

export interface PeriodOption {
  readonly value: string;
  readonly label: string;
  readonly kind: 'month' | 'quarter';
  /** The period now runs (it contains today, IST) — its figures can still grow. */
  readonly inProgress: boolean;
}

function monthLabel(year: number, month0: number): string {
  return `${MONTH_NAMES[month0]} ${year}`;
}

function quarterLabel(value: string): string {
  const match = /^FY-(\d{2})(\d{2})-Q([1-4])$/.exec(value);
  if (match === null) return value;
  return `FY 20${match[1]}-${match[2]} Q${match[3]} (${QUARTER_SPANS[Number(match[3]) - 1]})`;
}

/**
 * The period options for one GSTIN, newest first: every IST month from its
 * first issue to the later of its last issue and today, and every FY quarter
 * those months touch. Derived from the GSTIN's own min/max `issued_at`, so
 * no period that holds data is missing; the current month and quarter are
 * always offered and marked in progress.
 */
export function periodOptions(gstin: Pick<HsnSummaryGstinDto, 'firstIssuedAt' | 'lastIssuedAt'>, now: number): { months: PeriodOption[]; quarters: PeriodOption[] } {
  const first = istMonthOf(gstin.firstIssuedAt);
  const last = istMonthOf(gstin.lastIssuedAt);
  const today = istMonthOf(now);
  const index = (m: { year: number; month0: number }): number => m.year * 12 + m.month0;
  const start = Math.min(index(first), index(today));
  const end = Math.max(index(last), index(today));
  const currentMonth = `${today.year}-${pad2(today.month0 + 1)}`;
  const currentQuarter = quarterOf(today.year, today.month0);
  const months: PeriodOption[] = [];
  const quarters: PeriodOption[] = [];
  const seenQuarters = new Set<string>();
  for (let i = end; i >= start; i -= 1) {
    const year = Math.floor(i / 12);
    const month0 = i % 12;
    const value = `${year}-${pad2(month0 + 1)}`;
    months.push({ value, label: monthLabel(year, month0), kind: 'month', inProgress: value === currentMonth });
    const quarter = quarterOf(year, month0);
    if (!seenQuarters.has(quarter)) {
      seenQuarters.add(quarter);
      quarters.push({ value: quarter, label: quarterLabel(quarter), kind: 'quarter', inProgress: quarter === currentQuarter });
    }
  }
  return { months, quarters };
}

/** The option's visible label, with the in-progress marker. */
export function periodOptionLabel(option: PeriodOption): string {
  return option.inProgress ? `${option.label} — in progress` : option.label;
}

// ── copy ─────────────────────────────────────────────────────────────────────

/** The AATO digit rule — the app cannot know the tenant's turnover, so it states the rule rather than enforcing it. */
export const AATO_NOTE =
  'Table 12 needs at least 4-digit HSN codes when aggregate annual turnover (AATO) is up to ₹5 crore, and 6 digits above it. This app does not know your turnover — check the codes against your AATO before filing.';

/** One row's unit flag: an OTH row that merged several catalog units. */
export function mixedUnitsNote(row: Pick<HsnSummaryRowDto, 'mixedUnits' | 'sourceUoms'>): string | null {
  if (!row.mixedUnits) return null;
  return `Mixed units under one UQC (${row.sourceUoms.join(', ')}) — the quantity adds unlike units; check it before filing.`;
}

/**
 * The rows the CSV drops for their RATE alone (story 8-1d): `rateIssue` and
 * NOT `hsnIssue` — a row with both is already counted through its issue
 * lines, so the shortfall never counts it twice.
 */
export function rateOnlyIssueRows<T extends Pick<HsnSummaryRowDto, 'hsnIssue' | 'rateIssue'>>(rows: readonly T[]): T[] {
  return rows.filter((row) => row.rateIssue && !row.hsnIssue);
}

/**
 * The CSV-shortfall warning: the HSN-issue lines and (8-1d) the rate-issue
 * rows are in the on-screen totals but cannot go into the CSV, so Table 12
 * will fall short of the invoices by their value — the issue lines' value
 * plus the `totalValuePaise` of the rows flagged for their rate only.
 */
export function issueShortfallNote(
  lines: readonly Pick<HsnIssueLineDto, 'valuePaise'>[],
  rows: readonly Pick<HsnSummaryRowDto, 'hsnIssue' | 'rateIssue' | 'gstBps' | 'totalValuePaise'>[],
  formatRupees: (paise: number) => string,
): string | null {
  const rateRows = rateOnlyIssueRows(rows);
  if (lines.length === 0 && rateRows.length === 0) return null;
  const value =
    lines.reduce((sum, line) => sum + line.valuePaise, 0) + rateRows.reduce((sum, row) => sum + row.totalValuePaise, 0);
  if (rateRows.length === 0) {
    const noun = lines.length === 1 ? 'line has' : 'lines have';
    return `${lines.length} invoice ${noun} a blank or malformed HSN. They are in the totals above but left out of the CSV (the portal accepts master HSNs only), so Table 12 will be ${formatRupees(value)} short of the invoice total. Issued invoices are frozen — correct the SKU's HSN in the catalog for future invoices, and declare these lines manually or by credit/debit note.`;
  }
  const parts: string[] = [];
  if (lines.length > 0) {
    parts.push(`${lines.length} invoice ${lines.length === 1 ? 'line has' : 'lines have'} a blank or malformed HSN`);
  }
  const rates = [...new Set(rateRows.map((row) => row.gstBps))].sort((a, b) => a - b).map((bps) => `${rateCell(bps)}%`);
  parts.push(`${rateRows.length} ${rateRows.length === 1 ? 'row has a GST rate' : 'rows have GST rates'} not on the GST rate master (${rates.join(', ')})`);
  return `${parts.join(', and ')}. They are in the totals above but left out of the CSV, so Table 12 will be ${formatRupees(value)} short of the invoice total. Issued invoices are frozen — correct the SKU's HSN or rate in the catalog for future invoices, and declare these manually or by credit/debit note.`;
}

export function hsnSummaryReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'validation-failed':
        return error.detail ?? 'That GSTIN or period is not valid.';
      case 'role-denied':
        return 'Your role cannot read the HSN summary.';
      case 'permission-denied':
        return 'That data belongs to another tenant — sign in again.';
      case 'not-found':
        return 'That tenant no longer exists — sign in again.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      default:
        return error.detail ?? `Could not load the HSN summary (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}
