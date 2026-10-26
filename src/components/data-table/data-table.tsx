'use client';

import { Fragment, useEffect, useRef, useState } from 'react';

import { BulkActionBar } from '@/components/shared/bulk-action-bar';
import { LoadingStatus, SkeletonRows } from '@/components/shared/skeleton';
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
  type ColumnPriority,
  type CursorStack,
  type SortState,
  type SortValue,
} from '@/lib/data-table-model';
import { formatCount } from '@/lib/format-quantity';

/**
 * Data-table primitive — the spine every list surface drops into (stubbed in
 * Story 1.1): dense ~40px rows, sticky header, tabular numerals on numeric
 * columns, cursor pagination (offsets and infinite scroll are banned),
 * sticky-styled row actions wired by the owning surface later.
 */
export interface DataTableColumn<T> {
  readonly key: string;
  readonly header: string;
  readonly numeric?: boolean;
  readonly render?: (row: T) => React.ReactNode;
  /**
   * Story UI-2 (§3.2) — 3 hides below `lg`, 2 below `md`; 1 (or absent)
   * never hides. A hidden column's value shows in a labelled line under the
   * row's first named cell until the column itself shows. Only a NON-interactive
   * column without a `data-testid` may take 2 or 3 (spec A5): its render is
   * drawn twice.
   */
  readonly priority?: ColumnPriority;
  /**
   * Story UI-2 — opt-in client-side sort. The header becomes a sort button
   * ONLY while the table shows the whole list (page one, no next page);
   * over a cursor page it stays plain text (§3.2: a sort there would lie).
   */
  readonly sortValue?: (row: T) => SortValue;
}

/**
 * Story UI-2 (§3.5, W6) — opt-in, page-scoped row selection. The caller owns
 * the set (its bulk action must clear and prune it on its own events); the
 * table clears it on its own page moves, shows the bar while at least one
 * on-screen selectable row is selected, and counts only those.
 */
export interface DataTableSelection<T> {
  readonly selected: ReadonlySet<string>;
  readonly onChange: (next: ReadonlySet<string>) => void;
  readonly canSelect?: (row: T) => boolean;
  /** The row checkbox's accessible name ("Select wave W-12"). */
  readonly rowLabel: (row: T) => string;
  readonly noun: { readonly one: string; readonly many: string };
  /** The bar's actions (at most three). */
  readonly actions?: React.ReactNode;
  /** A bulk run in flight: every checkbox and Clear selection are disabled. */
  readonly busy?: boolean;
}

/**
 * The DOM id of a row's expanded panel — the toggle that opens it points at
 * this with `aria-controls`, so the association is one shared function
 * rather than a magic string agreed in two places.
 */
export function expandedRowId(rowId: string): string {
  return `expanded-${rowId}`;
}

export interface DataTableProps<T extends { id: string }> {
  readonly columns: readonly DataTableColumn<T>[];
  readonly rows: readonly T[];
  /** Opaque cursor for the next page; absent → "Next" is disabled. */
  readonly nextCursor?: string | null;
  readonly onCursor?: (cursor: string | null) => void;
  /** Story UI-2 — a node, so a caller passes an `EmptyState`; a plain string still renders as before. */
  readonly emptyMessage?: React.ReactNode;
  /**
   * Optional per-row detail panel (story 4.2b). When it returns a node, a
   * full-width row is rendered directly beneath that row — the shape a list
   * whose rows cannot carry their own detail needs, and the reason this app
   * still has no `[id]` route. Returning `null`/`undefined` renders nothing,
   * so a surface that does not opt in is byte-for-byte unchanged.
   *
   * The owning surface decides which row is open and fetches the detail; the
   * table only supplies the slot.
   */
  readonly renderExpanded?: (row: T) => React.ReactNode;
  /**
   * Story UI-1 — a cold load (no data yet): the header renders, the body is
   * five skeleton rows, the table is `aria-busy`, and these words are
   * announced (visually hidden). Pass it only while the read has no data;
   * absent, the table renders exactly as before. Story UI-2: Prev and Next
   * are disabled while it is set (one push per press).
   */
  readonly loading?: string;
  readonly selection?: DataTableSelection<T>;
  /** Story UI-2 — the footer's noun ("Showing 12 waves"); default rows. */
  readonly rowNoun?: { readonly one: string; readonly many: string };
}

