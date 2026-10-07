/**
 * Story 21-4 — a client brand's metered usage on the web: the period picker
 * (months from the client's creation to the current month, plus a custom
 * range of at most 366 days), the per-line labels (storage as base-unit-days,
 * the handling counts, the rate, the amount or "Not billed"), the segment and
 * overall totals, the two notices, and the refusal mapper.
 *
 * Pure: no React, no fetch — every sentence and derivation here is pinned by
 * `usage.test.ts`. The backend decides every number; nothing here rounds,
 * converts or re-prices a quantity (amounts are integer paise from the
 * server, quantities are its exact decimal strings).
 */
import { ApiProblem } from '@/lib/api/client';
import type { ClientUsageResponse, RateCardDto, UsageLineDto, UsageSegmentDto } from '@/lib/api/generated';
import { formatRupees } from '@/lib/invoices';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import { basisLabel, chargeLabel, formatIstDate, istDateOf, NOT_BILLED } from '@/lib/rate-cards';

/** The backend's bound on one usage read (inclusive days). */
export const MAX_USAGE_DAYS = 366;

/** Always shown above the figures: nothing here is an invoice. */
export const ESTIMATE_NOTICE = 'Estimate until invoiced · GST-exclusive';

/** Shown when storage has no measured day at all (no snapshot has run, or the tenant's own client). */
export const STORAGE_NOT_MEASURED = 'Storage not measured yet';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** One selectable month: its inclusive IST date range. */
export interface UsageMonthOption {
  /** `YYYY-MM`. */
  readonly value: string;
  readonly label: string;
  readonly from: string;
  readonly to: string;
  /** The month contains today (IST) — its figures can still grow. */
  readonly inProgress: boolean;
}

function lastDayOfMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

/**
 * The months a client can be metered over, newest first: from the IST month
 * the client was created to the IST month of `asOf` (the SERVER's clock —
 * the rate-cards read's `asOf`), the current one marked in progress.
 */
export function usageMonthOptions(clientCreatedAt: string, asOf: string): UsageMonthOption[] {
  const created = istDateOf(clientCreatedAt);
  const today = istDateOf(asOf);
  const index = (date: string): number => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
  const start = Math.min(index(created), index(today));
  const end = index(today);
  const options: UsageMonthOption[] = [];
  for (let i = end; i >= start; i -= 1) {
    const year = Math.floor(i / 12);
    const month0 = i % 12;
    const value = `${year}-${pad2(month0 + 1)}`;
    options.push({
      value,
      label: `${MONTH_NAMES[month0]} ${year}`,
      from: `${value}-01`,
      to: `${value}-${pad2(lastDayOfMonth(year, month0))}`,
      inProgress: i === end,
    });
  }
  return options;
}

/** The option's visible label, with the in-progress marker. */
export function usageMonthLabel(option: UsageMonthOption): string {
  return option.inProgress ? `${option.label} — in progress` : option.label;
}

/** The default period: last month — or the current one when the client is newer than that. */
export function defaultUsageMonth(options: readonly UsageMonthOption[]): UsageMonthOption | null {
  return options[1] ?? options[0] ?? null;
}

/** Inclusive day count of `[from, to]` (UTC arithmetic on dates — no zone). */
function inclusiveDays(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The custom range → a period, or a problem the form shows (and sends
 * nothing): both dates, `from` not after `to`, at most 366 days — the rules
 * the backend answers 400 to, mirrored so a guaranteed refusal is never sent.
 */
export function parseCustomRange(from: string, to: string): { period: { from: string; to: string }; problem: null } | { period: null; problem: string } {
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) return { period: null, problem: 'Pick both a start and an end date.' };
  if (from > to) return { period: null, problem: 'The start date is after the end date.' };
  if (inclusiveDays(from, to) > MAX_USAGE_DAYS) {
    return { period: null, problem: `A period covers at most ${MAX_USAGE_DAYS} days.` };
  }
  return { period: { from, to }, problem: null };
}

// ── a line ──────────────────────────────────────────────────────────────────

