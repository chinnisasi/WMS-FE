import { ApiProblem } from '@/lib/api/client';
import type { OrderDto, OrderEntryDto, OrderLineDto } from '@/lib/api/generated';

/**
 * Pure copy and derivation for the Outbound orders surface (story 4.2b) —
 * extracted from the component the way `over-receipt.ts` was carved out of
 * the review queue, because this repo's tests all live in `src/lib/`.
 *
 * Three decisions live here rather than in JSX:
 *   1. Over-ATP is a normal outcome. Acceptance reserves `min(qty, atp)`, so
 *      a 201 can carry `shortfallQty > 0` and `backordered` lines. The create
 *      outcome therefore reads as accepted-with-a-shortfall, never as a
 *      failure.
 *   2. A cancel refused with 409 is refused for a cause no DTO the client
 *      holds can show (committed reservations, drawn pick lines). The only
 *      honest thing to render is the server's own `title` / `detail`.
 *   3. The status control filters the LOADED PAGE. The list endpoint offers
 *      `cursor` + `limit` and nothing else, so the count is stated in those
 *      terms ("N of M on this page") instead of implying a global search.
 */

export type OrderStatus = OrderEntryDto['status'];

/** The four lifecycle arms, in plain words (spec: numbers and verbs). */
export const ORDER_STATUS_LABEL: Readonly<Record<OrderStatus, string>> = {
  accepted: 'Accepted',
  ready_to_dispatch: 'Ready to dispatch',
  dispatched: 'Dispatched',
  cancelled: 'Cancelled',
};

/**
 * Derived from the label Record, never hand-listed: a new lifecycle arm
 * fails the compile at ORDER_STATUS_LABEL and then appears in the filter on
 * its own. A hand-written `readonly OrderStatus[]` would have accepted any
 * subset silently.
 */
export const ORDER_STATUSES = Object.keys(ORDER_STATUS_LABEL) as readonly OrderStatus[];

export function orderStatusLabel(status: OrderStatus): string {
  return ORDER_STATUS_LABEL[status];
}

export type OrderSource = OrderEntryDto['source'];

/** Record-typed for the same reason: a new source must be labelled to compile. */
export const ORDER_SOURCE_LABEL: Readonly<Record<OrderSource, string>> = {
  manual: 'Manual',
  ingested: 'Ingested',
};

export function orderSourceLabel(source: OrderSource): string {
  return ORDER_SOURCE_LABEL[source];
}

/**
 * Cancel is offered for exactly one state. The other three are terminal or
 * downstream (`ready_to_dispatch`, `dispatched`) or already done
 * (`cancelled`) — offering an action the backend will refuse for a state the
 * row already shows is the thing this rule exists to prevent.
 */
export function canCancelOrder(status: OrderStatus): boolean {
  return status === 'accepted';
}

/** The channel refs a list row shows; `—` on a manual order. */
export function channelRefLabel(order: Pick<OrderEntryDto, 'integrationId' | 'externalEventId'>): string {
  if (order.integrationId === null && order.externalEventId === null) return '—';
  return [order.integrationId, order.externalEventId].filter((ref) => ref !== null).join(' · ');
}

/**
 * A line's reservation hold, in plain words throughout — the journal's own
 * enum values (`held` / `committed` / `released` / `expired`) are not copy.
 * `reservationState` is typed `string | null`, so an unrecognised value falls
 * back to itself rather than being hidden.
 */
const HOLD_STATE_LABEL: Readonly<Record<string, string>> = {
  held: 'Held',
  committed: 'Committed to a pick',
  released: 'Released',
  expired: 'Expired',
};

export function holdStateLabel(line: Pick<OrderLineDto, 'reservationId' | 'reservationState'>): string {
  if (line.reservationId === null) return 'No hold';
  if (line.reservationState === null) return 'Held';
  return HOLD_STATE_LABEL[line.reservationState] ?? line.reservationState;
}

export interface LineTotals {
  readonly lines: number;
  readonly qty: number;
  readonly reservedQty: number;
  readonly shortfallQty: number;
  readonly backorderedLines: number;
}

export function lineTotals(lines: readonly OrderLineDto[]): LineTotals {
  return lines.reduce<LineTotals>(
    (totals, line) => ({
      lines: totals.lines + 1,
      qty: totals.qty + line.qty,
      reservedQty: totals.reservedQty + line.reservedQty,
      shortfallQty: totals.shortfallQty + line.shortfallQty,
      backorderedLines: totals.backorderedLines + (line.status === 'backordered' ? 1 : 0),
    }),
    { lines: 0, qty: 0, reservedQty: 0, shortfallQty: 0, backorderedLines: 0 },
  );
}

