import { describe, expect, test } from 'bun:test';

import { MAX_WAREHOUSE_HOPS, fetchAllWarehouses } from './fetch-all-warehouses';
import type { WarehouseResponse } from '@/lib/api/generated';

interface PageSpec {
  items: string[];
  nextCursor: string | null;
}

/** Stub fetcher serving a scripted page sequence, recording the cursors it received. */
function stubPager(pages: PageSpec[]) {
  const cursors: (string | undefined)[] = [];
  let calls = 0;
  const fetchPage = (_tenantId: string, options?: { cursor?: string }) => {
    cursors.push(options?.cursor);
    const page = pages[calls]!;
    calls += 1;
    // String stand-ins for warehouse rows — the walk only concatenates and
    // forwards; it never inspects the item shape.
    return Promise.resolve({
      items: page.items as unknown as readonly WarehouseResponse[],
      nextCursor: page.nextCursor,
    });
  };
  return { fetchPage, cursors, get calls() { return calls; } };
}

describe('fetchAllWarehouses (cursor-chain walk)', () => {
  test('concatenates all pages in server order, following each nextCursor', async () => {
    const pager = stubPager([
      { items: ['w1', 'w2'], nextCursor: 'c1' },
      { items: ['w3'], nextCursor: 'c2' },
      { items: ['w4', 'w5'], nextCursor: null },
    ]);

    const items = await fetchAllWarehouses('tenant-1', pager.fetchPage);
    expect(items as unknown as readonly string[]).toEqual(['w1', 'w2', 'w3', 'w4', 'w5']);
    // First page uncursoried; each later page carries the previous nextCursor.
    expect(pager.cursors).toEqual([undefined, 'c1', 'c2']);
  });

  test('a single-page result never issues a second request', async () => {
    const pager = stubPager([{ items: ['only'], nextCursor: null }]);
    const items = await fetchAllWarehouses('tenant-1', pager.fetchPage);
    expect(items as unknown as readonly string[]).toEqual(['only']);
    expect(pager.calls).toBe(1);
  });

  test('stops at the 20-hop bound even when the backend never stops paging', async () => {
    // Every page advertises another cursor — the loop must terminate itself.
    let n = 0;
    const cursors: (string | undefined)[] = [];
    const items = await fetchAllWarehouses('tenant-1', (_tenantId, options) => {
      cursors.push(options?.cursor);
      n += 1;
      return Promise.resolve({
        items: [`w${n}`] as unknown as readonly WarehouseResponse[],
        nextCursor: `cursor-${n}`,
      });
    });
    expect(items as unknown as readonly string[]).toHaveLength(MAX_WAREHOUSE_HOPS);
    expect(cursors).toHaveLength(MAX_WAREHOUSE_HOPS);
  });
});