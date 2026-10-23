import { describe, expect, test } from 'bun:test';

import { ApiProblem } from './api/client';
import {
  batchDetailReason,
  batchFailureWord,
  batchQuantityLabel,
  LOADING_CODES,
  NOT_BATCH_TRACKED,
  otherWarehousesLabel,
  resolveSearch,
  choicePrompt,
  codeEntryLabel,
  skuResolution,
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
  test('the five backend system codes, each labelled (story 2-4a adds DAMAGED)', () => {
    expect(SYSTEM_BIN_LABEL).toEqual({
      RECEIVING: 'Receiving (awaiting putaway)',
      'QC-HOLD': 'QC hold (not sellable)',
      RETURNS: 'Returns',
      'IN-TRANSIT': 'In transit',
      DAMAGED: 'Damaged (not sellable)',
    });
    expect(systemBinLabel('RECEIVING', true)).toBe('Receiving (awaiting putaway)');
    expect(systemBinLabel('QC-HOLD', true)).toBe('QC hold (not sellable)');
    expect(systemBinLabel('DAMAGED', true)).toBe('Damaged (not sellable)');
    // A user bin coded DAMAGED (a pre-rule collision) is not the system bin.
    expect(systemBinLabel('DAMAGED', false)).toBeNull();
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

describe('review follow-ups', () => {
  test('a case-insensitive code matching two SKUs offers a choice, never a silent pick', () => {
    const twins: CodeMap = { state: 'ready', data: [{ id: 's-a', code: 'abc' }, { id: 's-b', code: 'ABC' }] };
    expect(resolveSearch('Abc', BINS, twins)).toEqual({
      kind: 'choice',
      code: 'Abc',
      matches: [{ id: 's-a', code: 'abc' }, { id: 's-b', code: 'ABC' }],
    });
    // The exact code still resolves.
    expect(resolveSearch('ABC', BINS, twins)).toEqual({ kind: 'sku', id: 's-b', code: 'ABC' });
    const binTwins: CodeMap = { state: 'ready', data: [{ id: 'b-a', code: 'x-a' }, { id: 'b-b', code: 'X-A' }] };
    expect(resolveSearch('x-a ', binTwins, SKUS)).toMatchObject({ kind: 'bin', id: 'b-a' });
    expect(resolveSearch('x-A', binTwins, SKUS)).toEqual({
      kind: 'ambiguous',
      message: 'More than one bin matches x-A — type the exact code.',
    });
  });

  test('the batch failure heading: not-found only for the 404 sentence', () => {
    expect(batchFailureWord(batchDetailReason(new ApiProblem('not-found', 404, 'gone')))).toBe('Batch not found');
    expect(batchFailureWord(batchDetailReason(new ApiProblem('boom', 500, 'x')))).toBe('Batch unavailable');
    expect(batchFailureWord(batchDetailReason(new Error('Failed to fetch')))).toBe('Batch unavailable');
  });
});

describe('story 1-1 — a code two clients share offers a choice labelled with the client', () => {
  const shared: CodeMap = {
    state: 'ready',
    data: [
      { id: 's-acme', code: 'TSHIRT-M', label: 'TSHIRT-M · ACME' },
      { id: 's-beta', code: 'TSHIRT-M', label: 'TSHIRT-M · BETA' },
      { id: 's-other', code: 'CAP', label: 'CAP · ACME' },
    ],
  };
  test('two exact matches → the choice arm with both, never the first', () => {
    const resolution = resolveSearch('TSHIRT-M', BINS, shared);
    expect(resolution).toEqual({
      kind: 'choice',
      code: 'TSHIRT-M',
      matches: [
        { id: 's-acme', code: 'TSHIRT-M', label: 'TSHIRT-M · ACME' },
        { id: 's-beta', code: 'TSHIRT-M', label: 'TSHIRT-M · BETA' },
      ],
    });
    expect(choicePrompt(resolution as Extract<typeof resolution, { kind: 'choice' }>)).toBe('2 SKUs match TSHIRT-M — pick one.');
    // Case-insensitively too.
    expect(resolveSearch('tshirt-m', BINS, shared)).toMatchObject({ kind: 'choice' });
  });
  test('picking one applies that SKU, and the summary names its client', () => {
    const picked = skuResolution({ id: 's-beta', code: 'TSHIRT-M', label: 'TSHIRT-M · BETA' });
    expect(picked).toEqual({ kind: 'sku', id: 's-beta', code: 'TSHIRT-M', label: 'TSHIRT-M · BETA' });
    expect(searchSummary(picked)).toBe('Where SKU TSHIRT-M · BETA is — one row per bin.');
    expect(codeEntryLabel({ id: 'x', code: 'CAP' })).toBe('CAP');
  });
  test('a single match resolves at once and carries its label', () => {
    expect(resolveSearch('CAP', BINS, shared)).toEqual({ kind: 'sku', id: 's-other', code: 'CAP', label: 'CAP · ACME' });
  });
  test('one client: no label, the summary is unchanged', () => {
    expect(searchSummary({ kind: 'sku', id: 's-1', code: 'GLOW-SERUM-30' })).toBe('Where SKU GLOW-SERUM-30 is — one row per bin.');
  });
  test('a bin still wins over a shared SKU code (and says so)', () => {
    const bins: CodeMap = { state: 'ready', data: [{ id: 'b-t', code: 'TSHIRT-M' }] };
    expect(resolveSearch('TSHIRT-M', bins, shared)).toEqual({ kind: 'bin', id: 'b-t', code: 'TSHIRT-M', alsoSku: true });
  });
});
