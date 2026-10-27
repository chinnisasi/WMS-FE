import { describe, expect, test } from 'bun:test';

import {
  FIRST_PAGE,
  canSort,
  cursorStackNext,
  cursorStackPrev,
  hasPrevPage,
  headerCheckState,
  hiddenColumnCounts,
  hiddenColumnsLabel,
  nextSort,
  priorityCellClass,
  priorityMirrorClass,
  selectedRows,
  showingLabel,
  sortRows,
  toggleAll,
  toggleOne,
} from './data-table-model';

/** Story UI-2 (UI-PATTERNS §3) — the DataTable rules, pinned without React. */

describe('cursor stack — Prev means the previous page', () => {
  test('Next, Next, Prev lands on page two; Prev again on page one; then no Prev', () => {
    const p2 = cursorStackNext(FIRST_PAGE, 'c2');
    const p3 = cursorStackNext(p2, 'c3');
    expect(p3).toEqual({ current: 'c3', previous: [null, 'c2'] });
    const back = cursorStackPrev(p3);
    expect(back.current).toBe('c2');
    expect(hasPrevPage(back)).toBe(true);
    const first = cursorStackPrev(back);
    expect(first).toEqual(FIRST_PAGE);
    expect(hasPrevPage(first)).toBe(false);
    expect(cursorStackPrev(first)).toEqual(FIRST_PAGE);
  });
});

describe('sorting', () => {
  test('three-state cycle; another column starts ascending', () => {
    expect(nextSort(null, 'a')).toEqual({ key: 'a', direction: 'ascending' });
    expect(nextSort({ key: 'a', direction: 'ascending' }, 'a')).toEqual({ key: 'a', direction: 'descending' });
    expect(nextSort({ key: 'a', direction: 'descending' }, 'a')).toBeNull();
    expect(nextSort({ key: 'a', direction: 'descending' }, 'b')).toEqual({ key: 'b', direction: 'ascending' });
  });

  test('only over a complete list: page one with no next page', () => {
    expect(canSort(FIRST_PAGE, null)).toBe(true);
    expect(canSort(FIRST_PAGE, undefined)).toBe(true);
    expect(canSort(FIRST_PAGE, 'c2')).toBe(false);
    expect(canSort(cursorStackNext(FIRST_PAGE, 'c2'), null)).toBe(false);
  });

  test('stable, numeric-aware, missing values last in both directions', () => {
    const rows = [
      { id: '1', v: 'B-10' },
      { id: '2', v: null },
      { id: '3', v: 'b-2' },
      { id: '4', v: 'A' },
      { id: '5', v: 'B-2' },
    ];
    const asc = sortRows(rows, (r) => r.v, 'ascending').map((r) => r.id);
    expect(asc).toEqual(['4', '3', '5', '1', '2']);
    const desc = sortRows(rows, (r) => r.v, 'descending').map((r) => r.id);
    expect(desc).toEqual(['1', '3', '5', '4', '2']);
    expect(sortRows([{ n: 10 }, { n: 9 }, { n: 100 }], (r) => r.n, 'ascending').map((r) => r.n)).toEqual([9, 10, 100]);
  });
});

describe('selection — page-scoped, selectable rows only', () => {
  const rows = [
    { id: 'a', ok: true },
    { id: 'b', ok: false },
    { id: 'c', ok: true },
  ];
  const can = (r: { ok: boolean }) => r.ok;

  test('header state ignores non-selectable rows', () => {
    expect(headerCheckState(rows, new Set(), can)).toBe('none');
    expect(headerCheckState(rows, new Set(['a']), can)).toBe('some');
    expect(headerCheckState(rows, new Set(['a', 'c']), can)).toBe('all');
    expect(headerCheckState(rows, new Set(['b']), can)).toBe('none');
    expect(headerCheckState([{ id: 'b', ok: false }], new Set(), can)).toBe('none');
  });

  test('toggle all selects every selectable row on the page, or clears when all are', () => {
    expect([...toggleAll(rows, new Set(['a']), can)].sort()).toEqual(['a', 'c']);
    expect([...toggleAll(rows, new Set(['a', 'c']), can)]).toEqual([]);
    expect([...toggleOne(new Set(['a']), 'c', true)].sort()).toEqual(['a', 'c']);
    expect([...toggleOne(new Set(['a']), 'a', false)]).toEqual([]);
  });

  test('a bulk action sees only the selected rows still on screen and selectable', () => {
    expect(selectedRows(rows, new Set(['a', 'b', 'gone']), can).map((r) => r.id)).toEqual(['a']);
  });
});

describe('column priority', () => {
  test('3 hides below lg, 2 below md, 1 never; the mirror is the inverse', () => {
    expect(priorityCellClass(3)).toBe('hidden lg:table-cell');
    expect(priorityCellClass(2)).toBe('hidden md:table-cell');
    expect(priorityCellClass(1)).toBe('');
    expect(priorityCellClass(undefined)).toBe('');
    expect(priorityMirrorClass(3)).toBe('lg:hidden');
    expect(priorityMirrorClass(2)).toBe('md:hidden');
  });

  test('hidden counts per breakpoint, and the footer words', () => {
    expect(hiddenColumnCounts([{ priority: 1 }, { priority: 2 }, { priority: 3 }, { priority: 3 }, {}])).toEqual({
      belowMd: 3,
      belowLg: 2,
    });
    expect(hiddenColumnsLabel(1)).toBe('1 column hidden at this width — shown under each row');
    expect(hiddenColumnsLabel(2)).toContain('2 columns');
  });
});

test('showing label counts the page, en-IN grouped', () => {
  expect(showingLabel(1)).toBe('Showing 1 row');
  expect(showingLabel(12)).toBe('Showing 12 rows');
  expect(showingLabel(123456)).toBe('Showing 1,23,456 rows');
});
