import { ApiProblem } from '@/lib/api/client';
import type { AddressDto, OrderDto, OrderEntryDto, OrderLineDto } from '@/lib/api/generated';
import { parseQuantityInput, quantityLabel, sharedQuantityUom, type QuantityUom } from '@/lib/format-quantity';

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
/**
 * The aggregate quantities in a totals sentence render at the shared unit's
 * precision with the unit named — when the order's lines all resolve to one
 * unit. A mixed-unit (or unresolvable-SKU) order has no precision to state,
 * so its totals keep the unit-agnostic "`N` units" fallback copy.
 */
export function orderTotalsLabel(totals: LineTotals, uom?: QuantityUom | null): string {
  const q = (value: number) => quantityLabel(value, uom ?? null);
  const head = `${totals.lines} ${totals.lines === 1 ? 'line' : 'lines'} · ${q(totals.qty)} ordered · ${q(totals.reservedQty)} reserved`;
  if (totals.shortfallQty === 0) return head;
  const backordered = `${totals.backorderedLines} backordered ${totals.backorderedLines === 1 ? 'line' : 'lines'}`;
  return `${head} · ${q(totals.shortfallQty)} short across ${backordered}`;
}

/**
 * One line's quantities, as the expanded row states them. The line's OWN SKU
 * names the unit and its precision per row — a column mixing units has no
 * single alignment, so each row states its own. A line whose SKU cannot be
 * resolved falls back to the unit-agnostic "`N` units" rather than guessing
 * a precision.
 */
export function lineQuantityLabel(
  line: Pick<OrderLineDto, 'qty' | 'reservedQty' | 'shortfallQty'>,
  uom?: QuantityUom | null,
): string {
  const q = (value: number) => quantityLabel(value, uom ?? null);
  const base = `${q(line.qty)} ordered · ${q(line.reservedQty)} reserved`;
  return line.shortfallQty > 0 ? `${base} · ${q(line.shortfallQty)} short` : base;
}

export interface Outcome {
  readonly tone: 'accepted' | 'rejected';
  readonly word: string;
  readonly reason: string;
}

/**
 * The create result. A shortfall is reported as part of the acceptance — the
 * order exists, the reservations that could be taken were taken, and the
 * remainder is backordered. `skuOf` resolves the line's SKU because
 * `OrderLineDto` carries `skuId` alone (no code, no name) — and its unit, so
 * the short-fall quantities are named at the SKU's precision with its unit,
 * falling back to the raw id and the unit-agnostic "`N` units" when it
 * cannot be resolved.
 */
export const MAX_NAMED_SHORT_LINES = 5;

