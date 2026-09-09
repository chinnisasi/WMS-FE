'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import {
  fetchApiGetPurchaseOrder,
  fetchApiListGoodsReceipts,
  fetchApiListOverReceipts,
  fetchApiListPurchaseOrders,
  fetchApiListSkus,
  fetchApiListUsers,
  fetchApiListVendors,
} from '@/lib/api/client';
import type {
  GoodsReceiptEntryDto,
  OverReceiptDto,
  PurchaseOrderDto,
  PurchaseOrderLineDto,
  SkuResponse,
  UserResponse,
  VendorDto,
} from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { CATALOG_CHANGED_EVENT } from '@/lib/catalog';
import { fetchAllPages } from '@/lib/fetch-all-pages';
import { USERS_CHANGED_EVENT } from '@/lib/users';

/**
 * The PO list is headers-only (the lines ride the detail read), so the card
 * renders this header shape — the generated `lines` array is required by the
 * type but absent at runtime on list items, and must never be dereferenced.
 */
export type PurchaseOrderHeader = Omit<PurchaseOrderDto, 'lines'>;

/**
 * Inbound + receiving reads (stories 3.1 / 3.3) — the same external-store
 * pattern as use-catalog.ts: the session identity drives tenant scoping, the
 * cursor the viewer asked for is scoped to the scope it was asked for (a
 * cursor from another tenant/warehouse is treated as a first-page request,
 * never replayed), and stale pages are filtered at render time — no
 * synchronous setState in effects.
 */

/** One keyset page of the warehouse's POs, enriched with per-PO lines. */
export interface PurchaseOrdersPage {
  items: readonly PurchaseOrderHeader[];
  /** Cursor for the DataTable's Next button; null on the last page. */
  nextCursor: string | null;
  /** poId → its lines, from the per-PO detail reads (the list omits them). */
  lines: Readonly<Record<string, readonly PurchaseOrderLineDto[]>>;
}

