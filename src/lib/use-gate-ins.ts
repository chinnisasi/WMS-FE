'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import {
  fetchApiGetGateIn,
  fetchApiListAsns,
  fetchApiListGateIns,
  fetchApiListPartners,
  fetchApiListPurchaseOrders,
} from '@/lib/api/client';
import type { AsnEntryDto, GateInDetailDto, GateInEntryDto, PartnerDto, PurchaseOrderDto } from '@/lib/api/generated';
import { INBOUND_CHANGED_EVENT } from '@/lib/asns';
import { readSession, subscribeSession } from '@/lib/auth';
import { fetchAllPages } from '@/lib/fetch-all-pages';
import { readReason } from '@/lib/outbound-orders';
import { PARTNERS_CHANGED_EVENT } from '@/lib/partners';
import { sortedByCode } from '@/lib/purchase-orders';
import type { Reloadable, ResourceState } from '@/lib/resource-state';

/**
 * Story 2-3a — the Gate-in tab's reads, each a `ResourceState` hook (guide
 * §1): the scope stamped into the result and filtered at render (never a
 * setState in an effect), `cancelled` in the cleanup, `reload()` clearing
 * first so Retry visibly reloads. None takes a client filter: a truck can
 * carry several clients (the tab shows `AllClientsNote`).
 */

function useTenantId(): string | null {
  return useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
}

export interface GateInsPage {
  readonly items: readonly GateInEntryDto[];
  readonly nextCursor: string | null;
}

/**
 * One warehouse's gate-ins, newest gated-in first, on `DataTable` Prev/Next.
 * Refetches on `INBOUND_CHANGED_EVENT` (every gate-in mutation fires it) and
 * on `reload()` (the Refresh button — a device unload appears on reload; there
 * is no polling). `reload()` also returns to page one and bumps `epoch`, which
 * the table's key joins (guide §1.11).
 */
export function useGateIns(
  warehouseId: string | null,
): ResourceState<GateInsPage> & Reloadable & { onCursor: (cursor: string | null) => void; epoch: number } {
  const tenantId = useTenantId();
  const [requested, setRequested] = useState<{ tenantId: string | null; warehouseId: string | null; cursor: string | null; epoch: number } | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [revision, setRevision] = useState(0);
  const activeCursor =
    requested !== null && requested.tenantId === tenantId && requested.warehouseId === warehouseId && requested.epoch === epoch
      ? requested.cursor
      : null;
  const [result, setResult] = useState<{
    tenantId: string;
    warehouseId: string;
    cursor: string | null;
    revision: number;
    epoch: number;
    state: ResourceState<GateInsPage>;
  } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(INBOUND_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(INBOUND_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || warehouseId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const page = await fetchApiListGateIns(tenantId, warehouseId, activeCursor === null ? undefined : { cursor: activeCursor });
        if (!cancelled) {
          setResult({
            tenantId,
            warehouseId,
            cursor: activeCursor,
            revision,
            epoch,
            state: { state: 'ready', data: { items: page.items, nextCursor: page.nextCursor ?? null } },
          });
        }
      } catch (error) {
        if (!cancelled) {
          setResult({ tenantId, warehouseId, cursor: activeCursor, revision, epoch, state: { state: 'failed', reason: readReason(error, 'the gate-ins') } });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, warehouseId, activeCursor, revision, epoch]);

  const onCursor = useCallback(
    (cursor: string | null) => setRequested({ tenantId, warehouseId, cursor, epoch }),
    [tenantId, warehouseId, epoch],
  );
  const reload = useCallback(() => {
    setRequested(null);
    setEpoch((e) => e + 1);
  }, []);
  // A result of another scope, page, revision or epoch is stale at render.
  // A revision bump (an inbound change) keeps the old rows on screen while
  // the re-read is in flight — the table does not blank on every write.
  const stale =
    tenantId === null ||
    warehouseId === null ||
    result === null ||
    result.tenantId !== tenantId ||
    result.warehouseId !== warehouseId ||
    result.cursor !== activeCursor ||
    result.epoch !== epoch;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), onCursor, reload, epoch };
}

/**
 * One gate-in's detail (its documents with PO/ASN codes and its receipts),
 * fetched when its row is expanded — `null` reads nothing. Re-read on an
 * inbound change, so an expanded row follows its own row actions.
 */
