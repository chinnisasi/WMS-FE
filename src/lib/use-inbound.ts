'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import {
  fetchApiGetAsn,
  fetchApiGetPurchaseOrder,
  fetchApiListBins,
  fetchApiListGoodsReceipts,
  fetchApiListOverReceipts,
  fetchApiListPurchaseOrders,
  fetchApiListQcHolds,
  fetchApiListSkus,
  fetchApiListStock,
  fetchApiListUsers,
  fetchApiListPartners,
  fetchApiListZones,
} from '@/lib/api/client';
import { CLIENT_PENDING, clientFilterForDrill, type ClientFilter } from '@/lib/active-client';
import { useClientEpoch } from '@/lib/use-client-epoch';
import { useKeyedDrill } from '@/lib/use-drill';
import type {
  AsnLineDto,
  BinResponse,
  GoodsReceiptEntryDto,
  OverReceiptDto,
  PurchaseOrderDto,
  PurchaseOrderLineDto,
  QcHoldEntryDto,
  SkuResponse,
  StockEntryDto,
  UserResponse,
  PartnerDto,
  ZoneResponse,
} from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { CATALOG_CHANGED_EVENT } from '@/lib/catalog';
import type { GrnsDrill, OverReceiptsDrill } from '@/lib/drill';
import { fetchGrnsDrill, fetchOverReceiptsDrill } from '@/lib/drill-fetch';
import { fetchAllPages } from '@/lib/fetch-all-pages';
import { USERS_CHANGED_EVENT } from '@/lib/users';
import { PARTNERS_CHANGED_EVENT } from '@/lib/partners';
import { readReason } from '@/lib/outbound-orders';
import type { Reloadable, ResourceState } from '@/lib/resource-state';
import { INBOUND_CHANGED_EVENT } from '@/lib/asns';
import { sortedByCode } from '@/lib/purchase-orders';
import { vendorsLinkedTo } from '@/lib/partners';

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
  /** Story 1-5a — the screen's active-client filter (`useActiveClient().filter`); pending sends nothing. */
  clientFilter: ClientFilter,
): (PurchaseOrdersPage & { onCursor: (cursor: string | null) => void; reload: () => void }) | null {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const pending = clientFilter === CLIENT_PENDING;
  const clientId: string | null = clientFilter === CLIENT_PENDING ? null : clientFilter;
  const clientEpoch = useClientEpoch(clientId, pending);
  const [requested, setRequested] = useState<{
    tenantId: string;
    warehouseId: string;
    clientId: string | null; clientEpoch: number;
    cursor: string | null;
  } | null>(null);
  const activeCursor =
    requested !== null && requested.tenantId === tenantId && requested.warehouseId === warehouseId && requested.clientId === clientId && requested.clientEpoch === clientEpoch
      ? requested.cursor
      : null;
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<{
    tenantId: string;
    warehouseId: string;
    clientId: string | null;
    requested: string | null;
    page: PurchaseOrdersPage;
  } | null>(null);

  // Story 2-1 — a PO create (or any inbound mutation) refetches. Load-bearing:
  // the create returns the table to page one with `onCursor(null)`, which
  // from page one changes nothing the fetch effect depends on.
  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(INBOUND_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(INBOUND_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || warehouseId === null || pending) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await fetchApiListPurchaseOrders(
          tenantId,
          warehouseId,
          { ...(clientId === null ? {} : { clientId }), ...(activeCursor === null ? {} : { cursor: activeCursor }) },
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
            clientId,
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
  }, [tenantId, warehouseId, clientId, pending, activeCursor, revision]);

  const onCursor = useCallback(
    (cursor: string | null) => {
      if (tenantId === null || warehouseId === null) return;
      setRequested({ tenantId, warehouseId, clientId, clientEpoch, cursor });
    },
    [tenantId, warehouseId, clientId, clientEpoch],
  );
  const reload = useCallback(() => setRevision((r) => r + 1), []);

  if (
    tenantId === null ||
    warehouseId === null ||
    pending ||
    page === null ||
    page.tenantId !== tenantId ||
    page.warehouseId !== warehouseId ||
    page.clientId !== clientId ||
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

/**
 * Story 9-1b — given an Overview drill, the page is the drill's rows (its
 * warehouse, blind flag and window, exactly); the caller passes the drill's
 * warehouse (or null for a tenant-wide drill) as `warehouseId`. 9-1b also
 * gave it the `ResourceState` shape (frontend guide §1.1): a failed read is
 * `failed` with a reason, never "no receipts", and `reload()` clears first.
 */
export function useGoodsReceipts(
  warehouseId: string | null,
  /** Story 1-5a — the active-client filter; a drill ignores it (decision 11). */
  clientFilter: ClientFilter,
  drillProp: GrnsDrill | null = null,
): ResourceState<GoodsReceiptsPage> & Reloadable & { readonly onCursor: (cursor: string | null) => void } {
  // Keyed on drillKey, not identity: an RSC refresh must not refetch.
  const drill = useKeyedDrill(drillProp);
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const effective = clientFilterForDrill(clientFilter, drill !== null);
  const pending = effective === CLIENT_PENDING;
  const clientId: string | null = effective === CLIENT_PENDING ? null : effective;
  const clientEpoch = useClientEpoch(clientId, pending);
  const [requested, setRequested] = useState<{
    tenantId: string;
    warehouseId: string | null;
    clientId: string | null; clientEpoch: number;
    cursor: string | null;
  } | null>(null);
  const activeCursor =
    requested !== null && requested.tenantId === tenantId && requested.warehouseId === warehouseId && requested.clientId === clientId && requested.clientEpoch === clientEpoch
      ? requested.cursor
      : null;
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<{
    tenantId: string;
    warehouseId: string | null;
    clientId: string | null;
    requested: string | null;
    state: ResourceState<GoodsReceiptsPage>;
  } | null>(null);

  useEffect(() => {
    if (tenantId === null || pending) return;
    let cancelled = false;
    (async () => {
      try {
        const result =
          drill === null
            ? await fetchApiListGoodsReceipts(tenantId, {
                ...(warehouseId === null ? {} : { warehouseId }),
                ...(clientId === null ? {} : { clientId }),
                ...(activeCursor === null ? {} : { cursor: activeCursor }),
              })
            : await fetchGrnsDrill(tenantId, drill, activeCursor);
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
            clientId,
            requested: activeCursor,
            state: { state: 'ready', data: { items: result.items, nextCursor: result.nextCursor ?? null, poCodes } },
          });
        }
      } catch (error) {
        if (!cancelled) {
          setPage({
            tenantId,
            warehouseId,
            clientId,
            requested: activeCursor,
            state: { state: 'failed', reason: readReason(error, 'the goods receipts') },
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, clientId, pending, drill, activeCursor, revision]);

  const onCursor = useCallback(
    (cursor: string | null) => {
      if (tenantId === null) return;
      setRequested({ tenantId, warehouseId, clientId, clientEpoch, cursor });
    },
    [tenantId, warehouseId, clientId, clientEpoch],
  );
  // Clear first, and restart from page one (a stale cursor's Retry would fail forever).
  const reload = useCallback(() => {
    setRequested(null);
    setPage(null);
    setRevision((r) => r + 1);
  }, []);

  const stale =
    tenantId === null ||
    pending ||
    page === null ||
    page.tenantId !== tenantId ||
    page.warehouseId !== warehouseId ||
    page.clientId !== clientId ||
    page.requested !== activeCursor;
  return { ...(stale ? ({ state: 'loading' } as const) : page.state), onCursor, reload };
}

/** One keyset page of the over-receipt queue (the Conflicts & Reviews read). */
export interface OverReceiptsPage {
  items: readonly OverReceiptDto[];
  /** Cursor for the Next button; null on the last page. */
  nextCursor: string | null;
  /**
   * poId → PO code. Every over-receipt carries a PO OR (story 21-6) an ASN —
   * a blind receipt cannot over-receive; an ASN's code rides the row itself
   * (`asnCode`). Story 21-9: the LINE is optional — a late receipt's line
   * that matched no document line pends against the document alone
   * (`poLineId` null, or no `asnLineId`).
   */
  poCodes: Readonly<Record<string, string>>;
  /**
   * Story 21-9 — poId / asnId → the document's status, read from the same
   * detail fetches (no BE field): a `closed` / `cancelled` document makes
   * its rows late receipts.
   */
  documentStatuses: Readonly<Record<string, string>>;
  /** poLineId → the PO line's ordered / received / open context. */
  poLines: Readonly<Record<string, PurchaseOrderLineDto>>;
  /** Story 21-6 — asnLineId → the ASN line's announced / received / open context. */
  asnLines: Readonly<Record<string, AsnLineDto>>;
}

/**
 * Story 9-1b — given an Overview drill, the page is the drill's rows: the
 * request carries exactly the drill's keys (never the `status` tab), and
 * the cursor rides back verbatim. The drill is fixed for the hook's
 * lifetime (the screen remounts on a drill change).
 */
export function useOverReceipts(
  status: 'pending' | 'approved' | 'rejected',
  /** Story 1-5a — the active-client filter; a drill ignores it (decision 11). */
  clientFilter: ClientFilter,
  drillProp: OverReceiptsDrill | null = null,
): (OverReceiptsPage & { onCursor: (cursor: string | null) => void; reload: () => void }) | null {
  // Keyed on drillKey, not identity: an RSC refresh must not refetch.
  const drill = useKeyedDrill(drillProp);
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const effective = clientFilterForDrill(clientFilter, drill !== null);
  const pending = effective === CLIENT_PENDING;
  const clientId: string | null = effective === CLIENT_PENDING ? null : effective;
  const clientEpoch = useClientEpoch(clientId, pending);
  const [requested, setRequested] = useState<{
    tenantId: string;
    status: 'pending' | 'approved' | 'rejected';
    clientId: string | null; clientEpoch: number;
    cursor: string | null;
  } | null>(null);
  // The cursor is scoped to the scope it was asked for — a cursor paged on
  // one status tab is a first-page request on another (a cursor from the
  // pending tab must never ride the approved query, or rows are skipped).
  const activeCursor =
    requested !== null && requested.tenantId === tenantId && requested.status === status && requested.clientId === clientId && requested.clientEpoch === clientEpoch
      ? requested.cursor
      : null;
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<{
    tenantId: string;
    status: 'pending' | 'approved' | 'rejected';
    clientId: string | null;
    requested: string | null;
    page: OverReceiptsPage;
  } | null>(null);

  useEffect(() => {
    if (tenantId === null || pending) return;
    let cancelled = false;
    (async () => {
      try {
        const result =
          drill === null
            ? await fetchApiListOverReceipts(
                tenantId,
                {
                  status,
                  ...(clientId === null ? {} : { clientId }),
                  ...(activeCursor === null ? {} : { cursor: activeCursor }),
                },
              )
            : await fetchOverReceiptsDrill(tenantId, drill, activeCursor);
        if (cancelled) return;
        const poCodes: Record<string, string> = {};
        const documentStatuses: Record<string, string> = {};
        const poLines: Record<string, PurchaseOrderLineDto> = {};
        const asnLines: Record<string, AsnLineDto> = {};
        // Story 21-6 — the ASN lines' context: ONE detail read per distinct
        // ASN on the page (many over-receipts can share an ASN), every line
        // kept so each card finds its own.
        const asnIds = [...new Set(result.items.flatMap((entry) => (entry.asnId === undefined ? [] : [entry.asnId])))];
        await Promise.all(
          asnIds.map(async (asnId) => {
            try {
              const detail = await fetchApiGetAsn(tenantId, asnId);
              documentStatuses[asnId] = detail.asn.status;
              for (const line of detail.asn.lines) asnLines[line.id] = line;
            } catch {
              // the cards still render; the line context is omitted
            }
          }),
        );
        await Promise.all(
          result.items.map(async (entry) => {
            if (entry.asnId !== undefined) return;
            if (entry.poId === null) return;
            try {
              const detail = await fetchApiGetPurchaseOrder(tenantId, entry.poId);
              poCodes[entry.poId] = detail.purchaseOrder.code;
              documentStatuses[entry.poId] = detail.purchaseOrder.status;
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
            clientId,
            requested: activeCursor,
            page: {
              items: result.items,
              nextCursor: result.nextCursor ?? null,
              poCodes,
              documentStatuses,
              poLines,
              asnLines,
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
  }, [tenantId, status, clientId, pending, drill, activeCursor, revision]);

  const onCursor = useCallback(
    (cursor: string | null) => {
      if (tenantId === null) return;
      setRequested({ tenantId, status, clientId, clientEpoch, cursor });
    },
    [tenantId, status, clientId, clientEpoch],
  );
  const reload = useCallback(() => setRevision((r) => r + 1), []);

  if (
    tenantId === null ||
    pending ||
    page === null ||
    page.tenantId !== tenantId ||
    page.status !== status ||
    page.clientId !== clientId ||
    page.requested !== activeCursor
  ) {
    return null;
  }
  return { ...page.page, onCursor, reload };
}

/**
 * Story 1-3 — every partner holding the vendor role (`GET /partners?role=vendor`,
 * a read open to every member, any status) as an id→partner map, refetched
 * on `PARTNERS_CHANGED_EVENT`. The replenishment picker names a draft's vendor
 * from it even when that vendor is no longer linked or active. (The PO table
 * reads the PO's own frozen `vendorSnapshot`, not this map.)
 */
export function useVendorMap(): Readonly<Record<string, PartnerDto>> | null {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [map, setMap] = useState<{ tenantId: string; revision: number; map: Record<string, PartnerDto> } | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(PARTNERS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(PARTNERS_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const vendors = await fetchAllPages<PartnerDto>(async (options) => {
          const result = await fetchApiListPartners(tenantId, { ...options, role: 'vendor' });
          return { items: result.items, nextCursor: result.nextCursor ?? null };
        });
        if (!cancelled) {
          setMap({ tenantId, revision, map: Object.fromEntries(vendors.map((v) => [v.id, v])) });
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
/**
 * One keyset page of the QC holds list (story 3.4) — the Inbound surface's
 * QC Holds card. No join data rides the rows: the card composes SKU codes
 * and holder emails through `useSkuMap` / `useUserMap`.
 */
export interface QcHoldsPage {
  /** Story 1-2b — the list rows carry the kind, GRN, client, batch and held quantity. */
  items: readonly QcHoldEntryDto[];
  /** Cursor for the Next button; null on the last page. */
  nextCursor: string | null;
}

/** Story 2-8a — the list's status filter: one status, or `closed` (released or inspected — the Closed tab). */
export type QcHoldStatusFilter = 'open' | 'released' | 'inspected' | 'closed';

export function useQcHolds(
  warehouseId: string | null,
  status: QcHoldStatusFilter,
  /**
   * Story 1-5a — the active-client filter. The QC-hold FORM's open-holds
   * read passes `null` (a write-side screen is never filtered, decision 10).
   */
  clientFilter: ClientFilter,
  /**
   * Story 1-2b — one goods receipt's holds only. The GRN pins its own
   * warehouse, so a narrowed read sends `grnId` without the warehouse (a
   * notification may name a receipt of another warehouse than the active one).
   */
  grnId: string | null = null,
): (QcHoldsPage & { onCursor: (cursor: string | null) => void; reload: () => void }) | null {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const pending = clientFilter === CLIENT_PENDING;
  const clientId: string | null = clientFilter === CLIENT_PENDING ? null : clientFilter;
  const clientEpoch = useClientEpoch(clientId, pending);
  const [requested, setRequested] = useState<{
    tenantId: string;
    warehouseId: string | null;
    status: QcHoldStatusFilter;
    grnId: string | null;
    clientId: string | null; clientEpoch: number;
    cursor: string | null;
  } | null>(null);
  // The cursor is scoped to the scope it was asked for — a cursor paged on
  // one warehouse or status tab is a first-page request on another.
  const activeCursor =
    requested !== null &&
    requested.tenantId === tenantId &&
    requested.warehouseId === warehouseId &&
    requested.status === status &&
    requested.grnId === grnId &&
    requested.clientId === clientId && requested.clientEpoch === clientEpoch
      ? requested.cursor
      : null;
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<{
    tenantId: string;
    warehouseId: string | null;
    status: QcHoldStatusFilter;
    grnId: string | null;
    clientId: string | null;
    requested: string | null;
    page: QcHoldsPage;
  } | null>(null);

  useEffect(() => {
    if (tenantId === null || warehouseId === null || pending) return;
    let cancelled = false;
    (async () => {
      try {
        const base = grnId === null ? { warehouseId, status } : { status, grnId };
        const scope = clientId === null ? base : { ...base, clientId };
        const result = await fetchApiListQcHolds(
          tenantId,
          activeCursor === null ? scope : { ...scope, cursor: activeCursor },
        );
        if (cancelled) return;
        setPage({
          tenantId,
          warehouseId,
          status,
          grnId,
          clientId,
          requested: activeCursor,
          page: { items: result.items, nextCursor: result.nextCursor ?? null },
        });
      } catch {
        // Quiet chrome on failure — the render-time key check hides stale data.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, status, grnId, clientId, pending, activeCursor, revision]);

  const onCursor = useCallback(
    (cursor: string | null) => {
      if (tenantId === null || warehouseId === null) return;
      setRequested({ tenantId, warehouseId, status, grnId, clientId, clientEpoch, cursor });
    },
    [tenantId, warehouseId, status, grnId, clientId, clientEpoch],
  );
  const reload = useCallback(() => setRevision((r) => r + 1), []);

  if (
    tenantId === null ||
    warehouseId === null ||
    pending ||
    page === null ||
    page.tenantId !== tenantId ||
    page.warehouseId !== warehouseId ||
    page.status !== status ||
    page.grnId !== grnId ||
    page.clientId !== clientId ||
    page.requested !== activeCursor
  ) {
    return null;
  }
  return { ...page.page, onCursor, reload };
}

/**
 * The active warehouse's on-hand (sku, bin) scopes with stock (story 2.2's
 * read) as the QC hold form's scope choices — the full page chain behind
 * `fetchAllPages`, positive-quantity rows only. `reload` refetches the whole
 * chain (a just-held scope's units move into the QC bin, so its row drops
 * out of the picker).
 */
export function useStockScopes(
  warehouseId: string | null,
): { rows: readonly StockEntryDto[]; reload: () => void } | null {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [rows, setRows] = useState<{
    tenantId: string;
    warehouseId: string;
    rows: readonly StockEntryDto[];
  } | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (tenantId === null || warehouseId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const all = await fetchAllPages<StockEntryDto>(async (options) => {
          const page = await fetchApiListStock(tenantId, warehouseId, options);
          return { items: page.items, nextCursor: page.nextCursor ?? null };
        });
        if (cancelled) return;
        setRows({
          tenantId,
          warehouseId,
          rows: all.filter((row) => row.quantity > 0),
        });
      } catch {
        // Quiet chrome on failure — the render-time key check hides stale data.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, revision]);

  const reload = useCallback(() => setRevision((r) => r + 1), []);

  if (tenantId === null || warehouseId === null) return null;
  if (rows === null || rows.tenantId !== tenantId || rows.warehouseId !== warehouseId) return null;
  return { rows: rows.rows, reload };
}

/**
 * The active warehouse's bin id → code map (story 1.3's read) — the QC Holds
 * card names each hold's origin bin without a join per row. Zones chain their
 * own bin pages; both chains walk `fetchAllPages`.
 */
export function useBinCodeMap(warehouseId: string | null): Readonly<Record<string, string>> | null {
  const meta = useBinMetaMap(warehouseId);
  return useMemo(
    () => (meta === null ? null : Object.fromEntries(Object.entries(meta).map(([id, bin]) => [id, bin.code]))),
    [meta],
  );
}

/** One bin's code and system flag (story 2-4a — a system bin is told apart from a user bin with the same code). */
export interface BinMeta {
  readonly code: string;
  readonly systemOwned: boolean;
}

/**
 * The active warehouse's bin id → {code, systemOwned} map — the
 * `useBinCodeMap` read with the system flag kept (story 2-4a: the QC hold
 * picker excludes SYSTEM bins by code, never a user bin that shares one).
 */
export function useBinMetaMap(warehouseId: string | null): Readonly<Record<string, BinMeta>> | null {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [map, setMap] = useState<{ tenantId: string; warehouseId: string; map: Record<string, BinMeta> } | null>(
    null,
  );

  useEffect(() => {
    if (tenantId === null || warehouseId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const zones = await fetchAllPages<ZoneResponse>((options) =>
          fetchApiListZones(tenantId, warehouseId, options),
        );
        const binCode: Record<string, BinMeta> = {};
        await Promise.all(
          zones.map(async (zone) => {
            try {
              const bins = await fetchAllPages<BinResponse>((options) =>
                fetchApiListBins(tenantId, warehouseId, zone.id, options),
              );
              for (const bin of bins) binCode[bin.id] = { code: bin.code, systemOwned: bin.systemOwned === true };
            } catch {
              // A zone that fails to list leaves its bins showing "—".
            }
          }),
        );
        if (!cancelled) {
          setMap({ tenantId, warehouseId, map: binCode });
        }
      } catch {
        // Quiet chrome on failure.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId]);

  if (tenantId === null || warehouseId === null) return null;
  if (map === null || map.tenantId !== tenantId || map.warehouseId !== warehouseId) return null;
  return map.map;
}

/**
 * Story 2-1 — the PO create form's options, read PER PICKED CLIENT from the
 * server (never the tenant-wide maps, which stop at 1,000 rows): the whole
 * cursor chain at the routes' page ceiling (200), `fetchAllPages`' 20 hops
 * — 4,000 rows per client (PENDING). `ResourceState`, re-read on a client
 * change, on the module's change event and by `reload()` (which clears
 * first, so Retry visibly reloads).
 */
function useClientScopedOptions<T>(
  clientId: string,
  changedEvent: string,
  subject: string,
  load: (tenantId: string, clientId: string) => Promise<readonly T[]>,
): ResourceState<readonly T[]> & Reloadable {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    tenantId: string;
    clientId: string;
    revision: number;
    state: ResourceState<readonly T[]>;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(changedEvent, onChange);
    return () => window.removeEventListener(changedEvent, onChange);
  }, [changedEvent]);

  useEffect(() => {
    if (tenantId === null || clientId === '') return;
    let cancelled = false;
    (async () => {
      try {
        const items = await load(tenantId, clientId);
        if (!cancelled) setResult({ tenantId, clientId, revision, state: { state: 'ready', data: items } });
      } catch (error) {
        if (!cancelled) setResult({ tenantId, clientId, revision, state: { state: 'failed', reason: readReason(error, subject) } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, clientId, revision, load, subject]);

  const reload = useCallback(() => setRevision((r) => r + 1), []);
  // A result from another tenant, client or revision is stale at render
  // (loading) — `reload()` therefore shows loading until the re-read lands.
  const stale =
    tenantId === null ||
    clientId === '' ||
    result === null ||
    result.tenantId !== tenantId ||
    result.clientId !== clientId ||
    result.revision !== revision;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}

/** The partner list's and SKU list's `@Max(200)` page size. */
const OPTIONS_PAGE_LIMIT = 200;

async function loadLinkedVendors(tenantId: string, clientId: string): Promise<readonly PartnerDto[]> {
  const partners = await fetchAllPages((options) =>
    fetchApiListPartners(tenantId, { role: 'vendor', clientId, status: 'active', limit: OPTIONS_PAGE_LIMIT, ...options }),
  );
  // The server's `clientId` filter is an EXISTS over active links in any
  // role; the vendor rule (an active vendor link to THIS client) is applied
  // here, as the replenishment draft picker does.
  return sortedByCode(vendorsLinkedTo(partners, clientId));
}

async function loadClientSkus(tenantId: string, clientId: string): Promise<readonly SkuResponse[]> {
  return fetchAllPages((options) =>
    fetchApiListSkus(tenantId, { clientId, status: 'active', limit: OPTIONS_PAGE_LIMIT, ...options }),
  );
}

/** Story 2-1 — the vendors linked to `clientId` (active partner, vendor role, active vendor link), by code. */
export function usePoVendorOptions(clientId: string): ResourceState<readonly PartnerDto[]> & Reloadable {
  return useClientScopedOptions(clientId, PARTNERS_CHANGED_EVENT, 'the vendors', loadLinkedVendors);
}

/** Story 2-1 — `clientId`'s active SKUs (kits are removed by the form, through `useKits`). */
export function usePoSkuOptions(clientId: string): ResourceState<readonly SkuResponse[]> & Reloadable {
  return useClientScopedOptions(clientId, CATALOG_CHANGED_EVENT, 'the SKUs', loadClientSkus);
}
