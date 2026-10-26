import { afterEach, describe, expect, test } from 'bun:test';

import { render, type Rendered } from '../../lib/test/render';
import { EmptyState } from './empty-state';
import { Field } from './field';
import { SubmitButton } from './submit-button';

/** Story UI-2 (UI-PATTERNS §4, §5: W4, W9, W10) — the empty, field and submit contracts. */

let view: Rendered | undefined;
afterEach(() => {
  view?.unmount();
  view = undefined;
});

describe('EmptyState', () => {
  test('each kind renders its one sentence; only cleared carries the (decorative) check', () => {
    for (const kind of ['first-use', 'filtered', 'cleared'] as const) {
      view = render(<EmptyState kind={kind}>Nothing needs review.</EmptyState>);
      const root = view.container.querySelector('[data-testid="empty-state"]')!;
      expect(root.getAttribute('data-kind')).toBe(kind);
      expect(root.textContent).toContain('Nothing needs review.');
      const glyph = root.querySelector('[aria-hidden]');
      if (kind === 'cleared') expect(glyph!.textContent).toBe('✓');
      else expect(glyph).toBeNull();
      view.unmount();
    }
    view = undefined;
  });

  test('the one next step renders when given', () => {
    view = render(<EmptyState kind="filtered" action={<button type="button">Show all statuses</button>}>No match.</EmptyState>);
    expect(view.container.querySelector('button')!.textContent).toBe('Show all statuses');
  });
});

describe('Field', () => {
  test('label, hint and error are tied to the control; aria-invalid only with an error', () => {
    view = render(
      <Field label="Quantity" hint="Whole units." error="Enter a whole number.">
        {(control) => <input {...control} />}
      </Field>,
    );
    const input = view.container.querySelector('input')!;
    const label = view.container.querySelector('label')!;
    expect(label.htmlFor).toBe(input.id);
    const described = input.getAttribute('aria-describedby')!.split(' ');
    expect(described).toHaveLength(2);
    expect(described.map((id) => view!.container.querySelector(`[id="${id}"]`)!.textContent)).toEqual(['Whole units.', 'Enter a whole number.']);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(view.container.querySelector('[role="alert"]')!.textContent).toBe('Enter a whole number.');
  });

  test('no error, no hint: no describedby and no aria-invalid', () => {
    view = render(<Field label="Name">{(control) => <input {...control} />}</Field>);
    const input = view.container.querySelector('input')!;
    expect(input.hasAttribute('aria-describedby')).toBe(false);
    expect(input.hasAttribute('aria-invalid')).toBe(false);
  });
});

describe('SubmitButton', () => {
  test('says what it does, reads busy while in flight, and says why it is disabled', () => {
    view = render(<SubmitButton busy={false} ready={false} label="Create counts" busyLabel="Creating…" notReadyReason="Choose a zone first." />);
    let button = view.container.querySelector('button')!;
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe('Create counts');
    const reason = view.container.querySelector(`[id="${button.getAttribute('aria-describedby')}"]`)!;
    expect(reason.textContent).toBe('Choose a zone first.');
    view.rerender(<SubmitButton busy ready label="Create counts" busyLabel="Creating…" />);
    button = view.container.querySelector('button')!;
    expect(button.textContent).toBe('Creating…');
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
  });
});
