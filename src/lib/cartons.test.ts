import { afterEach, describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import {
  addCarton,
  assignCase,
  bindRecartonKey,
  buildPackBody,
  buildRecartonBody,
  canSplitAtPack,
  carrierMultiCartonWarning,
  cartonIsEmpty,
  gridMatchesScan,
  cartonLabelsFilename,
  cartonLine,
  cartonReason,
  cartonSkusFromScanned,
  cartonSlipsFilename,
  cartonSummary,
  clientLabelPagesWarning,
  DEFAULT_PACK_PRINT,
  gridFromLivePack,
  grossOverShipmentBound,
  lastPrintedPackageLabelCount,
  MAX_CARTONS,
  PACK_PRINT_STORAGE_KEY,
  packageCountDiffersWarning,
  packageLabelsFilename,
  packingSlipFilename,
  packPrintRequest,
  parseCartonDimensionsCm,
  parseCartonGrid,
  parseCartonWeightKg,
  parsePackageLabelDraft,
  parseRecartonReason,
  perUomTotals,
  rememberedPrintChoice,
  rememberPackageLabelCount,
  rememberPrintChoice,
  removeCarton,
  rowTotals,
  setCartonMeasure,
  setCartonQty,
  splitGrid,
  type CartonGrid,
  type CartonSku,
} from './cartons';

const EA = { uom: 'EA', uomPrecision: 0 };
const KG = { uom: 'KG', uomPrecision: 3 };
const A: CartonSku = { skuId: 'sku-a', skuCode: 'A', uom: EA, packedQty: 10, catchWeight: false };
const B: CartonSku = { skuId: 'sku-b', skuCode: 'B', uom: EA, packedQty: 4, catchWeight: false };
const RICE: CartonSku = { skuId: 'sku-r', skuCode: 'RICE', uom: KG, packedQty: 2.5, catchWeight: false };
const FISH: CartonSku = {
  skuId: 'sku-f',
  skuCode: 'FISH',
  uom: EA,
  packedQty: 3,
  catchWeight: true,
  cases: [
    { id: 'hu-1', label: 'C-1' },
    { id: 'hu-2', label: 'C-2' },
    { id: 'hu-3', label: 'C-3' },
  ],
};

function twoCartons(): CartonGrid {
  // AC1's split: carton 1 A×6 3.2 kg; carton 2 A×4 B×4 2.8 kg.
  let grid = splitGrid([A, B]);
  grid = setCartonQty(grid, 0, 'sku-a', '6');
  grid = setCartonQty(grid, 0, 'sku-b', '');
  grid = setCartonQty(grid, 1, 'sku-a', '4');
  grid = setCartonQty(grid, 1, 'sku-b', '4');
  grid = setCartonMeasure(grid, 0, 'weightKg', '3.2');
  grid = setCartonMeasure(grid, 1, 'weightKg', '2.8');
  return grid;
}

describe('the grid model', () => {
  test('split opens carton 1 holding everything and an empty carton 2', () => {
    const grid = splitGrid([A, B]);
    expect(grid.cartons).toHaveLength(2);
    expect(grid.cartons[0]!.qty).toEqual({ 'sku-a': '10', 'sku-b': '4' });
    expect(cartonIsEmpty(grid, 1)).toBe(true);
    expect(rowTotals(grid).map((r) => r.matches)).toEqual([true, true]);
  });

  test('a row that does not add up is flagged, word first', () => {
    const grid = setCartonQty(splitGrid([A]), 0, 'sku-a', '9');
    const [row] = rowTotals(grid);
    expect(row!.matches).toBe(false);
    expect(row!.word).toBe('Differs — 9 of 10 EA');
    expect(rowTotals(setCartonQty(grid, 0, 'sku-a', 'x'))[0]!.cartonedQty).toBeNull();
  });

  test('add stops at 200; remove only an empty carton, never the last', () => {
    let grid = splitGrid([A]);
    for (let i = 0; i < 300; i += 1) grid = addCarton(grid);
    expect(grid.cartons).toHaveLength(MAX_CARTONS);
    const full = splitGrid([A]);
    expect(removeCarton(full, 0)).toBe(full);
    expect(removeCarton(full, 1).cartons).toHaveLength(1);
    expect(removeCarton(removeCarton(full, 1), 0).cartons).toHaveLength(1);
  });

  test('removing a carton re-indexes the cases after it', () => {
    let grid = addCarton(splitGrid([FISH]));
    grid = assignCase(grid, 'hu-3', 2);
    grid = removeCarton(grid, 1);
    expect(grid.caseCarton['hu-3']).toBe(1);
  });
});

describe('parseCartonGrid', () => {
  test('AC1: two cartons with their weights', () => {
    expect(parseCartonGrid(twoCartons(), 'pack')).toEqual({
      cartons: [
        { scanned: [{ skuId: 'sku-a', qty: 6 }], weightGrams: 3200 },
        {
          scanned: [
            { skuId: 'sku-a', qty: 4 },
            { skuId: 'sku-b', qty: 4 },
          ],
          weightGrams: 2800,
        },
      ],
      problem: null,
    });
  });

  test('cartons that do not add up are refused', () => {
    const grid = setCartonQty(twoCartons(), 1, 'sku-a', '3');
    expect(parseCartonGrid(grid, 'pack').problem).toContain('the cartons must add up');
  });

  test('an empty carton is refused by number', () => {
    expect(parseCartonGrid(addCarton(twoCartons()), 'pack').problem).toBe('Carton 3 is empty — remove it.');
  });

  test('A31: a fractional each split across cartons is refused even when the total is whole', () => {
    let grid = setCartonQty(splitGrid([A]), 0, 'sku-a', '6.5');
    grid = setCartonQty(grid, 1, 'sku-a', '3.5');
    expect(parseCartonGrid(grid, 'pack').problem).toBe('Carton 1: A counts in whole EA — split it in whole units.');
  });

  test('a measured unit splits to its precision', () => {
    let grid = setCartonQty(splitGrid([RICE]), 0, 'sku-r', '1.25');
    grid = setCartonQty(grid, 1, 'sku-r', '1.25');
    expect(parseCartonGrid(grid, 'pack').cartons).toEqual([{ scanned: [{ skuId: 'sku-r', qty: 1.25 }] }, { scanned: [{ skuId: 'sku-r', qty: 1.25 }] }]);
  });

  test('weights and dimensions convert and are bounded', () => {
    expect(parseCartonWeightKg('1.25')).toEqual({ grams: 1250, problem: null });
    expect(parseCartonWeightKg('1001').problem).not.toBeNull();
    expect(parseCartonWeightKg('0.0004').problem).not.toBeNull();
    expect(parseCartonDimensionsCm('40', '30', '20.5')).toEqual({ dimensionsMm: { lengthMm: 400, widthMm: 300, heightMm: 205 }, problem: null });
    expect(parseCartonDimensionsCm('40', '', '20').problem).toBe('Dimensions are all three sides together, or none of them.');
    const grid = setCartonMeasure(twoCartons(), 1, 'lengthCm', '40');
    expect(parseCartonGrid(grid, 'pack').problem).toBe('Carton 2: Dimensions are all three sides together, or none of them.');
  });

  test('catch-weight SKUs cannot be split at a web pack', () => {
    expect(canSplitAtPack([A, FISH])).toBe(false);
    expect(parseCartonGrid(splitGrid([A, FISH]), 'pack').problem).toContain('handheld');
  });

  test('re-carton: each case sits in exactly one carton, its qty its case count', () => {
    let grid = splitGrid([FISH]);
    grid = assignCase(grid, 'hu-2', 1);
    expect(parseCartonGrid(grid, 'recarton')).toEqual({
      cartons: [
        { scanned: [{ skuId: 'sku-f', qty: 2, handlingUnitIds: ['hu-1', 'hu-3'] }] },
        { scanned: [{ skuId: 'sku-f', qty: 1, handlingUnitIds: ['hu-2'] }] },
      ],
      problem: null,
    });
  });

  test('re-carton prefilled from the live pack round-trips', () => {
    const grid = gridFromLivePack(
      [A, B, FISH],
      [
        { weightGrams: 3200, dimensionsMm: { lengthMm: 400, widthMm: 300, heightMm: 200 }, lines: [{ skuId: 'sku-a', qty: 6 }, { skuId: 'sku-f', qty: 3, handlingUnitIds: ['hu-1', 'hu-2', 'hu-3'] }] },
        { weightGrams: null, dimensionsMm: null, lines: [{ skuId: 'sku-a', qty: 4 }, { skuId: 'sku-b', qty: 4 }] },
      ],
    );
    expect(grid.cartons[0]).toEqual({ qty: { 'sku-a': '6' }, weightKg: '3.2', lengthCm: '40', widthCm: '30', heightCm: '20' });
    const parsed = parseCartonGrid(grid, 'recarton');
    expect(parsed.problem).toBeNull();
    expect(parsed.cartons![0]).toEqual({
      scanned: [
        { skuId: 'sku-a', qty: 6 },
        { skuId: 'sku-f', qty: 3, handlingUnitIds: ['hu-1', 'hu-2', 'hu-3'] },
      ],
      weightGrams: 3200,
      dimensionsMm: { lengthMm: 400, widthMm: 300, heightMm: 200 },
    });
  });
});

describe('the bodies', () => {
  const bench = { scanned: [{ skuId: 'sku-a', qty: 10 }, { skuId: 'sku-b', qty: 4 }], weightGrams: 900 };

  test('AC7: no grid, or one carton, is today’s exact payload', () => {
    expect(buildPackBody(bench, null)).toEqual({ body: bench, problem: null });
    expect(JSON.stringify(buildPackBody(bench, removeCarton(splitGrid([A, B]), 1)).body)).toBe(JSON.stringify(bench));
  });

  test('more than one carton: the scanned total, the cartons, no top-level weight', () => {
    const { body } = buildPackBody(bench, twoCartons());
    expect(body).toEqual({ scanned: bench.scanned, cartons: parseCartonGrid(twoCartons(), 'pack').cartons! });
    expect(body).not.toHaveProperty('weightGrams');
    expect(body).not.toHaveProperty('dimensionsMm');
  });

  test('bench lines of one SKU sum exactly into one grid row', () => {
    const skus = cartonSkusFromScanned(
      [{ skuId: 'sku-r', qty: 0.1 }, { skuId: 'sku-r', qty: 0.2 }],
      () => ({ skuCode: 'RICE', uom: KG }),
    );
    expect(skus).toEqual([{ skuId: 'sku-r', skuCode: 'RICE', uom: KG, packedQty: 0.3, catchWeight: false }]);
  });

  test('re-carton body carries the reason; the key binds to the body', () => {
    expect(buildRecartonBody(twoCartons(), '  ').problem).toContain('Say why');
    expect(parseRecartonReason('x'.repeat(201)).problem).toContain('200');
    const built = buildRecartonBody(twoCartons(), ' box burst ');
    expect(built.body!.reason).toBe('box burst');
    let minted = 0;
    const mint = () => `k${(minted += 1)}`;
    const first = bindRecartonKey(null, built.body!, mint);
    expect(bindRecartonKey(first, built.body!, mint)).toBe(first);
    expect(bindRecartonKey(first, { ...built.body!, reason: 'other' }, mint).key).toBe('k2');
  });
});

describe('refusal copy', () => {
  test('every story code has words', () => {
    const codes = [
      'validation-failed',
      'carton-contents-mismatch',
      'shipment-labelled-by-carrier',
      'order-not-packed',
      'recarton-limit',
      'too-many-labels',
      'package-count-mismatch',
      'carton-not-current',
      'consignee-address-missing',
      'rtv-not-picked',
      'rtc-not-picked',
    ];
    for (const code of codes) {
      const text = cartonReason(new ApiProblem(code, 409), 'recarton');
      expect(text.startsWith('Not re-packed')).toBe(true);
      expect(text).not.toContain(`(${code})`);
    }
  });

  test('the contents mismatch names the SKUs', () => {
    const error = new ApiProblem('carton-contents-mismatch', 422, undefined, undefined, { skus: [{ skuCode: 'A', packed: 10, cartoned: 9 }] });
    expect(cartonReason(error, 'recarton')).toContain('A packed 10, in cartons 9');
  });

  test('a validation detail renders verbatim', () => {
    expect(cartonReason(new ApiProblem('validation-failed', 400, 'carton 2: empty'), 'pack')).toBe('carton 2: empty');
  });
});

describe('file names, totals, summaries', () => {
  test('names fold to [A-Za-z0-9._-]', () => {
    expect(packingSlipFilename('SO-1')).toBe('SO-1-packing-slip.pdf');
    expect(cartonSlipsFilename('SO 1/2', 'zpl')).toBe('SO-1-2-carton-slips.zpl');
    expect(cartonLabelsFilename('', 'pdf')).toBe('order-carton-labels.pdf');
    expect(packageLabelsFilename('RTV-0007', 'zpl')).toBe('RTV-0007-package-labels.zpl');
  });

  test('A36: totals per UoM, never across units', () => {
    expect(
      perUomTotals([
        { qty: 10, uom: EA },
        { qty: 2, uom: EA },
        { qty: 2.5, uom: KG },
      ]),
    ).toBe('12 EA · 2.5 KG');
    expect(perUomTotals([])).toBe('—');
  });

  test('the packed row and a carton line', () => {
    expect(cartonSummary(3, 12_400)).toBe('3 cartons · 12.4 kg');
    expect(cartonSummary(1, null)).toBe('1 carton');
    expect(cartonLine(2, 3, 4200, { lengthMm: 400, widthMm: 300, heightMm: 200 })).toBe('Carton 2 of 3 — 4.2 kg — 40 × 30 × 20 cm');
  });

  test('warnings: gross over the shipment bound, label pages, one AWB', () => {
    expect(grossOverShipmentBound(1_200_000)).toBe(true);
    expect(grossOverShipmentBound(1_000_000)).toBe(false);
    expect(clientLabelPagesWarning(2, 3)).toBe('The client’s label has 2 pages for 3 cartons.');
    expect(clientLabelPagesWarning(3, 3)).toBeNull();
    expect(carrierMultiCartonWarning(3)).toBe('One AWB will cover 3 cartons — every carton label prints it.');
    expect(carrierMultiCartonWarning(1)).toBeNull();
  });
});

describe('the print group', () => {
  afterEach(() => localStorage.clear());

  test('ZPL labels are the default; a choice is remembered', () => {
    expect(rememberedPrintChoice()).toBe(DEFAULT_PACK_PRINT);
    rememberPrintChoice('slip-a4');
    expect(rememberedPrintChoice()).toBe('slip-a4');
    localStorage.setItem(PACK_PRINT_STORAGE_KEY, 'junk');
    expect(rememberedPrintChoice()).toBe(DEFAULT_PACK_PRINT);
  });

  test('a blocked storage keeps the default and never throws', () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked');
      },
    });
    try {
      expect(rememberedPrintChoice()).toBe(DEFAULT_PACK_PRINT);
      expect(() => rememberPrintChoice('labels-pdf')).not.toThrow();
      expect(lastPrintedPackageLabelCount('rtv-1')).toBeNull();
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: original });
    }
  });

  test('each choice names its route, format, layout and file', () => {
    expect(packPrintRequest('labels-a4', 'SO-1')).toEqual({ route: 'carton-labels', format: 'pdf', layout: 'a4', filename: 'SO-1-carton-labels.pdf' });
    expect(packPrintRequest('slips-zpl', 'SO-1')).toEqual({ route: 'packing-slip', format: 'zpl', layout: 'label', filename: 'SO-1-carton-slips.zpl' });
  });
});

