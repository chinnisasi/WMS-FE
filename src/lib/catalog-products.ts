import { ApiProblem } from '@/lib/api/client';
import { UNREACHABLE_REASON, verbatim } from '@/lib/outbound-orders';

/**
 * Pure copy and derivation for the Settings products card (story 11-6) —
 * extracted from the component because every sentence of copy or derivation
 * lives in `src/lib/` and is tested there. The card itself renders these.
 */

export const MAX_PRODUCT_AXES = 3;

export interface ParsedProductAxes {
  readonly axes: readonly string[];
  /** Non-null when the form cannot be sent — nothing is requested. */
  readonly problem: string | null;
}

/**
 * The comma-separated axes field → the wire `axes` array: trimmed, empties
 * dropped, 1–3 required (the backend's `@ArrayMinSize(1)` / `@ArrayMaxSize(3)`
 * on `CreateProductDto`). Anything the backend would only answer 400 to is
 * refused here first; the axis vocabulary itself (short names) stays the
 * server's to judge — an over-long axis name is SENT.
 */
export function parseProductAxes(raw: string): ParsedProductAxes {
  const axes = raw
    .split(',')
    .map((axis) => axis.trim())
    .filter((axis) => axis !== '');
  if (axes.length === 0) {
    return { axes: [], problem: 'Declare at least one variant axis — e.g. size, colour.' };
  }
  if (axes.length > MAX_PRODUCT_AXES) {
    return { axes: [], problem: `A product declares at most ${MAX_PRODUCT_AXES} axes.` };
  }
  return { axes, problem: null };
}

/** The products-table axes cell: `size · colour`. */
export function productAxesLabel(axes: readonly string[]): string {
  return axes.join(' · ');
}

/**
 * One variant's axis values, as the matrix states them: `size: M · colour:
 * Red`, keyed by the product's declared axes in declared order. A value the
 * payload somehow lacks reads `—` rather than being hidden — the pairing
 * CHECK makes this unreachable, and an honest dash beats a silent gap.
 */
export function variantValuesLabel(
  values: Record<string, unknown> | null,
  axes: readonly string[],
): string {
  return axes
    .map((axis) => {
      const value = values === null ? undefined : values[axis];
      return `${axis}: ${value === undefined || value === null || value === '' ? '—' : String(value)}`;
    })
    .join(' · ');
}

/**
 * Product create/edit failures, branching on the machine-readable problem
 * `code` — same contract as every other mapper. A duplicate name is named in
 * the problem's detail; an axes edit under attached variants is refused by a
 * code this client can explain, so it does.
 */
export function productReason(error: unknown, action: 'created' | 'updated'): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'duplicate-product-name':
        return error.detail ?? 'A product with this name already exists in this tenant.';
      case 'product-has-variants':
        return (
          error.detail ??
          'The axes cannot change while SKUs are attached to this product — detach them first.'
        );
      case 'not-found':
        return 'That product no longer exists — refresh the page.';
      case 'role-denied':
        return 'Your role cannot edit the catalog.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the entered values and try again.';
      default:
        return error.detail ?? `Product not ${action} (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/**
 * The variant attach/detach PATCH failures (the same SKU edit PATCH the SKU
 * table drives, branched on the 11-3 codes). A duplicate-values refusal is
 * the server naming the conflicting SKU — the server's words render verbatim,
 * which is what "refused by name inline" means here.
 */
export function skuAttachReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'duplicate-variant-values':
        return verbatim(error);
      case 'not-found':
        return 'That SKU or product no longer exists — refresh the page.';
      case 'role-denied':
        return 'Your role cannot edit SKUs.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Fill in a value for every axis the product declares.';
      default:
        return error.detail ?? `Variant not saved (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}