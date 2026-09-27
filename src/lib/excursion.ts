import { ApiProblem } from '@/lib/api/client';
import type { QcHoldDto } from '@/lib/api/generated';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';

/**
 * Story 12-7 — the excursion review queue's pure decisions (the
 * `over-receipt.ts` pattern): the machine-problem reason strings of the
 * queue's read and of its one mutation. Clients branch on the problem
 * `code`, never on prose.
 */

/**
 * The excursion list read's failure reasons. `invalid-cursor` is its own
 * arm (the keyset page reference the queue can sit on when the backend
 * prunes) — the queue's Retry restarts from the first page, which is the
 * only recovery the copy can honestly offer.
 */
export function excursionListReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'invalid-cursor':
        return 'That page reference is stale — the queue restarted from the first page.';
      case 'not-found':
        return 'That warehouse no longer exists — refresh the page.';
      case 'permission-denied':
        return 'That data belongs to another tenant — sign in again.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the queue filters and try again.';
      default:
        return error.detail ?? 'Could not load the excursion queue.';
    }
  }
  return UNREACHABLE_REASON;
}

/**
 * The resolve command's failure reasons (capability `review.decide`). The
 * 409 arm mirrors `over-receipt-decided`: the excursion was resolved by
 * another reviewer between the page load and the click — the queue's
 * re-read (the reload the caller runs) is the recovery, and the refusal
 * says so instead of rendering a raw conflict.
 */
export function excursionResolveReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'excursion-resolved':
        return 'This excursion was already resolved — the queue has refreshed.';
      case 'not-found':
        return 'This excursion no longer exists — refresh the queue.';
      case 'role-denied':
        return 'Your role cannot resolve excursions.';
      case 'idempotency-key-reuse':
        return 'This decision was already processed.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the request and try again.';
      default:
        return error.detail ?? `Resolve failed (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/**
 * One joined hold's state label on an excursion card. A hold id the
 * qc-holds read no longer returns (released-and-pruned, or outside the
 * walked page window) is DISPOSED — the affected unit is no longer
 * quarantined and the card says so rather than silently dropping it.
 */
export function holdLabel(hold: QcHoldDto | undefined): string {
  if (hold === undefined) return 'disposed';
  return hold.status === 'open' ? 'held' : 'released';
}