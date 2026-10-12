'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import {
  fetchApiListNotifications,
  fetchApiMarkNotificationsOpened,
  fetchApiNotificationStatus,
} from '@/lib/api/client';
import { readSession, subscribeSession } from '@/lib/auth';
import { warehouseDisplayLabel } from '@/lib/drill';
import type { NotificationEntry, NotificationLookups } from '@/lib/notifications';
import { useSkuMap } from '@/lib/use-inbound';
import { useTenantWarehouses } from '@/lib/use-tenant-warehouses';
import { readReason } from '@/lib/outbound-orders';
import type { Reloadable, ResourceState } from '@/lib/resource-state';

export interface NotificationsPage {
  readonly items: readonly NotificationEntry[];
  /** Cursor for the DataTable's Next button; null on the last page. */
  readonly nextCursor: string | null;
  /** When the page arrived — the relative times count from it (render stays pure). */
  readonly fetchedAtMs: number;
}

function useTenantId(): string | null {
  return useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
}

/**
 * Story 9-2 — one keyset page of the caller's notification entries, newest
 * raised first (the house loader shape, frontend guide §1). The server
 * routes by role; this hook filters nothing. `limit` is the panel's 10, or
 * absent for the page (the server's default). The cursor is passed back
 * verbatim, stamped with the tenant it was requested for.
 */
export function useNotifications(
  limit?: number,
): ResourceState<NotificationsPage> & Reloadable & { readonly onCursor: (cursor: string | null) => void } {
  const tenantId = useTenantId();
  const [requested, setRequested] = useState<{ tenantId: string; cursor: string | null } | null>(null);
  const activeCursor = requested !== null && requested.tenantId === tenantId ? requested.cursor : null;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    requested: string | null;
    state: ResourceState<NotificationsPage>;
  } | null>(null);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await fetchApiListNotifications(tenantId, {
          ...(activeCursor === null ? {} : { cursor: activeCursor }),
          ...(limit === undefined ? {} : { limit }),
        });
        if (!cancelled) {
          setResult({
            tenantId,
            requested: activeCursor,
            state: { state: 'ready', data: { items: page.items, nextCursor: page.nextCursor ?? null, fetchedAtMs: Date.now() } },
          });
        }
      } catch (error) {
        if (!cancelled) {
          setResult({ tenantId, requested: activeCursor, state: { state: 'failed', reason: readReason(error, 'notifications') } });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, activeCursor, limit, revision]);

  const onCursor = useCallback(
    (cursor: string | null) => {
      if (tenantId === null) return;
      setRequested({ tenantId, cursor });
    },
    [tenantId],
  );
  // Clear first, and restart from page one (frontend guide §1).
  const reload = useCallback(() => {
    setRequested(null);
    setResult(null);
    setRevision((r) => r + 1);
  }, []);

  const stale = tenantId === null || result === null || result.tenantId !== tenantId || result.requested !== activeCursor;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), onCursor, reload };
}

/**
 * Story 9-2 — the bell's dot. Read once when the shell mounts and once per
 * PATHNAME change (the caller passes `usePathname()`: a query-only change is
 * the same pathname and refetches nothing). No polling, no timer.
 *
 * `markOpened` records the panel open server-side and clears the dot from
 * the server's answer. A status read still in flight when the panel opened is
 * dropped (the seq guard, frontend guide §1.3) — it could only re-light a dot
 * the open just cleared. A failed read shows no dot (the bell is chrome; the
 * panel itself reports its own failures).
 */
export function useNotificationStatus(pathname: string): { readonly hasNew: boolean; readonly markOpened: () => void } {
  const tenantId = useTenantId();
  const [status, setStatus] = useState<{ tenantId: string; hasNew: boolean } | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (tenantId === null) return;
    const mine = ++seq.current;
    (async () => {
      try {
        const answer = await fetchApiNotificationStatus(tenantId);
        if (mine === seq.current) setStatus({ tenantId, hasNew: answer.hasNew });
      } catch {
        // Quiet chrome: no dot on a failed read.
      }
    })();
  }, [tenantId, pathname]);

  const markOpened = useCallback(() => {
    if (tenantId === null) return;
    const mine = ++seq.current;
    (async () => {
      try {
        const answer = await fetchApiMarkNotificationsOpened(tenantId);
        if (mine === seq.current) setStatus({ tenantId, hasNew: answer.hasNew });
      } catch {
        // The dot stays as it was; the next pathname change re-reads it.
      }
    })();
  }, [tenantId]);

  const hasNew = status !== null && status.tenantId === tenantId && status.hasNew;
  return { hasNew, markOpened };
}

/**
 * The entries' name lookups: SKU codes (the catalog map) and warehouse
 * labels (`warehouseDisplayLabel` — `CODE Name`, or a short id while the
 * warehouses are loading or failed). Mounted only where entries render: the
 * panel body is lazy, so the shell never pages the catalog on its own.
 */
export function useNotificationLookups(): NotificationLookups {
  const skus = useSkuMap();
  const warehouses = useTenantWarehouses();
  const items = warehouses.state === 'ready' ? warehouses.data.items : null;
  return {
    sku: (skuId) => {
      const sku = skus?.[skuId];
      return sku === undefined ? null : { code: sku.code, uom: sku.uom, uomPrecision: sku.uomPrecision };
    },
    warehouse: (warehouseId) => warehouseDisplayLabel(items, warehouseId),
  };
}