/** Thousands separators on a decimal string's integer part — the string is the server's exact value, never re-parsed as a float. */
export function groupDecimal(value: string): string {
  const negative = value.startsWith('-');
  const [whole, fraction] = (negative ? value.slice(1) : value).split('.');
  const grouped = (whole ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '−' : ''}${grouped}${fraction === undefined ? '' : `.${fraction}`}`;
}

const COUNT_NOUNS: Readonly<Record<Exclude<UsageLineDto['chargeCode'], 'storage'>, readonly [string, string]>> = {
  inbound_handling: ['receipt line', 'receipt lines'],
  pick: ['pick', 'picks'],
  outbound_handling: ['order', 'orders'],
};

/** The quantity cell: storage as base-unit-days (`1,234.567 kg-days`), the rest as counts (`3 receipt lines`). */
export function usageQuantityLabel(line: Pick<UsageLineDto, 'chargeCode' | 'uom' | 'quantity'>): string {
  if (line.chargeCode === 'storage') {
    return `${groupDecimal(line.quantity)} ${line.uom === null ? 'unit' : line.uom}-days`;
  }
  const [one, many] = COUNT_NOUNS[line.chargeCode];
  return `${groupDecimal(line.quantity)} ${line.quantity === '1' ? one : many}`;
}

/** The base-unit cell: the storage line's UoM, or — for a count. */
export function usageUnitLabel(line: Pick<UsageLineDto, 'uom'>): string {
  return line.uom ?? '—';
}

/** The rate cell: `₹3.30 per 1,000 units per day`, or — when the card prices no such charge. */
export function usageRateLabel(line: Pick<UsageLineDto, 'ratePaise' | 'basis'>): string {
  return line.ratePaise === null ? '—' : `${formatRupees(line.ratePaise)} ${basisLabel(line.basis)}`;
}

/** A storage amount withheld because the stretch has days not yet measured (21-4). */
export const STORAGE_PENDING = 'Pending — not all days measured';

/**
 * The amount cell: `₹4.07`, or "Not billed" (no card, or no line for the
 * charge) — except a storage line in a stretch whose storage is not fully
 * measured: its amount is withheld, not unbilled.
 */
export function usageAmountLabel(
  line: Pick<UsageLineDto, 'amountPaise' | 'chargeCode' | 'ratePaise'>,
  segment?: Pick<UsageSegmentDto, 'storageMeasuredThrough' | 'toDate'>,
): string {
  if (line.amountPaise !== null) return formatRupees(line.amountPaise);
  if (line.chargeCode === 'storage' && line.ratePaise !== null && segment !== undefined && segment.storageMeasuredThrough !== segment.toDate) {
    return STORAGE_PENDING;
  }
  return NOT_BILLED;
}

export function usageChargeLabel(line: Pick<UsageLineDto, 'chargeCode'>): string {
  return chargeLabel(line.chargeCode);
}

// ── segments and totals ────────────────────────────────────────────────────

/** Σ of a segment's priced amounts (integer paise from the server). */
export function segmentBilledPaise(segment: Pick<UsageSegmentDto, 'lines'>): number {
  return segment.lines.reduce((sum, line) => sum + (line.amountPaise ?? 0), 0);
}

/**
 * A segment's heading: its dates and the card that priced it —
 * `1 Sep 2026 – 14 Sep 2026 · card from 1 Sep 2026`, or "no rate card in
 * force" for a stretch nothing prices.
 */
export function segmentHeading(
  segment: Pick<UsageSegmentDto, 'fromDate' | 'toDate' | 'rateCardId'>,
  cards: readonly Pick<RateCardDto, 'id' | 'effectiveFrom'>[],
): string {
  const range = `${formatIstDate(segment.fromDate)} – ${formatIstDate(segment.toDate)}`;
  if (segment.rateCardId === null) return `${range} · no rate card in force — not billed`;
  const card = cards.find((entry) => entry.id === segment.rateCardId);
  return card?.effectiveFrom ? `${range} · card from ${formatIstDate(card.effectiveFrom)}` : `${range} · rate card`;
}

export function segmentTotalLabel(segment: Pick<UsageSegmentDto, 'lines'>): string {
  return `Segment total ${formatRupees(segmentBilledPaise(segment))}`;
}

export function billedTotalLabel(usage: Pick<ClientUsageResponse, 'totals'>): string {
  const unbilled = usage.totals.unbilledLines;
  const suffix = unbilled === 0 ? '' : ` · ${unbilled} line${unbilled === 1 ? '' : 's'} not billed`;
  return `Billed total ${formatRupees(usage.totals.billedPaise)}${suffix}`;
}

/**
 * The storage notice: "Storage not measured yet" when nothing is measured;
 * otherwise "Storage through <date>" — the last day in the figures — with a
 * note when the period runs past it.
 */
export function storageNotice(usage: Pick<ClientUsageResponse, 'storageCompleteThrough' | 'from' | 'to'>): string {
  const through = usage.storageCompleteThrough;
  if (through === null || through < usage.from) return STORAGE_NOT_MEASURED;
  if (through >= usage.to) return `Storage through ${formatIstDate(usage.to)}`;
  return `Storage through ${formatIstDate(through)} — later days are not in the figures yet`;
}

/** The period's in-progress marker: the period runs past the server's today (IST). */
export function periodInProgress(usage: Pick<ClientUsageResponse, 'to' | 'asOf'>): boolean {
  return usage.to >= istDateOf(usage.asOf);
}

// ── refusals ────────────────────────────────────────────────────────────────

export function usageReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'validation-failed':
        return error.detail ?? 'Check the period — at most 366 days, the start not after the end.';
      case 'not-found':
        return 'This client no longer exists — refresh the page.';
      case 'permission-denied':
        return 'Your session belongs to another tenant — sign in again.';
      case 'role-denied':
        return 'Your role cannot read usage.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      default:
        return error.detail ?? `Usage unavailable (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}
