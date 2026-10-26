import { afterEach, describe, expect, test } from 'bun:test';
import { act, useState } from 'react';

import { render, type Rendered } from '../../lib/test/render';
import { DataTable, type DataTableColumn, type DataTableSelection } from './data-table';

/**
 * Story UI-2 (UI-PATTERNS §3, W5/W6) — the DataTable behaviours a list is
 * judged by: Prev means the previous page, the footer counts the page,
 * sorting only over a complete list, page-scoped selection with the bulk
 * bar, and hidden columns that stay reachable.
 */

let view: Rendered | undefined;
afterEach(() => {
  view?.unmount();
  view = undefined;
});

interface Row {
  readonly id: string;
  readonly name: string;
  readonly qty: number | null;
  readonly ok?: boolean;
}

const COLUMNS: readonly DataTableColumn<Row>[] = [
  { key: 'name', header: 'Name', sortValue: (r) => r.name },
  { key: 'qty', header: 'Qty', numeric: true, sortValue: (r) => r.qty },
];

const button = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith(text))!;
const click = (el: Element) => act(() => (el as HTMLElement).click());
const names = (root: HTMLElement) =>
  [...root.querySelectorAll('tbody tr')].map((tr) => tr.querySelector('td')?.firstChild?.textContent ?? '');

describe('pagination', () => {
  test('Next, Next, Prev returns to page two, then page one; Prev is disabled on page one', () => {
    const asked: (string | null)[] = [];
    const pages: Record<string, { rows: Row[]; next: string | null }> = {
      first: { rows: [{ id: '1', name: 'a', qty: 1 }], next: 'c2' },
      c2: { rows: [{ id: '2', name: 'b', qty: 2 }], next: 'c3' },
      c3: { rows: [{ id: '3', name: 'c', qty: 3 }], next: null },
    };
    function Harness() {
      const [cursor, setCursor] = useState<string | null>(null);
      const page = pages[cursor ?? 'first']!;
      return (
        <DataTable<Row>
          columns={COLUMNS}
          rows={page.rows}
          nextCursor={page.next}
          onCursor={(c) => {
            asked.push(c);
            setCursor(c);
          }}
        />
      );
    }
    view = render(<Harness />);
    const root = view.container;
    expect(button(root, 'Prev').disabled).toBe(true);
    click(button(root, 'Next'));
    click(button(root, 'Next'));
    expect(names(root)).toEqual(['c']);
    click(button(root, 'Prev'));
    expect(names(root)).toEqual(['b']);
    click(button(root, 'Prev'));
    expect(names(root)).toEqual(['a']);
    expect(button(root, 'Prev').disabled).toBe(true);
    expect(asked).toEqual(['c2', 'c3', 'c2', null]);
  });

  test('the footer counts the page in en-IN, never a total; nothing when empty; numeric cells group', () => {
    view = render(<DataTable<Row> columns={COLUMNS} rows={[{ id: '1', name: 'a', qty: 1234567 }]} rowNoun={{ one: 'bin', many: 'bins' }} />);
    expect(view.container.querySelector('[data-testid="table-count"]')!.textContent).toBe('Showing 1 bin');
    expect(view.container.querySelector('tbody td.data')!.textContent).toBe('12,34,567');
    view.unmount();
    view = render(<DataTable<Row> columns={COLUMNS} rows={[]} emptyMessage="None" />);
    expect(view.container.querySelector('[data-testid="table-count"]')).toBeNull();
    expect(view.container.textContent).toContain('None');
  });
});

describe('sorting', () => {
  const rows: Row[] = [
    { id: '1', name: 'b', qty: 2 },
    { id: '2', name: 'a', qty: null },
    { id: '3', name: 'c', qty: 1 },
  ];

  test('a complete list: none → ascending → descending → none, aria-sort only on the sorted header, nulls last', () => {
    view = render(<DataTable<Row> columns={COLUMNS} rows={rows} />);
    const root = view.container;
    const qtyHeader = () => [...root.querySelectorAll('th')][1]!;
    expect(qtyHeader().hasAttribute('aria-sort')).toBe(false);
    click(button(root, 'Qty'));
    expect(qtyHeader().getAttribute('aria-sort')).toBe('ascending');
    expect([...root.querySelectorAll('th')][0]!.hasAttribute('aria-sort')).toBe(false);
    expect(names(root)).toEqual(['c', 'b', 'a']);
    click(button(root, 'Qty'));
    expect(qtyHeader().getAttribute('aria-sort')).toBe('descending');
    expect(names(root)).toEqual(['b', 'c', 'a']);
    click(button(root, 'Qty'));
    expect(qtyHeader().hasAttribute('aria-sort')).toBe(false);
    expect(names(root)).toEqual(['b', 'a', 'c']);
  });

  test('a cursor page offers no sort: plain headers, server order', () => {
    view = render(<DataTable<Row> columns={COLUMNS} rows={rows} nextCursor="c2" onCursor={() => undefined} />);
    const headers = [...view.container.querySelectorAll('th')];
    expect(headers.every((th) => th.querySelector('button') === null)).toBe(true);
    expect(names(view.container)).toEqual(['b', 'a', 'c']);
  });
});

