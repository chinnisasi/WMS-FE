import { ApiProblem } from '@/lib/api/client';
import type { InvoiceDto } from '@/lib/api/generated';
import { formatQuantity } from '@/lib/format-quantity';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';

/**
 * Story 8-1 — the GST invoice surface's pure decisions (the `excursion.ts`
 * pattern): money and rate rendering in exact integer arithmetic, the
 * operator's rupee input parsed to paise without a float, the document
 * snapshot read defensively, and the refusal mappers. Clients branch on the
 * problem `code`, never on prose.
 */

// ── the module broadcaster ───────────────────────────────────────────────────

export const INVOICES_CHANGED_EVENT = 'wms-invoices-changed';

export function notifyInvoicesChanged(): void {
  window.dispatchEvent(new Event(INVOICES_CHANGED_EVENT));
}

// ── money and rates ──────────────────────────────────────────────────────────

/**
 * Integer paise → `₹1,234.56`. Integer arithmetic only: the server's money is
 * paise-exact and a `/ 100` float would print `0.30000000000000004`-class
 * dust for some values. The client never rounds — the rupee-rounded payable
 * and its round-off are the SERVER's stored figures (story 8-1b).
 */
export function formatRupees(paise: number): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.trunc(abs / 100);
  const fraction = String(abs % 100).padStart(2, '0');
  return `${negative ? '−' : ''}₹${rupees.toLocaleString('en-IN')}.${fraction}`;
}

/**
 * The signed round-off line (story 8-1b): `+₹0.38`, `−₹0.49`, `₹0.00`. The
 * sign is always shown on a non-zero figure — a round-off that silently reads
 * as an amount would be misread as a charge.
 */
export function formatRoundOff(paise: number): string {
  if (paise > 0) return `+${formatRupees(paise)}`;
  return formatRupees(paise);
}

/** An exact percent from integer thousandths of a percent (18000 → `18%`, 6250 → `6.25%`, 125 → `0.125%`). */
function percentLabel(thousandths: number): string {
  const whole = Math.trunc(thousandths / 1000);
  const rest = thousandths % 1000;
  if (rest === 0) return `${whole}%`;
  return `${whole}.${String(rest).padStart(3, '0').replace(/0+$/, '')}%`;
}

/** GST basis points → a percent label (1800 → `18%`, 1250 → `12.5%`, 25 → `0.25%`). */
export function gstRateLabel(bps: number): string {
  return percentLabel(bps * 10);
}

/**
 * Rule 46 prints the RATE of each tax, not only the combined rate. Intra-state
 * supply splits the GST rate equally into CGST and SGST/UTGST (an odd basis
 * point halves exactly in thousandths — 25 bps → 0.125% each); inter-state
 * carries the whole rate as IGST. An unresolved supply charges no tax.
 */
export function taxRateLabels(
  bps: number,
  supplyType: 'intra' | 'inter' | null,
): { cgst: string; sgst: string; igst: string } {
  if (supplyType === 'intra') return { cgst: percentLabel(bps * 5), sgst: percentLabel(bps * 5), igst: '—' };
  if (supplyType === 'inter') return { cgst: '—', sgst: '—', igst: percentLabel(bps * 10) };
  return { cgst: '—', sgst: '—', igst: '—' };
}

// ── Rule 46: the total in words (Indian system) ─────────────────────────────

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n]!;
  const tens = TENS[Math.trunc(n / 10)]!;
  return n % 10 === 0 ? tens : `${tens}-${ONES[n % 10]}`;
}

/** A non-negative integer in Indian-system words (crore, lakh, thousand, hundred). */
function integerInWords(n: number): string {
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.trunc(n / 10_000_000);
  let rest = n % 10_000_000;
  const lakh = Math.trunc(rest / 100_000);
  rest %= 100_000;
  const thousand = Math.trunc(rest / 1000);
  rest %= 1000;
  const hundred = Math.trunc(rest / 100);
  rest %= 100;
  if (crore > 0) parts.push(`${integerInWords(crore)} Crore`);
  if (lakh > 0) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand > 0) parts.push(`${belowHundred(thousand)} Thousand`);
  if (hundred > 0) parts.push(`${ONES[hundred]} Hundred`);
  if (rest > 0) parts.push(belowHundred(rest));
  return parts.join(' ');
}

/** Integer paise → `Indian Rupees One Thousand Two Hundred Thirty-Four and Fifty-Six Paise Only`. */
export function amountInWords(paise: number): string {
  const abs = Math.abs(paise);
  const rupees = Math.trunc(abs / 100);
  const rest = abs % 100;
  const words = `Indian Rupees ${integerInWords(rupees)}${rest > 0 ? ` and ${belowHundred(rest)} Paise` : ''} Only`;
  return paise < 0 ? `Minus ${words}` : words;
}

