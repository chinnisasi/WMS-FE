'use client';

import { Fragment, useState } from 'react';

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
  readonly emptyMessage?: string;
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
}

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  nextCursor = null,
  onCursor,
  emptyMessage = 'No rows yet.',
  renderExpanded,
}: DataTableProps<T>) {
  // Tracks the cursor that produced the current page; null = first page, so
  // Prev is disabled until a Next has actually happened.
  const [activeCursor, setActiveCursor] = useState<string | null>(null);
  const go = (cursor: string | null) => {
    setActiveCursor(cursor);
    onCursor?.(cursor);
  };
  return (
    <div className="overflow-x-auto rounded-md border border-(--border)">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-(--muted)">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={`h-10 border-b border-(--border) px-3 text-left font-medium text-(--muted-foreground) ${
                  c.numeric ? 'data text-right' : ''
                }`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="h-24 px-3 text-center text-(--muted-foreground)">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const expanded = renderExpanded?.(row);
              return (
                <Fragment key={row.id}>
                  <tr className="h-10 border-b border-(--border) last:border-b-0 hover:bg-(--muted)">
                    {columns.map((c) => (
                      <td key={c.key} className={`px-3 ${c.numeric ? 'data text-right' : ''}`}>
                        {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '')}
                      </td>
                    ))}
                  </tr>
                  {expanded ? (
                    <tr id={expandedRowId(row.id)} className="border-b border-(--border) last:border-b-0">
                      <td colSpan={columns.length} className="bg-(--muted) px-3 py-2">
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
      <div className="flex h-10 items-center justify-end gap-2 border-t border-(--border) px-3 text-xs">
        <button
          type="button"
          disabled={activeCursor === null || !onCursor}
          onClick={() => go(null)}
          className="rounded-sm border border-(--border) px-2 py-1 disabled:opacity-40"
        >
          Prev
        </button>
        <button
          type="button"
          disabled={!nextCursor || !onCursor}
          onClick={() => nextCursor && go(nextCursor)}
          className="rounded-sm border border-(--border) px-2 py-1 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}