const SORT_GLYPH = { ascending: '▲', descending: '▼' } as const;

function HeaderRow<T>({
  columns,
  sort,
  onSort,
  leading,
}: {
  columns: readonly DataTableColumn<T>[];
  /** Present only while sorting is honest; absent → plain headers. */
  sort?: SortState;
  onSort?: (key: string) => void;
  /** The selection column's header cell. */
  leading?: React.ReactNode;
}) {
  return (
    <thead className="sticky top-0 bg-(--muted)">
      <tr>
        {leading}
        {columns.map((c) => {
          const sortable = onSort !== undefined && c.sortValue !== undefined;
          const active = sortable && sort !== null && sort !== undefined && sort.key === c.key ? sort.direction : null;
          return (
            <th
              key={c.key}
              scope="col"
              aria-sort={active ?? undefined}
              className={`h-10 border-b border-(--border) px-3 text-left font-medium text-(--foreground) ${
                c.numeric ? 'data text-right' : ''
              } ${priorityCellClass(c.priority)}`}
            >
              {sortable ? (
                <button
                  type="button"
                  onClick={() => onSort(c.key)}
                  className={`inline-flex items-center gap-1 rounded-sm font-medium hover:underline focus-visible:outline-2 focus-visible:outline-(--ring) ${
                    c.numeric ? 'flex-row-reverse' : ''
                  }`}
                  title={active === null ? `Sort by ${c.header}` : undefined}
                >
                  {c.header}
                  <span aria-hidden className={active === null ? 'text-(--muted-foreground)' : ''}>
                    {active === null ? '↕' : SORT_GLYPH[active]}
                  </span>
                </button>
              ) : (
                c.header
              )}
            </th>
          );
        })}
      </tr>
    </thead>
  );
}

/** The default cell: a bare number in a numeric column is a count, grouped en-IN (A10). */
function defaultCell<T>(column: DataTableColumn<T>, row: T): React.ReactNode {
  const value = (row as Record<string, unknown>)[column.key];
  if (column.numeric === true && typeof value === 'number') return formatCount(value);
  return String(value ?? '');
}

function cellContent<T>(column: DataTableColumn<T>, row: T): React.ReactNode {
  return column.render ? column.render(row) : defaultCell(column, row);
}

/** A header checkbox whose mixed state is the DOM `indeterminate` property (no attribute exists for it). */
function SelectAllBox({
  state,
  label,
  disabled,
  onToggle,
  boxRef,
}: {
  state: 'none' | 'some' | 'all';
  label: string;
  disabled: boolean;
  onToggle: () => void;
  boxRef: React.RefObject<HTMLInputElement | null>;
}) {
  useEffect(() => {
    if (boxRef.current) boxRef.current.indeterminate = state === 'some';
  }, [state, boxRef]);
  return (
    <input
      ref={boxRef}
      type="checkbox"
      aria-label={label}
      checked={state === 'all'}
      disabled={disabled}
      onChange={onToggle}
      className="h-4 w-4 focus-visible:outline-2 focus-visible:outline-(--ring)"
    />
  );
}

/**
 * Story UI-1 — the skeleton of a table for a surface that renders NO table
 * while its read loads (the portal lists): the same header and five skeleton
 * rows, no pager. A separate element, so the real `DataTable` still mounts
 * fresh on ready exactly as before.
 */