export function createOutcome(
  order: OrderDto,
  skuOf: (skuId: string) => (QuantityUom & { readonly code: string }) | undefined,
): Outcome {
  const totals = lineTotals(order.lines);
  const code = (skuId: string) => skuOf(skuId)?.code ?? skuId;
  const shared = sharedQuantityUom(order.lines, skuOf);
  const q = (value: number) => quantityLabel(value, shared);
  if (totals.shortfallQty === 0) {
    return {
      tone: 'accepted',
      word: 'Order accepted',
      reason: `${totals.lines} ${totals.lines === 1 ? 'line' : 'lines'}, ${q(totals.qty)} reserved in full.`,
    };
  }
  const shortLines = order.lines.filter((line) => line.shortfallQty > 0);
  const named = shortLines
    .slice(0, MAX_NAMED_SHORT_LINES)
    // A short line is named per ITS OWN SKU's unit, even inside a mixed order
    // where the totals sentence had to stay unit-agnostic.
    .map((line) => {
      const sku = skuOf(line.skuId);
      return `${code(line.skuId)} short ${quantityLabel(line.shortfallQty, sku ?? null)}`;
    })
    .join(', ');
  // An order carries up to 200 lines; naming them all would make the banner
  // a paragraph. The expanded row has the full per-line truth.
  const hidden = shortLines.length - MAX_NAMED_SHORT_LINES;
  const short = hidden > 0 ? `${named} …and ${hidden} more` : named;
  return {
    tone: 'accepted',
    word: 'Accepted with a shortfall',
    reason: `${q(totals.reservedQty)} of ${q(totals.qty)} reserved; ${totals.backorderedLines} of ${totals.lines} lines backordered — ${short}.`,
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
 *
 * Exported for `outbound-waves.ts`, whose refusals are verbatim for the same
 * reason and more often: `cutoff-passed`, `wave-cap-exceeded` and the
 * open-wave claim are all decided by state no DTO the client holds can show.
 */
export function verbatim(problem: ApiProblem): string {
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

/**
 * `null` = no filter. Filters the loaded page, never the warehouse.
 *
 * Generic over the status union (not pinned to `OrderStatus`) so the waves
 * surface filters its own three-arm lifecycle through the same function
 * rather than re-deriving it — the list APIs offer `cursor` + `limit` only,
 * and that limitation is identical on both.
 */
export function filterPage<T extends { readonly status: string }>(
  rows: readonly T[],
  status: T['status'] | null,
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
    // The STRING shape, not `Number()`: `parseQuantityInput` is the one
    // decimal-literal grammar (the bare `Number()` accepts `1e3` (→ 1000) and
    // `0x10` (→ 16), neither of which a `type="number"` field can produce and
    // both of which the backend refuses). Quantities are fractional now
    // (story 10.5), and the backend's floor is `@Min(0.001)`, so any POSITIVE
    // decimal passes; only zero is refused here (the backend refuses it too —
    // the parser's job is "nothing is sent that the backend would only 400").
    // A value finer than the SKU's unit allows is NEVER clamped or rounded
    // here: the backend's precision refusal (naming the unit and its
    // precision) is the authority, and this parser only decides shape.
    const quantity = parseQuantityInput(line.quantity);
    if (quantity === null || quantity <= 0) {
      return {
        lines: [],
        problem: 'Every quantity is a decimal greater than zero.',
      };
    }
    if (quantity > MAX_LINE_QUANTITY) {
      return { lines: [], problem: `A line quantity is at most ${MAX_LINE_QUANTITY}.` };
    }
    lines.push({ skuId: line.skuId, quantity });
  }
  return { lines, problem: null };
}

/* ------------------------------------------------------------------ */
/* The shipment destination (story 11-1)                               */
/* ------------------------------------------------------------------ */

/**
 * The address fields the create form collects. `line2` is the only optional
 * field — the backend refuses an address that is missing any other one, so
 * the parser refuses it first ("nothing is sent that the backend would only
 * 400"). The pincode is TEXT, six digits, leading zeros significant.
 */
export interface DestinationFields {
  readonly contactName: string;
  readonly phone: string;
  readonly line1: string;
  readonly line2: string;
  readonly city: string;
  readonly state: string;
  readonly pincode: string;
}

export function emptyDestinationFields(): DestinationFields {
  return { contactName: '', phone: '', line1: '', line2: '', city: '', state: '', pincode: '' };
}

export interface ParsedDestination {
  readonly destination: AddressDto | null;
  /** Non-null when the destination cannot be sent — nothing is requested. */
  readonly problem: string | null;
}

const PINCODE_RE = /^\d{6}$/;

/**
 * The destination form fields → the wire address. Trim every field, drop a
 * blank `line2`, refuse a required field left empty (naming it) and a
 * pincode that is not six digits. The backend re-checks all of this behind
 * its replay lookup; this parser only decides shape, exactly as
 * `parseDraftLines` does for lines.
 */
export function parseDestinationFields(fields: DestinationFields): ParsedDestination {
  const trimmed = {
    contactName: fields.contactName.trim(),
    phone: fields.phone.trim(),
    line1: fields.line1.trim(),
    line2: fields.line2.trim(),
    city: fields.city.trim(),
    state: fields.state.trim(),
    pincode: fields.pincode.trim(),
  };
  const missing = [
    ['contactName', 'contact name'],
    ['phone', 'phone'],
    ['line1', 'address line 1'],
    ['city', 'city'],
    ['state', 'state'],
    ['pincode', 'pincode'],
  ].filter(([key]) => trimmed[key as keyof typeof trimmed] === '');
  if (missing.length > 0) {
    const labels = missing.map(([, label]) => label);
    const list =
      labels.length === 1
        ? `a ${labels[0]}`
        : `${labels.slice(0, -1).map((label) => `a ${label}`).join(', ')} and a ${labels[labels.length - 1]}`;
    return {
      destination: null,
      problem: `The destination needs ${list}.`,
    };
  }
  if (!PINCODE_RE.test(trimmed.pincode)) {
    return {
      destination: null,
      problem: 'The pincode is six digits, as text — leading zeros are part of it.',
    };
  }
  return {
    destination: {
      contactName: trimmed.contactName,
      phone: trimmed.phone,
      line1: trimmed.line1,
      // A blank second line is "no second line" on the wire, not `''`.
      ...(trimmed.line2 === '' ? {} : { line2: trimmed.line2 }),
      city: trimmed.city,
      state: trimmed.state,
      pincode: trimmed.pincode,
    },
    problem: null,
  };
}

/**
 * The one line the orders table shows per row (story 11-1): city and
 * pincode — what the dispatch surface works from first. A pre-11.1 order
 * row reads `destination: null`; it renders as a dash, not empty space.
 */
export function destinationSummary(order: Pick<OrderEntryDto, 'destination'>): string {
  if (order.destination === null) return '—';
  return `${order.destination.city} ${order.destination.pincode}`;
}
