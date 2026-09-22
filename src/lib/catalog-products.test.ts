import { describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import {
  parseProductAxes,
  productAxesLabel,
  productReason,
  skuAttachReason,
  variantValuesLabel,
} from './catalog-products';
import { UNREACHABLE_REASON } from './outbound-orders';

/**
 * The products card's pure decisions (story 11-6), pinned here because every
 * sentence of copy or derivation lives in `src/lib/`: the axes parser
 * mirrors the backend's 1–3 decorator bounds, the variant label keys the
 * product's declared axes in declared order, and both mappers branch on the
 * machine-readable problem `code` — never on prose.
 */

function problem(code: string, status: number, detail?: string, title?: string): ApiProblem {
  return new ApiProblem(code, status, detail, title);
}

describe('parseProductAxes (the axes field → the wire array)', () => {
  test('trims, drops blanks, and accepts one to three axes', () => {
    expect(parseProductAxes('size, colour')).toEqual({ axes: ['size', 'colour'], problem: null });
    expect(parseProductAxes(' size ')).toEqual({ axes: ['size'], problem: null });
    expect(parseProductAxes('a, b, c')).toEqual({ axes: ['a', 'b', 'c'], problem: null });
  });

  test('an empty declaration is refused client-side', () => {
    expect(parseProductAxes('').problem).toContain('at least one');
    expect(parseProductAxes(' , ,').problem).toContain('at least one');
  });

  test('more than three axes is refused client-side', () => {
    expect(parseProductAxes('a, b, c, d').problem).toContain('at most 3');
  });
});

describe('productAxesLabel / variantValuesLabel', () => {
  test('the axes cell joins with a separator; the variant label keys declared order', () => {
    expect(productAxesLabel(['size', 'colour'])).toBe('size · colour');
    expect(variantValuesLabel({ colour: 'Red', size: 'M' }, ['size', 'colour'])).toBe(
      'size: M · colour: Red',
    );
  });

  test('a value the payload lacks renders a dash, never a silent gap', () => {
    expect(variantValuesLabel({ size: 'M' }, ['size', 'colour'])).toBe('size: M · colour: —');
    expect(variantValuesLabel(null, ['size'])).toBe('size: —');
  });
});

describe('productReason (branching on the problem code)', () => {
  test('the named arms', () => {
    expect(productReason(problem('duplicate-product-name', 409, 'Product "Shirts" already exists.'), 'created')).toBe(
      'Product "Shirts" already exists.',
    );
    expect(
      productReason(problem('product-has-variants', 409, 'two SKUs attached'), 'updated'),
    ).toBe('two SKUs attached');
    expect(productReason(problem('product-has-variants', 409), 'updated')).toContain(
      'detach them first',
    );
    expect(productReason(problem('role-denied', 403), 'created')).toContain('Your role');
    expect(productReason(problem('not-found', 404), 'updated')).toContain('no longer exists');
    expect(productReason(problem('idempotency-key-reuse', 422), 'created')).toContain(
      'already processed',
    );
    expect(productReason(problem('unauthenticated', 401), 'created')).toContain('session expired');
    expect(productReason(problem('validation-failed', 400, 'axes must be 1–3'), 'created')).toBe(
      'axes must be 1–3',
    );
  });

  test('an unknown code falls back to detail, then to a sentence naming the code', () => {
    expect(productReason(problem('weird', 500, 'boom'), 'created')).toBe('boom');
    expect(productReason(problem('weird', 500), 'updated')).toBe('Product not updated (weird).');
  });

  test('the transport arm renders the house unreachable copy', () => {
    expect(productReason(new Error('Failed to fetch'), 'created')).toBe(UNREACHABLE_REASON);
  });
});

describe('skuAttachReason (the variant attach/detach PATCH)', () => {
  test('a duplicate-values refusal renders the server verbatim — refused by name', () => {
    expect(
      skuAttachReason(problem('duplicate-variant-values', 409, 'SKU "TEE-2" already carries size: M.')),
    ).toBe('SKU "TEE-2" already carries size: M.');
  });

  test('the named arms and the house fallback', () => {
    expect(skuAttachReason(problem('validation-failed', 400, 'variantValues.size'))).toBe(
      'variantValues.size',
    );
    expect(skuAttachReason(problem('validation-failed', 400))).toContain('every axis');
    expect(skuAttachReason(problem('role-denied', 403))).toContain('cannot edit SKUs');
    expect(skuAttachReason(new Error('Failed to fetch'))).toBe(UNREACHABLE_REASON);
  });
});