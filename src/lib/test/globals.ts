/**
 * Global stubbing for tests, now that `bun test` preloads a real DOM
 * (`bunfig.toml` → `happydom.ts`).
 *
 * Before the DOM existed, the pure-logic suites under `src/lib` installed
 * their own `window`/`document`/`localStorage` by plain assignment and tore
 * them down with `delete`. Neither works against happy-dom: `localStorage`
 * is an accessor with no setter, so assigning to it throws
 * "Attempted to assign to readonly property", and `delete` would strip the
 * real global out from under every later test file in the run.
 *
 * `stubGlobal` defines over whatever is there, remembering the original
 * descriptor the first time it touches a name; `restoreGlobals` puts every
 * one of them back. The suites keep their spy-based assertions — a stub is
 * still what they observe — they just install and remove it safely.
 */
const originals = new Map<string, PropertyDescriptor | undefined>();

export function stubGlobal(name: string, value: unknown): void {
  if (!originals.has(name)) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  }
  Object.defineProperty(globalThis, name, {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

export function restoreGlobals(): void {
  for (const [name, descriptor] of originals) {
    if (descriptor === undefined) {
      delete (globalThis as Record<string, unknown>)[name];
    } else {
      Object.defineProperty(globalThis, name, descriptor);
    }
  }
  originals.clear();
}
