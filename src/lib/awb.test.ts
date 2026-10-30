import { describe, expect, test } from 'bun:test';

import { awbProblem, normalizeAwb } from './awb';
import awbVectors from './awb.vectors.json';
import tagVectors from './parcel-tag.vectors.json';
import { parcelTagCode, parcelTagMatches, parcelTagOrderSuffix } from './parcel-tag';

// Story 4-4a (A7) — the vector files are copied byte for byte from wms-be
// src/shared/primitives; the three repos run the same cases.
describe('normalizeAwb + awbProblem (shared vectors)', () => {
  for (const vector of awbVectors.cases) {
    test(JSON.stringify(vector.raw), () => {
      const normalized = normalizeAwb(vector.raw);
      expect(normalized).toBe(vector.normalized);
      expect(awbProblem(normalized) === null).toBe(vector.valid);
    });
  }

  test('the parcel tag is refused as an AWB in words', () => {
    expect(awbProblem('O0123456789ABCDEF')).toBe('This is the parcel tag — scan the courier’s label.');
  });
});

describe('parcelTagCode (shared vectors)', () => {
  for (const vector of tagVectors.cases) {
    test(vector.orderId, () => {
      expect(parcelTagCode(vector.orderId)).toBe(vector.code);
      expect(parcelTagMatches(vector.code, vector.orderId)).toBe(true);
      expect(parcelTagMatches(vector.code.toLowerCase(), vector.orderId)).toBe(true);
    });
  }

  test('a non-tag code names no order', () => {
    expect(parcelTagOrderSuffix('123456789012')).toBeNull();
    expect(parcelTagMatches('O0000000000000000', '01a18ba8-4743-79dd-8fe5-145b99902272')).toBe(false);
  });
});
