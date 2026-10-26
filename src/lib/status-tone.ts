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
