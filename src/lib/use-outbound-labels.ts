'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import {
  fetchApiGetShipment,
  fetchApiListConnections,
  fetchApiListManifests,
} from '@/lib/api/client';
import type {
  CarrierConnectionResponse,
  ManifestDto,
  ShipmentResponse,
} from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { OUTBOUND_CHANGED_EVENT } from '@/lib/outbound';
import { detailReason, readReason } from '@/lib/outbound-orders';
import type { ResourceState, Reloadable } from '@/lib/use-outbound-orders';

/**
 * The label station's reads (story 4.6c), beside the pack/dispatch ones —
 * the canonical hook shape (`use-outbound-orders`): session identity via
 * `useSyncExternalStore`, a `useEffect` fetch, a `revision` counter bumped by
 * OUTBOUND_CHANGED_EVENT, and stale results (tenant changed mid-flight)
 * filtered at render. Every read reports its own failure — a failed fetch is
 * a FeedbackBanner with a Retry, never an endless "Loading…".
 *
 * The label and manifest mutations do NOT live here: like the 4-2b/4-2d
 * surfaces, they live in the component (`pack-dispatch.tsx`), where the
 * idempotency key's lifetime is the intent — per-DRAFT for a label form, and
 * per-CONFIRMATION for the manifest closure — and each success calls
 * `notifyOutboundChanged()` so every outbound reader refetches.
 */

/**
 * The tenant's carrier connections for the label form's picker. The
 * connection is the form's one required field — an order cannot be labelled
 * without naming which carrier account generates its label — so the picker
 * carries an explicit failed arm rather than offering an empty select.
 */
export function useCarrierConnections(): ResourceState<readonly CarrierConnectionResponse[]> &
  Reloadable {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    state: ResourceState<readonly CarrierConnectionResponse[]>;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(OUTBOUND_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(OUTBOUND_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const items: CarrierConnectionResponse[] = [];
        // Keyset walk — the list is cursor-paginated, and the picker needs
        // every connection, not the newest page.
        let cursor: string | null = null;
        for (;;) {
          const page = await fetchApiListConnections(
            tenantId,
            cursor === null ? undefined : { cursor },
          );
          items.push(...page.items);
          cursor = page.nextCursor;
          if (cursor === null) break;
        }
        if (!cancelled) {
          setResult({ tenantId, state: { state: 'ready', data: items } });
        }
      } catch (error) {
        if (!cancelled) {
          setResult({
            tenantId,
            state: { state: 'failed', reason: readReason(error, 'the carrier connections') },
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, revision]);

  const reload = useCallback(() => setRevision((r) => r + 1), []);
  const stale = tenantId === null || result === null || result.tenantId !== tenantId;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}

/**
 * One order's shipment read-back: the label the order already carries, or
 * `null` when it has none (the route answers 404 `not-found` for that case,
 * which is "no label yet" — an expected state of a `ready_to_dispatch` order,
 * never a failed read). Fetched when the row expands, exactly like
 * `useOrderDetail`.
 */
export function useOrderShipment(orderId: string | null): ResourceState<ShipmentResponse | null> &
  Reloadable {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    orderId: string;
    state: ResourceState<ShipmentResponse | null>;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(OUTBOUND_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(OUTBOUND_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || orderId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const shipment = await fetchApiGetShipment(tenantId, orderId);
        if (!cancelled) setResult({ tenantId, orderId, state: { state: 'ready', data: shipment } });
      } catch (error) {
        if (!cancelled) {
          setResult({
            tenantId,
            orderId,
            state: { state: 'failed', reason: detailReason(error) },
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, orderId, revision]);

  const reload = useCallback(() => setRevision((r) => r + 1), []);
  const stale =
    orderId === null ||
    tenantId === null ||
    result === null ||
    result.tenantId !== tenantId ||
    result.orderId !== orderId;

  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}

export interface OutboundManifestsPage {
  items: readonly ManifestDto[];
  /** Cursor for the list's Next button; null on the last page. */
  nextCursor: string | null;
}

/**
 * One keyset page of the warehouse's manifests, newest first — the manifest
 * section's read. Unlike the label form's reads this is UNGATED: a manifest
 * is the hand-over record, and the record is readable by every role that can
 * read the pipeline (the builder alone is gated on `labels.execute`).
 */
export function useManifests(
  warehouseId: string | null,
): ResourceState<OutboundManifestsPage> &
  Reloadable & { readonly onCursor: (cursor: string | null) => void } {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [requested, setRequested] = useState<{
    tenantId: string;
    warehouseId: string;
    cursor: string | null;
  } | null>(null);
  const activeCursor =
    requested !== null && requested.tenantId === tenantId && requested.warehouseId === warehouseId
      ? requested.cursor
      : null;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    warehouseId: string;
    requested: string | null;
    state: ResourceState<OutboundManifestsPage>;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(OUTBOUND_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(OUTBOUND_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || warehouseId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await fetchApiListManifests(
          tenantId,
          warehouseId,
          activeCursor === null ? undefined : { cursor: activeCursor },
        );
        if (!cancelled) {
          setResult({
            tenantId,
            warehouseId,
            requested: activeCursor,
            state: {
              state: 'ready',
              data: { items: page.items, nextCursor: page.nextCursor ?? null },
            },
          });
        }
      } catch (error) {
        if (!cancelled) {
          setResult({
            tenantId,
            warehouseId,
            requested: activeCursor,
            state: { state: 'failed', reason: readReason(error, 'manifests') },
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, activeCursor, revision]);

  const onCursor = useCallback(
    (cursor: string | null) => {
      if (tenantId === null || warehouseId === null) return;
      setRequested({ tenantId, warehouseId, cursor });
    },
    [tenantId, warehouseId],
  );
  const reload = useCallback(() => setRevision((r) => r + 1), []);

  const stale =
    tenantId === null ||
    warehouseId === null ||
    result === null ||
    result.tenantId !== tenantId ||
    result.warehouseId !== warehouseId ||
    result.requested !== activeCursor;

  return { ...(stale ? ({ state: 'loading' } as const) : result.state), onCursor, reload };
}