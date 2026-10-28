import { afterEach, describe, expect, test } from 'bun:test';
import { act, useState } from 'react';

import { render, type Rendered } from '../../lib/test/render';
import { DetailDrawer } from './detail-drawer';

/**
 * Story 2-3b (UI-PATTERNS §3.6, W8) — the non-modal drawer: focus moves in
 * on open and back to the trigger on close; Esc closes it only from inside
 * it, only when nothing inside handled Esc first, and never while it is held
 * (a write in flight); there is no backdrop, so the page behind it stays
 * reachable.
 */

let view: Rendered | undefined;
afterEach(() => {
  view?.unmount();
  view = undefined;
});

function Harness({ held = false }: { held?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" data-testid="trigger" onClick={() => setOpen(true)}>
        Open DA-0001
      </button>
      <button type="button" data-testid="outside">
        Elsewhere
      </button>
      {open && (
        <DetailDrawer title="DA-0001" subtitle="D3 · 10:30–11:30" onClose={() => setOpen(false)} closeDisabled={held} testId="drawer">
          <input aria-label="inside" />
          <div
            data-testid="inner-layer"
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === 'Escape') event.preventDefault();
            }}
          />
        </DetailDrawer>
      )}
    </div>
  );
}

const q = (id: string) => view!.container.querySelector<HTMLElement>(`[data-testid="${id}"]`);

function escape(target: HTMLElement) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  });
}

function openDrawer() {
  q('trigger')!.focus();
  act(() => q('trigger')!.click());
}

describe('DetailDrawer', () => {
  test('a non-modal dialog named by its title: focus moves into it, and back to the trigger on Close', () => {
    view = render(<Harness />);
    openDrawer();
    const drawer = q('drawer')!;
    expect(drawer.getAttribute('role')).toBe('dialog');
    expect(drawer.getAttribute('aria-modal')).toBe('false');
    const heading = drawer.querySelector('h2')!;
    expect(heading.textContent).toBe('DA-0001');
    expect(drawer.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(document.activeElement).toBe(heading);
    expect(drawer.textContent).toContain('D3 · 10:30–11:30');
    act(() => drawer.querySelector<HTMLButtonElement>('button[aria-label="Close DA-0001"]')!.click());
    expect(q('drawer')).toBeNull();
    expect(document.activeElement).toBe(q('trigger'));
  });

  test('Esc from inside closes it; Esc from the page behind does not (no document-level handler)', () => {
    view = render(<Harness />);
    openDrawer();
    escape(q('outside')!);
    expect(q('drawer')).not.toBeNull();
    const inside = q('drawer')!.querySelector<HTMLInputElement>('input')!;
    inside.focus();
    escape(inside);
    expect(q('drawer')).toBeNull();
  });

  test('an inner layer that handles Esc keeps the drawer open (the topmost layer closes first)', () => {
    view = render(<Harness />);
    openDrawer();
    escape(q('inner-layer')!);
    expect(q('drawer')).not.toBeNull();
  });

  test('held (a write in flight): Esc and Close do nothing', () => {
    view = render(<Harness held />);
    openDrawer();
    escape(q('drawer')!.querySelector('input')!);
    expect(q('drawer')).not.toBeNull();
    expect(q('drawer')!.querySelector<HTMLButtonElement>('button[aria-label="Close DA-0001"]')!.disabled).toBe(true);
  });
});
