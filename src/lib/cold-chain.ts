import { ApiProblem } from '@/lib/api/client';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';

/**
 * Story 12-7 — the `/compliance` cold-chain trace viewer's pure decisions
 * (the `over-receipt.ts` pattern): the orderId shape check and the
 * machine-problem reason strings of the trace read. Clients branch on the
 * problem `code`, never on prose.
 */

/**
 * The Crockford base32 ULID shape (26 chars), matching `src/lib/ulid.ts`'s
 * generator: 10-char ms timestamp + 16 random chars. The client-side shape
 * check before fetch — the BE's 400 names a malformed orderId, but a
 * pasted order id with a stray space or a lowercase `i`/`l` (outside the
 * Crockford alphabet) is refused inline without spending the request.
 */
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isUlid(value: string): boolean {
  return ULID_PATTERN.test(value);
}

/**
 * The trace read's failure reasons. The two codes the surface is designed
 * around: `order-not-dispatched` (409 — a cold-chain trace is defined only
 * for dispatched orders, so an undispatched or draft order renders the
 * mapped refusal, not a raw error) and `not-found` (404 — the warehouse or
 * the order is invisible; an order that dispatched from another warehouse
 * reads the same as a missing one).
 */
export function traceReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'order-not-dispatched':
        return error.detail ?? 'This order has not been dispatched — a cold-chain trace exists only for dispatched orders.';
      case 'not-found':
        return 'No dispatched order with this id exists in this warehouse — check the order id and the warehouse pick.';
      case 'permission-denied':
        return 'That order belongs to another tenant — sign in again.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'That order id is malformed — it must be a 26-character ULID.';
      default:
        return error.detail ?? 'Could not load the cold-chain trace.';
    }
  }
  return UNREACHABLE_REASON;
}