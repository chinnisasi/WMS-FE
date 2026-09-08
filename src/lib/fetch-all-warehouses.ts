import type { WarehouseResponse } from '@/lib/api/generated';

/** One keyset page, as `fetchApiListWarehouses` returns it. */
export type WarehousePage = {
  items: readonly WarehouseResponse[];
  nextCursor: string | null;
};

export type WarehousePageFetcher = (
  tenantId: string,
  options?: { cursor?: string },
) => Promise<WarehousePage>;

/**
 * The cursor-chain walk behind `useTenantWarehouses`, as a plain function so
 * it is testable without React: follow `nextCursor` until it is null,
 * bounded at 20 hops so a misbehaving backend can never spin the loop
 * forever (review loop 1). Pages are concatenated in server order.
 */
export const MAX_WAREHOUSE_HOPS = 20;

export async function fetchAllWarehouses(
  tenantId: string,
  fetchPage: WarehousePageFetcher,
): Promise<readonly WarehouseResponse[]> {
  let items: WarehouseResponse[] = [];
  let cursor: string | undefined;
  for (let hops = 0; hops < MAX_WAREHOUSE_HOPS; hops++) {
    const page = await fetchPage(tenantId, cursor === undefined ? undefined : { cursor });
    items = [...items, ...page.items];
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return items;
}