/**
 * DOM environment for `bun test` (the component-test infrastructure story).
 *
 * Registered as a preload in `bunfig.toml`, so it runs once before any test
 * file is evaluated and installs `window`, `document` and friends as real
 * globals. Everything under `src/lib/*.test.ts` predates this and hand-shims
 * the globals it needs in `beforeEach`; those shims keep working because they
 * assign over these, and their `afterEach` cleanup restores rather than
 * removes — see `src/lib/test/render.ts` for the rendering side.
 */
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost:3001/' });

// React's `act` refuses to run without this, and every component test goes
// through it (see `src/lib/test/render.ts`).
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
