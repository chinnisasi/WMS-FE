/**
 * Story 21-5 — the client invoices surface's pure decisions: labels, the
 * per-status actions, the printable document's wording (Rule 46), the
 * period options, the outcomes built from RESPONSES, and the refusal
 * mappers. The backend decides every figure — nothing here prices, taxes or
 * rounds; amounts are its integer paise, quantities its decimal strings.
 *
 * Pure: no React, no fetch — pinned by `client-invoices.test.ts`.
 */
import { ApiProblem } from '@/lib/api/client';
import type {
  ClientInvoiceDto,
  ClientInvoiceEntryDto,
  ClientInvoiceLineDto,
  ClientInvoicePartyDto,
  IssueClientInvoiceResponse,
  PrepareClientInvoicesResponse,
} from '@/lib/api/generated';
import { formatRupees } from '@/lib/invoices';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import { chargeLabel, formatIstDate, istDateOf } from '@/lib/rate-cards';
import { groupDecimal } from '@/lib/usage';

// ── the module broadcaster ───────────────────────────────────────────────────

export const CLIENT_INVOICES_CHANGED_EVENT = 'wms-client-invoices-changed';

export function notifyClientInvoicesChanged(): void {
  window.dispatchEvent(new Event(CLIENT_INVOICES_CHANGED_EVENT));
}

// ── vocabulary ───────────────────────────────────────────────────────────────

export type ClientInvoiceStatus = ClientInvoiceDto['status'];
export type ClientInvoiceVerb = 'dispute' | 'settle' | 'void';

export const CLIENT_INVOICE_STATUS_LABEL: Readonly<Record<ClientInvoiceStatus, string>> = {
  draft: 'Draft',
  issued: 'Issued',
  disputed: 'Disputed',
  settled: 'Settled',
  void: 'Void',
};

export const CLIENT_INVOICE_GAP_LABEL: Readonly<Record<string, string>> = {
  'supplier-gstin-missing': 'No supplier GSTIN',
  'supplier-address-missing': 'No supplier address',
  'client-legal-name-missing': 'Client legal name missing',
  'client-billing-address-missing': 'Client billing address incomplete',
  'storage-not-complete': 'Storage not fully measured',
  'line-unpriced': 'Unpriced line',
  'einvoice-required': 'E-invoice (IRN) required',
};

export const CLIENT_INVOICE_WARNING_LABEL: Readonly<Record<string, string>> = {
  'supplier-state-differs': 'Warehouse in another state',
};

/** A code this build does not know still renders — by its code, never dropped. */
export function clientInvoiceGapLabel(code: string): string {
  return CLIENT_INVOICE_GAP_LABEL[code] ?? code;
}

export function clientInvoiceWarningLabel(code: string): string {
  return CLIENT_INVOICE_WARNING_LABEL[code] ?? code;
}

/** The list's gap cell. */
export function gapCountLabel(count: number): string {
  if (count === 0) return '—';
  return `${count} gap${count === 1 ? '' : 's'}`;
}

/**
 * What each status offers (the state rule — never an action the row's own
 * state rules out): a draft is refreshed, issued or discarded; an issued
 * invoice is disputed, settled or voided; a disputed one settled or voided;
 * settled and void are terminal.
 */
export function clientInvoiceActions(status: ClientInvoiceStatus): {
  refresh: boolean;
  issue: boolean;
  discard: boolean;
  dispute: boolean;
  settle: boolean;
  void: boolean;
} {
  return {
    refresh: status === 'draft',
    issue: status === 'draft',
    discard: status === 'draft',
    dispute: status === 'issued',
    settle: status === 'issued' || status === 'disputed',
    void: status === 'issued' || status === 'disputed',
  };
}

/** The verbs that need a note. */
export function noteRequired(verb: ClientInvoiceVerb): boolean {
  return verb === 'dispute' || verb === 'void';
}

export const MAX_STATUS_NOTE_LENGTH = 500;

/** The note field → the note to send (null = none), or a problem (nothing is sent). */
export function parseStatusNote(verb: ClientInvoiceVerb, text: string): { note: string | null; problem: null } | { note: null; problem: string } {
  const trimmed = text.trim();
  if (trimmed === '') {
    return noteRequired(verb) ? { note: null, problem: `Say why — a note is required to ${verb} an invoice.` } : { note: null, problem: null };
  }
  if ([...trimmed].length > MAX_STATUS_NOTE_LENGTH) {
    return { note: null, problem: `A note is at most ${MAX_STATUS_NOTE_LENGTH} characters.` };
  }
  return { note: trimmed, problem: null };
}

export const VERB_LABEL: Readonly<Record<ClientInvoiceVerb, string>> = { dispute: 'Dispute', settle: 'Settle', void: 'Void' };

