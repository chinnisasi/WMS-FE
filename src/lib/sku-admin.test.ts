import { describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import type { SkuResponse } from '@/lib/api/generated';
import {
  HAZARD_CLASSES,
  PACKAGING_REFRESH_NOTE,
  SHELF_LIFE_LABEL,
  STORAGE_CLASSES,
  barcodeProblem,
  clientsUnavailableNote,
  emptySkuCreateDraft,
  packLevelsLabel,
  parsePackagingDraft,
  parseShelfLifeInput,
  parseSkuCreateDraft,
  shelfLifeLabel,
  shelfLifeWarning,
  skuMasterReason,
  binClassReason,
  hazardClassLabel,
  skuClassReason,
  storageClassLabel,
} from './sku-admin';
import { UNREACHABLE_REASON } from './outbound-orders';

/**
 * The class admin's pure decisions (story 12-7), pinned here: the two
 * vocabularies the pickers surface verbatim, the class columns' nullable
 * rendering (the KNOWN-BAD generated type drops `| null`, so the label
 * functions follow the BE contract — null carries no rule), and the
 * machine-problem reason strings of the SKU class PATCH and the bin
 * structure-arm PATCH. The two 409 class-refusal codes render the server's
 * detail VERBATIM — it names the stranded (sku, bin, hold) parties.
 */

function problem(code: string, status: number, detail?: string): ApiProblem {
  return new ApiProblem(code, status, detail);
}

function sku(over: Record<string, unknown> = {}): SkuResponse {
  // The overrides are `Record<string, unknown>` + one cast, not
  // `Partial<SkuResponse>`: the KNOWN-BAD generated type drops `| null` on
  // hazardClass, but the fixture must be able to carry the runtime-null
  // shape (a plain SKU) the label functions exist to render.
  return {
    id: 'sku-1',
    tenantId: 't-1',
    code: 'SPICE-01',
    name: 'Turmeric 500g',
    uom: 'each',
    uomPrecision: 0,
    gstRateBps: 1800,
    hsn: null,
    batchTracked: false,
    serialTracked: false,
    catchWeightTracked: false,
    weightGrams: null,
    lengthMm: null,
    widthMm: null,
    heightMm: null,
    countryOfOrigin: null,
    reorderPoint: 0,
    reorderQty: 0,
    productId: null,
    variantValues: null,
    barcode: 'BC-1',
    uomConversions: [],
    shelfLifeDays: null,
    barcodes: [],
    storageClass: 'ambient',
    hazardClass: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  } as unknown as SkuResponse;
}

describe('the class vocabularies (the pickers surface the backend tuples verbatim)', () => {
  test('the storage vocabulary is the six FR-40 classes', () => {
    expect(STORAGE_CLASSES).toEqual(['ambient', 'chilled', 'frozen', 'controlled', 'hazardous', 'secure']);
  });

  test('the hazard vocabulary is the seven FR-41 classes', () => {
    expect(HAZARD_CLASSES).toEqual([
      'explosive',
      'oxidizer',
      'flammable',
      'corrosive-acid',
      'corrosive-base',
      'toxic',
      'gas',
    ]);
  });
});

describe('the class columns', () => {
  test('a classed SKU renders its class; a null hazard renders the no-rule dash', () => {
    expect(storageClassLabel(sku({ storageClass: 'hazardous' }))).toBe('hazardous');
    expect(hazardClassLabel(sku({ hazardClass: 'oxidizer' }))).toBe('oxidizer');
    // Null carries no rule (the 12-2 narrowing) — "—", never a fake class.
    expect(hazardClassLabel(sku({ hazardClass: null }))).toBe('—');
  });
});

describe('skuClassReason (the SKU class PATCH arms, branched on the code)', () => {
  test('the two class codes render the server detail verbatim', () => {
    const stranding =
      'Bin A-01-01 holds 3 each of SPICE-01; the chilled class would strand them.';
    expect(skuClassReason(problem('storage-class-conflict', 409, stranding))).toBe(stranding);
    const segregation =
      'SKU "RICE-01" would conflict with stock it shares bins with: bin "A-02-02" (warehouse W1) co-locates with "BATT-9" (chemical: DG 9) — "RICE-01" (food: packaged-dry-grocery) must be kept apart from it: food never shares a bin with a chemical — relocate the stock or release the holds first.';
    expect(skuClassReason(problem('hazard-segregation-conflict', 409, segregation))).toBe(
      segregation,
    );
  });

  test('story 1-6b: the hazard-segregation-conflict fallback names no single field — any goods-type edit can raise it', () => {
    expect(skuClassReason(problem('hazard-segregation-conflict', 409))).toBe(
      'This change conflicts with stock in the same bins — relocate it first.',
    );
  });

  test('the house set and the fallbacks', () => {
    expect(skuClassReason(problem('not-found', 404))).toContain('no longer exists');
    expect(skuClassReason(problem('role-denied', 403))).toContain('Your role');
    expect(skuClassReason(problem('idempotency-key-reuse', 422))).toContain('already processed');
    expect(skuClassReason(problem('unauthenticated', 401))).toContain('session expired');
    expect(skuClassReason(problem('validation-failed', 400, 'hazardClass is not a recordable hazard class'))).toBe(
      'hazardClass is not a recordable hazard class',
    );
    expect(skuClassReason(problem('weird', 500, 'boom'))).toBe('boom');
    expect(skuClassReason(problem('weird', 500))).toBe('Update failed (weird).');
    expect(skuClassReason(new Error('Failed to fetch'))).toBe(UNREACHABLE_REASON);
  });
});

describe('binClassReason (the bin structure-arm PATCH arms, branched on the code)', () => {
  test('storage-class-conflict renders the stranded stock verbatim; bin-retired is its own arm', () => {
    const stranding = 'Bin FZ-1-1 holds 12.000 kg of ICE-01; the ambient class would strand them.';
    expect(binClassReason(problem('storage-class-conflict', 409, stranding))).toBe(stranding);
    expect(binClassReason(problem('bin-retired', 409, 'Bin A-01-01 retired at …'))).toContain(
      'Bin A-01-01 retired at …',
    );
    expect(binClassReason(problem('bin-retired', 409))).toContain('retirement is terminal');
  });

  test('the house set and the fallbacks', () => {
    expect(binClassReason(problem('not-found', 404))).toContain('no longer exists');
    expect(binClassReason(problem('role-denied', 403))).toContain('Your role');
    expect(binClassReason(problem('idempotency-key-reuse', 422))).toContain('already processed');
    expect(binClassReason(problem('unauthenticated', 401))).toContain('session expired');
    expect(binClassReason(problem('validation-failed', 400))).toContain('Check the entered values');
    expect(binClassReason(problem('weird', 500, 'boom'))).toBe('boom');
    expect(binClassReason(problem('weird', 500))).toBe('Update failed (weird).');
    expect(binClassReason(new Error('Failed to fetch'))).toBe(UNREACHABLE_REASON);
  });
});
describe('story 1-4 — the SKU master rules mirrored from the server', () => {
  test('the barcode rule: trimmed, 1–64 printable ASCII, no ";"', () => {
    expect(barcodeProblem('8901234567890')).toBeNull();
    expect(barcodeProblem('  AB C-1/2  ')).toBeNull(); // trimmed first; an inner space is fine
    expect(barcodeProblem('')).toBe('Barcode must be 1–64 characters.');
    expect(barcodeProblem('9'.repeat(65))).toBe('Barcode must be 1–64 characters.');
    expect(barcodeProblem('890;1')).toBe('Barcode "890;1" may not contain ";".');
    expect(barcodeProblem('caf\u00e9')).toContain('printable ASCII');
    expect(barcodeProblem('a\tb')).toContain('printable ASCII');
  });

  test('shelf life: blank clears, a whole 1–3650 passes, anything else names the rule', () => {
    expect(parseShelfLifeInput('')).toEqual({ value: null, problem: null });
    expect(parseShelfLifeInput(' 365 ')).toEqual({ value: 365, problem: null });
    expect(parseShelfLifeInput('0').problem).toBe('Shelf life must be 1–3650 days.');
    expect(parseShelfLifeInput('3651').problem).toBe('Shelf life must be 1–3650 days.');
    expect(parseShelfLifeInput('1.5').problem).toBe('Shelf life must be a whole number of days.');
    expect(SHELF_LIFE_LABEL).toBe('Shelf life — total days from manufacture');
  });

  test('the shelf-life warning fires only below the client minimum', () => {
    expect(shelfLifeWarning(60, 90)).toBe(
      'This client requires at least 90 days of remaining shelf life on receipt — a 60-day product can never arrive with that much left.',
    );
    expect(shelfLifeWarning(90, 90)).toBeNull();
    expect(shelfLifeWarning(null, 90)).toBeNull();
    expect(shelfLifeWarning(60, null)).toBeNull();
  });

  test('the table labels', () => {
    expect(packLevelsLabel({ uomConversions: [{ uom: 'case', factor: 12 }, { uom: 'pallet', factor: 480 }] })).toBe('case ×12 · pallet ×480');
    expect(packLevelsLabel({ uomConversions: [] })).toBe('—');
    expect(shelfLifeLabel({ shelfLifeDays: 365 })).toBe('365 d');
    expect(shelfLifeLabel({ shelfLifeDays: null })).toBe('—');
    expect(PACKAGING_REFRESH_NOTE).toContain('Refresh handhelds after changing pack sizes');
  });

  test('the packaging draft: the PUT body, blank rows dropped', () => {
    const parsed = parsePackagingDraft(
      'each',
      'PRIMARY',
      [
        { id: '1', uom: 'case', factor: '12' },
        { id: '2', uom: '', factor: '' },
      ],
      [
        { id: 'a', barcode: ' 8901 ', uom: 'case' },
        { id: 'b', barcode: '8903', uom: 'each' },
        { id: 'c', barcode: '', uom: '' },
      ],
    );
    expect(parsed).toEqual({
      body: { levels: [{ uom: 'case', factor: 12 }], barcodes: [{ barcode: '8901', uom: 'case' }, { barcode: '8903', uom: 'each' }] },
      problem: null,
    });
  });

  test('the packaging draft refuses what the server could only refuse', () => {
    const problem = (levels: { uom: string; factor: string }[], barcodes: { barcode: string; uom: string }[] = []) =>
      parsePackagingDraft(
        'each',
        'PRIMARY',
        levels.map((l, i) => ({ id: String(i), ...l })),
        barcodes.map((b, i) => ({ id: String(i), ...b })),
      ).problem;
    expect(problem([{ uom: 'each', factor: '12' }])).toBe('A pack level cannot be the base unit (each).');
    expect(problem([{ uom: 'case', factor: '12' }, { uom: 'case', factor: '6' }])).toBe('The case level is listed twice.');
    expect(problem([{ uom: 'case', factor: '1' }])).toBe('One case must hold a whole number of each from 2 to 10,00,000.');
    expect(problem([{ uom: 'case', factor: '1000001' }])).toContain('from 2 to');
    expect(problem([], [{ barcode: 'PRIMARY', uom: 'each' }])).toBe('PRIMARY is already the primary barcode.');
    expect(problem([], [{ barcode: '8901', uom: 'pallet' }])).toBe(
      '8901 names the pallet level, which this SKU does not declare — add the level first.',
    );
    expect(problem([{ uom: 'case', factor: '12' }], [{ barcode: '8901', uom: 'case' }, { barcode: '8901', uom: 'each' }])).toBe(
      '8901 is listed twice.',
    );
    expect(problem([], [{ barcode: '89;01', uom: 'each' }])).toBe('Barcode "89;01" may not contain ";".');
  });

  test('the create draft: blank optionals dropped, the client required only when the tenant has several', () => {
    const draft = {
      ...emptySkuCreateDraft(),
      code: ' TEA-1 ',
      name: 'Assam tea',
      uom: 'each',
      gstPercent: '5',
      shelfLifeDays: '365',
      levels: [{ id: '1', uom: 'case', factor: '12' }],
      barcodes: [{ id: 'a', barcode: '8901', uom: 'case' }],
    };
    expect(parseSkuCreateDraft(draft, false)).toEqual({
      body: {
        code: 'TEA-1',
        name: 'Assam tea',
        uom: 'each',
        gstRate: 500,
        batchTracked: false,
        serialTracked: false,
        catchWeightTracked: false,
        storageClass: 'ambient',
        shelfLifeDays: 365,
        levels: [{ uom: 'case', factor: 12 }],
        barcodes: [{ barcode: '8901', uom: 'case' }],
        // Story 1-6a — the two flags always ride (the batchTracked shape); every other goods-type key is dropped when blank.
        highValue: false,
        fragile: false,
      },
      problem: null,
    });
    expect(parseSkuCreateDraft(draft, true)).toEqual({ body: null, problem: 'Choose the client this SKU belongs to.' });
    expect(parseSkuCreateDraft({ ...draft, clientId: 'c-1' }, true).body?.clientId).toBe('c-1');
    expect(parseSkuCreateDraft({ ...draft, serialTracked: true, catchWeightTracked: true }, false).problem).toContain('pick one');
    expect(parseSkuCreateDraft({ ...draft, weightGrams: '1.5' }, false).problem).toBe('Weight must be a positive whole number.');
    expect(parseSkuCreateDraft({ ...draft, weightGrams: '500', countryOfOrigin: 'in' }, false).body?.attributes).toEqual({
      weightGrams: 500,
      countryOfOrigin: 'IN',
    });
  });

  test('the create draft carries the goods-type fields and decision 7 (story 1-6a)', () => {
    const base = { ...emptySkuCreateDraft(), code: 'DG-1', name: 'Acetone', gstPercent: '18' };
    const derived = parseSkuCreateDraft(
      { ...base, hazardClass: 'toxic', goods: { ...base.goods, dgClass: '3', dgUnNumber: 'UN1090', fragile: true } },
      false,
    );
    expect(derived.problem).toBeNull();
    // A mapped class derives the hazard server-side — the stale pick is not sent.
    expect(derived.body).toMatchObject({ dgClass: '3', dgUnNumber: '1090', fragile: true, highValue: false });
    expect(derived.body).not.toHaveProperty('hazardClass');
    const choose = parseSkuCreateDraft({ ...base, goods: { ...base.goods, dgClass: '8', dgUnNumber: '1830' } }, false);
    expect(choose.problem).toContain('DG class 8');
    const none = parseSkuCreateDraft({ ...base, hazardClass: 'none', goods: { ...base.goods, dgClass: '8', dgUnNumber: '1830' } }, false);
    expect((none.body as Record<string, unknown> | null)?.['hazardClass']).toBeNull();
  });

  test('skuMasterReason: the 1-4 codes, the server detail verbatim where it names the party', () => {
    const p = (code: string, status: number, detail?: string) => new ApiProblem(code, status, detail);
    expect(skuMasterReason(p('sku-has-stock', 409, 'SKU "A" has stock on hand — batch tracking cannot change'))).toBe(
      'SKU "A" has stock on hand — batch tracking cannot change',
    );
    expect(skuMasterReason(p('dg-hazard-mismatch', 400, 'DG class 3 sets the hazard class to "flammable".'))).toBe(
      'DG class 3 sets the hazard class to "flammable".',
    );
    expect(skuMasterReason(p('dg-hazard-required', 400))).toBe(
      'DG class 8 needs its hazard class — choose corrosive acid, corrosive base or none.',
    );
    expect(skuMasterReason(p('sku-has-stock', 409))).toBe(
      'Tracking cannot change while the SKU has stock, a pending over-receipt or a pending adjustment.',
    );
    expect(skuMasterReason(p('barcode-level-unknown', 400))).toBe(
      'A barcode names a level this SKU does not declare — add the pack level first.',
    );
    expect(skuMasterReason(p('duplicate-barcode', 409, 'Barcode "8901" already belongs to SKU "TEA-2" (its case barcode).'))).toBe(
      'Barcode "8901" already belongs to SKU "TEA-2" (its case barcode).',
    );
    expect(skuMasterReason(p('barcode-is-code', 409))).toBe('A barcode may not equal a SKU code in this client.');
    expect(skuMasterReason(p('client-required', 400, 'server words'))).toBe('Choose the client this SKU belongs to.');
    expect(skuMasterReason(p('client-departed', 409))).toBe('That client has departed — it takes no new SKUs.');
    expect(skuMasterReason(new Error('Failed to fetch'))).toBe(UNREACHABLE_REASON);
  });
});

test('story 1-4: a GST % with more than two decimals is refused, never rounded', () => {
  const draft = { ...emptySkuCreateDraft(), code: 'G-1', name: 'n', gstPercent: '18.125' };
  expect(parseSkuCreateDraft(draft, false)).toEqual({ body: null, problem: 'GST % takes at most two decimals (basis points).' });
  expect(parseSkuCreateDraft({ ...draft, gstPercent: '18.25' }, false).body?.gstRate).toBe(1825);
});

test('story 1-4: a create waits for the clients list — a note while loading or failed, none when ready', () => {
  expect(clientsUnavailableNote({ state: 'loading' })).toBe('Loading clients…');
  expect(clientsUnavailableNote({ state: 'failed', reason: 'The API is unreachable' })).toBe(
    'Clients not loaded — The API is unreachable. Creating waits for the client list.',
  );
  expect(clientsUnavailableNote({ state: 'ready' })).toBeNull();
});
