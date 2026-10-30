import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { awbProblem, normalizeAwb } from './awb';
import { cartonCode, parseCartonCode } from './carton-code';
import vectors from './carton-code.vectors.json';

// Story 4-5a (A49, D3) — the vector file is byte-identical in wms-be
// src/shared/primitives, wms-fe src/lib and wms-mobile src/lib; each repo
// pins the same sha256 so a drifted copy fails here.
const VECTORS_SHA256 = '8a1b4e8a483b3813554bd7af2b69de5f78408affd7b3c8decb10dc4c73374bfa';

describe('carton-code (shared vectors)', () => {
  test('the vector file is the shared copy', () => {
    const bytes = readFileSync(join(import.meta.dir, 'carton-code.vectors.json'));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(VECTORS_SHA256);
  });

  for (const vector of vectors.build) {
    test(`build ${vector.code}`, () => {
      expect(cartonCode(vector.orderId, vector.packSeq, vector.seq)).toBe(vector.code);
      expect(parseCartonCode(vector.code)).toEqual({
        parcelTag: vector.code.split('.')[0]!,
        packSeq: vector.packSeq,
        seq: vector.seq,
      });
    });
  }

  for (const vector of vectors.parse) {
    test(`parse ${JSON.stringify(vector.input)}`, () => {
      expect(parseCartonCode(vector.input)).toEqual(vector.result);
    });
  }

  test('a carton code is refused as an AWB in its own words', () => {
    expect(awbProblem(normalizeAwb('O8FE5145B99902272.1.2'))).toBe('This is a carton label — scan the courier’s label.');
  });
});
