import type { BatchBinOnHandDto } from '@/lib/api/generated';
import { ApiProblem } from '@/lib/api/client';
import { warehouseDisplayLabel, type DrillWarehouse } from '@/lib/drill';
import { quantityLabel, type QuantityUom } from '@/lib/format-quantity';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import type { ResourceState } from '@/lib/resource-state';

/**
 * The Inventory screen's words and derivations (inventory-screen,
 * 2026-10-17) — pure, so every sentence the screen shows is pinned here
 * (`inventory.test.ts`) rather than left in JSX.
 */

/**
 * The system bins in words. The codes are the backend's own constants
 * (`wms-be src/modules/tenancy/receiving-bin.ts`: RECEIVING, QC-HOLD,
 * IN-TRANSIT, RETURNS, DAMAGED). Stock in them is real stock in the building, so the
 * rows are shown — labelled, never hidden (totals must agree with the ledger).
 */
export const SYSTEM_BIN_LABEL: Readonly<Record<string, string>> = {
  RECEIVING: 'Receiving (awaiting putaway)',
  'QC-HOLD': 'QC hold (not sellable)',
  RETURNS: 'Returns',
  'IN-TRANSIT': 'In transit',
  // Story 2-4a — units received damaged: on hand, not sellable, leave only by a write-off.
  DAMAGED: 'Damaged (not sellable)',
};

/**
 * A bin's word label, or null for an ordinary storage bin. Only a bin the
 * server flags `systemOwned` is labelled — a user bin that happens to be
 * coded like a system one gets none — and a system bin with a code this
 * build does not know reads "System bin (CODE)".
 */
export function systemBinLabel(code: string, systemOwned: boolean): string | null {
  if (!systemOwned) return null;
  return Object.prototype.hasOwnProperty.call(SYSTEM_BIN_LABEL, code)
    ? SYSTEM_BIN_LABEL[code]!
    : `System bin (${code})`;
}

/* ------------------------------------------------------------------ */
/* The search box — a code resolved to an id from the loaded maps       */
/* ------------------------------------------------------------------ */

/** One code the search can resolve: a bin of this warehouse or a SKU. */
export interface CodeEntry {
  readonly id: string;
  readonly code: string;
  /**
   * Story 1-1 — how the entry is named on screen when it differs from the
   * code: a SKU's `skuDisplayLabel` (`TSHIRT-M · ACME` once the tenant has
   * more than one client). Absent → the code.
   */
  readonly label?: string;
}

/** An entry's on-screen name. */
export function codeEntryLabel(entry: CodeEntry): string {
  return entry.label ?? entry.code;
}

export type CodeMap = ResourceState<readonly CodeEntry[]>;

export interface SearchAvailability {
  /** No search can be submitted (a map still loading, or both failed). */
  readonly disabled: boolean;
  /** The line under the box: loading, or which map failed — null when both are in. */
  readonly note: string | null;
  readonly placeholder: string;
}

export const LOADING_CODES = 'Loading codes…';

/**
 * Whether the box can search. While either map loads it is disabled
 * ("Loading codes…"); a failed map is named, and the box searches by the
 * other code only; both failed → disabled.
 */
export function searchAvailability(bins: CodeMap, skus: CodeMap): SearchAvailability {
  if (bins.state === 'loading' || skus.state === 'loading') {
    return { disabled: true, note: LOADING_CODES, placeholder: LOADING_CODES };
  }
  if (bins.state === 'failed' && skus.state === 'failed') {
    return {
      disabled: true,
      note: 'Bin and SKU codes not loaded — search is unavailable.',
      placeholder: 'Codes not loaded',
    };
  }
  if (bins.state === 'failed') {
    return { disabled: false, note: 'Bin codes not loaded — search by SKU code only.', placeholder: 'SKU code' };
  }
  if (skus.state === 'failed') {
    return { disabled: false, note: 'SKU codes not loaded — search by bin code only.', placeholder: 'Bin code' };
  }
  return { disabled: false, note: null, placeholder: 'Bin or SKU code' };
}