export function useGateInDetail(gateInId: string | null): ResourceState<GateInDetailDto> & Reloadable {
  const tenantId = useTenantId();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ tenantId: string; gateInId: string; revision: number; state: ResourceState<GateInDetailDto> } | null>(null);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(INBOUND_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(INBOUND_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || gateInId === null) return;
    let cancelled = false;
    (async () => {
      try {
        const { gateIn } = await fetchApiGetGateIn(tenantId, gateInId);
        if (!cancelled) setResult({ tenantId, gateInId, revision, state: { state: 'ready', data: gateIn } });
      } catch (error) {
        if (!cancelled) setResult({ tenantId, gateInId, revision, state: { state: 'failed', reason: readReason(error, 'the gate-in') } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, gateInId, revision]);

  const reload = useCallback(() => setRevision((r) => r + 1), []);
  const stale =
    tenantId === null || gateInId === null || result === null || result.tenantId !== tenantId || result.gateInId !== gateInId || result.revision !== revision;
  return { ...(stale ? ({ state: 'loading' } as const) : result.state), reload };
}

/** A list answer as `fetchAllPages` walks it (an absent cursor is the last page). */
function cursorPage<T>(page: { items: readonly T[]; nextCursor?: string | null }): { items: readonly T[]; nextCursor: string | null } {
  return { items: page.items, nextCursor: page.nextCursor ?? null };
}

/** The partner and list routes' `@Max(200)` page size. */
const OPTIONS_PAGE_LIMIT = 200;
/** The ASN list's `@Max(100)` page size. */
const ASN_PAGE_LIMIT = 100;

/**
 * A whole-chain options read (`fetchAllPages`' 20 hops), keyed by its scope
 * and re-read on `event` and by `reload()` (which shows loading until the
 * re-read lands).
 */
function useOptions<T>(
  scope: string | null,
  event: string,
  subject: string,
  load: (tenantId: string) => Promise<T>,
): ResourceState<T> & Reloadable {
  const tenantId = useTenantId();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; state: ResourceState<T> } | null>(null);
  const key = tenantId === null || scope === null ? null : `${tenantId}|${scope}|${revision}`;

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(event, onChange);
    return () => window.removeEventListener(event, onChange);
  }, [event]);

  useEffect(() => {
    if (tenantId === null || key === null) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await load(tenantId);
        if (!cancelled) setResult({ key, state: { state: 'ready', data } });
      } catch (error) {
        if (!cancelled) setResult({ key, state: { state: 'failed', reason: readReason(error, subject) } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, key, load, subject]);

  const reload = useCallback(() => setRevision((r) => r + 1), []);
  return { ...(result === null || result.key !== key ? ({ state: 'loading' } as const) : result.state), reload };
}

async function loadTransporters(tenantId: string): Promise<readonly PartnerDto[]> {
  const partners = await fetchAllPages((options) =>
    fetchApiListPartners(tenantId, { role: 'transporter', status: 'active', limit: OPTIONS_PAGE_LIMIT, ...options }),
  );
  return sortedByCode(partners);
}

/**
 * The active `transporter` partners (decision 4), by code — the Record /
 * Edit form's picker. Re-read on `PARTNERS_CHANGED_EVENT`, and by the form
 * after a transporter refusal.
 */
export function useTransporterOptions(): ResourceState<readonly PartnerDto[]> & Reloadable {
  return useOptions('transporters', PARTNERS_CHANGED_EVENT, 'the transporters', loadTransporters);
}

export interface GateInLinkSources {
  /** The warehouse's open POs, every client. */
  readonly pos: readonly PurchaseOrderDto[];
  /** The warehouse's announced and partially received ASNs, every client. */
  readonly asns: readonly AsnEntryDto[];
}

/**
 * The PO / ASN a document row may cover: the warehouse's open POs and its
 * announced or partially received ASNs, across ALL clients (a truck carries
 * several). Re-read on an inbound change.
 */
export function useGateInLinkSources(warehouseId: string | null): ResourceState<GateInLinkSources> & Reloadable {
  const load = useCallback(
    async (tenantId: string): Promise<GateInLinkSources> => {
      if (warehouseId === null) return { pos: [], asns: [] };
      const [pos, announced, partial] = await Promise.all([
        fetchAllPages<PurchaseOrderDto>((options) =>
          fetchApiListPurchaseOrders(tenantId, warehouseId, { status: 'open', limit: OPTIONS_PAGE_LIMIT, ...options }).then(cursorPage),
        ),
        fetchAllPages<AsnEntryDto>((options) =>
          fetchApiListAsns(tenantId, warehouseId, { status: 'announced', limit: ASN_PAGE_LIMIT, ...options }).then(cursorPage),
        ),
        fetchAllPages<AsnEntryDto>((options) =>
          fetchApiListAsns(tenantId, warehouseId, { status: 'partially_received', limit: ASN_PAGE_LIMIT, ...options }).then(cursorPage),
        ),
      ]);
      return { pos: sortedByCode(pos), asns: sortedByCode([...announced, ...partial]) };
    },
    [warehouseId],
  );
  return useOptions(warehouseId, INBOUND_CHANGED_EVENT, 'the open POs and ASNs', load);
}
