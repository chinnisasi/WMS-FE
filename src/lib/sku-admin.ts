import { ApiProblem } from '@/lib/api/client';
import type { SkuResponse } from '@/lib/api/generated';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';

/**
 * Story 12-7 — the storage/hazard class admin's pure decisions, extracted
 * from the surfaces (the `over-receipt.ts` pattern) so they are testable:
 * the class vocabularies the two edit forms pick from, the class-column
 * labels, and the machine-problem reason strings of the SKU class PATCH and
 * the bin structure-arm PATCH. Clients branch on the problem `code`, never
 * on prose.
 *
 * The 409 class-refusal codes name the conflicting parties in `detail` — the
 * conflicting (sku, bin, hold) rows a stranding class change leaves behind —
 * so those arms render the detail VERBATIM: paraphrasing a list of stock
 * that must be relocated first would be guessing.
 */

/** The SKU's storage class (FR-40) — the required, non-nullable vocabulary. */
export type StorageClass = SkuResponse['storageClass'];

/**
 * The storage-class vocabulary, surfaced verbatim from the backend's 12-1
 * three-layer pattern (TS tuple / DB CHECK / DTO @IsIn) — the same
 * `BIN_TYPES` precedent in `zone-bin-setup.tsx`: the picker mirrors the
 * server's fixed vocabulary; the server's decorators remain the boundary.
 */
export const STORAGE_CLASSES = [
  'ambient',
  'chilled',
  'frozen',
  'controlled',
  'hazardous',
  'secure',
] as const satisfies readonly StorageClass[];

/**
 * The hazard-class vocabulary (FR-41), mirrored for the edit picker. The
 * matrix CARD does not use this — the matrix card renders the endpoint's
 * `classes` array, the only source for the matrix view — but an edit form
 * needs its options before the matrix read resolves, and this is the same
 * fixed vocabulary the backend declares.
 */
export const HAZARD_CLASSES = [
  'explosive',
  'oxidizer',
  'flammable',
  'corrosive-acid',
  'corrosive-base',
  'toxic',
  'gas',
] as const;

/** The SKU's hazard class (FR-41), or null when it carries none. */
export type HazardClass = SkuResponse['hazardClass'] | null;

/**
 * The SKU table's Storage column. Every SKU carries a class (required on the
 * response since the 12-1 schema) — but the KNOWN-BAD generated types have
 * taught this repo to trust runtime truth over the declared type, so a row
 * that somehow arrives class-less renders the house em-dash instead of
 * `undefined`.
 */
export function storageClassLabel(sku: SkuResponse): string {
  return sku.storageClass ?? '—';
}

/**
 * The SKU table's Hazard column (story 12-7): null carries no rule — the
 * decided 12-2 narrowing — so a class-less SKU renders "—" ("no rule"), not
 * a fake class. The generated type drops `| null` (KNOWN-BAD, tracked in
 * PENDING); the runtime-nullable rendering here follows the BE contract,
 * not the broken type.
 */
export function hazardClassLabel(sku: SkuResponse): string {
  return (sku.hazardClass as string | null) ?? '—';
}

/**
 * The SKU class-edit PATCH's failure reasons, branched on the problem
 * `code` — the same contract as `decisionReason` / `qcReason`. The two class
 * codes surface the server's detail verbatim: `storage-class-conflict` names
 * the stranded bins, `hazard-segregation-conflict` names the co-located
 * stock (SKUs, bins and the pinning hold, where one exists).
 */
export function skuClassReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'storage-class-conflict':
        return error.detail ?? 'The class change would strand stock in bins that no longer fit it.';
      case 'hazard-segregation-conflict':
        return error.detail ?? 'The hazard class conflicts with co-located stock — relocate or release it first.';
      case 'not-found':
        return 'That SKU no longer exists — refresh the page.';
      case 'role-denied':
        return 'Your role cannot edit SKUs.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the entered values and try again.';
      default:
        return error.detail ?? `Update failed (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/**
 * The bin Edit-class PATCH's failure reasons (the structure arm, gated
 * `bin.create` on the backend): the same shared `storage-class-conflict`
 * code as the SKU form, plus the bin's own `bin-retired` (retirement is
 * terminal) and the house set.
 */
export function binClassReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'storage-class-conflict':
        // The backend's detail names the conflicting stock — the (sku, qty)
        // rows the class change strands — verbatim.
        return error.detail ?? 'The class change would strand stock that no longer fits the bin.';
      case 'bin-retired':
        return error.detail ?? 'That bin is retired — retirement is terminal.';
      case 'not-found':
        return 'That bin no longer exists — refresh the page.';
      case 'role-denied':
        return 'Your role cannot edit bin structure.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the entered values and try again.';
      default:
        return error.detail ?? `Update failed (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}