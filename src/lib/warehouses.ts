/**
 * Warehouse-selection contract shared between the sidebar switcher
 * (reader/renderer) and the Settings create form (broadcaster). Story 1.2
 * has no server-side "active warehouse" concept yet — the picked warehouse
 * is a per-viewer localStorage convenience, same pattern as src/lib/auth.ts.
 */

/** Fired on `window` after a warehouse is created so the switcher refetches. */
export const WAREHOUSES_CHANGED_EVENT = 'wms-warehouses-changed';

/** Fired on `window` when the picked warehouse changes (also on pick itself). */
export const ACTIVE_WAREHOUSE_CHANGED_EVENT = 'wms-active-warehouse-changed';

export const ACTIVE_WAREHOUSE_STORAGE_KEY = 'wms-active-warehouse';

export function readActiveWarehouseId(): string | null {
  try {
    const id = localStorage.getItem(ACTIVE_WAREHOUSE_STORAGE_KEY);
    return typeof id === 'string' && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

export function writeActiveWarehouseId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_WAREHOUSE_STORAGE_KEY, id);
  } catch {
    // private mode — selection just won't persist
  }
  window.dispatchEvent(new Event(ACTIVE_WAREHOUSE_CHANGED_EVENT));
}

/**
 * React subscription for the picked warehouse — pairs with
 * useSyncExternalStore (storage event covers other tabs, the local event
 * covers picks in this tab).
 */
export function subscribeActiveWarehouse(onChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === ACTIVE_WAREHOUSE_STORAGE_KEY) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(ACTIVE_WAREHOUSE_CHANGED_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(ACTIVE_WAREHOUSE_CHANGED_EVENT, onChange);
  };
}

export function notifyWarehousesChanged(): void {
  window.dispatchEvent(new Event(WAREHOUSES_CHANGED_EVENT));
}