import { afterEach, describe, expect, test } from 'bun:test';

import { render, type Rendered } from '../../lib/test/render';
import { DataTable, expandedRowId } from './data-table';

/**
 * The shared list primitive every surface in the app renders through.
 *
 * Story 4-2b added its `renderExpanded` slot and shipped it with no test at
 * all — a review layer proved by mutation that rendering the detail row
 * unconditionally, or hard-coding `colSpan`, broke six unrelated surfaces
 * while the whole suite stayed green. These are the two row-shapes that gap
 * named, and they are the first component tests in this repo.
 */
interface Row {
  readonly id: string;
  readonly code: string;
}

const ROWS: Row[] = [
  { id: 'r1', code: 'ORD-1' },
  { id: 'r2', code: 'ORD-2' },
];

const COLUMNS = [
  { key: 'code', header: 'Code' },
  { key: 'note', header: 'Note' },
];

let view: Rendered | undefined;
afterEach(() => {
  view?.unmount();
  view = undefined;
});

describe('DataTable: the expanded-row slot', () => {
  test('without the slot, a row renders exactly one <tr> — the six surfaces that never opted in', () => {
    view = render(<DataTable columns={COLUMNS} rows={ROWS} />);
    const body = view.container.querySelector('tbody')!;
    expect(body.querySelectorAll('tr')).toHaveLength(2);
    // No stray cell spanning the table: every row is the ordinary shape.
    expect(body.querySelectorAll('td[colspan]')).toHaveLength(0);
  });

  test('a slot returning null is indistinguishable from not passing one', () => {
    view = render(<DataTable columns={COLUMNS} rows={ROWS} renderExpanded={() => null} />);
    const body = view.container.querySelector('tbody')!;
    expect(body.querySelectorAll('tr')).toHaveLength(2);
    expect(body.querySelectorAll('td[colspan]')).toHaveLength(0);
  });

  test('a slot returning a node adds one full-width row beneath its own row', () => {
    view = render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        renderExpanded={(row) => (row.id === 'r2' ? <p>detail for {row.code}</p> : null)}
      />,
    );
    const body = view.container.querySelector('tbody')!;
    const rows = [...body.querySelectorAll('tr')];
    expect(rows).toHaveLength(3);

    // It follows ITS OWN row, not the end of the table.
    const panel = body.querySelector('td[colspan]')!;
    expect(panel.textContent).toContain('detail for ORD-2');
    expect(rows.indexOf(panel.closest('tr')!)).toBe(2);

    // Full width, so the layout cannot silently drift when a column is added.
    expect(panel.getAttribute('colspan')).toBe(String(COLUMNS.length));
  });

  test('the empty state spans the full width too — the other colSpan site', () => {
    // There are two `colSpan={columns.length}` cells in this component. A
    // mutation aimed at the panel is not a test of the empty row, and vice
    // versa; both are pinned so neither can drift when a column is added.
    view = render(<DataTable columns={COLUMNS} rows={[]} emptyMessage="No orders yet." />);
    const cell = view.container.querySelector('tbody td[colspan]')!;
    expect(cell.getAttribute('colspan')).toBe(String(COLUMNS.length));
    expect(cell.textContent).toContain('No orders yet.');
  });

  test('the panel row carries the id the toggle points `aria-controls` at', () => {
    view = render(
      <DataTable columns={COLUMNS} rows={ROWS} renderExpanded={(row) => <span>{row.code}</span>} />,
    );
    const body = view.container.querySelector('tbody')!;
    for (const row of ROWS) {
      expect(body.querySelector(`#${expandedRowId(row.id)}`)).not.toBeNull();
    }
  });
});
