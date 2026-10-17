import { describe, expect, test } from 'bun:test';

import { ApiProblem } from './api/client';
import {
  batchDetailReason,
  batchQuantityLabel,
  LOADING_CODES,
  NOT_BATCH_TRACKED,
  otherWarehousesLabel,
  resolveSearch,
  searchAvailability,
  searchSummary,
  splitBatchBins,
  SYSTEM_BIN_LABEL,
  systemBinLabel,
  totalAcrossBins,
  type CodeMap,
} from './inventory';

const BINS: CodeMap = {
  state: 'ready',
  data: [
    { id: 'bin-1', code: 'D-01-01' },
    { id: 'bin-2', code: 'GLOW' },
  ],
};
const SKUS: CodeMap = {
  state: 'ready',
  data: [
    { id: 'sku-1', code: 'GLOW-SERUM-30' },
    { id: 'sku-2', code: 'GLOW' },
  ],
};
const LOADING: CodeMap = { state: 'loading' };
const FAILED: CodeMap = { state: 'failed', reason: 'nope' };

describe('SYSTEM_BIN_LABEL — system bins in words', () => {
  test('the four backend system codes, each labelled', () => {
    expect(SYSTEM_BIN_LABEL).toEqual({
      RECEIVING: 'Receiving (awaiting putaway)',
      'QC-HOLD': 'QC hold (not sellable)',
      RETURNS: 'Returns',
      'IN-TRANSIT': 'In transit',
    });
    expect(systemBinLabel('RECEIVING', true)).toBe('Receiving (awaiting putaway)');
    expect(systemBinLabel('QC-HOLD', true)).toBe('QC hold (not sellable)');
  });

  test('only a system-owned bin is labelled; an unknown system code falls back', () => {
    expect(systemBinLabel('RECEIVING', false)).toBeNull();
    expect(systemBinLabel('D-01-01', false)).toBeNull();
    expect(systemBinLabel('DOCK-X', true)).toBe('System bin (DOCK-X)');
    // Not a prototype key either.
    expect(systemBinLabel('constructor', true)).toBe('System bin (constructor)');
  });
});

describe('searchAvailability — the box while the maps load or fail', () => {
  test('either map loading → disabled, "Loading codes…"', () => {
    expect(searchAvailability(LOADING, SKUS)).toMatchObject({ disabled: true, note: LOADING_CODES });
    expect(searchAvailability(BINS, LOADING)).toMatchObject({ disabled: true, note: LOADING_CODES });
    expect(searchAvailability(FAILED, LOADING)).toMatchObject({ disabled: true, note: LOADING_CODES });
  });

  test('a failed map is named and the other code still searches; both failed → disabled', () => {
    expect(searchAvailability(FAILED, SKUS)).toEqual({
      disabled: false,
      note: 'Bin codes not loaded — search by SKU code only.',
      placeholder: 'SKU code',
    });
    expect(searchAvailability(BINS, FAILED)).toEqual({
      disabled: false,
      note: 'SKU codes not loaded — search by bin code only.',
      placeholder: 'Bin code',
    });
    expect(searchAvailability(FAILED, FAILED).disabled).toBe(true);
    expect(searchAvailability(BINS, SKUS)).toEqual({ disabled: false, note: null, placeholder: 'Bin or SKU code' });
  });
});

