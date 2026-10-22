import { describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import {
  ADJUSTMENT_PENDINGS_HREF,
  parseWriteOff,
  writeOffBatches,
  writeOffOffered,
  writeOffOutcome,
  writeOffReason,
} from './write-off';

/** Story 2-4a — the damaged write-off's words and derivations. */

const each = { id: 'sku-1', code: 'SPF', uom: 'each', uomPrecision: 0, batchTracked: false } as const;
const kg = { id: 'sku-2', code: 'RICE', uom: 'kg', uomPrecision: 3, batchTracked: false } as const;
const lot = { id: 'sku-3', code: 'SERUM', uom: 'each', uomPrecision: 0, batchTracked: true } as const;

describe('writeOffOffered', () => {
  test('only the system DAMAGED bin, and only with stock.adjust', () => {
    expect(writeOffOffered({ binCode: 'DAMAGED', binSystemOwned: true }, true)).toBe(true);
    expect(writeOffOffered({ binCode: 'DAMAGED', binSystemOwned: true }, false)).toBe(false);
    // A user bin coded DAMAGED (a pre-rule collision) is not the system bin.
    expect(writeOffOffered({ binCode: 'DAMAGED', binSystemOwned: false }, true)).toBe(false);
    expect(writeOffOffered({ binCode: 'RETURNS', binSystemOwned: true }, true)).toBe(false);
    expect(writeOffOffered({ binCode: 'A-01', binSystemOwned: false }, true)).toBe(false);
  });
});

describe('parseWriteOff', () => {
  const base = { warehouseId: 'w', binId: 'b' };

  test('a whole-unit write-off: negative on the wire, reason damaged, the note trimmed, no batch key', () => {
    expect(parseWriteOff({ ...base, sku: each, draft: { quantity: ' 4 ', note: '  crushed  ', batchCode: null }, available: 6 })).toEqual({
      kind: 'ok',
      body: { warehouseId: 'w', skuId: 'sku-1', binId: 'b', quantityDelta: -4, reasonCode: 'damaged', note: 'crushed' },
    });
  });

  test('a batch-tracked SKU names its batch with the override reason (an expired batch is drawn explicitly)', () => {
    expect(parseWriteOff({ ...base, sku: lot, draft: { quantity: '2', note: 'leak', batchCode: 'LOT-A' }, available: 3 })).toMatchObject({
      kind: 'ok',
      body: { quantityDelta: -2, batch: { code: 'LOT-A', overrideReason: 'damaged write-off' } },
    });
    expect(parseWriteOff({ ...base, sku: lot, draft: { quantity: '2', note: 'leak', batchCode: null }, available: 3 })).toEqual({
      kind: 'refused',
      problem: 'SERUM is batch-tracked — choose the batch to write off.',
    });
  });

  test('the refusals: not a positive number, finer than the unit, more than is there, no note, a note too long', () => {
    const refused = (sku: typeof each | typeof kg, quantity: string, note: string, available = 10) =>
      parseWriteOff({ ...base, sku, draft: { quantity, note, batchCode: null }, available });
    expect(refused(each, '', 'n')).toEqual({ kind: 'refused', problem: 'Type how many units to write off — a positive number.' });
    expect(refused(each, '0', 'n').kind).toBe('refused');
    expect(refused(each, '-1', 'n').kind).toBe('refused');
    expect(refused(each, '1e3', 'n').kind).toBe('refused');
    expect(refused(each, '1.5', 'n')).toEqual({ kind: 'refused', problem: 'each counts in whole units — 1.5 is not one.' });
    expect(refused(kg, '1.2345', 'n')).toEqual({ kind: 'refused', problem: 'kg takes at most 3 decimal place(s) — 1.2345 has more.' });
    expect(parseWriteOff({ ...base, sku: kg, draft: { quantity: '1.25', note: 'n', batchCode: null }, available: 2 }).kind).toBe('ok');
    expect(refused(each, '11', 'n')).toEqual({ kind: 'refused', problem: 'Only 10 each are in DAMAGED — write off at most that.' });
    expect(refused(each, '1', '   ')).toEqual({ kind: 'refused', problem: 'Add a note — what happened to the damaged units.' });
    expect(refused(each, '1', 'x'.repeat(501))).toEqual({ kind: 'refused', problem: 'The note is at most 500 characters.' });
  });
});

describe('writeOffBatches', () => {
  test('only batches with stock in the bin, by code', () => {
    const batch = (code: string, quantity: number) => ({ id: code, code, mfgDate: null, expiryDate: null, status: 'active', quantity });
    expect(writeOffBatches([batch('B', 2), batch('A', 0), batch('C', 1)]).map((b) => b.code)).toEqual(['B', 'C']);
  });
});

describe('writeOffReason / writeOffOutcome', () => {
  test('refusals by code; the unreachable server reads as such', () => {
    expect(writeOffReason(new ApiProblem('damaged-bin-write-off-only', 400, 'd'))).toBe(
      'The DAMAGED bin only takes a write-off (units out) — nothing was changed.',
    );
    expect(writeOffReason(new ApiProblem('bin-retired', 400, 'd'))).toBe('The bin is retired — nothing was changed.');
    expect(writeOffReason(new ApiProblem('insufficient-on-hand', 409, 'd'))).toContain('fewer units');
    expect(writeOffReason(new ApiProblem('request-failed', 0, 'x'))).toBe(UNREACHABLE_REASON);
    expect(writeOffReason(new Error('boom'))).toBe(UNREACHABLE_REASON);
  });

  test('applied vs pending words; the queue link', () => {
    expect(writeOffOutcome('applied', 4, each)).toEqual({ word: 'Written off', reason: '4 each of SPF written off from DAMAGED.' });
    expect(writeOffOutcome('pending', 1.5, kg).word).toBe('Pending approval');
    expect(ADJUSTMENT_PENDINGS_HREF).toBe('/conflicts?queue=adjustment-pendings');
  });
});
