/**
 * Story 21-3 — rate cards on the web: a client brand's versioned prices.
 * The vocabularies mirrored from wms-be (`billing/rate-cards.ts`), the
 * state each card shows (derived from its dates against the SERVER's
 * `asOf`, never the browser clock), the next scheduled change, the draft
 * editor's ₹ parser, the activation date minimum, and the refusal mappers.
 *
 * Pure: no React, no fetch — every sentence and derivation here is pinned by
 * `rate-cards.test.ts` (the house rule: a claim left in JSX is a claim
 * nothing can pin).
 */
import { ApiProblem } from '@/lib/api/client';
import type { ClientDto, ClientInvoiceLineDto, RateCardDto, RateCardLineDto } from '@/lib/api/generated';
import { formatRupees } from '@/lib/invoices';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import { parseRupees } from '@/lib/rupees';

/** Fired on `window` after a rate-card mutation so readers refetch. */
export const RATE_CARDS_CHANGED_EVENT = 'wms-rate-cards-changed';

export function notifyRateCardsChanged(): void {
  window.dispatchEvent(new Event(RATE_CARDS_CHANGED_EVENT));
}

/**
 * Story 5-5a — the vocabularies split three ways:
 * - `MeteredChargeCode` — the four metered charges (`CHARGE_CODES`,
 *   `CHARGE_BASIS`, the editor's and the table's per-charge columns, usage);
 * - `RateCardChargeCode` — a card line's code: the four plus
 *   `minimum_monthly` (the minimum monthly charge, at most one per card);
 * - `ChargeCode` — every code a label is asked for: a card line's, plus an
 *   invoice line's `adhoc` and `minimum_adjustment`.
 */
export type RateCardChargeCode = RateCardLineDto['chargeCode'];
export type MeteredChargeCode = Exclude<RateCardChargeCode, 'minimum_monthly'>;
export type ChargeCode = RateCardChargeCode | ClientInvoiceLineDto['chargeCode'];
export type RateBasis = RateCardLineDto['basis'] | ClientInvoiceLineDto['basis'];
export type MinimumCounts = NonNullable<RateCardLineDto['minimumCounts']>;

/** The four metered charges, in the backend's canonical order (`CHARGE_CODES`). */
export const CHARGE_CODES: readonly MeteredChargeCode[] = ['storage', 'inbound_handling', 'pick', 'outbound_handling'];

/** The pair map — each metered charge has exactly one basis (the backend's `CHARGE_BASIS`). */
export const CHARGE_BASIS: Readonly<Record<MeteredChargeCode, RateCardLineDto['basis']>> = {
  storage: 'per_thousand_units_per_day',
  inbound_handling: 'per_receipt_line',
  pick: 'per_pick',
  outbound_handling: 'per_order',
};

/** The minimum monthly charge's code and its one basis (story 5-5a, decision 8). */
export const MINIMUM_CODE = 'minimum_monthly' satisfies RateCardChargeCode;
export const MINIMUM_BASIS = 'per_month' satisfies RateCardLineDto['basis'];

/** The backend's per-code bound on a metered line amount: ₹1 lakh in paise. */
export const MAX_RATE_AMOUNT_PAISE = 10_000_000;

/** A12 — the minimum monthly charge's bound: ₹0.01 .. ₹1 crore in paise. */
export const MAX_MINIMUM_AMOUNT_PAISE = 1_000_000_000;

/** A19 — what counts toward the floor: every charge (the default), or the metered ones only. */
export const MINIMUM_COUNTS: readonly MinimumCounts[] = ['all', 'metered'];

export const MINIMUM_COUNTS_LABEL: Readonly<Record<MinimumCounts, string>> = {
  all: 'Metered and ad-hoc charges',
  metered: 'Metered charges only',
};

/** Decision 9 / A21 — where the minimum applies, in the operator's words. */
export const MINIMUM_SCOPE_COPY =
  'The minimum applies to each monthly invoice (one per GSTIN). When the month’s charges fall short, the invoice adds a minimum-charge adjustment line for the difference; a card change mid-month prorates it by days. A client billed under more than one GSTIN cannot carry a minimum.';

const CHARGE_LABELS: Readonly<Record<ChargeCode, string>> = {
  storage: 'Storage',
  inbound_handling: 'Inbound handling',
  pick: 'Pick',
  outbound_handling: 'Outbound handling',
  minimum_monthly: 'Minimum monthly charge',
  adhoc: 'Ad-hoc charge',
  minimum_adjustment: 'Minimum charge adjustment',
};

const BASIS_LABELS: Readonly<Record<RateBasis, string>> = {
  per_thousand_units_per_day: 'per 1,000 units per day',
  per_receipt_line: 'per receipt line',
  per_pick: 'per pick',
  per_order: 'per order',
  per_month: 'per month',
  per_unit: 'per unit',
  per_invoice: 'per invoice',
};