// ── Rule 46: the place of supply by name ────────────────────────────────────

/**
 * The CBIC GST state-code list, mirroring wms-be's `gst_state_codes` seed
 * (migration 0053 — 38 entries, official names). The NAME of the place of
 * supply comes from here, never from the consignee's address text: a
 * consignee GSTIN outranks the address, so the address can name another state.
 */
export const GST_STATE_NAMES: Readonly<Record<string, string>> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
  '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
  '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
  '97': 'Other Territory', '99': 'Other Country',
};

/** `27 — Maharashtra`; a code outside the list still prints, by its code. */
export function placeOfSupplyLabel(code: string | null): string {
  if (code === null) return 'Unresolved';
  const name = GST_STATE_NAMES[code];
  return name === undefined ? code : `${code} — ${name}`;
}

/**
 * The invoice date as IST's calendar date. The FY label is derived on the IST
 * clock, so the printed date must be too — a viewer's local zone can put an
 * invoice issued 01:00 IST on 1 April on 31 March, a day before its FY.
 */
export function invoiceDateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * The operator's rupee text → integer paise, or a problem. `^\d+(\.\d{1,2})?$`
 * and string arithmetic — never `Number()` on the whole string, which accepts
 * `1e3` and `0x10` and would turn `0.07` into a float before the multiply.
 * A third decimal is refused (paise are the floor), never rounded.
 */
export function parseRupees(text: string): { paise: number } | { problem: string } {
  const trimmed = text.trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (match === null) {
    return { problem: 'Enter a rupee amount like 125 or 125.50 (at most two decimal places).' };
  }
  const rupees = Number(match[1]);
  const paise = rupees * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(paise)) {
    return { problem: 'That amount is too large.' };
  }
  return { paise };
}

// ── vocabulary ───────────────────────────────────────────────────────────────

export type InvoiceStatus = InvoiceDto['status'];

export const STATUS_LABEL: Readonly<Record<InvoiceStatus, string>> = {
  'awaiting-data': 'Awaiting data',
  issued: 'Issued',
  voided: 'Voided',
};

/** The gap kinds the backend names (`invoicing/generator.ts` GAP_KINDS). */
export type GapKind = 'unpriced-line' | 'place-of-supply' | 'supplier-gstin' | 'hsn-gap' | 'pos-discrepancy';

export const GAP_LABEL: Readonly<Record<GapKind, string>> = {
  'unpriced-line': 'Unpriced line',
  'place-of-supply': 'Place of supply unresolved',
  'supplier-gstin': 'No supplier GSTIN',
  'hsn-gap': 'HSN missing',
  'pos-discrepancy': 'GSTIN / address mismatch',
};

/** The kinds that park an invoice `awaiting-data` (the rest are warnings). */
const BLOCKING: ReadonlySet<string> = new Set(['unpriced-line', 'place-of-supply', 'supplier-gstin']);

export function isBlockingGap(kind: string): boolean {
  return BLOCKING.has(kind);
}

/** A gap kind the client does not know yet still renders — by its code, never dropped. */
export function gapLabel(kind: string): string {
  return (GAP_LABEL as Readonly<Record<string, string>>)[kind] ?? kind;
}

/** A gap's printed prefix: blocking kinds park the invoice, the rest are warnings. */
export function gapPrefix(kind: string): 'Blocking' | 'Warning' {
  return isBlockingGap(kind) ? 'Blocking' : 'Warning';
}

/** The list's gap cell: labels, blocking kinds first, `—` when none. */
export function gapSummary(kinds: readonly string[]): string {
  if (kinds.length === 0) return '—';
  return [...kinds]
    .sort((a, b) => Number(isBlockingGap(b)) - Number(isBlockingGap(a)))
    .map(gapLabel)
    .join(' · ');
}

/**
 * The printed document's heading and notice, by status. Only an issued
 * invoice is a tax invoice: an awaiting one has no number yet, and a voided
 * one HAS a number but is cancelled — each says what it actually is.
 */
export function documentHeading(status: InvoiceStatus): { title: string; notice: string | null } {
  switch (status) {
    case 'issued':
      return { title: 'Tax invoice', notice: null };
    case 'voided':
      return { title: 'Voided — not a valid tax invoice', notice: 'This invoice was cancelled after issue; its number is retired.' };
    default:
      return {
        title: 'Draft — not a tax invoice',
        notice: 'Awaiting data: this document has no number and cannot be issued until its blocking gaps close.',
      };
  }
}

