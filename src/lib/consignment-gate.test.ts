import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CONSIGNMENT_GATE_CODES,
  consignmentGate,
  consignmentGateCodeOf,
  isB2bOrder,
  ratedValuePaiseOf,
  valueFloorOf,
  type ConsignmentGateFacts,
  type ConsignmentGateResult,
} from './consignment-gate';
import raw from './consignment-gate.vectors.json';

// Story 4-6a (A8, D10) — the vector file is byte-identical in wms-be
// src/shared/primitives and wms-fe src/lib; each repo pins the same sha256
// so a drifted copy fails here. `consignment-gate.ts` itself is a
// byte-for-byte copy of the backend's pure gate.
const VECTORS_SHA256 = '654e52b466feb8ce5478c4fa53bb10baaa60525881e2f0d5579440ce0421699d';

interface GateVector {
  readonly name: string;
  readonly facts: ConsignmentGateFacts;
  readonly expected: ConsignmentGateResult;
}

const vectors = (raw as unknown as { vectors: GateVector[] }).vectors;

describe('consignment gate (shared vectors)', () => {
  test('the vector file is the shared copy', () => {
    const bytes = readFileSync(join(import.meta.dir, 'consignment-gate.vectors.json'));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(VECTORS_SHA256);
    expect(vectors.length).toBeGreaterThanOrEqual(20);
  });

  for (const vector of vectors) {
    test(vector.name, () => {
      expect(consignmentGate(vector.facts)).toEqual(vector.expected);
    });
  }

  test('every gate state, reason and code is pinned by a vector', () => {
    expect([...new Set(vectors.map((v) => v.expected.state))].sort()).toEqual([
      'dispatched',
      'eway-expired',
      'eway-required',
      'missing',
      'not-applicable',
      'not-required',
      'ready',
    ]);
    expect(new Set(vectors.map((v) => v.expected.code).filter((c) => c !== null))).toEqual(new Set(CONSIGNMENT_GATE_CODES));
  });

  test('the helpers', () => {
    expect(valueFloorOf(null, null)).toBeNull();
    expect(valueFloorOf(900, 700)).toBe(900);
    expect(isB2bOrder(null, '29ABCDE1234F1Z5')).toBe(true);
    expect(isB2bOrder('b2c', '29ABCDE1234F1Z5')).toBe(false);
    expect(consignmentGateCodeOf('ready')).toBeNull();
    expect(consignmentGateCodeOf('missing')).toBe('consignment-documents-missing');
    expect(ratedValuePaiseOf([{ qty: 2000, ratePaise: 3_000_000, parentLineId: null }])).toBe(6_000_000);
    expect(ratedValuePaiseOf([{ qty: 2000, ratePaise: null, parentLineId: null }])).toBeNull();
  });
});