/** The refusal banner's word per verb. */
export const VERB_REFUSED_WORD: Readonly<Record<ClientInvoiceVerb, string>> = { dispute: 'Not disputed', settle: 'Not settled', void: 'Not voided' };

/** The void form's standing warning (the spec's wording). */
export const VOID_WARNING =
  'If this invoice was already reported in GSTR-1, a credit note is the correct fix — not supported yet. A void keeps its number; the next Prepare for its month drafts a replacement.';

/** The banner an issue answered `stale` shows (the spec's wording). */
export const STALE_WORD = 'Figures changed — review and issue again';

// ── the printed document (Rule 46) ───────────────────────────────────────────

/**
 * The document's heading: only an issued (or disputed, or settled) invoice
 * is a tax invoice. A draft has no number and says so; a void is cancelled.
 */
export function clientInvoiceHeading(status: ClientInvoiceStatus): { title: string; notice: string | null } {
  switch (status) {
    case 'draft':
      return { title: 'DRAFT — not a tax invoice', notice: 'A draft has no number; it becomes a tax invoice only when issued.' };
    case 'void':
      return { title: 'VOID — not a valid tax invoice', notice: 'This invoice was voided after issue; its number stays retired.' };
    default:
      return { title: 'Tax Invoice', notice: null };
  }
}

/**
 * Rule 48(2), CGST Rules: a SERVICES tax invoice is issued in duplicate —
 * the original for the recipient, the duplicate for the supplier. An issued
 * (or disputed, or settled) invoice prints both copies; a draft or a void
 * prints once, unlabelled.
 */
export function printCopies(status: ClientInvoiceStatus): readonly (string | null)[] {
  return clientInvoiceHeading(status).title === 'Tax Invoice' ? ['ORIGINAL FOR RECIPIENT', 'DUPLICATE FOR SUPPLIER'] : [null];
}

/** The hint beside a disabled Issue: a draft with gaps cannot issue. */
export function issueBlockedHint(gapCount: number): string | null {
  if (gapCount === 0) return null;
  return `Fix the ${gapCount === 1 ? 'gap' : `${gapCount} gaps`} below, then Refresh — a draft with gaps cannot issue.`;
}

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** `2026-09-01` (or `2026-09`) → `September 2026`. */
export function monthLabel(periodStart: string): string {
  const year = periodStart.slice(0, 4);
  const month = Number(periodStart.slice(5, 7));
  return `${MONTHS_LONG[month - 1] ?? periodStart.slice(5, 7)} ${year}`;
}

/** One line's description: the charge, its base unit for storage, and the segment's dates. */
export function lineDescription(line: Pick<ClientInvoiceLineDto, 'chargeCode' | 'uom' | 'segmentFrom' | 'segmentTo'>): string {
  const unit = line.chargeCode === 'storage' && line.uom !== null ? ` (${line.uom})` : '';
  return `${chargeLabel(line.chargeCode)}${unit} · ${formatIstDate(line.segmentFrom)} – ${formatIstDate(line.segmentTo)}`;
}

const COUNT_NOUNS: Readonly<Record<Exclude<ClientInvoiceLineDto['chargeCode'], 'storage'>, readonly [string, string]>> = {
  inbound_handling: ['receipt line', 'receipt lines'],
  pick: ['pick', 'picks'],
  outbound_handling: ['order', 'orders'],
};

/** The quantity: storage in base-unit-days (`1,500 each-days`), the rest as counts. The server's exact string, grouped only. */
export function lineQuantityLabel(line: Pick<ClientInvoiceLineDto, 'chargeCode' | 'uom' | 'quantity'>): string {
  if (line.chargeCode === 'storage') return `${groupDecimal(line.quantity)} ${line.uom ?? 'unit'}-days`;
  const [one, many] = COUNT_NOUNS[line.chargeCode];
  return `${groupDecimal(line.quantity)} ${line.quantity === '1' ? one : many}`;
}

const RATE_UNITS: Readonly<Record<ClientInvoiceLineDto['chargeCode'], string>> = {
  storage: 'per 1,000 units/day',
  inbound_handling: 'per receipt line',
  pick: 'per pick',
  outbound_handling: 'per order',
};

/** The rate: `₹3.30 per 1,000 units/day`, or "Unpriced" on a draft line nothing prices. */
export function lineRateLabel(line: Pick<ClientInvoiceLineDto, 'chargeCode' | 'unitAmountPaise'>): string {
  return line.unitAmountPaise === null ? 'Unpriced' : `${formatRupees(line.unitAmountPaise)} ${RATE_UNITS[line.chargeCode]}`;
}