/**
 * Story 8-1b: an issued (or voided) invoice is FROZEN — the backend never
 * recomputes or rewrites it, so a regenerate is a guaranteed no-op and rates
 * a guaranteed `409 invoice-frozen`. The pricing panel is offered for
 * `awaiting-data` only (the state rule — never an action the row's own state
 * rules out).
 */
export function canRegenerate(status: InvoiceStatus): boolean {
  return status === 'awaiting-data';
}

/** The pricing panel's note when nothing is unpriced (an awaiting invoice blocked by something else). */
export function regenerateNote(): string {
  return "Re-derive this invoice from the order's dispatch facts (after fixing the order, warehouse or tenant data that blocks it). An unchanged result keeps the revision; once it issues, the invoice is frozen.";
}

/**
 * The list's Invoice cell (story 8-1b): numbering runs per supplier GSTIN, so
 * two GSTINs in one state print the same `27/2627/000001` — the number alone
 * does not identify an invoice; the GSTIN beside it does.
 */
export function invoiceNumberLabel(invoiceNo: string | null, originGstin: string | null): { number: string; gstin: string | null } {
  return { number: invoiceNo ?? 'Unnumbered', gstin: invoiceNo === null ? null : originGstin };
}

// ── the document snapshot ────────────────────────────────────────────────────

export interface DocumentAddress {
  readonly contactName?: string;
  readonly phone?: string;
  readonly line1?: string;
  readonly line2?: string;
  readonly city?: string;
  readonly state?: string;
  readonly pincode?: string;
}

export interface DocumentLine {
  readonly orderLineId: string;
  readonly skuCode: string;
  readonly skuName: string;
  readonly hsn: string | null;
  readonly qtyMilli: number;
  readonly uom: string;
  readonly ratePaise: number;
  readonly rateSource: string;
  readonly taxablePaise: number;
  readonly gstBps: number;
  readonly cgstPaise: number;
  readonly sgstPaise: number;
  readonly igstPaise: number;
  readonly hsnGap: boolean;
}

export interface DocumentGap {
  readonly kind: string;
  readonly detail: string;
  /** Set on the line-scoped kinds (`unpriced-line`, `hsn-gap`). */
  readonly orderLineId?: string;
}

