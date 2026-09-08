import { describe, expect, test } from 'bun:test';

import { MAX_PAGE_HOPS, fetchAllPages } from './fetch-all-pages';

interface PageSpec {
  items: string[];
  nextCursor: string | null;
}

/** Stub fetcher serving a scripted page sequence, recording the cursors it received. */
function stubPager(pages: PageSpec[]) {
  const cursors: (string | undefined)[] = [];
  let calls = 0;
  const fetchPage = (options?: { cursor?: string }) => {
    cursors.push(options?.cursor);
    const page = pages[calls]!;
    calls += 1;
    return Promise.resolve({
      items: page.items as unknown as readonly string[],
      nextCursor: page.nextCursor,
    });
  };
  return { fetchPage, cursors, get calls() { return calls; } };
}

describe('fetchAllPages (generic cursor-chain walk)', () => {
  test('concatenates all pages in server order, following each nextCursor', async () => {
    const pager = stubPager([
      { items: ['z1', 'z2'], nextCursor: 'c1' },
      { items: ['z3'], nextCursor: null },
    ]);

    const items = await fetchAllPages(pager.fetchPage);
    expect(items).toEqual(['z1', 'z2', 'z3']);
    expect(pager.cursors).toEqual([undefined, 'c1']);
  });

  test('a single-page result never issues a second request', async () => {
    const pager = stubPager([{ items: ['only'], nextCursor: null }]);
    const items = await fetchAllPages(pager.fetchPage);
    expect(items).toEqual(['only']);
    expect(pager.calls).toBe(1);
  });

  test('stops at the hop bound even when the backend never stops paging', async () => {
    let n = 0;
    const cursors: (string | undefined)[] = [];
    const items = await fetchAllPages((options) => {
      cursors.push(options?.cursor);
      n += 1;
      return Promise.resolve({
        items: [`z${n}`],
        nextCursor: `cursor-${n}`,
      });
    });
    expect(items).toHaveLength(MAX_PAGE_HOPS);
    expect(cursors).toHaveLength(MAX_PAGE_HOPS);
  });
});