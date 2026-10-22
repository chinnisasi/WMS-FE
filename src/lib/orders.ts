/**
 * Story 4-1b — how an order is NAMED, everywhere the web names one, and the
 * client order number's shape. No imports: the portal (behind its boundary)
 * and the staff surfaces share it.
 *
 * The label rule (decision 7): the client's own order number, else the sales
 * channel's reference (`externalEventId`), else the id's short form. The
 * backend returns the raw fields; the web composes the label here. The
 * backend's one SQL use of the rule (the client wind-down blocker,
 * `coalesce(client_order_ref, external_event_id, right(id::text, 8))`) takes
 * the same last eight characters — kept in step with `shortOrderId` (wms-be
 * `test/order-client-ref.spec.ts` checks the SQL side).
 */

/** The order fields the label reads; absent (an older stored response) reads as null. */
export interface OrderLabelFields {
  readonly id: string;
  readonly clientOrderRef?: string | null;
  readonly externalEventId?: string | null;
}

/**
 * The id's short form: its LAST eight characters — a UUIDv7's random tail
 * (the head is a millisecond timestamp, alike across a day's orders —
 * frontend IMPLEMENTATION-GUIDE §1.10). The backend's `right(id::text, 8)`.
 */
export function shortOrderId(id: string): string {
  return id.slice(-8);
}

/** `clientOrderRef ?? externalEventId ?? shortOrderId(id)` — a blank value never wins. */
export function orderLabel(order: OrderLabelFields): string {
  const ref = order.clientOrderRef ?? null;
  if (ref !== null && ref !== '') return ref;
  const channel = order.externalEventId ?? null;
  if (channel !== null && channel !== '') return channel;
  return shortOrderId(order.id);
}

/** The backend's `MAX_CLIENT_ORDER_REF_LENGTH` (wms-be `order.command.ts`). */
export const MAX_CLIENT_ORDER_REF_LENGTH = 64;

/**
 * Kept in step with wms-be's `CLIENT_ORDER_REF_RE` and the column CHECK
 * `orders_client_order_ref_shape_check` (migration 0088): 1–64 printable
 * ASCII characters, the first and the last not a space.
 */
export const CLIENT_ORDER_REF_RE = /^[!-~]([ -~]{0,62}[!-~])?$/;

/**
 * The client order number field, parsed as the backend will read it: trimmed;
 * blank (or spaces only) is ABSENT — `ref: null`, and the body carries no key
 * at all. A value the backend could only refuse 400 is a problem here, so it
 * is never sent and no Idempotency-Key is minted for it. Uniqueness is the
 * server's to decide (409 `duplicate-client-order-ref`).
 */
export function parseClientOrderRef(
  text: string,
  field = 'Client order number',
): { readonly ref: string | null; readonly problem: string | null } {
  const ref = text.trim();
  if (ref === '') return { ref: null, problem: null };
  if (ref.length > MAX_CLIENT_ORDER_REF_LENGTH) {
    return { ref: null, problem: `${field} is at most ${MAX_CLIENT_ORDER_REF_LENGTH} characters (this one is ${ref.length}).` };
  }
  if (!CLIENT_ORDER_REF_RE.test(ref)) {
    return {
      ref: null,
      problem: `${field} takes plain letters, digits, spaces and punctuation only — no tabs, line breaks or accented characters.`,
    };
  }
  return { ref, problem: null };
}

/** The body fragment: `{ clientOrderRef }` only when one was given (blank sends no key). */
export function clientOrderRefBody(ref: string | null): { clientOrderRef?: string } {
  return ref === null ? {} : { clientOrderRef: ref };
}

/** The backend's cap on the `reference` search (a channel reference is at most 200 characters). */
export const MAX_ORDER_SEARCH_LENGTH = 200;

/**
 * The staff and portal search box's value, as the backend reads `reference`:
 * trimmed; blank is no search (null); over 200 characters is a problem (the
 * server would refuse it 400) and nothing is sent.
 */
export function parseOrderSearch(text: string): { readonly reference: string | null; readonly problem: string | null } {
  const reference = text.trim();
  if (reference === '') return { reference: null, problem: null };
  if (reference.length > MAX_ORDER_SEARCH_LENGTH) {
    return { reference: null, problem: `A search is at most ${MAX_ORDER_SEARCH_LENGTH} characters.` };
  }
  return { reference, problem: null };
}