export interface InvoiceDocument {
  readonly header: {
    readonly invoiceNo: string | null;
    readonly fyLabel: string | null;
    readonly orderRef: string;
    readonly issuedAt: string | null;
    readonly supplyType: 'intra' | 'inter' | null;
    readonly placeOfSupply: string | null;
    readonly originGstin: string | null;
    readonly consigneeGstin: string | null;
    readonly originAddress: DocumentAddress | null;
    readonly consigneeAddress: DocumentAddress | null;
  };
  readonly seller: { readonly name: string; readonly gstin: string | null };
  readonly buyer: { readonly name: string | null; readonly gstin: string | null };
  readonly lines: readonly DocumentLine[];
  /**
   * Story 8-1b: `total` is the exact paise sum; `payable` the server's
   * rupee-rounded amount due; `roundOff = payable − total` (signed).
   */
  readonly totals: {
    readonly subtotal: number;
    readonly gst: number;
    readonly total: number;
    readonly roundOff: number;
    readonly payable: number;
  };
  readonly gaps: readonly DocumentGap[];
  readonly revision: number;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The OpenAPI types the snapshot as an opaque object, so the client checks
 * the pinned shape before rendering it as a tax document. A shape it does not
 * recognise returns null — the surface then says the document is unreadable
 * rather than printing an invoice with holes in it.
 */
export function readInvoiceDocument(raw: unknown): InvoiceDocument | null {
  if (!isObject(raw)) return null;
  const { header, seller, buyer, lines, totals, gaps } = raw;
  if (!isObject(header) || !isObject(seller) || !isObject(buyer) || !isObject(totals)) return null;
  if (!Array.isArray(lines) || !Array.isArray(gaps)) return null;
  if (
    typeof totals.subtotal !== 'number' ||
    typeof totals.gst !== 'number' ||
    typeof totals.total !== 'number' ||
    typeof totals.roundOff !== 'number' ||
    typeof totals.payable !== 'number'
  ) {
    return null;
  }
  if (typeof seller.name !== 'string' || typeof header.orderRef !== 'string') return null;
  const stringOrNull = (v: unknown): boolean => v === null || typeof v === 'string';
  const addressOk = (v: unknown): boolean => v === null || isObject(v);
  if (
    !stringOrNull(header.invoiceNo) ||
    !stringOrNull(header.issuedAt) ||
    !stringOrNull(header.placeOfSupply) ||
    !stringOrNull(header.originGstin) ||
    !stringOrNull(header.consigneeGstin) ||
    !(header.supplyType === null || header.supplyType === 'intra' || header.supplyType === 'inter') ||
    !addressOk(header.originAddress) ||
    !addressOk(header.consigneeAddress) ||
    !stringOrNull(seller.gstin) ||
    !stringOrNull(buyer.name) ||
    !stringOrNull(buyer.gstin)
  ) {
    return null;
  }
  const lineOk = (line: unknown): boolean =>
    isObject(line) &&
    typeof line.orderLineId === 'string' &&
    typeof line.skuCode === 'string' &&
    typeof line.skuName === 'string' &&
    typeof line.uom === 'string' &&
    (line.hsn === null || typeof line.hsn === 'string') &&
    typeof line.qtyMilli === 'number' &&
    typeof line.ratePaise === 'number' &&
    typeof line.taxablePaise === 'number' &&
    typeof line.gstBps === 'number' &&
    typeof line.cgstPaise === 'number' &&
    typeof line.sgstPaise === 'number' &&
    typeof line.igstPaise === 'number';
  const gapOk = (gap: unknown): boolean => isObject(gap) && typeof gap.kind === 'string' && typeof gap.detail === 'string';
  if (!lines.every(lineOk) || !gaps.every(gapOk)) return null;
  return raw as unknown as InvoiceDocument;
}

/**
 * The order lines the server says are unpriced — read from the gaps'
 * structured `orderLineId` (never parsed out of the detail prose). The
 * pricing panel offers exactly these lines and nothing else: an override on
 * an acceptance-priced line is a guaranteed 409.
 */
export function unpricedLineIds(document: InvoiceDocument): readonly string[] {
  const ids: string[] = [];
  for (const gap of document.gaps) {
    if (gap.kind === 'unpriced-line' && typeof gap.orderLineId === 'string' && !ids.includes(gap.orderLineId)) {
      ids.push(gap.orderLineId);
    }
  }
  return ids;
}

/**
 * One invoice line's quantity, in the unit the DOCUMENT froze. The catalog
 * contributes only the unit's declared precision, and only while its unit
 * still matches the snapshot's — a renamed, re-coded or unloaded SKU leaves
 * the raw figure in the snapshot's unit, never a guessed precision and never
 * a unit the document did not record.
 */
export function lineQuantityLabel(qtyMilli: number, uom: string, catalog: { uom: string; uomPrecision: number } | null): string {
  const qty = qtyMilli / 1000;
  return catalog !== null && catalog.uom === uom ? `${formatQuantity(qty, catalog.uomPrecision)} ${uom}` : `${qty} ${uom}`;
}

/** Rule 46's per-tax totals: the sums of the lines' CGST, SGST/UTGST and IGST, in paise. */
export function taxTotals(lines: readonly DocumentLine[]): { cgst: number; sgst: number; igst: number } {
  return lines.reduce(
    (sum, line) => ({ cgst: sum.cgst + line.cgstPaise, sgst: sum.sgst + line.sgstPaise, igst: sum.igst + line.igstPaise }),
    { cgst: 0, sgst: 0, igst: 0 },
  );
}

/** An address as print lines; absent parts are skipped, never rendered `undefined`. */
export function addressLines(address: DocumentAddress | null | undefined): readonly string[] {
  if (address === null || address === undefined) return [];
  const cityLine = [address.city, address.state].filter(Boolean).join(', ');
  return [
    address.line1,
    address.line2,
    [cityLine, address.pincode].filter(Boolean).join(' — '),
  ].filter((part): part is string => typeof part === 'string' && part !== '');
}

/** `Intra-state (27)` / `Inter-state (29)` / `Unresolved`. */
export function supplyLabel(supplyType: string | null, placeOfSupply: string | null): string {
  if (supplyType === null || placeOfSupply === null) return 'Unresolved';
  return `${supplyType === 'intra' ? 'Intra-state' : 'Inter-state'} (${placeOfSupply})`;
}

// ── the pricing draft ────────────────────────────────────────────────────────

/**
 * The pricing panel's draft → the command's `rates`, or a problem (nothing is
 * sent when a problem is set). Blank entries are dropped — the operator may
 * price some lines now and the rest later; at least one must be priced.
 */
export function parseRateDraft(
  entries: readonly { orderLineId: string; label: string; text: string }[],
): { rates: { orderLineId: string; ratePaise: number }[]; problem: string | null } {
  const rates: { orderLineId: string; ratePaise: number }[] = [];
  for (const entry of entries) {
    if (entry.text.trim() === '') continue;
    const parsed = parseRupees(entry.text);
    if ('problem' in parsed) {
      return { rates: [], problem: `${entry.label}: ${parsed.problem}` };
    }
    rates.push({ orderLineId: entry.orderLineId, ratePaise: parsed.paise });
  }
  if (rates.length === 0) {
    return { rates: [], problem: 'Enter a rate for at least one unpriced line.' };
  }
  return { rates, problem: null };
}

// ── outcomes and refusals ────────────────────────────────────────────────────

export interface Outcome {
  readonly tone: 'accepted' | 'rejected';
  readonly word: string;
  readonly reason: string;
}

/**
 * The generate outcome, built from the RESPONSE: an invoice that came back
 * still awaiting data is an acceptance of the prices sent, but not an
 * issuance — the sentence names what still blocks it.
 */
export function generateOutcome(invoice: InvoiceDto): Outcome {
  if (invoice.status === 'issued') {
    return {
      tone: 'accepted',
      word: 'Invoice issued',
      reason: `${invoice.invoiceNo ?? 'Unnumbered'} — payable ${formatRupees(invoice.payablePaise)} (revision ${invoice.revision}).`,
    };
  }
  const document = readInvoiceDocument(invoice.document);
  const blocking = document === null ? [] : [...new Set(document.gaps.map((g) => g.kind).filter(isBlockingGap))];
  return {
    tone: 'accepted',
    word: 'Saved — still awaiting data',
    reason:
      blocking.length === 0
        ? 'The invoice is not issued yet.'
        : `Still blocked by: ${blocking.map(gapLabel).join(', ')}.`,
  };
}

export function invoiceListReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'invalid-cursor':
        return 'That page reference is stale — Retry restarts the list from the first page.';
      case 'not-found':
        return 'That tenant no longer exists — sign in again.';
      case 'role-denied':
        return 'Your role cannot read invoices.';
      case 'permission-denied':
        return 'That data belongs to another tenant — sign in again.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the request and try again.';
      default:
        return error.detail ?? 'Could not load the invoices.';
    }
  }
  return UNREACHABLE_REASON;
}

