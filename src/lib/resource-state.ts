/**
 * The read-hook return shape (`IMPLEMENTATION-GUIDE §1.1`) — moved here from
 * `use-outbound-orders.ts` in story 21-11b so a portal module can name it
 * without importing an operator hook (`portal-boundary.test.ts`).
 * `use-outbound-orders.ts` re-exports both, so its importers are unchanged.
 *
 * Every read reports its own failure. The house hooks swallowed a failed
 * fetch into `null`, and a surface that renders `null` as "Loading…" then
 * tells the viewer a fetch is still in flight forever. So a read carries an
 * explicit `failed` arm and the surface renders it with a Retry. Progress
 * copy is never used for a failure.
 *
 * Types only: no React, no fetch, no imports.
 */
export type ResourceState<T> =
  | { readonly state: 'loading' }
  | { readonly state: 'ready'; readonly data: T }
  | { readonly state: 'failed'; readonly reason: string };

/** Every resource hook returns a way to re-run itself — the Retry affordance. */
export interface Reloadable {
  readonly reload: () => void;
}
