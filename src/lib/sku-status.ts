/**
 * Story 1-4b — SKU deactivation on the web: the status label, the reason
 * parse, the inactive marker, the inactive-aware picker filters and the
 * `sku-inactive` refusal wording every surface shares. Pure helpers, pinned
 * by `sku-status.test.ts`. Dependency-light (no reason-mapper imports), so
 * every reason mapper — `createReason` included — can import it; the status
 * route's own mapper is `skuStatusReason` in `sku-status-reason.ts`.
 *
 * An inactive SKU takes no new POs, ASNs, kits or channel mappings; an order
 * line for it is accepted only when stock covers it in full (it sells down,
 * never backorders); its channels publish 0. Every existing document, list
 * and stock read still shows it.
 */
import { ApiProblem } from '@/lib/api/client';
import type { SkuResponse } from '@/lib/api/generated';

/** The server's limit, in code points (decision 14). */
export const MAX_SKU_INACTIVE_REASON_LENGTH = 500;

type StatusOf = Pick<SkuResponse, 'status' | 'inactiveReason'>;

/** The Status column: "Active", "Inactive", "Inactive — {reason}". */
export function skuStatusLabel(sku: StatusOf): string {
  if (sku.status !== 'inactive') return 'Active';
  return sku.inactiveReason === null ? 'Inactive' : `Inactive — ${sku.inactiveReason}`;
}

/** Whether the SKU is inactive (an unknown or absent status reads active). */
export function isSkuInactive(sku: { readonly status?: string | null } | undefined): boolean {
  return sku?.status === 'inactive';
}

/**
 * The one inactive marker (mapping rows, the suggested-PO card, ASN detail
 * lines): the marker words for an inactive SKU, null for an active one.
 * `context` picks the clause that says what the inactive SKU still does.
 */
export function skuInactiveMarker(
  sku: { readonly status?: string | null } | undefined,
  context: 'mapping' | 'document' = 'document',
): string | null {
  if (!isSkuInactive(sku)) return null;
  return context === 'mapping' ? 'Inactive — publishes 0' : 'Inactive';
}

/** The deactivation reason field → the wire value (blank = none; ≤ 500 code points). */
export function parseSkuInactiveReason(text: string): { reason: string | null; problem: string | null } {
  const trimmed = text.trim();
  if (trimmed === '') return { reason: null, problem: null };
  if ([...trimmed].length > MAX_SKU_INACTIVE_REASON_LENGTH) {
    return { reason: null, problem: `The reason is at most ${MAX_SKU_INACTIVE_REASON_LENGTH} characters.` };
  }
  return { reason: trimmed, problem: null };
}

/** The deactivate panel's copy (decisions 1, 3 and 11). */
export const SKU_DEACTIVATE_COPY: readonly string[] = [
  'New purchase orders, ASNs and kits refuse it.',
  'Orders sell down existing stock only — an order line is accepted only when stock covers it in full, never backordered.',
  'Its channels show 0 (mappings are kept).',
  "Clear the SKU's channel buffers so those buffered units can sell by hand.",
  'Lines already backordered for it will not fill.',
];

/** The order-entry option label (decision 10): an inactive SKU stays, labelled. */
export function orderSkuOptionLabel(sku: Pick<SkuResponse, 'code' | 'status'>, base: string = sku.code): string {
  return isSkuInactive(sku) ? `${base} — inactive, sells existing stock only` : base;
}

/**
 * The document pickers (ASN create, kit compose, new mapping rows): inactive
 * SKUs drop out, except the ones already on the document (`keep` — an ASN
 * amend's existing lines, a kit PUT's stored components, a stored mapping).
 */
export function withoutInactive<T extends { id: string; status?: string | null }>(
  options: readonly T[],
  keep: ReadonlySet<string> = new Set(),
): readonly T[] {
  return options.filter((option) => !isSkuInactive(option) || keep.has(option.id));
}

/** The codes a `sku-inactive` refusal names (`extensions.skuCodes`), else []. */
export function inactiveSkuCodes(error: ApiProblem): string[] {
  const codes = error.extensions.skuCodes;
  return Array.isArray(codes) ? codes.filter((code): code is string => typeof code === 'string') : [];
}

/**
 * The shared `sku-inactive` sentence for a document that refuses an inactive
 * SKU (`subject` names what it cannot take — "a new ASN", "a new kit"…).
 */
export function skuInactiveSentence(error: ApiProblem, subject: string): string {
  const codes = inactiveSkuCodes(error);
  const named = codes.length === 0 ? 'A SKU' : `${codes.length === 1 ? 'SKU' : 'SKUs'} ${codes.join(', ')}`;
  return `${named} ${codes.length > 1 ? 'are' : 'is'} inactive — an inactive SKU cannot go on ${subject}. Reactivate it in Settings → SKUs first.`;
}

