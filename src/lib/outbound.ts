/**
 * Outbound change events — the same three-line broadcaster pattern as
 * zones.ts / catalog.ts / users.ts: the Outbound surface's mutations (order
 * create, order cancel) notify, and every outbound reader (the order list
 * today; waves, pack and dispatch as they land) subscribes and refetches.
 *
 * One event covers the whole module on purpose: an order cancel changes the
 * order list AND anything downstream that had grouped it, so a reader that
 * only cared about "its" mutation would go stale the first time a sibling
 * surface moved the same order.
 */

/** Fired on `window` after an outbound mutation so readers refetch. */
export const OUTBOUND_CHANGED_EVENT = 'wms-outbound-changed';

export function notifyOutboundChanged(): void {
  window.dispatchEvent(new Event(OUTBOUND_CHANGED_EVENT));
}
