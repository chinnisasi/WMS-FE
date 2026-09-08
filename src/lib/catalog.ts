/**
 * Catalog master-data change events, same broadcaster pattern as zones.ts:
 * the Settings catalog surfaces (import wizard, SKU inline edit) notify, and
 * every SKUs/checklist reader subscribes and refetches. One event covers both
 * — imports create SKUs, edits mutate them, and both feed the checklist's
 * catalog step.
 */

/** Fired on `window` after a catalog mutation so readers refetch. */
export const CATALOG_CHANGED_EVENT = 'wms-catalog-changed';

export function notifyCatalogChanged(): void {
  window.dispatchEvent(new Event(CATALOG_CHANGED_EVENT));
}