export function TableSkeleton<T>({ columns, label }: { readonly columns: readonly DataTableColumn<T>[]; readonly label: string }) {
  return (
    <div className="overflow-x-auto rounded-md border border-(--border)" data-testid="table-skeleton">
      <LoadingStatus label={label} />
      <table aria-busy="true" className="w-full border-collapse text-sm">
        <HeaderRow columns={columns} />
        <tbody>
          <SkeletonRows columns={columns.length} />
        </tbody>
      </table>
    </div>
  );
}

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  nextCursor = null,
  onCursor,
  emptyMessage = 'No rows yet.',
  renderExpanded,
  loading,
  selection,
  rowNoun,
}: DataTableProps<T>) {
  // Story UI-2 — the cursor stack: Next pushes, Prev pops, so Prev means the
  // previous page (it used to return to page one). Page one has no Prev.
  const [stack, setStack] = useState<CursorStack>(FIRST_PAGE);
  const [sortState, setSortState] = useState<SortState>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const isLoading = loading !== undefined;

  const move = (next: CursorStack) => {
    setStack(next);
    // A selection is page-scoped: any page move clears it (§3.5).
    if (selection !== undefined && selection.selected.size > 0) selection.onChange(new Set());
    onCursor?.(next.current);
  };

  // Sorting is honest only over the whole list; when it stops being honest
  // the order falls back to the server's (A4).
  const sortable = columns.some((c) => c.sortValue !== undefined) && canSort(stack, nextCursor);
  const activeSort = sortable ? sortState : null;
  const sortColumn = activeSort === null ? undefined : columns.find((c) => c.key === activeSort.key);
  const shownRows =
    activeSort !== null && sortColumn?.sortValue !== undefined
      ? sortRows(rows, sortColumn.sortValue, activeSort.direction)
      : rows;

  const canSelect = selection?.canSelect ?? (() => true);
  const picked = selection === undefined ? [] : selectedRows(rows, selection.selected, canSelect);
  const headerState = selection === undefined ? 'none' : headerCheckState(rows, selection.selected, canSelect);
  const anySelectable = selection !== undefined && rows.some(canSelect);
  const showBar = selection !== undefined && picked.length > 0 && !isLoading;

  // A11y (A6) — when the bar goes away with focus inside it, focus lands on
  // the header checkbox rather than on <body>.
  const barHadFocus = useRef(false);
  useEffect(() => {
    if (!showBar && barHadFocus.current) {
      barHadFocus.current = false;
      selectAllRef.current?.focus();
    }
  }, [showBar]);

  const leadingCount = selection === undefined ? 0 : 1;
  const colSpan = columns.length + leadingCount;
  const mirrored = columns.filter((c) => c.priority === 2 || c.priority === 3);
  // The mirror sits under the row's first NAMED, always-shown cell — the
  // identifier — not under a bare toggle button.
  const hostIndex = Math.max(0, columns.findIndex((c) => c.header !== '' && (c.priority ?? 1) === 1));
  const hidden = hiddenColumnCounts(columns);

  return (
    <div className="overflow-x-auto rounded-md border border-(--border)">
      {isLoading && <LoadingStatus label={loading} />}
      {showBar && selection !== undefined && (
        <div
          ref={barRef}
          onFocusCapture={() => {
            barHadFocus.current = true;
          }}
          onBlurCapture={(event) => {
            if (!barRef.current?.contains(event.relatedTarget as Node | null)) barHadFocus.current = false;
          }}
        >
          <BulkActionBar
            count={picked.length}
            noun={selection.noun}
            disabled={selection.busy === true}
            onClear={() => selection.onChange(new Set())}
          >
            {selection.actions}
          </BulkActionBar>
        </div>
      )}
      <table aria-busy={isLoading ? 'true' : undefined} className="w-full border-collapse text-sm">
        <HeaderRow
          columns={columns}
          sort={sortable ? activeSort : undefined}
          onSort={sortable ? (key) => setSortState((state) => nextSort(state, key)) : undefined}
          leading={
            selection === undefined ? undefined : (
              <th scope="col" className="h-10 w-10 border-b border-(--border) px-3 text-left">
                {anySelectable && (
                  <SelectAllBox
                    boxRef={selectAllRef}
                    state={headerState}
                    label={`Select all ${selection.noun.many} on this page`}
                    disabled={selection.busy === true || isLoading}
                    onToggle={() => selection.onChange(toggleAll(rows, selection.selected, canSelect))}
                  />
                )}
              </th>
            )
          }
        />
        <tbody>
          {isLoading ? (
            <SkeletonRows columns={colSpan} />
          ) : shownRows.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className="h-24 px-3 text-center text-(--muted-foreground)">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            shownRows.map((row) => {
              const expanded = renderExpanded?.(row);
              const rowSelectable = selection !== undefined && canSelect(row);
              const isPicked = rowSelectable && selection.selected.has(row.id);
              return (
                <Fragment key={row.id}>
                  <tr
                    className={`h-10 border-b border-(--border) last:border-b-0 hover:bg-(--muted) ${isPicked ? 'bg-(--primary)/5' : ''}`}
                    aria-selected={selection === undefined ? undefined : isPicked}
                  >
                    {selection !== undefined && (
                      <td className="w-10 px-3">
                        {rowSelectable && (
                          <input
                            type="checkbox"
                            aria-label={selection.rowLabel(row)}
                            checked={isPicked}
                            disabled={selection.busy === true}
                            onChange={(e) => selection.onChange(toggleOne(selection.selected, row.id, e.target.checked))}
                            className="h-4 w-4 focus-visible:outline-2 focus-visible:outline-(--ring)"
                          />
                        )}
                      </td>
                    )}
                    {columns.map((c, index) => (
                      <td
                        key={c.key}
                        className={`px-3 ${c.numeric ? 'data text-right' : ''} ${priorityCellClass(c.priority)}`}
                      >
                        {cellContent(c, row)}
                        {index === hostIndex && mirrored.length > 0 && (
                          <dl data-priority-mirror className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-(--muted-foreground) lg:hidden">
                            {mirrored.map((m) => (
                              <div key={m.key} className={`flex gap-1 ${priorityMirrorClass(m.priority)}`}>
                                <dt>{m.header}:</dt>
                                <dd className={m.numeric ? 'data' : ''}>{cellContent(m, row)}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                      </td>
                    ))}
                  </tr>
                  {expanded ? (
                    <tr id={expandedRowId(row.id)} className="border-b border-(--border) last:border-b-0">
                      <td colSpan={colSpan} className="bg-(--muted) px-3 py-2">
                        {expanded}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>
      <div className="flex min-h-10 flex-wrap items-center justify-end gap-2 border-t border-(--border) px-3 py-1 text-xs">
        {!isLoading && shownRows.length > 0 && (
          <span className="mr-auto text-(--muted-foreground)" data-testid="table-count">
            {showingLabel(shownRows.length, rowNoun)}
            {hidden.belowMd > 0 && <span className="md:hidden"> · {hiddenColumnsLabel(hidden.belowMd)}</span>}
            {hidden.belowLg > 0 && <span className="hidden md:inline lg:hidden"> · {hiddenColumnsLabel(hidden.belowLg)}</span>}
          </span>
        )}
        <button
          type="button"
          disabled={!hasPrevPage(stack) || !onCursor || isLoading}
          onClick={() => move(cursorStackPrev(stack))}
          className="rounded-sm border border-(--border) px-2 py-1 focus-visible:outline-2 focus-visible:outline-(--ring) disabled:opacity-40"
        >
          Prev
        </button>
        <button
          type="button"
          disabled={!nextCursor || !onCursor || isLoading}
          onClick={() => nextCursor && move(cursorStackNext(stack, nextCursor))}
          className="rounded-sm border border-(--border) px-2 py-1 focus-visible:outline-2 focus-visible:outline-(--ring) disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}
