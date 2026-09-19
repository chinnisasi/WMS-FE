import { describe, expect, test } from 'bun:test';

import {
  formatQuantity,
  parseQuantityInput,
  quantityInputLabel,
  quantityLabel,
  sharedQuantityUom,
  type QuantityUom,
} from './format-quantity';

/**
 * The one quantity-formatting statement (story 10.5), pinned where every
 * surface borrows it: declared precision, grouped integer part, no `.000` on
 * a 0-precision unit, and no rounding anywhere.
 */

describe('formatQuantity', () => {
  test('a measured unit renders at its declared precision', () => {
    expect(formatQuantity(2.5, 3)).toBe('2.500');
    expect(formatQuantity(18.4, 1)).toBe('18.4');
    expect(formatQuantity(2.5004, 3)).toBe('2.500');
  });

  test('a whole-unit unit never grows a decimal suffix', () => {
    expect(formatQuantity(3000, 0)).toBe('3,000');
    expect(formatQuantity(3, 0)).toBe('3');
    expect(formatQuantity(3000.5, 0)).toBe('3,001'); // the server never sends this
  });

  test('the integer part groups, the fraction stays a plain digit run', () => {
    expect(formatQuantity(1234.5, 3)).toBe('1,234.500');
    expect(formatQuantity(12345678.901, 3)).toBe('12,345,678.901');
  });

  test('float dust is absorbed at render, not by rounding the value', () => {
    // Every quantity arrives already at declared precision server-side;
    // toFixed(3) only makes the dust visible-none again.
    expect(formatQuantity(0.1 + 0.2, 3)).toBe('0.300');
  });

  test('negative quantities keep the sign and format like the rest', () => {
    // A PO line's derived open quantity legitimately goes negative.
    expect(formatQuantity(-0.5, 3)).toBe('-0.500');
    expect(formatQuantity(-3000, 0)).toBe('-3,000');
  });

  test('zero renders as 0 (or 0.000), never as a blank', () => {
    expect(formatQuantity(0, 0)).toBe('0');
    expect(formatQuantity(0, 3)).toBe('0.000');
  });
});

describe('quantityInputLabel', () => {
  test('a whole-unit unit says so, without decimal talk', () => {
    expect(quantityInputLabel(0)).toBe('Whole units — this unit counts in whole numbers.');
  });

  test('a measured unit names the places its precision allows', () => {
    expect(quantityInputLabel(3)).toBe('Decimals to 3 places.');
    expect(quantityInputLabel(1)).toBe('Decimals to 1 place.');
  });
});

describe('quantityLabel', () => {
  test('a resolved SKU names its unit at declared precision', () => {
    expect(quantityLabel(2.5, { uom: 'kg', uomPrecision: 3 })).toBe('2.500 kg');
    expect(quantityLabel(3000, { uom: 'each', uomPrecision: 0 })).toBe('3,000 each');
  });

  test('an unresolvable SKU keeps the ONE unit-agnostic fallback, everywhere', () => {
    // The same sentence family on every surface — never a bare number, never
    // a guessed unit or precision.
    expect(quantityLabel(2.5, null)).toBe('2.5 units');
    expect(quantityLabel(3000, null)).toBe('3000 units');
  });
});

describe('sharedQuantityUom', () => {
  const KG: QuantityUom = { uom: 'kg', uomPrecision: 3 };
  const EACH: QuantityUom = { uom: 'each', uomPrecision: 0 };
  const skuOf = (skuId: string) =>
    ({ 'sku-kg': KG, 'sku-each': EACH })[skuId as 'sku-kg' | 'sku-each'];

  test('lines that all resolve to one unit share it', () => {
    expect(
      sharedQuantityUom([{ skuId: 'sku-kg' }, { skuId: 'sku-kg' }], skuOf),
    ).toEqual(KG);
  });

  test('mixed units share nothing — an aggregate keeps the raw fallback', () => {
    expect(
      sharedQuantityUom([{ skuId: 'sku-kg' }, { skuId: 'sku-each' }], skuOf),
    ).toBeNull();
  });

  test('an unresolvable SKU forfeits the shared unit rather than guessing', () => {
    expect(sharedQuantityUom([{ skuId: 'sku-kg' }, { skuId: 'sku-gone' }], skuOf)).toBeNull();
  });

  test('an empty line set has no unit', () => {
    expect(sharedQuantityUom([], skuOf)).toBeNull();
  });
});

describe('parseQuantityInput (shape, never precision)', () => {
  test('a decimal literal parses to its number', () => {
    expect(parseQuantityInput('2.5')).toBe(2.5);
    expect(parseQuantityInput('3000')).toBe(3000);
    expect(parseQuantityInput(' 1.25 ')).toBe(1.25);
    expect(parseQuantityInput('0')).toBe(0);
  });

  test('the notations Number() accepts but the field and backend do not are refused', () => {
    // `Number('1e3')` is 1000 and `Number('0x10')` is 16 — silent quantity
    // changes a type="number" field cannot produce and the backend refuses.
    expect(parseQuantityInput('1e3')).toBeNull();
    expect(parseQuantityInput('0x10')).toBeNull();
    expect(parseQuantityInput('+4')).toBeNull();
    expect(parseQuantityInput('-3')).toBeNull();
    expect(parseQuantityInput('Infinity')).toBeNull();
    expect(parseQuantityInput('abc')).toBeNull();
    expect(parseQuantityInput('')).toBeNull();
  });
});