describe('resolveSearch — a code to the bin or SKU it names', () => {
  test('a bin code → the bin; a SKU code → the SKU; blank → blank', () => {
    expect(resolveSearch('D-01-01', BINS, SKUS)).toEqual({ kind: 'bin', id: 'bin-1', code: 'D-01-01', alsoSku: false });
    expect(resolveSearch('GLOW-SERUM-30', BINS, SKUS)).toEqual({ kind: 'sku', id: 'sku-1', code: 'GLOW-SERUM-30' });
    expect(resolveSearch('   ', BINS, SKUS)).toEqual({ kind: 'blank' });
  });

  test('case-insensitive and trimmed', () => {
    expect(resolveSearch('  d-01-01 ', BINS, SKUS)).toMatchObject({ kind: 'bin', id: 'bin-1' });
    expect(resolveSearch('glow-serum-30', BINS, SKUS)).toMatchObject({ kind: 'sku', id: 'sku-1' });
  });

  test('a code that is both a bin and a SKU picks the bin, and says so', () => {
    const both = resolveSearch('GLOW', BINS, SKUS);
    expect(both).toEqual({ kind: 'bin', id: 'bin-2', code: 'GLOW', alsoSku: true });
    expect(searchSummary(both as Extract<typeof both, { kind: 'bin' }>)).toBe(
      'GLOW is both a bin code and a SKU code — showing the bin.',
    );
  });

  test('a miss never claims the code is absent from the warehouse', () => {
    const miss = resolveSearch('ZZ-9', BINS, SKUS);
    expect(miss).toEqual({ kind: 'miss', message: 'No bin or SKU with code ZZ-9 found.' });
    expect((miss as { message: string }).message).not.toContain('not in this warehouse');
  });

  test('a failed map: the other still resolves, and a miss names what was not searched', () => {
    expect(resolveSearch('GLOW-SERUM-30', FAILED, SKUS)).toMatchObject({ kind: 'sku', id: 'sku-1' });
    expect(resolveSearch('D-01-01', BINS, FAILED)).toMatchObject({ kind: 'bin', id: 'bin-1', alsoSku: false });
    expect(resolveSearch('D-01-01', FAILED, SKUS)).toEqual({
      kind: 'miss',
      message: 'No SKU with code D-01-01 found (bin codes are not loaded).',
    });
    expect(resolveSearch('GLOW-SERUM-30', BINS, FAILED)).toEqual({
      kind: 'miss',
      message: 'No bin with code GLOW-SERUM-30 found (SKU codes are not loaded).',
    });
  });
});

describe('the stock and batch words', () => {
  const EACH = { uom: 'each', uomPrecision: 0 };
  const KG = { uom: 'kg', uomPrecision: 3 };

  test('the SKU total sums exactly at the SKU precision', () => {
    expect(totalAcrossBins([{ quantity: 297 }, { quantity: 3 }], EACH)).toBe('300 each');
    expect(totalAcrossBins([{ quantity: 2.1 }, { quantity: 0.2 }], KG)).toBe('2.300 kg');
    expect(totalAcrossBins([], EACH)).toBe('0 each');
  });

  test('a zero batch reads "0 in this warehouse"', () => {
    expect(batchQuantityLabel(0, EACH)).toBe('0 in this warehouse');
    expect(batchQuantityLabel(1.5, KG)).toBe('1.500 kg');
  });

  test('a batch\'s bins split by warehouse, zero rows dropped, others counted and named', () => {
    const W = 'w-here';
    const split = splitBatchBins(
      [
        { warehouseId: W, binId: 'b1', quantity: 4 },
        { warehouseId: W, binId: 'b2', quantity: 0 },
        { warehouseId: 'w-2', binId: 'b3', quantity: 1 },
        { warehouseId: 'w-2', binId: 'b4', quantity: 2 },
        { warehouseId: 'w-3', binId: 'b5', quantity: 5 },
        { warehouseId: 'w-3', binId: 'b6', quantity: 0 },
      ],
      W,
    );
    expect(split.here.map((b) => b.binId)).toEqual(['b1']);
    expect(split.elsewhere).toEqual([
      { warehouseId: 'w-2', bins: 2 },
      { warehouseId: 'w-3', bins: 1 },
    ]);
    expect(
      otherWarehousesLabel(split.elsewhere, [
        { id: 'w-2', code: 'MYS', name: 'Mysore' },
        { id: 'w-3', code: 'DEL', name: 'Delhi' },
      ]),
    ).toBe('3 more bins in other warehouses: MYS Mysore (2), DEL Delhi (1)');
    expect(otherWarehousesLabel([{ warehouseId: 'w-2', bins: 1 }], [{ id: 'w-2', code: 'MYS', name: 'Mysore' }])).toBe(
      '1 more bin in other warehouses: MYS Mysore (1)',
    );
    expect(otherWarehousesLabel([], [])).toBeNull();
  });

  test('the batch refusal words branch on the code', () => {
    expect(batchDetailReason(new ApiProblem('not-found', 404, 'gone'))).toBe('Batch not found — it may have been removed.');
    expect(batchDetailReason(new Error('Failed to fetch'))).toBe('The API is unreachable — is wms-be running?');
    expect(NOT_BATCH_TRACKED).toBe("This SKU isn't batch-tracked.");
  });
});