export type SearchResolution =
  | { readonly kind: 'blank' }
  | { readonly kind: 'bin'; readonly id: string; readonly code: string; readonly alsoSku: boolean }
  | { readonly kind: 'sku'; readonly id: string; readonly code: string; readonly label?: string }
  | { readonly kind: 'choice'; readonly code: string; readonly matches: readonly CodeEntry[] }
  | { readonly kind: 'miss'; readonly message: string }
  | { readonly kind: 'ambiguous'; readonly message: string };

/**
 * Exact code first, then a case-insensitive match. Codes are unique
 * case-SENSITIVELY, so `abc` and `ABC` can both exist — and since story 1-1
 * a SKU code is unique per CLIENT, so two brands can both own `TSHIRT-M`.
 * More than one match is never a silent pick of the first: the caller gets
 * every match (`readonly CodeEntry[]` of length ≥ 2).
 */
function findCode(map: CodeMap, query: string): CodeEntry | readonly CodeEntry[] | undefined {
  if (map.state !== 'ready') return undefined;
  const exact = map.data.filter((entry) => entry.code === query);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return exact;
  const upper = query.toUpperCase();
  const matches = map.data.filter((entry) => entry.code.toUpperCase() === upper);
  if (matches.length > 1) return matches;
  return matches[0];
}

function isMany(found: CodeEntry | readonly CodeEntry[] | undefined): found is readonly CodeEntry[] {
  return Array.isArray(found);
}

/** The SKU arm a picked entry applies (the chooser's buttons, or a single match). */
export function skuResolution(entry: CodeEntry): Extract<SearchResolution, { kind: 'sku' }> {
  return entry.label === undefined
    ? { kind: 'sku', id: entry.id, code: entry.code }
    : { kind: 'sku', id: entry.id, code: entry.code, label: entry.label };
}

/**
 * A typed code → the bin or SKU it names. A code that is both a bin and a
 * SKU picks the bin (and says so — `alsoSku`). A miss never claims the code
 * is absent from the warehouse: the maps can be truncated (`fetchAllPages`
 * stops at 20 pages), so it says only that nothing loaded matched — and, when
 * a map failed, which one could not be searched.
 */
export function resolveSearch(query: string, bins: CodeMap, skus: CodeMap): SearchResolution {
  const code = query.trim();
  if (code === '') return { kind: 'blank' };
  const bin = findCode(bins, code);
  const sku = findCode(skus, code);
  // A bin code is unique per warehouse case-sensitively: case twins stay
  // "type the exact code".
  if (isMany(bin)) return { kind: 'ambiguous', message: `More than one bin matches ${code} — type the exact code.` };
  if (bin !== undefined) return { kind: 'bin', id: bin.id, code: bin.code, alsoSku: sku !== undefined };
  // Several SKUs (two clients' `TSHIRT-M`, or case twins): the viewer picks.
  if (isMany(sku)) return { kind: 'choice', code, matches: sku };
  if (sku !== undefined) return skuResolution(sku);
  if (bins.state === 'failed') return { kind: 'miss', message: `No SKU with code ${code} found (bin codes are not loaded).` };
  if (skus.state === 'failed') return { kind: 'miss', message: `No bin with code ${code} found (SKU codes are not loaded).` };
  return { kind: 'miss', message: `No bin or SKU with code ${code} found.` };
}

/** The line above a chooser: several SKUs answer to the typed code. */
export function choicePrompt(resolution: Extract<SearchResolution, { kind: 'choice' }>): string {
  return `${resolution.matches.length} SKUs match ${resolution.code} — pick one.`;
}

/**
 * The line above a resolved search's rows. A SKU is named with its client
 * (`TSHIRT-M · ACME`) once the tenant has more than one — the code alone
 * no longer says which SKU the rows are.
 */
export function searchSummary(resolution: Extract<SearchResolution, { kind: 'bin' | 'sku' }>): string {
  if (resolution.kind === 'sku') return `Where SKU ${resolution.label ?? resolution.code} is — one row per bin.`;
  return resolution.alsoSku
    ? `${resolution.code} is both a bin code and a SKU code — showing the bin.`
    : `What is in bin ${resolution.code}.`;
}

