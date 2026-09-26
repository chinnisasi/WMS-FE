import { describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import type { SkuResponse } from '@/lib/api/generated';
import {
  HAZARD_CLASSES,
  STORAGE_CLASSES,
  binClassReason,
  hazardClassLabel,
  skuClassReason,
  storageClassLabel,
} from './sku-admin';
import { UNREACHABLE_REASON } from './outbound-orders';

/**
 * The class admin's pure decisions (story 12-7), pinned here: the two
 * vocabularies the pickers surface verbatim, the class columns' nullable
 * rendering (the KNOWN-BAD generated type drops `| null`, so the label
 * functions follow the BE contract — null carries no rule), and the
 * machine-problem reason strings of the SKU class PATCH and the bin
 * structure-arm PATCH. The two 409 class-refusal codes render the server's
 * detail VERBATIM — it names the stranded (sku, bin, hold) parties.
 */

function problem(code: string, status: number, detail?: string): ApiProblem {
  return new ApiProblem(code, status, detail);
}

function sku(over: Record<string, unknown> = {}): SkuResponse {
  // The overrides are `Record<string, unknown>` + one cast, not
  // `Partial<SkuResponse>`: the KNOWN-BAD generated type drops `| null` on
  // hazardClass, but the fixture must be able to carry the runtime-null
  // shape (a plain SKU) the label functions exist to render.
  return {
    id: 'sku-1',
    tenantId: 't-1',
    code: 'SPICE-01',
    name: 'Turmeric 500g',
    uom: 'each',
    uomPrecision: 0,
    gstRateBps: 1800,
    hsn: null,
    batchTracked: false,
    serialTracked: false,
    catchWeightTracked: false,
    weightGrams: null,
    lengthMm: null,
    widthMm: null,
    heightMm: null,
    countryOfOrigin: null,
    reorderPoint: 0,
    reorderQty: 0,
    productId: null,
    variantValues: null,
    barcode: 'BC-1',
    uomConversions: [],
    storageClass: 'ambient',
    hazardClass: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  } as unknown as SkuResponse;
}

describe('the class vocabularies (the pickers surface the backend tuples verbatim)', () => {
  test('the storage vocabulary is the six FR-40 classes', () => {
    expect(STORAGE_CLASSES).toEqual(['ambient', 'chilled', 'frozen', 'controlled', 'hazardous', 'secure']);
  });

  test('the hazard vocabulary is the seven FR-41 classes', () => {
    expect(HAZARD_CLASSES).toEqual([
      'explosive',
      'oxidizer',
      'flammable',
      'corrosive-acid',
      'corrosive-base',
      'toxic',
      'gas',
    ]);
  });
});

describe('the class columns', () => {
  test('a classed SKU renders its class; a null hazard renders the no-rule dash', () => {
    expect(storageClassLabel(sku({ storageClass: 'hazardous' }))).toBe('hazardous');
    expect(hazardClassLabel(sku({ hazardClass: 'oxidizer' }))).toBe('oxidizer');
    // Null carries no rule (the 12-2 narrowing) — "—", never a fake class.
    expect(hazardClassLabel(sku({ hazardClass: null }))).toBe('—');
  });
});

describe('skuClassReason (the SKU class PATCH arms, branched on the code)', () => {
  test('the two class codes render the server detail verbatim', () => {
    const stranding =
      'Bin A-01-01 holds 3 each of SPICE-01; the chilled class would strand them.';
    expect(skuClassReason(problem('storage-class-conflict', 409, stranding))).toBe(stranding);
    const segregation =
      'SPICE-01 (flammable) co-locates with OX-01 (oxidizer) in bin A-02-02 — relocate one first.';
    expect(skuClassReason(problem('hazard-segregation-conflict', 409, segregation))).toBe(
      segregation,
    );
  });

  test('the house set and the fallbacks', () => {
    expect(skuClassReason(problem('not-found', 404))).toContain('no longer exists');
    expect(skuClassReason(problem('role-denied', 403))).toContain('Your role');
    expect(skuClassReason(problem('idempotency-key-reuse', 422))).toContain('already processed');
    expect(skuClassReason(problem('unauthenticated', 401))).toContain('session expired');
    expect(skuClassReason(problem('validation-failed', 400, 'hazardClass is not a recordable hazard class'))).toBe(
      'hazardClass is not a recordable hazard class',
    );
    expect(skuClassReason(problem('weird', 500, 'boom'))).toBe('boom');
    expect(skuClassReason(problem('weird', 500))).toBe('Update failed (weird).');
    expect(skuClassReason(new Error('Failed to fetch'))).toBe(UNREACHABLE_REASON);
  });
});

describe('binClassReason (the bin structure-arm PATCH arms, branched on the code)', () => {
  test('storage-class-conflict renders the stranded stock verbatim; bin-retired is its own arm', () => {
    const stranding = 'Bin FZ-1-1 holds 12.000 kg of ICE-01; the ambient class would strand them.';
    expect(binClassReason(problem('storage-class-conflict', 409, stranding))).toBe(stranding);
    expect(binClassReason(problem('bin-retired', 409, 'Bin A-01-01 retired at …'))).toContain(
      'Bin A-01-01 retired at …',
    );
    expect(binClassReason(problem('bin-retired', 409))).toContain('retirement is terminal');
  });

  test('the house set and the fallbacks', () => {
    expect(binClassReason(problem('not-found', 404))).toContain('no longer exists');
    expect(binClassReason(problem('role-denied', 403))).toContain('Your role');
    expect(binClassReason(problem('idempotency-key-reuse', 422))).toContain('already processed');
    expect(binClassReason(problem('unauthenticated', 401))).toContain('session expired');
    expect(binClassReason(problem('validation-failed', 400))).toContain('Check the entered values');
    expect(binClassReason(problem('weird', 500, 'boom'))).toBe('boom');
    expect(binClassReason(problem('weird', 500))).toBe('Update failed (weird).');
    expect(binClassReason(new Error('Failed to fetch'))).toBe(UNREACHABLE_REASON);
  });
});