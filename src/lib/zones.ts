/**
 * Zone/bin master-data change events, same broadcaster pattern as
 * warehouses.ts: the Settings setup forms (zone create, grid generator,
 * manual bin, block toggle) notify, and every zones/bins/checklist surface
 * subscribes and refetches. One event covers both — bins live inside zones
 * and both feed the setup checklist.
 */

/** Fired on `window` after a zone/bin mutation so readers refetch. */
export const ZONES_CHANGED_EVENT = 'wms-zones-changed';

export function notifyZonesChanged(): void {
  window.dispatchEvent(new Event(ZONES_CHANGED_EVENT));
}