/** The taxable value: the line amount, or "—" when unpriced. */
export function lineTaxableLabel(line: Pick<ClientInvoiceLineDto, 'amountPaise'>): string {
  return line.amountPaise === null ? '—' : formatRupees(line.amountPaise);
}

/** The supplier's printed address lines (from the frozen party). */
export function supplierAddressLines(party: Pick<ClientInvoicePartyDto, 'supplier'>): readonly string[] {
  const address = party.supplier.address;
  if (address === null) return [];
  return [address.line1, address.line2, `${address.city}, ${address.state} — ${address.pincode}`].filter(
    (part): part is string => typeof part === 'string' && part !== '',
  );
}

/** The recipient's printed address lines; absent parts skipped. */
export function recipientAddressLines(party: Pick<ClientInvoicePartyDto, 'recipient'>): readonly string[] {
  const { address, stateName } = party.recipient;
  const cityLine = [address.city, stateName].filter(Boolean).join(', ');
  return [address.line1, address.line2, [cityLine, address.pincode].filter(Boolean).join(' — ')].filter(
    (part): part is string => typeof part === 'string' && part !== '',
  );
}

/** `Karnataka (29)`, or "—". */
export function stateLabel(stateName: string | null, stateCode: string | null): string {
  if (stateCode === null) return '—';
  return stateName === null ? stateCode : `${stateName} (${stateCode})`;
}

/** The per-tax totals for the printed footer, from the server's totals. */
export function taxSummary(totals: ClientInvoiceDto['totals']): { cgst: string; sgst: string; igst: string } {
  return { cgst: formatRupees(totals.cgst), sgst: formatRupees(totals.sgst), igst: formatRupees(totals.igst) };
}

// ── the period ───────────────────────────────────────────────────────────────

export interface InvoiceMonthOption {
  /** `YYYY-MM`. */
  readonly value: string;
  readonly label: string;
}

/**
 * The months a client can be invoiced for, newest first: from the IST month
 * the client was created to the last ENDED month (on `nowMs`). The server
 * still decides — a month that has not ended answers 409 `period-not-ended`.
 */
