'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiListBins, fetchApiListZones } from '@/lib/api/client';
import type { BinResponse, ZoneResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { fetchAllPages } from '@/lib/fetch-all-pages';

/**
 * The bin id → code maps of SEVERAL warehouses at once (story 5-5).
 *
 * The Conflicts & Reviews queues are tenant-wide lists — the variance rows
 * and adjustment pendings carry their OWN warehouseId and binId, so a single
 * warehouse's `useBinCodeMap` (the QC-holds pattern) cannot label them. Each
 * page's distinct warehouse set is walked the same way that hook walks one:
 * the warehouse's zones, then each zone's bin pages, bounded at the
 * `fetchAllPages` hop cap, with a zone-level catch so one unreadable zone
 * leaves its bins unlabelled rather than failing the whole join.
 *
 * This is enrichment, like the excursion queue's hold join — a failed walk
 * renders "(unknown bin)" instead of failing the queue, and `null` means
 * "not landed yet", never "no bins exist".
 */

export type BinCodeMaps = Readonly<Record<string, Readonly<Record<string, string>>>>;

export function useBinCodeMaps(warehouseIds: readonly string[]): BinCodeMaps | null {
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  // Stable key: sorted, deduped, joined. The caller's array identity changes
  // every render; the ids are what the fetch actually depends on.
  const key = [...new Set(warehouseIds)].sort().join(',');
  const [maps, setMaps] = useState<{ tenantId: string; key: string; maps: BinCodeMaps } | null>(
    null,
  );

  useEffect(() => {
    if (tenantId === null || key === '') return;
    let cancelled = false;
    (async () => {
      try {
        const forTenant = tenantId;
        const ids = key.split(',');
        const walked: Record<string, Record<string, string>> = {};
        await Promise.all(
          ids.map(async (warehouseId) => {
            try {
              const zones = await fetchAllPages<ZoneResponse>((options) =>
                fetchApiListZones(forTenant, warehouseId, options),
              );
              const binCode: Record<string, string> = {};
              await Promise.all(
                zones.map(async (zone) => {
                  try {
                    const bins = await fetchAllPages<BinResponse>((options) =>
                      fetchApiListBins(forTenant, warehouseId, zone.id, options),
                    );
                    for (const bin of bins) binCode[bin.id] = bin.code;
                  } catch {
                    // A zone that fails to list leaves its bins showing
                    // "(unknown bin)" — enrichment, never a failed queue.
                  }
                }),
              );
              walked[warehouseId] = binCode;
            } catch {
              // A warehouse that fails to leave unlabelled bins, like above.
              walked[warehouseId] = {};
            }
          }),
        );
        if (!cancelled) setMaps({ tenantId: forTenant, key, maps: walked });
      } catch {
        // Quiet chrome on failure — the render-time key check hides stale data.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, key]);

  if (tenantId === null || maps === null || maps.tenantId !== tenantId || maps.key !== key) {
    return null;
  }
  return maps.maps;
}

/** A bin's card label: the joined code, or the honest join-failed fallback. */
export function binCodeLabel(
  maps: BinCodeMaps | null,
  warehouseId: string,
  binId: string,
): string | null {
  const map = maps?.[warehouseId];
  if (map === undefined) return null;
  return map[binId] ?? null;
}