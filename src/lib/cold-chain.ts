import { ApiProblem } from '@/lib/api/client';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';

/**
 * Story 12-7 — the `/compliance` cold-chain trace viewer's pure decisions
 * (the `over-receipt.ts` pattern): the orderId shape check and the
 * machine-problem reason strings of the trace read. Clients branch on the
 * problem `code`, never on prose.
 *
 * The id vocabulary: every BE entity id — orders included — is a dashed
 * lowercase UUIDv7 (`wms-be/src/shared/primitives/ids.ts`: "Every entity id
 * in the system is a UUIDv7… Idempotency keys are ULIDs"). ULIDs are the
 * Idempotency-Key vocabulary ONLY, never an entity id — the trace gate
 * checks the UUID shape, not a ULID.
 */

/**
 * The dashed UUID shape (36 chars), case-insensitive hex — the same shape
 * the BE's `UUID_RE` guards the trace route with. The client-side shape
 * check before fetch: the BE's 400 names a malformed orderId, but a pasted
 * order id with a stray space or a missing dash group is refused inline
 * without spending the request. Case-insensitive because a copy out of
 * some tooling arrives uppercase; the component lowercases before fetch.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
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
        return error.detail ?? 'That order id is malformed — it must be a 36-character UUID (8-4-4-4-12, dashes).';
      default:
        return error.detail ?? 'Could not load the cold-chain trace.';
    }
  }
  return UNREACHABLE_REASON;
}