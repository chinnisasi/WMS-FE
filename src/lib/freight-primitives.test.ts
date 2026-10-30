import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { cartonCode } from './carton-code';
import {
  DRIVER_LICENCE_RE,
  FREIGHT_LIMITS,
  SEAL_RE,
  consignmentRef,
  freightLoadCode,
  lrProblem,
  normalizeDriverLicence,
  normalizeLr,
  normalizeSeal,
  parsePackageScan,
  type PackageSetOfTag,
} from './freight-primitives';
import vectors from './freight.vectors.json';

// Story 4-9a (A8, D9) — the vector file is byte-identical beside wms-be
// src/shared/primitives/freight.ts, wms-fe src/lib/freight-primitives.ts and
// wms-mobile src/lib/freight.ts; each repo pins the same sha256 so a drifted
// copy fails here.
const VECTORS_SHA256 = '15c00f27b55110e125ef087884afbdfe1783f0b5bf7a9522232e94cc6ebef579';

describe('freight primitives (shared vectors)', () => {
  test('the vector file is the shared copy', () => {
    const bytes = readFileSync(join(import.meta.dir, 'freight.vectors.json'));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(VECTORS_SHA256);
  });

  for (const vector of vectors.seal) {
    test(`normalizeSeal ${JSON.stringify(vector.input)}`, () => {
      expect(normalizeSeal(vector.input)).toBe(vector.normalized);
      expect(SEAL_RE.test(normalizeSeal(vector.input))).toBe(vector.valid);
    });
  }

  for (const vector of vectors.licence) {
    test(`normalizeDriverLicence ${JSON.stringify(vector.input)}`, () => {
      expect(normalizeDriverLicence(vector.input)).toBe(vector.normalized);
      expect(DRIVER_LICENCE_RE.test(normalizeDriverLicence(vector.input))).toBe(vector.valid);
    });
  }

  for (const vector of vectors.lr) {
    test(`normalizeLr / lrProblem ${JSON.stringify(vector.input)}`, () => {
      expect(normalizeLr(vector.input)).toBe(vector.normalized);
      expect(lrProblem(normalizeLr(vector.input)) !== null).toBe(vector.problem);
    });
  }

  for (const vector of vectors.consignmentRef) {
    test(`consignmentRef ${vector.loadCode} ${vector.stopSeq}`, () => {
      expect(consignmentRef(vector.loadCode, vector.stopSeq)).toBe(vector.ref);
    });
  }

  for (const vector of vectors.packageScan) {
    test(`parsePackageScan ${JSON.stringify(vector.input)}`, () => {
      const tags = vector.tags as Readonly<Record<string, PackageSetOfTag>>;
      expect(parsePackageScan(vector.input, (tag) => tags[tag])).toEqual(vector.result as ReturnType<typeof parsePackageScan>);
    });
  }

  test('a package code built by cartonCode parses back to itself', () => {
    const code = cartonCode('01a18ba8-4743-79dd-8fe5-145b99902272', 2, 15);
    expect(parsePackageScan(code, () => undefined)).toEqual({ kind: 'package', parcelTag: 'O8FE5145B99902272', packSeq: 2, seq: 15, code });
  });

  test('the load code and the limits', () => {
    expect(freightLoadCode(7)).toBe('LD-0007');
    expect(freightLoadCode(12345)).toBe('LD-12345');
    expect(FREIGHT_LIMITS.consignments * 200).toBe(FREIGHT_LIMITS.packagesPerLoad);
    expect(lrProblem('')).toMatch(/LR number/);
  });
});