export function chargeLabel(code: ChargeCode): string {
  return CHARGE_LABELS[code] ?? code;
}

export function basisLabel(basis: RateBasis): string {
  return BASIS_LABELS[basis] ?? basis;
}

/** The copy for a charge a card does not price. ₹0 is different: billed at zero. */
export const NOT_BILLED = 'Not billed';

/** One charge's cell: `₹3.30` or "Not billed" (the minimum's: "No minimum"). */
export function chargeCell(card: Pick<RateCardDto, 'lines'>, code: RateCardChargeCode): string {
  const line = card.lines.find((entry) => entry.chargeCode === code);
  if (line === undefined) return code === MINIMUM_CODE ? NO_MINIMUM : NOT_BILLED;
  return formatRupees(line.amountPaise);
}

/** A card without a minimum monthly charge. */
export const NO_MINIMUM = 'No minimum';

/** The minimum column's cell: `₹50,000.00 · metered only`, or "No minimum". */
export function minimumCell(card: Pick<RateCardDto, 'lines'>): string {
  const line = card.lines.find((entry) => entry.chargeCode === MINIMUM_CODE);
  if (line === undefined) return NO_MINIMUM;
  return line.minimumCounts === 'metered' ? `${formatRupees(line.amountPaise)} · metered only` : formatRupees(line.amountPaise);
}

/** The clients a card can be drafted for: never the tenant's own `self` client. */
export function pricedClients(clients: readonly ClientDto[]): readonly ClientDto[] {
  return clients.filter((client) => !client.systemOwned);
}

// ── dates ───────────────────────────────────────────────────────────────────

/** IST is UTC+05:30 year-round. */
const IST_OFFSET_MS = 5.5 * 3600 * 1000;

