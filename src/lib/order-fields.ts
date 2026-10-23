/**
 * Story 4-2a — the order header fields on the web: order type (B2B/B2C), cash
 * on delivery, priority and ship-by date. IMPORT-FREE by contract (design
 * review A15): `lib/orders.ts` keeps its no-imports rule and the portal may
 * use every helper here (pure `lib/*` helpers are portal-allowed). "Today" is
 * always PASSED IN — the IST date of `Date.now()` (`istDateOf`,
 * `lib/rate-cards.ts`) — so nothing here reads a clock.
 */

/** Mirrors the backend's `ORDER_TYPES` (`order-urgency.ts`). */
export const ORDER_TYPES = ['b2b', 'b2c'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

/** Mirrors the backend's `ORDER_PRIORITIES`; ranked urgent 0, high 1, normal 2. */
export const ORDER_PRIORITIES = ['normal', 'high', 'urgent'] as const;
export type OrderPriority = (typeof ORDER_PRIORITIES)[number];

/** The portal may set normal or high only — urgent is the warehouse's (A12). */
export const PORTAL_ORDER_PRIORITIES = ['normal', 'high'] as const;

/** The backend's COD ceiling: ₹1 crore in paise. */
export const MAX_COD_AMOUNT_PAISE = 1_000_000_000;

/** The backend's ship-by window: today (IST) to today + 365 days. */
export const MAX_SHIP_BY_DAYS_AHEAD = 365;

export const ORDER_TYPE_LABEL: Readonly<Record<OrderType, string>> = { b2b: 'B2B', b2c: 'B2C' };
export const ORDER_PRIORITY_LABEL: Readonly<Record<OrderPriority, string>> = { normal: 'Normal', high: 'High', urgent: 'Urgent' };

const PRIORITY_RANK: Readonly<Record<string, number>> = { urgent: 0, high: 1, normal: 2 };

/** Absent (a pre-4-2a stored answer) reads as normal; an unknown value sorts last. */
function rank(priority: string | null | undefined): number {
  const value = priority ?? 'normal';
  return Object.prototype.hasOwnProperty.call(PRIORITY_RANK, value) ? PRIORITY_RANK[value]! : 3;
}

/**
 * INR money from integer paise (AD-9). Indian digit grouping by hand (the
 * last three digits are the first group, every group before it holds two:
 * `1,23,456`), so nothing depends on the runtime's ICU build; the paise are
 * always shown. Moved here from `outbound-pack-dispatch.ts` (which
 * re-exports it); the handheld's copy is byte-identical, pinned by test.
 */
export function formatInrPaise(amountPaise: number): string {
  const negative = amountPaise < 0;
  const abs = Math.abs(Math.trunc(amountPaise));
  const rupees = Math.floor(abs / 100);
  const paise = abs % 100;
  const digits = String(rupees);
  const grouped =
    digits.length <= 3
      ? digits
      : `${digits.slice(0, digits.length - 3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${digits.slice(-3)}`;
  return `${negative ? '−' : ''}₹${grouped}.${String(paise).padStart(2, '0')}`;
}

/** The priority chip's text — High and Urgent only; normal (or a legacy null) shows none. */
export function priorityChip(priority: string | null | undefined): string | null {
  return priority === 'high' ? 'High' : priority === 'urgent' ? 'Urgent' : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-10-24` → `24 Oct`. A malformed value prints as given. */
export function formatShipBy(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) return date;
  const month = MONTHS[Number(match[2]) - 1];
  return month === undefined ? date : `${match[3]} ${month}`;
}

/** The statuses an order is still to ship in (A14: there is no `picking` arm). */
const OPEN_STATUSES: readonly string[] = ['accepted', 'ready_to_dispatch'];

/**
 * Story 4-2a (A14) — "Overdue" before today, "Due today" on it; null after it,
 * with no date, or once the order is dispatched or cancelled.
 */
export function shipByStatus(
  shipByDate: string | null | undefined,
  todayIst: string,
  orderStatus?: string,
): 'Overdue' | 'Due today' | null {
  if (shipByDate === null || shipByDate === undefined) return null;
  if (orderStatus !== undefined && !OPEN_STATUSES.includes(orderStatus)) return null;
  if (shipByDate < todayIst) return 'Overdue';
  if (shipByDate === todayIst) return 'Due today';
  return null;
}

/** The ship-by cell: `24 Oct`, plus its status when there is one — `24 Oct · Due today`. */
export function shipByLabel(shipByDate: string | null | undefined, todayIst: string, orderStatus?: string): string {
  if (shipByDate === null || shipByDate === undefined) return '—';
  const status = shipByStatus(shipByDate, todayIst, orderStatus);
  return status === null ? formatShipBy(shipByDate) : `${formatShipBy(shipByDate)} · ${status}`;
}

/**
 * Story 4-2a (A14) — ONE payment line on every surface: "COD ₹x" when there
 * is an amount to collect; else "Prepaid" when the order has a type (created
 * from 4-2a on); else "—" (a legacy order, or a legacy stored slip).
 */
export function paymentLine(fields: { readonly codAmountPaise?: number | null; readonly orderType?: string | null }): string {
  if (fields.codAmountPaise !== null && fields.codAmountPaise !== undefined) return `COD ${formatInrPaise(fields.codAmountPaise)}`;
  if (fields.orderType !== null && fields.orderType !== undefined) return 'Prepaid';
  return '—';
}

/** The type cell: B2B / B2C, or "—" on a legacy order. */
export function orderTypeLabel(orderType: string | null | undefined): string {
  return orderType === 'b2b' || orderType === 'b2c' ? ORDER_TYPE_LABEL[orderType] : '—';
}

/** What the urgency comparator reads of an order. */
export interface UrgencyFacts {
  readonly priority?: string | null;
  readonly shipByDate?: string | null;
  readonly createdAt: string;
  readonly id: string;
}

/**
 * The backend's urgency key (A8), client-side: due first (ship-by on or
 * before today), then priority (urgent, high, normal), then ship-by ascending
 * with none last, then oldest, then id. Negative when `a` is more urgent.
 */
export function compareOrderUrgency(a: UrgencyFacts, b: UrgencyFacts, todayIst: string): number {
  const dueA = a.shipByDate !== null && a.shipByDate !== undefined && a.shipByDate <= todayIst;
  const dueB = b.shipByDate !== null && b.shipByDate !== undefined && b.shipByDate <= todayIst;
  if (dueA !== dueB) return dueA ? -1 : 1;
  const byRank = rank(a.priority) - rank(b.priority);
  if (byRank !== 0) return byRank;
  const shipA = a.shipByDate ?? null;
  const shipB = b.shipByDate ?? null;
  if (shipA !== shipB) {
    if (shipA === null) return 1;
    if (shipB === null) return -1;
    return shipA < shipB ? -1 : 1;
  }
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function addIsoDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The latest ship-by date the server accepts (the date input's `max`). */
export function maxShipByDate(todayIst: string): string {
  return addIsoDays(todayIst, MAX_SHIP_BY_DAYS_AHEAD);
}

/**
 * The ship-by text → the date to send, or a problem — so a date the server
 * would refuse is never sent. Blank is absent (`null`).
 */
export function parseShipByDate(text: string, todayIst: string): { date: string | null } | { problem: string } {
  const value = text.trim();
  if (value === '') return { date: null };
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const real = match !== null && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!real) return { problem: 'Ship-by must be a date (YYYY-MM-DD).' };
  if (value < todayIst) return { problem: 'Ship-by cannot be in the past (IST).' };
  if (value > maxShipByDate(todayIst)) return { problem: `Ship-by is at most ${MAX_SHIP_BY_DAYS_AHEAD} days ahead.` };
  return { date: value };
}

/** A COD amount (already parsed to paise) outside the server's range, as a sentence — or null. */
export function codAmountProblem(paise: number): string | null {
  if (!Number.isSafeInteger(paise) || paise < 1) return 'Enter the amount to collect (at least ₹0.01).';
  if (paise > MAX_COD_AMOUNT_PAISE) return 'The amount to collect is at most ₹1,00,00,000.00.';
  return null;
}

/**
 * Story 4-2a (A17) — the manifest's courier cash hand-over line: "2 COD ·
 * collect ₹2,998.00", or "No COD" (an absent figure — a manifest stored
 * before 4-2a — reads as none).
 */
export function manifestCodLabel(manifest: { readonly codShipmentCount?: number; readonly codTotalPaise?: number }): string {
  const count = manifest.codShipmentCount ?? 0;
  if (count === 0) return 'No COD';
  return `${count} COD · collect ${formatInrPaise(manifest.codTotalPaise ?? 0)}`;
}
