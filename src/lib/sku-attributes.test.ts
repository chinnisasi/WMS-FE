import { describe, expect, test } from 'bun:test';

import { skuPhysicalLabel } from './sku-attributes';

/**
 * The SKU table's weight·dims summary derivation (story 11-2). The claim the
 * test pins: partial attributes render the parts that exist — never a
 * fabricated composite (`200×—×100`) — and a fully-unset SKU renders the
 * em-dash placeholder, exactly like every other optional column.
 */
function sku(overrides: Partial<Parameters<typeof skuPhysicalLabel>[0]> = {}): Parameters<typeof skuPhysicalLabel>[0] {
  return {
    weightGrams: null,
    lengthMm: null,
    widthMm: null,
    heightMm: null,
    countryOfOrigin: null,
    ...overrides,
  };
}

describe('skuPhysicalLabel', () => {
  test('all attributes unset → the em-dash placeholder', () => {
    expect(skuPhysicalLabel(sku())).toBe('—');
  });

  test('a complete SKU renders weight, the L×W×H composite and the origin code', () => {
    expect(
      skuPhysicalLabel(sku({ weightGrams: 500, lengthMm: 200, widthMm: 150, heightMm: 100, countryOfOrigin: 'IN' })),
    ).toBe('500 g · 200×150×100 mm · IN');
  });

  test('a partial dimension set names the present axes instead of fabricating a shape', () => {
    expect(skuPhysicalLabel(sku({ weightGrams: 1200, widthMm: 400 }))).toBe('1200 g · W 400 mm');
    expect(skuPhysicalLabel(sku({ lengthMm: 200, heightMm: 100 }))).toBe('L 200 mm · H 100 mm');
  });

  test('weight and origin alone render without any dimension segment', () => {
    expect(skuPhysicalLabel(sku({ weightGrams: 500, countryOfOrigin: 'CN' }))).toBe('500 g · CN');
  });

  test('complete dimensions without weight render the composite alone', () => {
    expect(skuPhysicalLabel(sku({ lengthMm: 200, widthMm: 150, heightMm: 100 }))).toBe('200×150×100 mm');
  });
});