export function invoiceDetailReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'not-found':
        return 'This invoice no longer exists — refresh the list.';
      case 'role-denied':
        return 'Your role cannot read invoices.';
      case 'permission-denied':
        return 'That invoice belongs to another tenant — sign in again.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'That invoice reference is malformed — refresh the list.';
      default:
        return error.detail ?? 'Could not load the invoice.';
    }
  }
  return UNREACHABLE_REASON;
}

/**
 * The refusals whose recovery is a RE-READ: the line set the panel offered is
 * stale, or (8-1b `invoice-frozen`) the invoice issued since it was read and
 * the panel should not be on screen at all. The panel re-reads on exactly
 * these (and the copy says so — a claim the caller must make true).
 */
export function refusalNeedsReread(error: unknown): boolean {
  return (
    error instanceof ApiProblem &&
    (error.code === 'line-already-priced' || error.code === 'line-not-of-order' || error.code === 'invoice-frozen')
  );
}

/**
 * `invoice-frozen` (8-1b): the invoice issued since the panel read it. The
 * re-read shows it `issued`, which unmounts the pricing panel — so this
 * refusal's banner must live at the section level, not inside the panel.
 */
export function refusalIsFrozen(error: unknown): boolean {
  return error instanceof ApiProblem && error.code === 'invoice-frozen';
}

export function generateReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'not-found':
        return 'No order with this id exists in this tenant.';
      case 'order-not-dispatched':
        return 'That order is not dispatched yet — invoices are generated from dispatched orders only.';
      case 'line-already-priced':
        return 'One of those lines already carries the rate frozen when the order was accepted — only unpriced lines can be priced here. The invoice has been re-read.';
      case 'line-not-of-order':
        return 'One of those lines does not belong to this order — the invoice has been re-read.';
      case 'invoice-frozen':
        return 'This invoice has already issued and is frozen — an issued invoice is never re-priced (corrections need a credit or debit note). The invoice has been re-read.';
      case 'role-denied':
        return 'Your role cannot generate invoices.';
      case 'permission-denied':
        return 'That order belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This request was already processed with different prices — edit the draft and submit again.';
      case 'conflict':
        return 'The same request is already being processed — wait a moment and refresh.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the rates and try again.';
      default:
        return error.detail ?? `Not generated (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}
