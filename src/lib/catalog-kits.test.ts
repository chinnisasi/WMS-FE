import { describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import type { KitResponse, SkuResponse } from '@/lib/api/generated';
import { kitBomLabel, kitMarkerLabel, kitReason, parseKitComponents } from './catalog-kits';
import { UNREACHABLE_REASON } from './outbound-orders';

/**
 * The SKU table's kit editor pure decisions (story 11-6), pinned here:
 * quantities are base-UoM decimals (the API converts at its own edge — no
 * milli ever crosses this app), the BOM is a set, and every command-side
 * guard the backend refuses with has a mapped sentence the editor renders.
 */

function problem(code: string, status: number, detail?: string): ApiProblem {
  return new ApiProblem(code, status, detail);
}

function kit(over: Partial<KitResponse> = {}): KitResponse {
  return {
    skuId: 'kit-1',
    tenantId: 't-1',
    code: 'KIT-1',
    name: 'Starter kit',
    components: [
      { skuId: 'pad-1', code: 'PAD-01', qty: 2 },
      { skuId: 'tape-1', code: 'TAPE-01', qty: 1.5 },
    ],
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

function sku(over: Partial<SkuResponse> = {}): SkuResponse {
  return {
    id: 'pad-1',
    tenantId: 't-1',
    code: 'PAD-01',
    name: 'Foam pad',
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
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

describe('parseKitComponents (the kit editor rows → the PutKitDto body)', () => {
  test('a complete single-component draft parses to a decimal quantity', () => {
    expect(parseKitComponents([{ skuId: 'pad-1', quantity: '2' }])).toEqual({
      components: [{ skuId: 'pad-1', quantity: 2 }],
      problem: null,
    });
    expect(parseKitComponents([{ skuId: 'pad-1', quantity: '2.5' }])).toEqual({
      components: [{ skuId: 'pad-1', quantity: 2.5 }],
      problem: null,
    });
  });

  test('an empty composition is refused client-side (the guaranteed 400)', () => {
    expect(parseKitComponents([]).problem).toContain('at least one component');
    expect(parseKitComponents([{ skuId: '', quantity: '' }]).problem).toContain(
      'at least one component',
    );
  });

  test('a row with a SKU but no quantity — or a quantity with no SKU — is refused', () => {
    expect(parseKitComponents([{ skuId: 'pad-1', quantity: '' }]).problem).toContain(
      'decimal greater than zero',
    );
    expect(parseKitComponents([{ skuId: '', quantity: '2' }]).problem).toContain('needs a SKU');
  });

  test('a zero or malformed quantity is refused — the decimal-literal grammar, never bare Number()', () => {
    expect(parseKitComponents([{ skuId: 'pad-1', quantity: '0' }]).problem).toContain(
      'decimal greater than zero',
    );
    expect(parseKitComponents([{ skuId: 'pad-1', quantity: '1e3' }]).problem).toContain(
      'decimal greater than zero',
    );
  });

  test('a component named twice is refused naming the shape rule (the guaranteed 409)', () => {
    expect(
      parseKitComponents([
        { skuId: 'pad-1', quantity: '2' },
        { skuId: 'pad-1', quantity: '3' },
      ]).problem,
    ).toContain('the BOM is a set');
  });
});

describe('kitReason (all seven command-side arms, branched on the code)', () => {
  test('the seven kit arms', () => {
    expect(kitReason(problem('kit-already-composed', 409, 'already a kit'))).toBe('already a kit');
    expect(kitReason(problem('kit-sku-holds-stock', 409, '5 on hand'))).toBe('5 on hand');
    expect(kitReason(problem('kit-component-is-kit', 409, 'PAD-01 is a kit'))).toBe(
      'PAD-01 is a kit',
    );
    expect(kitReason(problem('kit-self-reference', 400))).toContain('cannot name itself');
    expect(kitReason(problem('duplicate-kit-component', 409, 'twice'))).toBe('twice');
    expect(kitReason(problem('kit-component-not-found', 404, 'no SKU "X"'))).toBe('no SKU "X"');
    expect(kitReason(problem('empty-kit-composition', 400))).toContain('at least one component');
  });

  test('the house set and the fallbacks', () => {
    expect(kitReason(problem('not-found', 404))).toContain('no longer exists');
    expect(kitReason(problem('role-denied', 403))).toContain('Your role');
    expect(kitReason(problem('idempotency-key-reuse', 422))).toContain('already processed');
    expect(kitReason(problem('unauthenticated', 401))).toContain('session expired');
    expect(kitReason(problem('validation-failed', 400, 'qty finer than kg allows'))).toBe(
      'qty finer than kg allows',
    );
    expect(kitReason(problem('weird', 500, 'boom'))).toBe('boom');
    expect(kitReason(problem('weird', 500))).toBe('Kit not saved (weird).');
    expect(kitReason(new Error('Failed to fetch'))).toBe(UNREACHABLE_REASON);
  });
});

describe('kitMarkerLabel / kitBomLabel (the derived kit marker)', () => {
  test('a plain SKU renders a dash; a kit renders its component count', () => {
    expect(kitMarkerLabel(undefined)).toBe('—');
    expect(kitMarkerLabel(kit())).toBe('Kit · 2 components');
    expect(kitMarkerLabel(kit({ components: [{ skuId: 'pad-1', code: 'PAD-01', qty: 1 }] }))).toBe(
      'Kit · 1 component',
    );
  });

  test('the BOM sentence names each component at its own unit precision', () => {
    const skus: Record<string, SkuResponse> = {
      'pad-1': sku(),
      'tape-1': sku({ id: 'tape-1', code: 'TAPE-01', uom: 'kg', uomPrecision: 3 }),
    };
    expect(kitBomLabel(kit(), (skuId) => skus[skuId])).toBe('PAD-01: 2 each · TAPE-01: 1.500 kg');
  });

  test('an unresolvable component falls back to the unit-agnostic copy', () => {
    expect(kitBomLabel(kit(), () => undefined)).toBe('PAD-01: 2 units · TAPE-01: 1.5 units');
  });
});