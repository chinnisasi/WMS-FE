/**
 * The component-rendering helper for `bun test`.
 *
 * Deliberately hand-rolled on `react-dom/client` rather than pulling in
 * @testing-library — this repo keeps four runtime dependencies and writes its
 * own API wrappers instead of leaning on generated abstractions, and one
 * ~30-line helper is cheaper to own than a query library. Assertions use
 * plain `querySelector`/`textContent` against the returned container.
 *
 * `act` is what flushes React's work synchronously, so a render returns with
 * the DOM already settled. It requires `IS_REACT_ACT_ENVIRONMENT`, which the
 * DOM preload sets.
 */
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

export interface Rendered {
  /** The element the tree was mounted into. */
  readonly container: HTMLElement;
  /** Re-render the same root with new props. */
  rerender(next: ReactElement): void;
  /** Unmount and detach — call it, so one test's DOM never reaches the next. */
  unmount(): void;
}

export function render(ui: ReactElement): Rendered {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root | undefined;
  act(() => {
    root = createRoot(container);
    root.render(ui);
  });
  return {
    container,
    rerender(next: ReactElement) {
      act(() => void root?.render(next));
    },
    unmount() {
      act(() => void root?.unmount());
      container.remove();
    },
  };
}