/** The IST calendar date (`YYYY-MM-DD`) of an instant. */
export function istDateOf(instant: string | number): string {
  const ms = typeof instant === 'number' ? instant : Date.parse(instant);
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-11-01` → `1 Nov 2026` (no locale, no zone — it is already an IST date). */
export function formatIstDate(date: string): string {
  const [year, month, day] = date.split('-');
  return `${Number(day)} ${MONTHS[Number(month) - 1] ?? month} ${year}`;
}

/**
 * The activation date input's `min`: today (IST) for a client's first card,
 * tomorrow (IST) once it has any dated card — the backend's rule (no hour
 * already passed is repriced). "Today" is the IST date of the loaded
 * `asOf` (the SERVER's clock, from the in-force read), never the browser's;
 * the server still decides, and its `rate-card-effective-date` refusal names
 * the earliest date it will take.
 */
export function activationMinDate(asOf: string, cards: readonly Pick<RateCardDto, 'status'>[]): string {
  const today = istDateOf(asOf);
  const hasDated = cards.some((card) => card.status === 'active' || card.status === 'superseded');
  return hasDated ? addDays(today, 1) : today;
}

// ── the state a card shows ─────────────────────────────────────────────────

export type RateCardState = 'Draft' | 'Scheduled' | 'In force' | 'Ended' | 'Cancelled';

/**
 * A card's state, derived from its dates. "In force" comes from the
 * in-force endpoint (the server's answer at `asOf`), never the browser
 * clock; Scheduled / Ended compare the card's IST dates with `asOf`'s IST
 * date (an effective date is an IST midnight, so a card dated on `asOf`'s
 * day has begun).
 */
export function rateCardState(
  card: Pick<RateCardDto, 'id' | 'status' | 'effectiveFrom' | 'effectiveTo'>,
  inForceId: string | null,
  asOf: string,
): RateCardState {
  if (card.status === 'draft') return 'Draft';
  if (card.status === 'cancelled') return 'Cancelled';
  if (card.id === inForceId) return 'In force';
  const today = istDateOf(asOf);
  if (card.effectiveFrom !== null && card.effectiveFrom > today) return 'Scheduled';
  return 'Ended';
}

/**
 * Cancel is offered on every SCHEDULED card: a dated card (`active`, or
 * `superseded` by a later one) whose date is ahead of the server's `asOf`.
 */
export function canCancelRateCard(card: Pick<RateCardDto, 'status' | 'effectiveFrom'>, asOf: string): boolean {
  return (
    (card.status === 'active' || card.status === 'superseded') &&
    card.effectiveFrom !== null &&
    card.effectiveFrom > istDateOf(asOf)
  );
}

/**
 * What cancelling `card` leaves in force, worded by case. The predecessor
 * is the card whose `effectiveTo` is this card's `effectiveFrom`:
 * - none → nothing is in force from that date;
 * - a predecessor still scheduled → it applies from its own date;
 * - a predecessor in force → it stays in force.
 */
export function cancelConsequence(
  card: Pick<RateCardDto, 'effectiveFrom'>,
  cards: readonly RateCardDto[],
  inForceId: string | null,
  asOf: string,
): string {
  const predecessor = cards.find(
    (entry) => entry.status === 'superseded' && entry.effectiveTo !== null && entry.effectiveTo === card.effectiveFrom,
  );
  if (predecessor === undefined) return 'Nothing is in force — this client will not be billed until another card takes effect.';
  if (rateCardState(predecessor, inForceId, asOf) === 'Scheduled') return 'The previous card applies from its own date.';
  return 'The card it replaces stays in force.';
}

/**
 * The next scheduled change, charge by charge against the card in force:
 * `Storage ₹3.30 → ₹4.00 from 1 Nov 2026`. A charge gained or dropped reads
 * "Not billed". Null when nothing is scheduled.
 */
export function nextChangeSummary(
  cards: readonly RateCardDto[],
  inForce: RateCardDto | null,
  asOf: string,
): { date: string; changes: readonly string[] } | null {
  const today = istDateOf(asOf);
  const next = cards
    // A scheduled card may already be superseded by a later one — it still starts first.
    .filter(
      (card) =>
        (card.status === 'active' || card.status === 'superseded') && card.effectiveFrom !== null && card.effectiveFrom > today,
    )
    .sort((a, b) => (a.effectiveFrom! < b.effectiveFrom! ? -1 : 1))[0];
  if (next === undefined) return null;
  const date = formatIstDate(next.effectiveFrom!);
  const changes: string[] = [];
  for (const code of CHARGE_CODES) {
    const before = inForce === null ? NOT_BILLED : chargeCell(inForce, code);
    const after = chargeCell(next, code);
    if (before !== after) changes.push(`${chargeLabel(code)} ${before} → ${after} from ${date}`);
  }
  // Story 5-5a — the minimum (and its counts rule) is a term too.
  const minimumBefore = inForce === null ? NO_MINIMUM : minimumCell(inForce);
  const minimumAfter = minimumCell(next);
  if (minimumBefore !== minimumAfter) changes.push(`${chargeLabel(MINIMUM_CODE)} ${minimumBefore} → ${minimumAfter} from ${date}`);
  if (changes.length === 0) changes.push(`A new card with the same prices takes over from ${date}`);
  return { date: next.effectiveFrom!, changes };
}

/** The banner copy when an active client has no card in force. */
export const NOT_BILLED_BANNER = 'This client will not be billed — no rate card is in force.';

export function showNotBilledBanner(client: Pick<ClientDto, 'status' | 'systemOwned'>, inForce: RateCardDto | null): boolean {
  return client.status === 'active' && !client.systemOwned && inForce === null;
}

// ── the draft editor ────────────────────────────────────────────────────────

/**
 * The editor's fields: the four metered ₹ fields (blank = the charge is not
 * billed), and — story 5-5a — the minimum monthly ₹ field (blank = no
 * minimum) with what counts toward it.
 */
export type RateDraftFields = Readonly<Record<MeteredChargeCode, string>> & {
  readonly minimum_monthly: string;
  readonly minimumCounts: MinimumCounts;
};

export const EMPTY_RATE_DRAFT: RateDraftFields = {
  storage: '',
  inbound_handling: '',
  pick: '',
  outbound_handling: '',
  minimum_monthly: '',
  minimumCounts: 'all',
};

/** Paise → the editor's rupee text (`330` → `3.30`), integer arithmetic only. */
export function paiseToRupeeText(paise: number): string {
  return `${Math.trunc(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;
}

/** A card's lines as editor fields (to edit a draft). */
export function draftFieldsOf(card: Pick<RateCardDto, 'lines'>): RateDraftFields {
  const fields: { -readonly [K in keyof RateDraftFields]: RateDraftFields[K] } = { ...EMPTY_RATE_DRAFT };
  for (const line of card.lines) {
    fields[line.chargeCode] = paiseToRupeeText(line.amountPaise);
    if (line.chargeCode === MINIMUM_CODE) fields.minimumCounts = line.minimumCounts ?? 'all';
  }
  return fields;
}

/**
 * The editor's fields → the lines the backend takes, or a problem naming the
 * charge. Blank → no line (not billed); `0` → billed at ₹0. Rupees parse
 * through `parseRupees` (no float); the per-code bound (A12) is checked here
 * because `parseRupees` does not know it: ₹0 .. ₹1 lakh for a metered rate,
 * ₹0.01 .. ₹1 crore for the minimum. The basis is never typed — the pair map.
 * The minimum line always carries its `minimumCounts` (the backend's default
 * is `all`; sending it keeps the request explicit).
 */
export function parseRateDraft(fields: RateDraftFields): { lines: RateCardLineDto[]; problem: null } | { lines: null; problem: string } {
  const lines: RateCardLineDto[] = [];
  for (const code of CHARGE_CODES) {
    const text = fields[code].trim();
    if (text === '') continue;
    const parsed = parseRupees(text);
    if ('problem' in parsed) return { lines: null, problem: `${chargeLabel(code)}: ${parsed.problem}` };
    if (parsed.paise > MAX_RATE_AMOUNT_PAISE) {
      return { lines: null, problem: `${chargeLabel(code)}: at most ${formatRupees(MAX_RATE_AMOUNT_PAISE)} ${basisLabel(CHARGE_BASIS[code])}.` };
    }
    lines.push({ chargeCode: code, basis: CHARGE_BASIS[code], amountPaise: parsed.paise });
  }
  const minimum = fields.minimum_monthly.trim();
  if (minimum !== '') {
    const label = chargeLabel(MINIMUM_CODE);
    const parsed = parseRupees(minimum);
    if ('problem' in parsed) return { lines: null, problem: `${label}: ${parsed.problem}` };
    if (parsed.paise < 1) return { lines: null, problem: `${label}: at least ₹0.01 — leave it blank for no minimum.` };
    if (parsed.paise > MAX_MINIMUM_AMOUNT_PAISE) {
      return { lines: null, problem: `${label}: at most ${formatRupees(MAX_MINIMUM_AMOUNT_PAISE)} ${basisLabel(MINIMUM_BASIS)}.` };
    }
    lines.push({ chargeCode: MINIMUM_CODE, basis: MINIMUM_BASIS, amountPaise: parsed.paise, minimumCounts: fields.minimumCounts });
  }
  return { lines, problem: null };
}

// ── outcomes and refusals ──────────────────────────────────────────────────

/** The GSTINs a `minimum-needs-single-gstin` refusal names (structured, never parsed from prose; "none" stands for no GSTIN). */
export function minimumGstins(error: unknown): readonly string[] {
  if (!(error instanceof ApiProblem) || error.code !== 'minimum-needs-single-gstin') return [];
  const raw = error.extensions['gstins'];
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).map((gstin) => (typeof gstin === 'string' && gstin !== '' ? gstin : gstin === null ? 'no GSTIN' : null)).filter((gstin): gstin is string => gstin !== null);
}

export function activatedOutcome(card: Pick<RateCardDto, 'effectiveFrom'>): { word: string; reason: string } {
  return {
    word: 'Card activated',
    reason: `Its rates apply from ${formatIstDate(card.effectiveFrom ?? '')} (IST midnight). It can no longer be edited — draft a new card to change a rate.`,
  };
}

export function cancelledOutcome(
  card: Pick<RateCardDto, 'effectiveFrom'>,
  consequence: string,
): { word: string; reason: string } {
  return {
    word: 'Card cancelled',
    reason: `It will not take effect on ${formatIstDate(card.effectiveFrom ?? '')}. ${consequence}`,
  };
}

export type RateCardAction = 'drafted' | 'saved' | 'discarded' | 'activated' | 'cancelled';

/** Every rate-card mutation's refusals, branched on `code`. */
export function rateCardReason(error: unknown, action: RateCardAction): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'rate-card-effective-date':
        // The server names the earliest date its clock allows.
        return error.detail ?? 'That date is too early — a replacement takes effect tomorrow (IST) at the earliest.';
      case 'rate-card-effective-overlap':
        return error.detail ?? 'A new card must take effect after every existing card.';
      case 'rate-card-no-lines':
        return 'Price at least one charge before activating the card.';
      case 'minimum-needs-single-gstin': {
        // A21 — the server names the GSTINs in `extensions.gstins`.
        const gstins = minimumGstins(error);
        return `A minimum monthly charge applies to each monthly invoice (one per GSTIN), and this client is billed under ${
          gstins.length > 1 ? `${gstins.length} GSTINs (${gstins.join(', ')})` : 'more than one GSTIN'
        } — it would be charged once per GSTIN. Remove the minimum from the draft, or bill the client from one GSTIN.`;
      }
      case 'rate-card-not-draft':
        return 'This card is no longer a draft — an activated card never changes. Refresh the list.';
      case 'rate-card-not-cancellable':
        return error.detail ?? 'Only a card whose date has not arrived can be cancelled.';
      case 'client-not-active':
        return error.detail ?? 'This client is not active — its cards cannot be drafted or activated.';
      case 'not-found':
        return 'That card or client no longer exists — refresh the page.';
      case 'role-denied':
        return 'Only an owner or an accountant can manage rate cards.';
      case 'permission-denied':
        return 'Your session belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'That request key was already used for a different change — reload and try again.';
      case 'conflict':
        return "The client's cards changed meanwhile — reload and try again.";
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the rates and the date and try again.';
      default:
        return error.detail ?? `Card not ${action} (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}
