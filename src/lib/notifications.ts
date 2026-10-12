import type { NotificationListResponse } from '@/lib/api/generated';
import { quantityLabel, type QuantityUom } from '@/lib/format-quantity';

/**
 * Story 9-2 — the notification panel's copy and links, pure so each sentence
 * and each href is pinned by `notifications.test.ts`.
 *
 * The frontend mirrors NO routing table: which entries a member sees is the
 * server's decision (it routes by the capability that acts), so an empty
 * list is simply what the API answered.
 */

/** One entry — a discriminated union on `sourceType`, each arm with its own summary. */
export type NotificationEntry = NotificationListResponse['items'][number];

export const NOTIFICATIONS_PANEL_LIMIT = 10;

/** A SKU as the copy needs it: the code, and the unit for a quantity. */
export interface NotificationSku extends QuantityUom {
  readonly code: string;
}

export interface NotificationLookups {
  /** The SKU by id, or null while the catalog is loading / for an unknown id. */
  readonly sku: (skuId: string) => NotificationSku | null;
  /** The warehouse's display label (`warehouseDisplayLabel`). */
  readonly warehouse: (warehouseId: string) => string;
}

/** The category label — what kind of thing needs attention. */
export function notificationCategory(entry: NotificationEntry): string {
  switch (entry.sourceType) {
    case 'stock-adjustment':
      return 'Adjustment awaiting approval';
    case 'count-variance':
      return 'Count variance over threshold';
    case 'over-receipt':
      return 'Over-receipt awaiting approval';
    case 'rejected-op':
      return 'Device op rejected';
    case 'reorder-breach':
      return 'Reorder point breached';
    case 'batch-alert':
      return entry.summary.kind === 'aged' ? 'Aged batch' : 'Batch nearing expiry';
    case 'qc-hold':
      return 'QC hold placed';
    case 'channel-sync':
      return 'Channel sync failing';
  }
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function skuCode(lookups: NotificationLookups, skuId: string): string {
  return lookups.sku(skuId)?.code ?? `SKU ${shortId(skuId)}`;
}

function quantity(lookups: NotificationLookups, skuId: string, value: number): string {
  const sku = lookups.sku(skuId);
  return quantityLabel(value, sku === null ? null : { uom: sku.uom, uomPrecision: sku.uomPrecision });
}

function signed(lookups: NotificationLookups, skuId: string, value: number): string {
  const magnitude = quantity(lookups, skuId, Math.abs(value));
  return value < 0 ? `−${magnitude}` : `+${magnitude}`;
}

const IST_DATE = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

function istDateLabel(iso: string): string {
  const parts = IST_DATE.formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('day')} ${part('month')} ${part('year')}`;
}

/** The one-line description from the entry's summary. */
export function notificationDescription(entry: NotificationEntry, lookups: NotificationLookups): string {
  const where = entry.warehouseId === null ? [] : [lookups.warehouse(entry.warehouseId)];
  switch (entry.sourceType) {
    case 'stock-adjustment': {
      const s = entry.summary;
      return [skuCode(lookups, s.skuId), signed(lookups, s.skuId, s.quantityDelta), s.reasonCode, ...where].join(' · ');
    }
    case 'count-variance': {
      const s = entry.summary;
      return [skuCode(lookups, s.skuId), `counted ${signed(lookups, s.skuId, s.delta)}`, ...where].join(' · ');
    }
    case 'over-receipt': {
      const s = entry.summary;
      return [s.grnCode, skuCode(lookups, s.skuId), `${quantity(lookups, s.skuId, s.excessQty)} over`, ...where].join(' · ');
    }
    case 'rejected-op': {
      const s = entry.summary;
      return `${s.opType} · ${s.problemCode}`;
    }
    case 'reorder-breach': {
      const s = entry.summary;
      return [
        skuCode(lookups, s.skuId),
        `ATP ${quantity(lookups, s.skuId, s.atpQty)} below ${quantity(lookups, s.skuId, s.pointQty)}`,
        ...where,
      ].join(' · ');
    }
    case 'batch-alert': {
      const s = entry.summary;
      const detail =
        s.kind === 'aged'
          ? `${s.ageDays ?? '?'} days old`
          : s.expiryDate === undefined
            ? 'nearing expiry'
            : `expires ${istDateLabel(s.expiryDate)}`;
      return [skuCode(lookups, s.skuId), `batch ${s.batchCode}`, detail, ...where].join(' · ');
    }
    case 'qc-hold': {
      const s = entry.summary;
      return [skuCode(lookups, s.skuId), s.reason, ...where].join(' · ');
    }
    case 'channel-sync':
      return `Connection ${shortId(entry.summary.connectionId)} — deliveries are failing`;
  }
}

const RESOLUTION_WORD: Readonly<Record<string, string>> = {
  'policy-removed': 'policy removed',
};

/** `null` while open; `Resolved · approved` once the source cleared. */
export function notificationResolvedLabel(entry: NotificationEntry): string | null {
  if (entry.resolvedAt === null) return null;
  const word = entry.resolution === null ? null : (RESOLUTION_WORD[entry.resolution] ?? entry.resolution);
  return word === null ? 'Resolved' : `Resolved · ${word}`;
}

/**
 * Where an entry clicks through to. Over-receipts and batch alerts land on
 * their queue drilled (9-1b's `parseDrill` contract — every link here
 * parses): an OPEN over-receipt narrows to the pending ones, a resolved one
 * to its warehouse across statuses. The rest open their screen.
 */
export function notificationHref(entry: NotificationEntry): string {
  switch (entry.sourceType) {
    case 'over-receipt': {
      const params = new URLSearchParams({ list: 'over-receipts' });
      if (entry.warehouseId !== null) params.set('warehouseId', entry.warehouseId);
      if (entry.resolvedAt === null) params.set('status', 'pending');
      return `/conflicts?${params.toString()}`;
    }
    case 'batch-alert': {
      const params = new URLSearchParams({ list: 'batch-alerts' });
      if (entry.warehouseId !== null) params.set('warehouseId', entry.warehouseId);
      params.set('kind', entry.summary.kind);
      return `/replenishment?${params.toString()}`;
    }
    case 'stock-adjustment':
    case 'count-variance':
    case 'rejected-op':
      return '/conflicts';
    case 'reorder-breach':
      return '/replenishment';
    case 'qc-hold':
      return '/inbound';
    case 'channel-sync':
      return '/channels';
  }
}

/** Relative age — `just now`, `5 min ago`, `3 h ago`, `2 d ago` (a future stamp reads `just now`). */
export function relativeTimeLabel(iso: string, nowMs: number): string {
  const seconds = Math.floor((nowMs - Date.parse(iso)) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

const IST_MINUTES = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** The absolute instant on the IST clock — the relative label's title. */
export function istTimeLabel(iso: string): string {
  const parts = IST_MINUTES.formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('day')} ${part('month')} ${part('year')}, ${part('hour')}:${part('minute')} IST`;
}

/** The bell trigger's accessible name — the dot is aria-hidden, so the name carries it. */
export function bellLabel(hasNew: boolean): string {
  return hasNew ? 'Notifications, new' : 'Notifications';
}

/**
 * The empty state — shown exactly when the API answered an empty page (a
 * role that can act on no source gets one; the client never decides it).
 */
export const NOTIFICATIONS_EMPTY = 'Nothing needs your attention.';