describe('return package labels', () => {
  afterEach(() => localStorage.clear());

  test('count and range', () => {
    expect(parsePackageLabelDraft({ count: '4', from: '', to: '' })).toEqual({ query: { count: 4 }, problem: null });
    expect(parsePackageLabelDraft({ count: '0', from: '', to: '' }).problem).not.toBeNull();
    expect(parsePackageLabelDraft({ count: '10000', from: '', to: '' }).problem).not.toBeNull();
    expect(parsePackageLabelDraft({ count: '9', from: '5', to: '3' }).problem).not.toBeNull();
    expect(parsePackageLabelDraft({ count: '5000', from: '', to: '' }).problem).toContain('print 1–1000 first');
    expect(parsePackageLabelDraft({ count: '5000', from: '1001', to: '2000' })).toEqual({ query: { count: 5000, from: 1001, to: 2000 }, problem: null });
  });

  test('A43: the dispatch dialog warns when the count differs from the labels printed', () => {
    rememberPackageLabelCount('rtv-1', 4);
    expect(lastPrintedPackageLabelCount('rtv-1')).toBe(4);
    expect(packageCountDiffersWarning(3, 4)).toContain('4 package labels were printed, but 3 packages');
    expect(packageCountDiffersWarning(4, 4)).toBeNull();
    expect(packageCountDiffersWarning(3, null)).toBeNull();
  });
});

describe('gridMatchesScan (4-5a A26 — a stale split is never sent)', () => {
  const skus = cartonSkusFromScanned(
    [
      { skuId: 'a', qty: 10 },
      { skuId: 'b', qty: 4 },
    ],
    () => undefined,
  );
  test('the split made from this scan matches it, in any order', () => {
    const grid = splitGrid(skus);
    expect(gridMatchesScan(grid, [{ skuId: 'b', qty: 4 }, { skuId: 'a', qty: 10 }])).toBe(true);
  });
  test('a changed count or a new SKU makes it stale', () => {
    const grid = splitGrid(skus);
    expect(gridMatchesScan(grid, [{ skuId: 'a', qty: 9 }, { skuId: 'b', qty: 4 }])).toBe(false);
    expect(gridMatchesScan(grid, [{ skuId: 'a', qty: 10 }, { skuId: 'b', qty: 4 }, { skuId: 'c', qty: 1 }])).toBe(false);
  });
});
