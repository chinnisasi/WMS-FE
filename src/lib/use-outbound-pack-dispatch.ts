'use client';

import { useOutboundOrders, type OutboundOrdersPage, type Reloadable, type ResourceState } from '@/lib/use-outbound-orders';

/**
 * The pack & dispatch surface's reads (story 4-2d).
 *
 * There is exactly one read of its own — the warehouse's order page — and it
 * is the SAME read the orders surface makes: the list endpoint is the only
 * order read there is (`cursor` + `limit`, headers only), and packable and
 * dispatchable orders are page-scoped client-side statuses of it. The hook is
 * therefore a distinct INSTANCE of the canonical shape (`use-outbound-orders`)
 * rather than a second fetch implementation: the two surfaces both mount on
 * `/outbound`, each needs its own cursor, revision counter and failed arm,
 * and the wave generate form already runs its own `useOutboundOrders` beside
 * the orders table for the same reason.
 *
 * The mutations this story adds do NOT live here: like the 4-2b/4-2c
 * surfaces, they live in the component (`pack-dispatch.tsx`), where the
 * idempotency key's lifetime is the intent — per-DRAFT for the pack bench,
 * per-CONFIRMATION for dispatch — and each success calls
 * `notifyOutboundChanged()` so every outbound reader refetches. The refusal
 * mappers live in `lib/outbound-pack-dispatch.ts`, tested.
 */

export type { OutboundOrdersPage, Reloadable, ResourceState };

/**
 * One cursor-paginated page of the warehouse's orders, newest first — the
 * read the pack & dispatch pipeline filters its packable/dispatchable rows
 * out of.
 */
export function usePipelineOrders(
  warehouseId: string | null,
): ResourceState<OutboundOrdersPage> & Reloadable & { readonly onCursor: (cursor: string | null) => void } {
  return useOutboundOrders(warehouseId);
}