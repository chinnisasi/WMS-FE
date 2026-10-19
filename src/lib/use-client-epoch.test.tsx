import { afterEach, describe, expect, test } from 'bun:test';

import { render, type Rendered } from './test/render';
import { useClientEpoch } from './use-client-epoch';

/**
 * Story 1-5a — the switch counter a list hook stamps its cursor with: every
 * client change is a new epoch, so a cursor requested under All is never
 * replayed after All → A → All; the pending state (clients still loading)
 * is not a switch.
 */
let view: Rendered | undefined;
afterEach(() => {
  view?.unmount();
  view = undefined;
});

function Probe({ clientId, pending }: { clientId: string | null; pending: boolean }) {
  return <span data-testid="epoch">{useClientEpoch(clientId, pending)}</span>;
}
const epoch = () => Number(view!.container.querySelector('[data-testid="epoch"]')!.textContent);

describe('useClientEpoch', () => {
  test('All → A → All: each switch is a new epoch — the way back never returns to the first one', () => {
    view = render(<Probe clientId={null} pending={false} />);
    expect(epoch()).toBe(0);
    view.rerender(<Probe clientId="c-a" pending={false} />);
    expect(epoch()).toBe(1);
    view.rerender(<Probe clientId={null} pending={false} />);
    expect(epoch()).toBe(2);
  });

  test('an unchanged client keeps its epoch across renders', () => {
    view = render(<Probe clientId="c-a" pending={false} />);
    view.rerender(<Probe clientId="c-a" pending={false} />);
    expect(epoch()).toBe(0);
  });

  test('pending → A is not a switch (the clients merely loaded)', () => {
    // While pending, a hook resolves its client id to null; the stored A arrives with the clients.
    view = render(<Probe clientId={null} pending />);
    expect(epoch()).toBe(0);
    view.rerender(<Probe clientId={null} pending />);
    expect(epoch()).toBe(0);
    view.rerender(<Probe clientId="c-a" pending={false} />);
    expect(epoch()).toBe(0);
    // …and a real switch after that is one.
    view.rerender(<Probe clientId={null} pending={false} />);
    expect(epoch()).toBe(1);
  });
});