/** A SKU search's total across every bin, at the SKU's precision. */
export function totalAcrossBins(rows: readonly { readonly quantity: number }[], sku: QuantityUom | null): string {
  // Base-UoM values at ≤ 3 places: summing through milli-units keeps the
  // float dust out of the total (2.1 + 0.2 must not print 2.3000000000000003).
  const milli = rows.reduce((sum, row) => sum + Math.round(row.quantity * 1000), 0);
  return quantityLabel(milli / 1000, sku);
}

/* ------------------------------------------------------------------ */
/* Batches                                                             */
/* ------------------------------------------------------------------ */

/**
 * The batch lifecycle statuses in words — the backend's `batches_status_check`
 * (`active`, `blocked`, migration 0010). An unknown value falls back to its raw text.
 */
const BATCH_STATUS_LABEL: Readonly<Record<string, string>> = {
  active: 'Active',
  blocked: 'Blocked',
};

export function batchStatusLabel(status: string): string {
  return Object.prototype.hasOwnProperty.call(BATCH_STATUS_LABEL, status) ? BATCH_STATUS_LABEL[status]! : status;
}

/** A batch's quantity here — a zero reads "0 in this warehouse" (the row is greyed). */
export function batchQuantityLabel(quantity: number, sku: QuantityUom | null): string {
  return quantity === 0 ? '0 in this warehouse' : quantityLabel(quantity, sku);
}

/**
 * A batch's bins split by warehouse. The detail read is tenant-wide; this
 * warehouse's bins are listed by code, the rest are counted per warehouse
 * (their bin codes are not loaded — the bin map is this warehouse's).
 * Zero rows are dropped on both sides.
 */
export function splitBatchBins(
  bins: readonly BatchBinOnHandDto[],
  warehouseId: string,
): { readonly here: readonly BatchBinOnHandDto[]; readonly elsewhere: readonly { warehouseId: string; bins: number }[] } {
  const here: BatchBinOnHandDto[] = [];
  const counts = new Map<string, number>();
  for (const bin of bins) {
    if (bin.quantity <= 0) continue;
    if (bin.warehouseId === warehouseId) here.push(bin);
    else counts.set(bin.warehouseId, (counts.get(bin.warehouseId) ?? 0) + 1);
  }
  return { here, elsewhere: [...counts].map(([id, count]) => ({ warehouseId: id, bins: count })) };
}

/** "3 more bins in other warehouses: BLR-02 Mysore (2), DEL-01 Delhi (1)" — null when none. */
export function otherWarehousesLabel(
  elsewhere: readonly { warehouseId: string; bins: number }[],
  warehouses: readonly DrillWarehouse[] | null,
): string | null {
  if (elsewhere.length === 0) return null;
  const total = elsewhere.reduce((sum, entry) => sum + entry.bins, 0);
  const named = elsewhere.map((entry) => `${warehouseDisplayLabel(warehouses, entry.warehouseId)} (${entry.bins})`);
  return `${total} more ${total === 1 ? 'bin' : 'bins'} in other warehouses: ${named.join(', ')}`;
}

export const BATCH_NOT_FOUND_REASON = 'Batch not found — it may have been removed.';

/** The heading over a failed batch detail: "Batch not found" only for a 404, else "Batch unavailable". */
export function batchFailureWord(reason: string): string {
  return reason === BATCH_NOT_FOUND_REASON ? 'Batch not found' : 'Batch unavailable';
}

/** The batch picker and the detail read's refusals, branched on `code`. */
export function batchDetailReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'not-found':
        return BATCH_NOT_FOUND_REASON;
      case 'permission-denied':
        return 'That data belongs to another tenant — sign in again.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      default:
        return error.detail ?? `Could not load the batch (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/** A SKU walk that hit `MAX_SKU_WALK_PAGES` before the last page. */
export const TOTAL_CAPPED = 'Total unavailable — too many bins to total here';
/** A SKU walk whose later page failed. */
export const TOTAL_PAGE_FAILED = 'Total unavailable — a page failed to load';

export const NOT_BATCH_TRACKED = "This SKU isn't batch-tracked.";
