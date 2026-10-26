import type { OrderStatus } from '@/lib/outbound-orders';

/** Story UI-1 — the StatusChip's meanings (UI-PATTERNS §9.2). */
export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

/**
 * Story UI-1 (UI-PATTERNS §9.2) — which StatusChip tone each order status
 * wears, staff and portal alike. Exhaustive over the generated union, so a
 * new lifecycle arm fails the compile here. In progress is `info`, the
 * settled hand-over `success`, a cancelled order `neutral` (it is not a
 * refusal — nothing failed).
 */
export const ORDER_STATUS_TONE: Readonly<Record<OrderStatus, StatusTone>> = {
  accepted: 'info',
  ready_to_dispatch: 'info',
  dispatched: 'success',
  cancelled: 'neutral',
};

/** The tone for an order status — `neutral` for a status a newer backend added and this build does not know. */
export function orderStatusTone(status: string): StatusTone {
  return Object.hasOwn(ORDER_STATUS_TONE, status) ? ORDER_STATUS_TONE[status as OrderStatus] : 'neutral';
}