describe('selection and the bulk bar', () => {
  const rows: Row[] = [
    { id: '1', name: 'a', qty: 1, ok: true },
    { id: '2', name: 'b', qty: 2, ok: false },
    { id: '3', name: 'c', qty: 3, ok: true },
  ];

  function Harness({ nextCursor = null, onCursor }: { nextCursor?: string | null; onCursor?: (c: string | null) => void }) {
    const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
    const selection: DataTableSelection<Row> = {
      selected,
      onChange: setSelected,
      canSelect: (r) => r.ok === true,
      rowLabel: (r) => `Select ${r.name}`,
      noun: { one: 'wave', many: 'waves' },
      actions: <button type="button">Release {selected.size}</button>,
    };
    return <DataTable<Row> columns={COLUMNS} rows={rows} selection={selection} nextCursor={nextCursor} onCursor={onCursor} />;
  }

  test('only selectable rows get a checkbox; the header goes indeterminate, then all, then clears', () => {
    view = render(<Harness />);
    const root = view.container;
    const boxes = () => [...root.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]')];
    expect(boxes().map((b) => b.getAttribute('aria-label'))).toEqual(['Select a', 'Select c']);
    const all = root.querySelector<HTMLInputElement>('thead input[type="checkbox"]')!;
    expect(all.getAttribute('aria-label')).toBe('Select all waves on this page');
    expect(root.querySelector('[data-testid="bulk-action-bar"]')).toBeNull();

    click(boxes()[0]!);
    expect(all.indeterminate).toBe(true);
    expect(all.checked).toBe(false);
    const bar = root.querySelector('[data-testid="bulk-action-bar"]')!;
    expect(bar.getAttribute('role')).toBe('toolbar');
    expect(bar.textContent).toContain('1 wave selected');

    click(all);
    expect(all.indeterminate).toBe(false);
    expect(all.checked).toBe(true);
    expect(root.querySelector('[data-testid="bulk-action-bar"]')!.textContent).toContain('2 waves selected');

    click(all);
    expect(root.querySelector('[data-testid="bulk-action-bar"]')).toBeNull();
  });

  test('Clear selection empties it and returns focus to the header checkbox', () => {
    view = render(<Harness />);
    const root = view.container;
    click(root.querySelector('tbody input[type="checkbox"]')!);
    const clear = button(root, 'Clear selection');
    act(() => clear.focus());
    click(clear);
    expect(root.querySelector('[data-testid="bulk-action-bar"]')).toBeNull();
    expect(document.activeElement).toBe(root.querySelector('thead input[type="checkbox"]'));
  });

  test('a page move clears the selection', () => {
    view = render(<Harness nextCursor="c2" onCursor={() => undefined} />);
    const root = view.container;
    click(root.querySelector('tbody input[type="checkbox"]')!);
    expect(root.querySelector('[data-testid="bulk-action-bar"]')).not.toBeNull();
    click(button(root, 'Next'));
    expect(root.querySelector('[data-testid="bulk-action-bar"]')).toBeNull();
  });
});

describe('column priority', () => {
  test('a priority-2/3 column hides by class and its value is mirrored, labelled, under the first cell', () => {
    const columns: readonly DataTableColumn<Row>[] = [
      { key: 'name', header: 'Name' },
      { key: 'qty', header: 'Qty', numeric: true, priority: 3 },
      { key: 'id', header: 'Ref', priority: 2 },
    ];
    view = render(<DataTable<Row> columns={columns} rows={[{ id: 'r1', name: 'a', qty: 5 }]} />);
    const root = view.container;
    const cells = [...root.querySelectorAll('tbody td')];
    expect(cells[1]!.className).toContain('hidden lg:table-cell');
    expect(cells[2]!.className).toContain('hidden md:table-cell');
    const mirror = cells[0]!.querySelector('[data-priority-mirror]')!;
    expect(mirror.textContent).toBe('Qty:5Ref:r1');
    const items = [...mirror.children];
    expect(items[0]!.className).toContain('lg:hidden');
    expect(items[1]!.className).toContain('md:hidden');
    expect(root.querySelector('[data-testid="table-count"]')!.textContent).toContain('2 columns hidden at this width');
  });

  test('a table with no priorities draws no mirror and no hidden-columns note', () => {
    view = render(<DataTable<Row> columns={COLUMNS} rows={[{ id: '1', name: 'a', qty: 1 }]} />);
    expect(view.container.querySelector('[data-priority-mirror]')).toBeNull();
    expect(view.container.textContent).not.toContain('hidden at this width');
  });
});
