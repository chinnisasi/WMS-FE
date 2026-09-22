import { ApiProblem } from '@/lib/api/client';
import type { KitResponse } from '@/lib/api/generated';
import { quantityLabel, parseQuantityInput, type QuantityUom } from '@/lib/format-quantity';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';

/**
 * Pure copy, parse and derivation for the SKU table's kit editor (story 11-6)
 * — extracted from the component because every sentence of copy or
 * derivation lives in `src/lib/` and is tested there.
 *
 * Kit quantities are entered, sent and displayed in the component's base UoM
 * as decimals — never raw milli. The API takes decimals and returns them
 * (`KitComponentDto.quantity` / `KitComponentResponse.qty`), so no conversion
 * happens in this app at all: the boundary is the server's.
 */

export interface ParsedKitComponents {
  readonly components: readonly { skuId: string; quantity: number }[];
  /** Non-null when the body cannot be sent — nothing is requested. */
  readonly problem: string | null;
}

/**
 * The kit editor's component rows → the `PutKitDto` body. Shape only: every
 * row names a SKU and a positive decimal quantity in that component's base
 * UoM (`parseQuantityInput` is the one decimal-literal grammar — never a bare
 * `Number()`), and the BOM is a SET, so a component named twice is refused
 * here naming it — a guaranteed 409 `duplicate-kit-component` the client can
 * cheaply avoid. The empty composition is a guaranteed 400
 * `empty-kit-composition`. Everything needing state (stock, kit-of-kit,
 * existence) stays the server's refusal.
 */
export function parseKitComponents(
  draft: readonly { readonly skuId: string; readonly quantity: string }[],
): ParsedKitComponents {
  const filled = draft.filter((row) => row.skuId !== '' || row.quantity.trim() !== '');
  if (filled.length === 0) {
    return { components: [], problem: 'A kit carries at least one component — pick a SKU and a quantity.' };
  }
  const components: { skuId: string; quantity: number }[] = [];
  const seen = new Set<string>();
  for (const row of filled) {
    if (row.skuId === '') {
      return { components: [], problem: 'Every component row needs a SKU.' };
    }
    const quantity = parseQuantityInput(row.quantity);
    if (quantity === null || quantity <= 0) {
      return { components: [], problem: 'Every component quantity is a decimal greater than zero.' };
    }
    if (seen.has(row.skuId)) {
      return {
        components: [],
        problem: `The same component SKU is named twice — the BOM is a set, not a list.`,
      };
    }
    seen.add(row.skuId);
    components.push({ skuId: row.skuId, quantity });
  }
  return { components, problem: null };
}

/**
 * Kit create/edit failures — all seven command-side arms the spec names,
 * branched on the machine-readable problem `code`, plus the house set.
 */
export function kitReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'kit-already-composed':
        return (
          error.detail ??
          'This SKU already carries a composition — edit its kit instead of creating one.'
        );
      case 'kit-sku-holds-stock':
        return (
          error.detail ??
          'This SKU already holds stock — a kit never holds stock, so ship it out before composing it.'
        );
      case 'kit-component-is-kit':
        return error.detail ?? 'A named component is itself a kit — a kit’s BOM is flat.';
      case 'kit-self-reference':
        return 'A kit cannot name itself as a component.';
      case 'duplicate-kit-component':
        return error.detail ?? 'The same component SKU is named twice — the BOM is a set.';
      case 'kit-component-not-found':
        return error.detail ?? 'A component SKU no longer exists — refresh the page.';
      case 'empty-kit-composition':
        return 'A kit carries at least one component.';
      case 'not-found':
        return 'That SKU no longer exists — refresh the page.';
      case 'role-denied':
        return 'Your role cannot edit the catalog.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the component quantities and try again.';
      default:
        return error.detail ?? `Kit not saved (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/** The SKU-table kit marker: `Kit · 2 components`, or `—` on a plain SKU. */
export function kitMarkerLabel(kit: KitResponse | undefined): string {
  if (kit === undefined) return '—';
  const n = kit.components.length;
  return `Kit · ${n} ${n === 1 ? 'component' : 'components'}`;
}

/**
 * A kit's BOM as the kit editor's prefill sentence and the marker's detail:
 * one component per phrase, quantity at the component's own unit precision
 * (`pad: 2 each · tape: 1 box`). A component SKU that cannot resolve falls
 * back to the unit-agnostic "`N` units" rather than guessing a precision.
 */
export function kitBomLabel(
  kit: KitResponse,
  skuOf: (skuId: string) => QuantityUom | undefined,
): string {
  return kit.components
    .map((component) => `${component.code}: ${quantityLabel(component.qty, skuOf(component.skuId) ?? null)}`)
    .join(' · ');
}