/**
 * Story UI-2 (UI-PATTERNS §3, W5) — the pure rules behind `DataTable`:
 * the cursor stack that makes Prev mean "previous page", the three-state
 * client-side sort and when it is honest, the page-scoped selection, and
 * the column-priority bookkeeping. No React, so `data-table-model.test.ts`
 * pins every rule directly.
 */

// ── Cursor stack ──────────────────────────────────────────────────────────

/**
 * Where the table is in a cursor walk: the cursor that produced the page on
 * screen (`null` = page one) and every earlier page's cursor, oldest first.
 */
export interface CursorStack {
  readonly current: string | null;
  readonly previous: readonly (string | null)[];
}

export const FIRST_PAGE: CursorStack = { current: null, previous: [] };

/** Next: the page on screen becomes the one Prev returns to. */
export function cursorStackNext(stack: CursorStack, next: string): CursorStack {
  return { current: next, previous: [...stack.previous, stack.current] };
}

/** Prev: back exactly one page. Page one stays page one. */
export function cursorStackPrev(stack: CursorStack): CursorStack {
  if (stack.previous.length === 0) return FIRST_PAGE;
  return { current: stack.previous[stack.previous.length - 1] ?? null, previous: stack.previous.slice(0, -1) };
}

export function hasPrevPage(stack: CursorStack): boolean {
  return stack.previous.length > 0;
}

// ── Sorting ───────────────────────────────────────────────────────────────

export type SortDirection = 'ascending' | 'descending';

/** `null`: unsorted (the server's order). */
export type SortState = { readonly key: string; readonly direction: SortDirection } | null;

/** A header press: none → ascending → descending → none; another column starts ascending. */
export function nextSort(state: SortState, key: string): SortState {
  if (state === null || state.key !== key) return { key, direction: 'ascending' };
  return state.direction === 'ascending' ? { key, direction: 'descending' } : null;
}

/**
 * A client-side sort is honest only when the rows on screen are the whole
 * list: page one, with no next page. Over a cursor page it would reorder 25
 * rows out of thousands and lie (§3.2).
 */
export function canSort(stack: CursorStack, nextCursor: string | null | undefined): boolean {
  return stack.previous.length === 0 && stack.current === null && (nextCursor ?? null) === null;
}

export type SortValue = string | number | null | undefined;

const collator = new Intl.Collator('en-IN', { numeric: true, sensitivity: 'base' });

function compareValues(a: SortValue, b: SortValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collator.compare(String(a), String(b));
}

/**
 * Stable sort by `value`. A missing value (`null`/`undefined`/`''`) sorts
 * last in BOTH directions — "unknown" is never the smallest or the largest.
 * Ties keep the server's order.
 */
export function sortRows<T>(rows: readonly T[], value: (row: T) => SortValue, direction: SortDirection): T[] {
  const sign = direction === 'ascending' ? 1 : -1;
  const missing = (v: SortValue) => v === null || v === undefined || v === '';
  return rows
    .map((row, index) => ({ row, index, v: value(row) }))
    .sort((x, y) => {
      const mx = missing(x.v);
      const my = missing(y.v);
      if (mx || my) return mx === my ? x.index - y.index : mx ? 1 : -1;
      const c = compareValues(x.v, y.v);
      return c === 0 ? x.index - y.index : sign * c;
    })
    .map((entry) => entry.row);
}

// ── Selection ─────────────────────────────────────────────────────────────

/** The selected rows that are on screen and still selectable — what a bulk action acts on. */
export function selectedRows<T extends { id: string }>(
  rows: readonly T[],
  selected: ReadonlySet<string>,
  canSelect: (row: T) => boolean = () => true,
): T[] {
  return rows.filter((row) => selected.has(row.id) && canSelect(row));
}

export type HeaderCheckState = 'none' | 'some' | 'all';

/** The header checkbox over the selectable rows on this page only. */
export function headerCheckState<T extends { id: string }>(
  rows: readonly T[],
  selected: ReadonlySet<string>,
  canSelect: (row: T) => boolean = () => true,
): HeaderCheckState {
  const selectable = rows.filter(canSelect);
  if (selectable.length === 0) return 'none';
  const picked = selectable.filter((row) => selected.has(row.id)).length;
  return picked === 0 ? 'none' : picked === selectable.length ? 'all' : 'some';
}

/** The header checkbox press: all selected → none; otherwise every selectable row on the page. */
export function toggleAll<T extends { id: string }>(
  rows: readonly T[],
  selected: ReadonlySet<string>,
  canSelect: (row: T) => boolean = () => true,
): ReadonlySet<string> {
  return headerCheckState(rows, selected, canSelect) === 'all'
    ? new Set<string>()
    : new Set(rows.filter(canSelect).map((row) => row.id));
}

export function toggleOne(selected: ReadonlySet<string>, id: string, on: boolean): ReadonlySet<string> {
  const next = new Set(selected);
  if (on) next.add(id);
  else next.delete(id);
  return next;
}

// ── Column priority ───────────────────────────────────────────────────────

export type ColumnPriority = 1 | 2 | 3;

/** Tailwind classes that hide a column below its breakpoint: 3 below `lg`, 2 below `md`. */
export function priorityCellClass(priority: ColumnPriority | undefined): string {
  if (priority === 3) return 'hidden lg:table-cell';
  if (priority === 2) return 'hidden md:table-cell';
  return '';
}

/** The mirror line under the first cell shows a hidden column's value until the column itself shows. */
export function priorityMirrorClass(priority: ColumnPriority | undefined): string {
  if (priority === 3) return 'lg:hidden';
  if (priority === 2) return 'md:hidden';
  return 'hidden';
}

/** How many columns are hidden below `md` (priority 2 and 3) and between `md` and `lg` (priority 3). */
export function hiddenColumnCounts(columns: readonly { readonly priority?: ColumnPriority }[]): {
  readonly belowMd: number;
  readonly belowLg: number;
} {
  const p3 = columns.filter((c) => c.priority === 3).length;
  const p2 = columns.filter((c) => c.priority === 2).length;
  return { belowMd: p2 + p3, belowLg: p3 };
}

export function hiddenColumnsLabel(count: number): string {
  return `${count} ${count === 1 ? 'column' : 'columns'} hidden at this width — shown under each row`;
}

// ── Footer ────────────────────────────────────────────────────────────────

/** "Showing 12 rows" — the page's own count, never a total the API does not return (§3.4). */
export function showingLabel(count: number, noun: { one: string; many: string } = { one: 'row', many: 'rows' }): string {
  return `Showing ${count.toLocaleString('en-IN')} ${count === 1 ? noun.one : noun.many}`;
}