export function usePurchaseOrders(
  warehouseId: string | null,
): (PurchaseOrdersPage & { onCursor: (cursor: string | null) => void; reload: () => void }) | null {
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
  const [page, setPage] = useState<{
    tenantId: string;
    warehouseId: string;
    requested: string | null;
    page: PurchaseOrdersPage;
  } | null>(null);

  useEffect(() => {
    if (tenantId === null || warehouseId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await fetchApiListPurchaseOrders(
          tenantId,
          warehouseId,
          activeCursor === null ? undefined : { cursor: activeCursor },
        );
        // The list carries headers only — each PO's lines come from its
        // detail read (a small page's worth; a failed detail leaves that
        // row's quantities as "—").
        const lines: Record<string, readonly PurchaseOrderLineDto[]> = {};
        await Promise.all(
          result.items.map(async (po) => {
            try {
              const detail = await fetchApiGetPurchaseOrder(tenantId, po.id);
              lines[po.id] = detail.purchaseOrder.lines;
            } catch {
              // header still renders; the lines column shows "—"
            }
          }),
        );
        if (!cancelled) {
          setPage({
            tenantId,
            warehouseId,
            requested: activeCursor,
            page: { items: result.items, nextCursor: result.nextCursor ?? null, lines },
          });
        }
      } catch {
        // Quiet chrome on failure — the render-time key check hides stale data.
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

  if (
    tenantId === null ||
    warehouseId === null ||
    page === null ||
    page.tenantId !== tenantId ||
    page.warehouseId !== warehouseId ||
    page.requested !== activeCursor
  ) {
    return null;
  }
  return { ...page.page, onCursor, reload };
}

/** One keyset page of the (optionally warehouse-scoped) GRN list. */
export interface GoodsReceiptsPage {
  items: readonly GoodsReceiptEntryDto[];
  /** Cursor for the DataTable's Next button; null on the last page. */
  nextCursor: string | null;
  /** poId → PO code, resolved by detail reads so rows can name the PO. */
  poCodes: Readonly<Record<string, string>>;
}

export function useGoodsReceipts(
  warehouseId: string | null,
): (GoodsReceiptsPage & { onCursor: (cursor: string | null) => void; reload: () => void }) | null {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [requested, setRequested] = useState<{
    tenantId: string;
    warehouseId: string | null;
    cursor: string | null;
  } | null>(null);
  const activeCursor =
    requested !== null && requested.tenantId === tenantId && requested.warehouseId === warehouseId
      ? requested.cursor
      : null;
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<{
    tenantId: string;
    warehouseId: string | null;
    requested: string | null;
    page: GoodsReceiptsPage;
  } | null>(null);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await fetchApiListGoodsReceipts(
          tenantId,
          activeCursor === null
            ? warehouseId === null
              ? undefined
              : { warehouseId }
            : { warehouseId: warehouseId ?? undefined, cursor: activeCursor },
        );
        if (cancelled) return;
        // Resolve the referenced POs' codes so rows show `PO-0004`, not a uuid.
        const poCodes: Record<string, string> = {};
        await Promise.all(
          result.items.map(async (grn) => {
            if (grn.poId === null || poCodes[grn.poId] !== undefined) return;
            try {
              const detail = await fetchApiGetPurchaseOrder(tenantId, grn.poId);
              poCodes[grn.poId] = detail.purchaseOrder.code;
            } catch {
              // the row renders the raw reference as "—"
            }
          }),
        );
        if (!cancelled) {
          setPage({
            tenantId,
            warehouseId,
            requested: activeCursor,
            page: { items: result.items, nextCursor: result.nextCursor ?? null, poCodes },
          });
        }
      } catch {
        // Quiet chrome on failure — the render-time key check hides stale data.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, activeCursor, revision]);

  const onCursor = useCallback(
    (cursor: string | null) => {
      if (tenantId === null) return;
      setRequested({ tenantId, warehouseId, cursor });
    },
    [tenantId, warehouseId],
  );
  const reload = useCallback(() => setRevision((r) => r + 1), []);

  if (
    tenantId === null ||
    page === null ||
    page.tenantId !== tenantId ||
    page.warehouseId !== warehouseId ||
    page.requested !== activeCursor
  ) {
    return null;
  }
  return { ...page.page, onCursor, reload };
}

/** One keyset page of the over-receipt queue (the Conflicts & Reviews read). */
export interface OverReceiptsPage {
  items: readonly OverReceiptDto[];
  /** Cursor for the Next button; null on the last page. */
  nextCursor: string | null;
  /** poId → PO code (every over-receipt carries a PO line — a blind receipt cannot over-receive). */
  poCodes: Readonly<Record<string, string>>;
  /** poLineId → the PO line's ordered / received / open context. */
  poLines: Readonly<Record<string, PurchaseOrderLineDto>>;
}

export function useOverReceipts(
  status: 'pending' | 'approved' | 'rejected',
): (OverReceiptsPage & { onCursor: (cursor: string | null) => void; reload: () => void }) | null {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [requested, setRequested] = useState<{
    tenantId: string;
    status: 'pending' | 'approved' | 'rejected';
    cursor: string | null;
  } | null>(null);
  // The cursor is scoped to the scope it was asked for — a cursor paged on
  // one status tab is a first-page request on another (a cursor from the
  // pending tab must never ride the approved query, or rows are skipped).
  const activeCursor =
    requested !== null && requested.tenantId === tenantId && requested.status === status
      ? requested.cursor
      : null;
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<{
    tenantId: string;
    status: 'pending' | 'approved' | 'rejected';
    requested: string | null;
    page: OverReceiptsPage;
  } | null>(null);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await fetchApiListOverReceipts(
          tenantId,
          activeCursor === null ? { status } : { status, cursor: activeCursor },
        );
        if (cancelled) return;
        const poCodes: Record<string, string> = {};
        const poLines: Record<string, PurchaseOrderLineDto> = {};
        await Promise.all(
          result.items.map(async (entry) => {
            if (entry.poId === null) return;
            try {
              const detail = await fetchApiGetPurchaseOrder(tenantId, entry.poId);
              poCodes[entry.poId] = detail.purchaseOrder.code;
              const line = detail.purchaseOrder.lines.find((l) => l.id === entry.poLineId);
              if (line !== undefined) poLines[line.id] = line;
            } catch {
              // the card still renders; the PO context reads "—"
            }
          }),
        );
        if (!cancelled) {
          setPage({
            tenantId,
            status,
            requested: activeCursor,
            page: {
              items: result.items,
              nextCursor: result.nextCursor ?? null,
              poCodes,
              poLines,
            },
          });
        }
      } catch {
        // Quiet chrome on failure — the render-time key check hides stale data.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, status, activeCursor, revision]);

  const onCursor = useCallback(
    (cursor: string | null) => {
      if (tenantId === null) return;
      setRequested({ tenantId, status, cursor });
    },
    [tenantId, status],
  );
  const reload = useCallback(() => setRevision((r) => r + 1), []);

  if (
    tenantId === null ||
    page === null ||
    page.tenantId !== tenantId ||
    page.status !== status ||
    page.requested !== activeCursor
  ) {
    return null;
  }
  return { ...page.page, onCursor, reload };
}

/**
 * The full vendor list (a read, open to every member) as an id→vendor map —
 * the PO card names vendors without a join per row.
 */
export function useVendorMap(): Readonly<Record<string, VendorDto>> | null {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [map, setMap] = useState<{ tenantId: string; map: Record<string, VendorDto> } | null>(null);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        // VendorListResponse's nextCursor is optional in the generated type,
        // so the page is normalized to the walker's contract.
        const vendors = await fetchAllPages<VendorDto>(async (options) => {
          const result = await fetchApiListVendors(tenantId, options);
          return { items: result.items, nextCursor: result.nextCursor ?? null };
        });
        if (!cancelled) {
          setMap({ tenantId, map: Object.fromEntries(vendors.map((v) => [v.id, v])) });
        }
      } catch {
        // Quiet chrome on failure.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  if (tenantId === null || map === null || map.tenantId !== tenantId) return null;
  return map.map;
}

/** The full SKU list as an id→SKU map — over-receipt cards name the SKU. */
export function useSkuMap(): Readonly<Record<string, SkuResponse>> | null {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [map, setMap] = useState<{ tenantId: string; map: Record<string, SkuResponse> } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(CATALOG_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(CATALOG_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const skus = await fetchAllPages<SkuResponse>((options) =>
          fetchApiListSkus(tenantId, options),
        );
        if (!cancelled) {
          setMap({ tenantId, map: Object.fromEntries(skus.map((s) => [s.id, s])) });
        }
      } catch {
        // Quiet chrome on failure.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, revision]);

  if (tenantId === null || map === null || map.tenantId !== tenantId) return null;
  return map.map;
}

/** The full user list as an id→user map — over-receipt cards name the requester. */
export function useUserMap(): Readonly<Record<string, UserResponse>> | null {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [map, setMap] = useState<{ tenantId: string; map: Record<string, UserResponse> } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(USERS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(USERS_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const users = await fetchAllPages<UserResponse>((options) =>
          fetchApiListUsers(tenantId, options),
        );
        if (!cancelled) {
          setMap({ tenantId, map: Object.fromEntries(users.map((u) => [u.id, u])) });
        }
      } catch {
        // Quiet chrome on failure.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, revision]);

  if (tenantId === null || map === null || map.tenantId !== tenantId) return null;
  return map.map;
}