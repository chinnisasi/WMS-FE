import { ApiProblem } from '@/lib/api/client';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';

/** Story 1-4b — the SKU status route's refusals (deactivate / reactivate). */
export function skuStatusReason(error: unknown, action: 'deactivated' | 'reactivated'): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'not-found':
        return 'That SKU no longer exists — refresh the page.';
      case 'role-denied':
        return 'Your role cannot edit the catalog.';
      case 'permission-denied':
        return 'That SKU belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This change was already processed with different details — refresh and try again.';
      case 'conflict':
        return 'The same change is still in flight — retry to read the settled result.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the reason and try again.';
      default:
        return error.detail ?? `SKU not ${action} (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}