export function invoiceMonthOptions(clientCreatedAt: string, nowMs: number): InvoiceMonthOption[] {
  const index = (date: string): number => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
  const start = index(istDateOf(clientCreatedAt));
  const end = index(istDateOf(nowMs)) - 1;
  const options: InvoiceMonthOption[] = [];
  for (let i = end; i >= start; i -= 1) {
    const value = `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
    options.push({ value, label: monthLabel(value) });
  }
  return options;
}

// ── the usage preview ────────────────────────────────────────────────────────

/**
 * The invoices that bill a client's month: issued (or disputed / settled) —
 * never a draft (nothing promised) or a void (cancelled). Their numbers, in
 * list order.
 */
export function invoicedNumbers(
  entries: readonly Pick<ClientInvoiceEntryDto, 'clientId' | 'periodStart' | 'status' | 'invoiceNo'>[],
  clientId: string,
  periodStart: string,
): string[] {
  return entries
    .filter((entry) => entry.clientId === clientId && entry.periodStart === periodStart && entry.status !== 'draft' && entry.status !== 'void')
    .map((entry) => entry.invoiceNo)
    .filter((no): no is string => no !== null);
}

/** The usage preview's notice for an invoiced month (the spec: "Invoiced as <no.>", live figures may differ). */
export function invoicedNotice(numbers: readonly string[]): string | null {
  if (numbers.length === 0) return null;
  return `Invoiced as ${numbers.join(', ')} — the live figures below may differ from the invoice`;
}

// ── outcomes, built from responses ───────────────────────────────────────────

export interface ClientInvoiceOutcome {
  readonly tone: 'accepted' | 'rejected' | 'warning';
  readonly word: string;
  readonly reason: string;
}

export function prepareOutcome(result: PrepareClientInvoicesResponse): ClientInvoiceOutcome {
  const created = result.created.length;
  const existing = result.existing.length;
  if (created === 0) {
    return {
      tone: 'accepted',
      word: 'Nothing new to prepare',
      reason: `Every registration with usage already has an invoice for ${monthLabel(result.existing[0]?.periodStart ?? '')}.`,
    };
  }
  const gaps = result.created.reduce((sum, invoice) => sum + invoice.gaps.length, 0);
  return {
    tone: 'accepted',
    word: `${created} draft${created === 1 ? '' : 's'} prepared`,
    reason: [
      `For ${result.created.map((invoice) => invoice.supplierGstin ?? 'no GSTIN').join(', ')}.`,
      existing > 0 ? `${existing} already invoiced.` : null,
      gaps > 0 ? `${gaps} gap${gaps === 1 ? '' : 's'} to clear before issue.` : 'Review and issue.',
    ]
      .filter((part): part is string => part !== null)
      .join(' '),
  };
}

export function issueOutcome(result: IssueClientInvoiceResponse): ClientInvoiceOutcome {
  if (result.outcome === 'stale') {
    return {
      tone: 'warning',
      word: STALE_WORD,
      reason: 'The figures moved since this draft was computed — the fresh draft is shown. Nothing was issued and no number was used.',
    };
  }
  return {
    tone: 'accepted',
    word: `Issued ${result.invoice.invoiceNo ?? ''}`.trim(),
    reason: `Payable ${formatRupees(result.invoice.totals.payable)}. The invoice is frozen from now on.`,
  };
}

export function transitionOutcome(invoice: Pick<ClientInvoiceDto, 'invoiceNo' | 'status'>): ClientInvoiceOutcome {
  return { tone: 'accepted', word: `${invoice.invoiceNo ?? 'Invoice'} ${CLIENT_INVOICE_STATUS_LABEL[invoice.status].toLowerCase()}`, reason: 'The audit trail keeps the note.' };
}

// ── refusals ─────────────────────────────────────────────────────────────────

function houseReason(error: ApiProblem): string | null {
  switch (error.code) {
    case 'role-denied':
      return 'Only an owner or an accountant can prepare, issue or change client invoices.';
    case 'permission-denied':
      return 'That data belongs to another tenant — sign in again.';
    case 'unauthenticated':
      return 'Your session expired — sign in again.';
    case 'idempotency-key-reuse':
      return 'This request was already processed — refresh and try again.';
    case 'conflict':
      return 'The same request is still being processed — wait a moment and refresh.';
    default:
      return null;
  }
}

export function prepareReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'period-not-ended':
        return error.detail ?? 'That month has not ended yet — a month is invoiced only after it ends.';
      case 'client-not-billable':
        return 'Your own company is never invoiced — pick a client brand.';
      case 'nothing-to-invoice':
        return error.detail ?? 'This client has no billable usage that month.';
      case 'invoice-exists':
        return 'An invoice for that month and registration was just created — refresh the list.';
      case 'not-found':
        return 'That client no longer exists — refresh the page.';
      case 'validation-failed':
        return error.detail ?? 'Pick a month and try again.';
      default:
        return houseReason(error) ?? error.detail ?? `Not prepared (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/** The gaps an `invoice-has-gaps` refusal carries (structured, never parsed from prose). */
export function refusalGaps(error: unknown): readonly { code: string; detail: string }[] {
  if (!(error instanceof ApiProblem) || error.code !== 'invoice-has-gaps') return [];
  const gaps = error.extensions.gaps;
  if (!Array.isArray(gaps)) return [];
  return gaps.filter(
    (gap): gap is { code: string; detail: string } =>
      typeof gap === 'object' && gap !== null && typeof (gap as { code?: unknown }).code === 'string' && typeof (gap as { detail?: unknown }).detail === 'string',
  );
}

export function clientInvoiceActionReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'invoice-has-gaps': {
        const gaps = refusalGaps(error);
        return gaps.length === 0
          ? (error.detail ?? 'This draft still has gaps — clear them, refresh, and issue again.')
          : `Clear these first, then refresh: ${gaps.map((gap) => clientInvoiceGapLabel(gap.code)).join(', ')}.`;
      }
      case 'invoice-not-draft':
        return 'This invoice is no longer a draft — the list has been refreshed.';
      case 'invoice-transition-invalid':
        return error.detail ?? 'That status change is not allowed from here.';
      case 'nothing-to-invoice':
        return 'This draft has no billable line — discard it.';
      case 'not-found':
        return 'This invoice no longer exists — refresh the list.';
      case 'validation-failed':
        return error.detail ?? 'Check the note and try again.';
      default:
        return houseReason(error) ?? error.detail ?? `Not done (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/** The refusals whose recovery is a re-read (the row moved under the operator). */
export function actionNeedsReread(error: unknown): boolean {
  return error instanceof ApiProblem && (error.code === 'invoice-not-draft' || error.code === 'invoice-transition-invalid' || error.code === 'not-found');
}

export function clientInvoiceReadReason(error: unknown, subject: 'list' | 'detail'): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'invalid-cursor':
        return 'That page reference is stale — Retry restarts the list from the first page.';
      case 'not-found':
        return subject === 'detail' ? 'This invoice no longer exists — refresh the list.' : 'That tenant no longer exists — sign in again.';
      case 'role-denied':
        return 'Client invoices are an operator surface — this session cannot read them.';
      default:
        return houseReason(error) ?? error.detail ?? `Could not load the client invoices (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}
