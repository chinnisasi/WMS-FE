import { afterEach, describe, expect, test } from 'bun:test';

import { render, type Rendered } from '../../lib/test/render';
import { DataTable, TableSkeleton, type DataTableColumn } from '../data-table/data-table';
import { ExceptionStrip } from './exception-strip';
import { Logo } from './logo';
import { PageHeader } from './page-header';
import { SkeletonRows, SkeletonTiles } from './skeleton';
import { StatusChip, statusChipClass, type StatusTone } from './status-chip';
import { StatusTimeline } from './status-timeline';

/**
 * Story UI-1 — the shared primitives (UI-PATTERNS §12: W1 PageHeader, W2
 * StatusChip, W3 skeletons, part of W11 ExceptionStrip / StatusTimeline, W12
 * logotype). What each must keep: a word with every colour, the h1, the
 * loading words announced, never a claim the caller did not make.
 */

let view: Rendered | undefined;
afterEach(() => {
  view?.unmount();
  view = undefined;
});

const TONES: readonly StatusTone[] = ['neutral', 'success', 'warning', 'danger', 'info'];

describe('StatusChip', () => {
  test('every tone × variant pairs a token border with a passing text colour — never the tone as small text on white', () => {
    const tokenOf: Record<StatusTone, string> = {
      neutral: '--border',
      success: '--accent',
      warning: '--warning',
      danger: '--destructive',
      info: '--primary',
    };
    for (const tone of TONES) {
      const outline = statusChipClass(tone, 'outline');
      const solid = statusChipClass(tone, 'solid');
      expect(outline).toContain('rounded-full');
      if (tone === 'neutral') {
        // On its own background: 4.83:1 even inside a tinted (muted) row.
        expect(outline).toContain('bg-(--background)');
        expect(outline).toContain('text-(--muted-foreground)');
      } else {
        expect(outline).toContain(`border-(${tokenOf[tone]})`);
        expect(outline).toContain(`bg-(${tokenOf[tone]})/10`);
        expect(outline).toContain('text-(--foreground)');
        // The pair DESIGN.md defines for the fill.
        expect(solid).toContain(`bg-(${tokenOf[tone]})`);
        expect(solid).toContain(`text-(${tokenOf[tone]}-foreground)`);
      }
      expect(outline).not.toMatch(/#[0-9a-f]{3,6}/i);
    }
  });

  test('renders the word verbatim, the glyph aria-hidden beside it, and passes span attributes through', () => {
    view = render(
      <StatusChip tone="warning" glyph="⚠" data-testid="chip" title="Locked until 5 pm">
        degraded
      </StatusChip>,
    );
    const chip = view.container.querySelector('[data-testid="chip"]')!;
    expect(chip.textContent).toBe('⚠degraded'); // never re-cased
    expect(chip.getAttribute('data-tone')).toBe('warning');
    expect(chip.getAttribute('title')).toBe('Locked until 5 pm');
    expect(chip.querySelector('[aria-hidden]')!.textContent).toBe('⚠');
  });
});

describe('PageHeader', () => {
  test('one h1, the purpose line, the meta row and the actions', () => {
    view = render(<PageHeader title="Outbound" description="Orders and dispatch." meta={<span>As of 14:05</span>} actions={<button type="button">New order</button>} />);
    const h1s = view.container.querySelectorAll('h1');
    expect(h1s).toHaveLength(1);
    expect(h1s[0]!.textContent).toBe('Outbound');
    expect(view.container.textContent).toContain('Orders and dispatch.');
    expect(view.container.textContent).toContain('As of 14:05');
    expect(view.container.querySelector('button')!.textContent).toBe('New order');
  });

  test('title alone renders no empty description, meta or actions', () => {
    view = render(<PageHeader title="Moves" />);
    expect(view.container.querySelector('p')).toBeNull();
    expect(view.container.querySelector('header')!.children).toHaveLength(1);
  });
});

type Row = { id: string; name: string; qty: number };
const COLUMNS: readonly DataTableColumn<Row>[] = [
  { key: 'name', header: 'Name' },
  { key: 'qty', header: 'Qty', numeric: true },
];

describe('skeletons', () => {
  test('DataTable `loading`: the header, five skeleton rows, aria-busy, and the words announced without role=status', () => {
    view = render(<DataTable<Row> columns={COLUMNS} rows={[]} loading="Loading orders…" emptyMessage="No orders yet." />);
    const c = view.container;
    expect([...c.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['Name', 'Qty']);
    expect(c.querySelectorAll('[data-testid="skeleton-row"]')).toHaveLength(5);
    expect(c.querySelector('[data-testid="skeleton-row"] td')).not.toBeNull();
    expect(c.querySelectorAll('[data-testid="skeleton-row"]')[0]!.children).toHaveLength(2);
    expect(c.querySelector('table')!.getAttribute('aria-busy')).toBe('true');
    const status = c.querySelector('[data-testid="loading-status"]')!;
    expect(status.textContent).toBe('Loading orders…');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(c.querySelector('[role="status"]')).toBeNull();
    expect(c.textContent).not.toContain('No orders yet.'); // loading is never dressed as empty
  });

  test('DataTable without `loading` renders rows exactly as before (no skeleton, no busy flag)', () => {
    view = render(<DataTable<Row> columns={COLUMNS} rows={[{ id: 'r1', name: 'Shirt', qty: 3 }]} />);
    expect(view.container.querySelector('[data-testid="skeleton-row"]')).toBeNull();
    expect(view.container.querySelector('table')!.hasAttribute('aria-busy')).toBe(false);
    expect(view.container.querySelector('[data-testid="loading-status"]')).toBeNull();
    expect(view.container.querySelector('tbody')!.textContent).toBe('Shirt3');
  });

  test('DataTable `loading` leaves the pager as it was (UI-1 A14 — no new disabling)', () => {
    view = render(<DataTable<Row> columns={COLUMNS} rows={[]} loading="Loading…" nextCursor="c2" onCursor={() => undefined} />);
    const next = [...view.container.querySelectorAll('button')].find((b) => b.textContent === 'Next')!;
    expect(next.disabled).toBe(false);
  });

  test('TableSkeleton: the same header and skeleton body, no pager', () => {
    view = render(<TableSkeleton columns={COLUMNS} label="Loading your stock…" />);
    expect([...view.container.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['Name', 'Qty']);
    expect(view.container.querySelectorAll('[data-testid="skeleton-row"]')).toHaveLength(5);
    expect(view.container.querySelectorAll('button')).toHaveLength(0);
    expect(view.container.textContent).toContain('Loading your stock…');
  });

  test('SkeletonRows draws at least one cell; SkeletonTiles draws its count and announces', () => {
    view = render(
      <table>
        <tbody>
          <SkeletonRows columns={0} rows={2} />
        </tbody>
      </table>,
    );
    expect(view.container.querySelectorAll('tr')).toHaveLength(2);
    expect(view.container.querySelectorAll('td')).toHaveLength(2);
    view.unmount();
    view = render(<SkeletonTiles count={3} label="Loading the overview…" />);
    expect(view.container.querySelectorAll('[data-testid="skeleton-tile"]')).toHaveLength(3);
    expect(view.container.textContent).toBe('Loading the overview…');
  });
});

describe('ExceptionStrip', () => {
  test('non-zero items render as amber chips with the count in words — a link when there is a drill, a plain chip when not', () => {
    view = render(
      <ExceptionStrip
        clearedText="Nothing needs attention"
        items={[
          { key: 'short', label: 'short-picked lines today', count: 3, href: null },
          { key: 'over', label: 'over-receipts awaiting a decision', count: 1, href: '/conflicts?list=over-receipts' },
          { key: 'zero', label: 'open expiry alerts', count: 0, href: '/replenishment' },
        ]}
      />,
    );
    const c = view.container;
    expect(c.querySelector('[data-testid="exception-short"]')!.textContent).toBe('⚠3 short-picked lines today');
    expect(c.querySelector('[data-testid="exception-short"] a')).toBeNull();
    const link = c.querySelector('[data-testid="exception-over"] a')!;
    expect(link.getAttribute('href')).toBe('/conflicts?list=over-receipts');
    expect(c.querySelector('[data-testid="exception-zero"]')).toBeNull(); // a zero is not drawn
    expect(c.querySelector('[data-testid="exceptions-cleared"]')).toBeNull();
  });

  test('all zero: the caller-chosen all-clear sentence, once', () => {
    view = render(
      <ExceptionStrip clearedText="Nothing needs attention in the figures available" items={[{ key: 'a', label: 'x', count: 0, href: null }]} />,
    );
    expect(view.container.querySelector('[data-testid="exceptions-cleared"]')!.textContent).toBe(
      '✓ Nothing needs attention in the figures available',
    );
  });
});

describe('StatusTimeline', () => {
  test('each step is a glyph and a word; the current step carries aria-current; a time shows only where given', () => {
    view = render(
      <StatusTimeline
        label="Order progress"
        steps={[
          { label: 'Placed', state: 'done', time: '26 Oct 2026, 14:05 IST' },
          { label: 'Accepted', state: 'current' },
          { label: 'Packed', state: 'upcoming' },
        ]}
      />,
    );
    const items = [...view.container.querySelectorAll('li')];
    expect(items.map((li) => li.getAttribute('data-state'))).toEqual(['done', 'current', 'upcoming']);
    expect(items[1]!.getAttribute('aria-current')).toBe('step');
    expect(items[0]!.hasAttribute('aria-current')).toBe(false);
    expect(items[0]!.textContent).toContain('26 Oct 2026, 14:05 IST');
    expect(items[1]!.textContent).not.toContain('IST');
    expect(items[0]!.textContent).toContain('Placed — done'); // the state in words for a screen reader
    expect(view.container.querySelector('ol')!.getAttribute('aria-label')).toBe('Order progress');
  });

  test('a stopped step reads as stopped', () => {
    view = render(<StatusTimeline label="x" steps={[{ label: 'Placed', state: 'done' }, { label: 'Cancelled', state: 'stopped' }]} />);
    expect(view.container.querySelectorAll('li')[1]!.textContent).toContain('✕Cancelled — stopped');
  });
});

describe('Logo', () => {
  test('the mark plus the product name; compact is the mark alone, named', () => {
    view = render(<Logo />);
    expect(view.container.textContent).toBe('WMS');
    expect(view.container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    view.unmount();
    view = render(<Logo compact />);
    const mark = view.container.querySelector('[role="img"]')!;
    expect(mark.getAttribute('aria-label')).toBe('WMS');
    expect(view.container.textContent).toBe('');
  });
});