/**
 * The expanded row's one-sentence summary. This sentence is the story's whole
 * shortfall claim, so it lives here and is tested rather than sitting
 * untestable in JSX where dropping the shortfall clause would stay green.
 */
export function orderTotalsLabel(totals: LineTotals): string {
  const head = `${totals.lines} ${totals.lines === 1 ? 'line' : 'lines'} · ${totals.qty} ordered · ${totals.reservedQty} reserved`;
  if (totals.shortfallQty === 0) return head;
  const backordered = `${totals.backorderedLines} backordered ${totals.backorderedLines === 1 ? 'line' : 'lines'}`;
  return `${head} · ${totals.shortfallQty} short across ${backordered}`;
}

/** One line's quantities, as the expanded row states them. */
export function lineQuantityLabel(line: Pick<OrderLineDto, 'qty' | 'reservedQty' | 'shortfallQty'>): string {
  const base = `${line.qty} ordered · ${line.reservedQty} reserved`;
  return line.shortfallQty > 0 ? `${base} · ${line.shortfallQty} short` : base;
}

export interface Outcome {
  readonly tone: 'accepted' | 'rejected';
  readonly word: string;
  readonly reason: string;
}

/**
 * The create result. A shortfall is reported as part of the acceptance — the
 * order exists, the reservations that could be taken were taken, and the
 * remainder is backordered. `skuLabel` resolves the line's SKU because
 * `OrderLineDto` carries `skuId` alone (no code, no name).
 */
export const MAX_NAMED_SHORT_LINES = 5;

export function createOutcome(order: OrderDto, skuLabel: (skuId: string) => string): Outcome {
  const totals = lineTotals(order.lines);
  if (totals.shortfallQty === 0) {
    return {
      tone: 'accepted',
      word: 'Order accepted',
      reason: `${totals.lines} ${totals.lines === 1 ? 'line' : 'lines'}, ${totals.qty} units reserved in full.`,
    };
  }
  const shortLines = order.lines.filter((line) => line.shortfallQty > 0);
  const named = shortLines
    .slice(0, MAX_NAMED_SHORT_LINES)
    .map((line) => `${skuLabel(line.skuId)} short ${line.shortfallQty}`)
    .join(', ');
  // An order carries up to 200 lines; naming them all would make the banner
  // a paragraph. The expanded row has the full per-line truth.
  const hidden = shortLines.length - MAX_NAMED_SHORT_LINES;
  const short = hidden > 0 ? `${named} …and ${hidden} more` : named;
  return {
    tone: 'accepted',
    word: 'Accepted with a shortfall',
    reason: `${totals.reservedQty} of ${totals.qty} units reserved; ${totals.backorderedLines} of ${totals.lines} lines backordered — ${short}.`,
  };
}

/** The cancel result, for the row that was cancelled. */
export function cancelOutcome(order: OrderDto): Outcome {
  return {
    tone: 'accepted',
    word: 'Order cancelled',
    reason: `${order.lines.length} ${order.lines.length === 1 ? 'line' : 'lines'} released; the order reads cancelled.`,
  };
}

/**
 * The server's words, verbatim — `title`, then `detail` when it adds
 * anything. Used wherever the client cannot know better than the backend.
 */
function verbatim(problem: ApiProblem): string {
  const title = problem.title ?? '';
  const detail = problem.detail ?? '';
  if (title !== '' && detail !== '' && detail !== title) return `${title} — ${detail}`;
  if (detail !== '') return detail;
  if (title !== '') return title;
  return `The request was refused (${problem.code}).`;
}

/** The house fallback copy, shared by every mapper below. */
export const UNREACHABLE_REASON = 'The API is unreachable — is wms-be running?';

/**
 * Order-creation failures, branching on the machine-readable problem `code`
 * (never on prose), same contract as `decisionReason` / `qcReason`.
 */
