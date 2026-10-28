'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiDockWindow, fetchApiGetDockAppointment, fetchApiGetDockSchedule, fetchApiListDockDoors } from '@/lib/api/client';
import type { DockAppointmentDto, DockDoorDto, DockScheduleDto, DockWindowResponse } from '@/lib/api/generated';
import { INBOUND_CHANGED_EVENT } from '@/lib/asns';
import { readSession, subscribeSession } from '@/lib/auth';
import { readReason } from '@/lib/outbound-orders';
import type { Reloadable, ResourceState } from '@/lib/resource-state';

/**
 * Story 2-3b — the dock reads, each a `ResourceState` hook (guide §1): the
 * scope stamped into the result and filtered at render (never a setState in
 * an effect), `cancelled` in the cleanup. Every dock write — and every
 * gate-in write, which can link or release an appointment — fires
 * `notifyInboundChanged()` (one event per module: the dock is inbound's), so
 * each read re-reads on `INBOUND_CHANGED_EVENT`.
 *
 * A re-read of the SAME scope (an inbound change, Refresh) keeps the last
 * good data on screen with `refreshing: true` ("Refreshing…" — never a blank
 * calendar); a scope change (warehouse, window, appointment) is a cold load.
 * A failed read's Retry is a new load. None takes a client filter: a truck
 * can carry several clients (`AllClientsNote`).
 */

function useTenantId(): string | null {
  return useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
}

export type RefreshingState<T> = ResourceState<T> & Reloadable & { readonly refreshing: boolean };

function useScopedRead<T>(scope: string | null, subject: string, load: (tenantId: string) => Promise<T>): RefreshingState<T> {
  const tenantId = useTenantId();
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; revision: number; state: ResourceState<T> } | null>(null);
  const key = tenantId === null || scope === null ? null : `${tenantId}|${scope}`;

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(INBOUND_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(INBOUND_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null || key === null) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await load(tenantId);
        if (!cancelled) setResult({ key, revision, state: { state: 'ready', data } });
      } catch (error) {
        if (!cancelled) setResult({ key, revision, state: { state: 'failed', reason: readReason(error, subject) } });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, key, revision, load, subject]);

  const reload = useCallback(() => setRevision((r) => r + 1), []);
  if (key === null || result === null || result.key !== key) return { state: 'loading', reload, refreshing: false };
  if (result.revision === revision) return { ...result.state, reload, refreshing: false };
  // The same scope re-reading: keep the last good data; a failure retries as a load.
  if (result.state.state === 'ready') return { ...result.state, reload, refreshing: true };
  return { state: 'loading', reload, refreshing: false };
}

/**
 * The dock calendar of a window (`from`–`to`, inclusive IST dates, ≤ 7
 * days): the schedule, the doors, the appointments and the exact summary.
 * `window` null reads nothing.
 */
export function useDockWindow(
  warehouseId: string | null,
  window: { from: string; to: string } | null,
  includeCancelled: boolean,
): RefreshingState<DockWindowResponse> {
  const scope = warehouseId === null || window === null ? null : `window|${warehouseId}|${window.from}|${window.to}|${includeCancelled ? 1 : 0}`;
  const from = window?.from ?? null;
  const to = window?.to ?? null;
  const load = useCallback(
    (tenantId: string) => fetchApiDockWindow(tenantId, { warehouseId: warehouseId ?? '', from: from ?? '', to: to ?? '', includeCancelled }),
    [warehouseId, from, to, includeCancelled],
  );
  return useScopedRead(scope, 'the dock schedule', load);
}

/** One appointment (the drawer, `?open=`); null reads nothing. */
export function useDockAppointment(appointmentId: string | null): RefreshingState<DockAppointmentDto> {
  const load = useCallback(
    async (tenantId: string) => (await fetchApiGetDockAppointment(tenantId, appointmentId ?? '')).appointment,
    [appointmentId],
  );
  return useScopedRead(appointmentId === null ? null : `appointment|${appointmentId}`, 'the appointment', load);
}

/** Every dock door of a warehouse, active first then by code. */
export function useDockDoors(warehouseId: string | null): RefreshingState<readonly DockDoorDto[]> {
  const load = useCallback(async (tenantId: string) => (await fetchApiListDockDoors(tenantId, warehouseId ?? '')).items, [warehouseId]);
  return useScopedRead(warehouseId === null ? null : `doors|${warehouseId}`, 'the dock doors', load);
}

/** The warehouse's dock schedule (`configured: false` = the defaults). */
export function useDockScheduleSetting(warehouseId: string | null): RefreshingState<DockScheduleDto> {
  const load = useCallback(async (tenantId: string) => (await fetchApiGetDockSchedule(tenantId, warehouseId ?? '')).schedule, [warehouseId]);
  return useScopedRead(warehouseId === null ? null : `schedule|${warehouseId}`, 'the dock schedule', load);
}
