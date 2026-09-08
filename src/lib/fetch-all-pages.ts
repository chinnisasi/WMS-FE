/**
 * Generic cursor-chain walker behind every fetch-all loader (zones, and any
 * later surface that needs the full keyset chain): follow `nextCursor` until
 * it is null, bounded at 20 hops so a misbehaving backend can never spin the
 * loop forever. Pages are concatenated in server order. Mirrors
 * fetchAllWarehouses — that one stays specialized because its fetcher carries
 * the tenant id.
 */

export type CursorPage<T> = {
  items: readonly T[];
  nextCursor: string | null;
};

export type CursorPageFetcher<T> = (options?: { cursor?: string }) => Promise<CursorPage<T>>;

export const MAX_PAGE_HOPS = 20;

export async function fetchAllPages<T>(fetchPage: CursorPageFetcher<T>): Promise<readonly T[]> {
  let items: T[] = [];
  let cursor: string | undefined;
  for (let hops = 0; hops < MAX_PAGE_HOPS; hops++) {
    const page = await fetchPage(cursor === undefined ? undefined : { cursor });
    items = [...items, ...page.items];
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return items;
}