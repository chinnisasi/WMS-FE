import { ApiProblem } from '@/lib/api/client';

/**
 * Pure copy decisions of the story 3.3 surfaces (Inbound + Conflicts &
 * Reviews) — extracted from the components so the behavior is testable:
 * the negative-open callout (an approved over-receipt legitimately drives a
 * PO line's derived open quantity past zero) and the machine-problem reason
 * strings of an over-receipt decision. Clients branch on the problem `code`,
 * never on prose.
 */

/** A PO line's open quantity for the table cells — negative means over-received. */
export function openQtyLabel(openQty: number): string {
  return openQty < 0 ? `${openQty} (over-received)` : String(openQty);
}

/** The decision outcome's reason: the problem code branches, in plain words. */
export function decisionReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'over-receipt-decided':
        return 'This over-receipt was already decided — refresh the queue.';
      case 'not-found':
        return 'This over-receipt no longer exists — refresh the queue.';
      case 'role-denied':
        return 'Your role cannot decide over-receipts.';
      case 'idempotency-key-reuse':
        return 'This decision was already processed.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the request and try again.';
      default:
        return error.detail ?? `Decision failed (${error.code}).`;
    }
  }
  return 'The API is unreachable — is wms-be running?';
}