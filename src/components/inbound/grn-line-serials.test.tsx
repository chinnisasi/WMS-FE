import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';

import { render, type Rendered } from '../../lib/test/render';
import { GrnLineSerials } from './grn-line-serials';

/**
 * Story 2-6a — a GRN line's serials: collapsed by default to a count, the
 * list on demand (each unit's state in words), a search once the line is
 * long, the unreadable units and the QC skip.
 */

let view: Rendered | undefined;
afterEach(() => {
  view?.unmount();
  view = undefined;
});

function setInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('story 2-6a: GrnLineSerials', () => {
  test('collapsed to a summary; expanding lists each serial with its state', () => {
    view = render(
      <GrnLineSerials
        line={{
          skuCode: 'PHONE',
          serials: [
            { serial: 'SN-A', state: 'applied' },
            { serial: 'SN-B', state: 'pending' },
            { serial: 'SN-C', state: 'rejected', afterWriteOff: true },
          ],
        }}
      />,
    );
    const toggle = view.container.querySelector<HTMLButtonElement>('button')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.textContent).toContain('3 serials · 1 booked · 1 awaiting approval · 1 approval rejected');
    expect(view.container.querySelectorAll('[data-testid="grn-serial"]')).toHaveLength(0);
    act(() => toggle.click());
    const rows = [...view.container.querySelectorAll('[data-testid="grn-serial"]')].map((row) => row.textContent);
    expect(rows).toEqual(['SN-ABooked', 'SN-BAwaiting approval', 'SN-CApproval rejectedRe-received after write-off']);
    // Short lists carry no search box.
    expect(view.container.querySelector('input[type="search"]')).toBeNull();
  });

  test('a long line is searchable', () => {
    const serials = Array.from({ length: 40 }, (_, i) => ({ serial: `IMEI-${String(i).padStart(3, '0')}`, state: 'applied' as const }));
    view = render(<GrnLineSerials line={{ skuCode: 'PHONE', serials }} />);
    act(() => view!.container.querySelector<HTMLButtonElement>('button')!.click());
    expect(view.container.querySelectorAll('[data-testid="grn-serial"]')).toHaveLength(40);
    setInput(view.container.querySelector<HTMLInputElement>('input[type="search"]')!, 'imei-03');
    expect([...view.container.querySelectorAll('[data-testid="grn-serial"]')].map((row) => row.querySelector('.font-mono')!.textContent)).toEqual(
      Array.from({ length: 10 }, (_, i) => `IMEI-03${i}`),
    );
    expect(view.container.textContent).toContain('10 of 40');
    setInput(view.container.querySelector<HTMLInputElement>('input[type="search"]')!, 'nope');
    expect(view.container.textContent).toContain('No serial matches “nope”.');
  });

  test('the unreadable units and the QC skip; nothing at all on a line without serial capture', () => {
    view = render(<GrnLineSerials line={{ skuCode: 'PHONE', serials: [{ serial: 'X', state: 'applied' }], unreadableSerialQty: 2, qcSkipped: 'serial-tracked' }} />);
    expect(view.container.querySelector('[data-testid="grn-line-unreadable"]')!.textContent).toBe('2 units — serial unreadable');
    expect(view.container.querySelector('[data-testid="grn-line-qc-skipped"]')!.textContent).toBe('QC on receipt skipped — serial-tracked');
    view.unmount();
    view = render(<GrnLineSerials line={{ skuCode: 'TEA' }} />);
    expect(view.container.innerHTML).toBe('');
  });
});