export function createReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'not-found':
        return error.detail ?? 'The warehouse or a line SKU no longer exists — refresh and try again.';
      case 'role-denied':
        return 'Your role cannot create orders.';
      case 'permission-denied':
        return 'That warehouse belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed.';
      case 'order-source-conflict':
        return error.detail ?? 'That channel reference already created a different order.';
      case 'conflict':
        return 'The same submission is still in flight — retry to read the settled result.';
      case 'reservation-store-unavailable':
        return 'The reservation store is unreachable — nothing was created; retry in a moment.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the lines and try again.';
      default:
        return error.detail ?? `Order not created (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/**
 * Cancel failures. A 409 is rendered verbatim whatever its code: its two real
 * causes — a committed reservation and a drawn pick line — are invisible in
 * every field the client holds, so paraphrasing them would be guessing.
 */
export function cancelReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    if (error.status === 409) return verbatim(error);
    switch (error.code) {
      case 'not-found':
        return 'This order no longer exists — refresh the list.';
      case 'role-denied':
        return 'Your role cannot cancel orders.';
      case 'permission-denied':
        return 'That order belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This cancellation was already processed.';
      case 'reservation-store-unavailable':
        return 'The reservation store is unreachable — nothing changed; retry in a moment.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the request and try again.';
      default:
        return error.detail ?? `Not cancelled (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/** The detail (expanded-row) fetch failure — inline on that row only. */
export function detailReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'not-found':
        return 'This order no longer exists — refresh the list.';
      case 'permission-denied':
        return 'That order belongs to another tenant — sign in again.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      default:
        return error.detail ?? `Detail unavailable (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/**
 * The whole-surface reads (the order page, the warehouse list, the SKU
 * list). Each one has an explicit failed arm in the hook and renders this
 * with a Retry — a read that fails must never keep showing progress copy.
 */
export function readReason(error: unknown, subject: string): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'permission-denied':
        return 'That data belongs to another tenant — sign in again.';
      case 'not-found':
        return `${subject} could not be found — refresh the page.`;
      case 'invalid-cursor':
        return 'That page reference is stale — go back to the first page.';
      default:
        return error.detail ?? `Could not load ${subject} (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/* ------------------------------------------------------------------ */
/* The page-scoped status filter                                       */
/* ------------------------------------------------------------------ */

/** `null` = no filter. Filters the loaded page, never the warehouse. */
export function filterPage<T extends { status: OrderStatus }>(
  rows: readonly T[],
  status: OrderStatus | null,
): readonly T[] {
  return status === null ? rows : rows.filter((row) => row.status === status);
}

/**
 * The count beside the control. Naming the scope costs one word and keeps the
 * control from implying it searched anything the request did not load.
 */
export function pageFilterCount(shown: number, total: number): string {
  return `${shown} of ${total} on this page`;
}

/* ------------------------------------------------------------------ */
/* Manual entry                                                        */
/* ------------------------------------------------------------------ */

export interface DraftLine {
  readonly skuId: string;
  readonly quantity: string;
}

export const MAX_ORDER_LINES = 200;
/** The backend's `@Max` on a line quantity (int32). */
export const MAX_LINE_QUANTITY = 2147483647;

export interface ParsedLines {
  readonly lines: readonly { skuId: string; quantity: number }[];
  /** Non-null when the draft cannot be sent — nothing is requested. */
  readonly problem: string | null;
}

/**
 * The draft → request-body parse. Native form validation catches the empty
 * and non-numeric cases first; this is the guard that stops a body the
 * backend would only answer 400 to (0 lines, >200 lines, a non-positive
 * quantity) from being sent at all.
 */
export function parseDraftLines(draft: readonly DraftLine[]): ParsedLines {
  const filled = draft.filter((line) => line.skuId !== '' || line.quantity.trim() !== '');
  if (filled.length === 0) {
    return { lines: [], problem: 'Add at least one line — a SKU and a quantity.' };
  }
  if (filled.length > MAX_ORDER_LINES) {
    return { lines: [], problem: `An order carries at most ${MAX_ORDER_LINES} lines.` };
  }
  const lines: { skuId: string; quantity: number }[] = [];
  for (const line of filled) {
    if (line.skuId === '') {
      return { lines: [], problem: 'Every line needs a SKU.' };
    }
    // The STRING shape, not `Number()`: the parser accepts `1e3` (→ 1000) and
    // `0x10` (→ 16), neither of which a `type="number"` field can produce and
    // both of which the backend refuses. Digits only.
    const raw = line.quantity.trim();
    if (!/^\d+$/.test(raw) || Number(raw) < 1) {
      return { lines: [], problem: 'Every quantity is a whole number of 1 or more.' };
    }
    const quantity = Number(raw);
    if (quantity > MAX_LINE_QUANTITY) {
      return { lines: [], problem: `A line quantity is at most ${MAX_LINE_QUANTITY}.` };
    }
    lines.push({ skuId: line.skuId, quantity });
  }
  return { lines, problem: null };
}
