import { afterEach, describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import type { BatchListItemDto, StockAdjustmentDto } from '@/lib/api/generated';
import { CLIENT_DEPARTED_REASON } from '@/lib/client-departed';
import { parseDrill } from '@/lib/drill';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import {
  ADJUST_REASON_LABEL,
  ADJUST_REASONS,
  ADJUSTMENT_PENDINGS_HREF,
  CATCH_WEIGHT_NOT_HERE,
  EMPTY_ADJUST_DRAFT,
  FEFO_SKIPS_EXPIRED_HINT,
  addExpiredBatchWarning,
  addSkuOptions,
  adjustBins,
  adjustLedgerHref,
  adjustOffered,
  adjustOutcome,
  adjustReason,
  adjustReasonHint,
  adjustSkuRefusal,
  existingBatch,
  fefoBatch,
  fefoCap,
  fefoPreview,
  istDateToInstant,
  parseAdjustQuantity,
  parseAdjustment,
  removeSkuBlock,
  storageClassWarning,
  type AdjustDraft,
  type AdjustReasonCode,
} from './adjust';

/** Story 3-2a — the web stock adjustment's pure rules. */

// ── the reason vocabulary, both ways ─────────────────────────────────────────

// Every generated reason is listed (a new server reason fails the compile)…
type Missing = Exclude<AdjustReasonCode, (typeof ADJUST_REASONS)[number]>;
// …and nothing is listed that the server does not accept (`satisfies` already refuses it).
type Extra = Exclude<(typeof ADJUST_REASONS)[number], AdjustReasonCode>;
const noneMissing: [Missing] extends [never] ? true : false = true;
const noneExtra: [Extra] extends [never] ? true : false = true;

describe('the reason vocabulary', () => {
  test('ADJUST_REASONS covers the generated enum both ways, in the server order, each labelled', () => {
    expect(noneMissing).toBe(true);
    expect(noneExtra).toBe(true);
    expect([...ADJUST_REASONS]).toEqual(['stock-count', 'damaged', 'expired', 'shrinkage', 'found', 'recall', 'system-correction', 'other']);
    expect(ADJUST_REASONS.map((code) => ADJUST_REASON_LABEL[code])).toEqual([
      'Stock count',
      'Damaged',
      'Expired',
      'Shrinkage',
      'Found',
      'Recall',
      'System correction',
      'Other',
    ]);
  });

  test('expired and recall carry the FEFO hint on a batch-tracked Remove only; nothing else does', () => {
    const batchRemove = { batchTracked: true, direction: 'remove' } as const;
    expect(adjustReasonHint('expired', batchRemove)).toBe(FEFO_SKIPS_EXPIRED_HINT);
    expect(adjustReasonHint('recall', batchRemove)).toBe('FEFO skips expired batches — pick the batch');
    for (const code of ADJUST_REASONS.filter((c) => c !== 'expired' && c !== 'recall')) expect(adjustReasonHint(code, batchRemove)).toBeNull();
    expect(adjustReasonHint('', batchRemove)).toBeNull();
    // No FEFO draw, no hint: an Add, or an untracked SKU.
    expect(adjustReasonHint('expired', { batchTracked: true, direction: 'add' })).toBeNull();
    expect(adjustReasonHint('expired', { batchTracked: false, direction: 'remove' })).toBeNull();
  });
});

// ── eligibility ──────────────────────────────────────────────────────────────

const storage = { systemOwned: false, retiredAt: null };
const plain = { id: 'sku-plain', catchWeightTracked: false };

describe('adjustOffered — decision 4', () => {
  test('a storage bin, not retired (blocked is fine — the server skips bin gates)', () => {
    expect(adjustOffered(storage, null, null)).toBe(true);
    expect(adjustOffered(storage, plain, new Set())).toBe(true);
  });

  test('every system bin is out: RECEIVING (putaway), QC-HOLD, IN-TRANSIT, RETURNS, and DAMAGED (write-off only)', () => {
    expect(adjustOffered({ systemOwned: true, retiredAt: null }, plain, new Set())).toBe(false);
  });

  test('a retired bin, a missing bin', () => {
    expect(adjustOffered({ systemOwned: false, retiredAt: '2026-10-01T00:00:00.000Z' }, plain, new Set())).toBe(false);
    expect(adjustOffered(null, plain, new Set())).toBe(false);
    expect(adjustOffered(undefined, plain, new Set())).toBe(false);
  });

  test('a kit (from the kits read) and a catch-weight SKU are refused; an unread kit list decides nothing', () => {
    expect(adjustOffered(storage, plain, new Set(['sku-plain']))).toBe(false);
    expect(adjustOffered(storage, { id: 'cw', catchWeightTracked: true }, new Set())).toBe(false);
    expect(adjustOffered(storage, plain, null)).toBe(true);
  });

  test('adjustBins: storage bins not retired, by code', () => {
    const bins = [
      { id: '2', code: 'B-01', systemOwned: false, retiredAt: null },
      { id: '1', code: 'A-01', systemOwned: false, retiredAt: null },
      { id: 'r', code: 'RECEIVING', systemOwned: true, retiredAt: null },
      { id: 'x', code: 'A-00', systemOwned: false, retiredAt: '2026-01-01T00:00:00.000Z' },
    ];
    expect(adjustBins(bins as never).map((b) => b.code)).toEqual(['A-01', 'B-01']);
  });

  test('adjustSkuRefusal words a kit and catch-weight (the screen sentence)', () => {
    expect(adjustSkuRefusal({ code: 'BOX', catchWeightTracked: false }, true)).toBe('BOX is a kit — a kit holds no stock; adjust its component SKUs.');
    expect(adjustSkuRefusal({ code: 'FISH', catchWeightTracked: true }, false)).toBe(`${CATCH_WEIGHT_NOT_HERE}.`);
    expect(CATCH_WEIGHT_NOT_HERE).toBe('Catch-weight stock is adjusted by handling unit — not on this screen yet');
    expect(adjustSkuRefusal({ code: 'SPF', catchWeightTracked: false }, false)).toBeNull();
  });
});

describe('addSkuOptions — decision 9', () => {
  const skus = [
    { id: 'b', code: 'B-SKU', status: 'active', clientId: 'acme', catchWeightTracked: false },
    { id: 'a', code: 'A-SKU', status: 'active', clientId: 'glow', catchWeightTracked: false },
    { id: 'off', code: 'OFF', status: 'inactive', clientId: 'acme', catchWeightTracked: false },
    { id: 'kit', code: 'KIT', status: 'active', clientId: 'acme', catchWeightTracked: false },
    { id: 'cw', code: 'FISH', status: 'active', clientId: 'acme', catchWeightTracked: true },
  ] as const;
  const open = { dedicatedClientId: null, systemOwned: false, retiredAt: null };

  test('active SKUs passing adjustOffered (no kit, no catch-weight), by code', () => {
    expect(addSkuOptions(skus, open, new Set(['kit'])).map((s) => s.code)).toEqual(['A-SKU', 'B-SKU']);
  });

  test("a bin dedicated to ACME offers ACME's only", () => {
    expect(addSkuOptions(skus, { ...open, dedicatedClientId: 'acme' }, new Set(['kit'])).map((s) => s.code)).toEqual(['B-SKU']);
  });

  test('removeSkuBlock: an unknown SKU, a kit and catch-weight are listed disabled with their reason', () => {
    expect(removeSkuBlock(null, false)).toBe('unknown SKU');
    expect(removeSkuBlock({ catchWeightTracked: false }, true)).toBe('a kit holds no stock');
    expect(removeSkuBlock({ catchWeightTracked: true }, false)).toBe(CATCH_WEIGHT_NOT_HERE);
    expect(removeSkuBlock({ catchWeightTracked: false }, false)).toBeNull();
  });

  test('storageClassWarning: non-blocking words when the class does not suit the bin', () => {
    expect(storageClassWarning({ code: 'ICE', storageClass: 'frozen' }, { code: 'A-01', storageClass: 'ambient' })).toBe(
      'ICE is frozen stock and A-01 is a ambient bin — an adjustment skips the bin checks, so make sure this is where the units really are.',
    );
    // Colder bin over warmer SKU is fine (the server's storageClassSatisfies).
    expect(storageClassWarning({ code: 'MILK', storageClass: 'chilled' }, { code: 'F-01', storageClass: 'frozen' })).toBeNull();
    expect(storageClassWarning({ code: 'SPF', storageClass: 'ambient' }, { code: 'A-01', storageClass: 'ambient' })).toBeNull();
  });
});

// ── FEFO ─────────────────────────────────────────────────────────────────────

function batch(code: string, quantity: number, expiryDate: string | null, id = `id-${code}`): BatchListItemDto {
  return { id, code, mfgDate: null, expiryDate, status: 'active', quantity };
}
const NOW = Date.parse('2026-10-23T06:00:00.000Z');
const L1 = batch('L1', 3, '2027-01-15T00:00:00.000Z');
const L2 = batch('L2', 5, '2027-06-15T00:00:00.000Z');

describe('fefoBatch — the server rule (resolveFefoBatch)', () => {
  test('the oldest non-expired batch with stock: L1 (exp 2027-01) before L2 (exp 2027-06)', () => {
    expect(fefoBatch([L2, L1], NOW)).toEqual({ kind: 'one', batch: L1 });
    expect(fefoCap(fefoBatch([L2, L1], NOW))).toBe(3);
  });

  test('a batch with no stock in the bin is never a candidate', () => {
    expect(fefoBatch([{ ...L1, quantity: 0 }, L2], NOW)).toEqual({ kind: 'one', batch: L2 });
  });

  test('nulls last: a batch without expiry is drawn after every dated one', () => {
    const open = batch('OPEN', 9, null);
    expect(fefoBatch([open, L2], NOW)).toEqual({ kind: 'one', batch: L2 });
    expect(fefoBatch([open], NOW)).toEqual({ kind: 'one', batch: open });
  });

  test('an instant compare: one millisecond before expiry is drawable, one after is not', () => {
    const expiry = Date.parse(L1.expiryDate!);
    expect(fefoBatch([L1, L2], expiry - 1)).toEqual({ kind: 'one', batch: L1 });
    expect(fefoBatch([L1, L2], expiry)).toEqual({ kind: 'one', batch: L1 }); // expiry >= now
    expect(fefoBatch([L1, L2], expiry + 1)).toEqual({ kind: 'one', batch: L2 });
  });

  test('only expired batches: no candidate', () => {
    const old = batch('OLD', 4, '2026-01-01T00:00:00.000Z');
    expect(fefoBatch([old], NOW)).toEqual({ kind: 'none' });
    expect(fefoCap({ kind: 'none' })).toBeNull();
    expect(fefoPreview({ kind: 'none' }, { uomPrecision: 0 })).toBe('No unexpired batch holds stock here — pick the batch to remove, with a reason.');
  });

  test('a tie on expiry names both; the cap is the smaller', () => {
    const T1 = batch('L1', 3, '2027-01-15T00:00:00.000Z');
    const T2 = batch('L2', 5, '2027-01-15T00:00:00.000Z');
    const pick = fefoBatch([T1, T2, batch('L3', 1, '2027-09-01T00:00:00.000Z')], NOW);
    expect(pick).toEqual({ kind: 'tie', batches: [T1, T2] });
    expect(fefoCap(pick)).toBe(3);
    expect(fefoPreview(pick, { uomPrecision: 0 })).toBe('FEFO takes L1 or L2 — same expiry (3 here).');
  });

  test('the preview names the FEFO batch and its quantity at the SKU precision', () => {
    expect(fefoPreview(fefoBatch([L1, L2], NOW), { uomPrecision: 0 })).toBe('FEFO takes L1 (3 here).');
    expect(fefoPreview(fefoBatch([batch('K1', 2.5, null)], NOW), { uomPrecision: 3 })).toBe('FEFO takes K1 (2.500 here).');
  });
});

// ── IST dates ────────────────────────────────────────────────────────────────

describe('istDateToInstant — the istMidnightOf twin', () => {
  // Restored to the zone the run started in (deleting TZ would fall back to the host's, not the run's).
  const originalTz = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  test('an IST date → the Z instant of its IST midnight', () => {
    expect(istDateToInstant('2027-03-31')).toBe('2027-03-30T18:30:00.000Z');
    expect(istDateToInstant('2027-01-01')).toBe('2026-12-31T18:30:00.000Z');
  });

  test('the same answer for a viewer outside IST (Los Angeles, across DST, and UTC)', () => {
    for (const tz of ['America/Los_Angeles', 'UTC', 'Pacific/Kiritimati']) {
      process.env.TZ = tz;
      expect(istDateToInstant('2027-03-31')).toBe('2027-03-30T18:30:00.000Z');
      expect(istDateToInstant('2027-03-14')).toBe('2027-03-13T18:30:00.000Z');
    }
  });

  test('anything but a real date is null', () => {
    expect(istDateToInstant('2027-02-30')).toBeNull();
    expect(istDateToInstant('31/03/2027')).toBeNull();
    expect(istDateToInstant('')).toBeNull();
  });
});

// ── the draft ────────────────────────────────────────────────────────────────

const untracked = {
  id: 'sku-x',
  code: 'X',
  uom: 'each',
  uomPrecision: 0,
  batchTracked: false,
  serialTracked: false,
  catchWeightTracked: false,
  status: 'active',
} as const;
const lot = { ...untracked, id: 'sku-lot', code: 'LOT', batchTracked: true } as const;
const lotSerial = { ...untracked, id: 'sku-ls', code: 'PHONE', batchTracked: true, serialTracked: true } as const;
const kg = { ...untracked, id: 'sku-kg', code: 'RICE', uom: 'kg', uomPrecision: 3 } as const;

function draft(patch: Partial<AdjustDraft>): AdjustDraft {
  return { ...EMPTY_ADJUST_DRAFT, binId: 'bin-a', skuId: 'sku-x', reasonCode: 'found', note: 'Found behind the rack', ...patch };
}

function parse(d: AdjustDraft, sku: Parameters<typeof parseAdjustment>[0]['sku'] = untracked, extra: Partial<Parameters<typeof parseAdjustment>[0]> = {}) {
  return parseAdjustment({ warehouseId: 'w', draft: d, sku, isKit: false, batches: [L1, L2], held: null, nowMs: NOW, ...extra });
}

function body(result: ReturnType<typeof parseAdjustment>): StockAdjustmentDto {
  if (result.kind !== 'ok') throw new Error(`refused: ${result.problem}`);
  return result.body;
}

describe('parseAdjustment — the I/O matrix', () => {
  test('Add untracked: bin A, SKU X, Add 3, found, a note → quantityDelta 3, no arms', () => {
    expect(body(parse(draft({ direction: 'add', quantity: '3', note: '  Found behind the rack  ' })))).toEqual({
      warehouseId: 'w',
      skuId: 'sku-x',
      binId: 'bin-a',
      quantityDelta: 3,
      reasonCode: 'found',
      note: 'Found behind the rack',
    });
  });

  test('Remove is a negative delta; an untracked Remove past what the bin holds is refused', () => {
    expect(body(parse(draft({ direction: 'remove', quantity: '2', reasonCode: 'damaged' }), untracked, { held: 5 })).quantityDelta).toBe(-2);
    expect(parse(draft({ direction: 'remove', quantity: '6' }), untracked, { held: 5 })).toEqual({
      kind: 'refused',
      problem: 'The bin holds 5 each of X — remove at most that.',
    });
  });

  test('Remove, FEFO: no batch arm sent; Remove 4 against L1 (3) is blocked', () => {
    const ok = body(parse(draft({ skuId: 'sku-lot', direction: 'remove', quantity: '2' }), lot));
    expect(ok.quantityDelta).toBe(-2);
    expect(ok.batch).toBeUndefined();
    expect(parse(draft({ skuId: 'sku-lot', direction: 'remove', quantity: '4' }), lot)).toEqual({
      kind: 'refused',
      problem: 'FEFO takes L1 (3 here) — remove at most 3, or pick a batch.',
    });
  });

  test('FEFO with only an expired batch: an explicit batch is required', () => {
    const old = batch('OLD', 4, '2026-01-01T00:00:00.000Z');
    expect(parse(draft({ skuId: 'sku-lot', direction: 'remove', quantity: '1' }), lot, { batches: [old] })).toEqual({
      kind: 'refused',
      problem: 'No unexpired batch holds stock here — pick the batch to remove, with a reason.',
    });
    const picked = body(
      parse(draft({ skuId: 'sku-lot', direction: 'remove', quantity: '1', batchMode: 'pick', batchCode: 'OLD', overrideReason: 'expired lot' }), lot, {
        batches: [old],
      }),
    );
    expect(picked.batch).toEqual({ code: 'OLD', overrideReason: 'expired lot' });
  });

  test('Remove, override: L2 picked → batch {code, overrideReason}; no reason → blocked; past the batch → blocked', () => {
    const pick = { skuId: 'sku-lot', direction: 'remove', quantity: '4', batchMode: 'pick', batchCode: 'L2' } as const;
    expect(body(parse(draft({ ...pick, overrideReason: '  counted short  ' }), lot)).batch).toEqual({ code: 'L2', overrideReason: 'counted short' });
    expect(parse(draft({ ...pick, overrideReason: '   ' }), lot)).toEqual({
      kind: 'refused',
      problem: 'Say why this batch and not the FEFO one — an override needs a reason.',
    });
    expect(parse(draft({ ...pick, quantity: '6', overrideReason: 'x' }), lot)).toEqual({
      kind: 'refused',
      problem: 'Batch L2 holds 5 each here — remove at most that.',
    });
    expect(parse(draft({ ...pick, batchCode: '', overrideReason: 'x' }), lot)).toEqual({
      kind: 'refused',
      problem: 'LOT is batch-tracked — pick the batch to remove.',
    });
  });

  test('Add, new batch: L9 with expiry 2027-03-31 IST → the Z instant of IST midnight', () => {
    const added = body(parse(draft({ skuId: 'sku-lot', direction: 'add', quantity: '5', batchCode: ' L9 ', expiryDate: '2027-03-31' }), lot));
    expect(added.batch).toEqual({ code: 'L9', expiryDate: '2027-03-30T18:30:00.000Z' });
    const both = body(parse(draft({ skuId: 'sku-lot', direction: 'add', quantity: '5', batchCode: 'L9', mfgDate: '2026-10-01', expiryDate: '2027-03-31' }), lot));
    expect(both.batch).toEqual({ code: 'L9', mfgDate: '2026-09-30T18:30:00.000Z', expiryDate: '2027-03-30T18:30:00.000Z' });
  });

  test('Add, new batch: expiry before manufacture is blocked; the same day is fine', () => {
    expect(parse(draft({ skuId: 'sku-lot', direction: 'add', quantity: '5', batchCode: 'L9', mfgDate: '2027-04-01', expiryDate: '2027-03-31' }), lot)).toEqual({
      kind: 'refused',
      problem: 'The expiry date is before the manufacturing date.',
    });
    expect(parse(draft({ skuId: 'sku-lot', direction: 'add', quantity: '5', batchCode: 'L9', mfgDate: '2027-03-31', expiryDate: '2027-03-31' }), lot).kind).toBe('ok');
  });

  test('Add, existing batch L1: no dates sent (the server keeps the first dates)', () => {
    const added = body(parse(draft({ skuId: 'sku-lot', direction: 'add', quantity: '2', batchCode: 'L1', expiryDate: '2030-01-01' }), lot));
    expect(added.batch).toEqual({ code: 'L1' });
    expect(existingBatch([L1, L2], ' L1 ')).toBe(L1);
    expect(existingBatch([L1, L2], 'l1')).toBeNull();
    expect(existingBatch(null, 'L1')).toBeNull();
  });

  test('Add batch-tracked with no code is blocked; while the batches load nothing is sent', () => {
    expect(parse(draft({ skuId: 'sku-lot', direction: 'add', quantity: '2' }), lot)).toEqual({
      kind: 'refused',
      problem: 'LOT is batch-tracked — type the batch code the units carry.',
    });
    expect(parse(draft({ skuId: 'sku-lot', direction: 'add', quantity: '2', batchCode: 'L1' }), lot, { batches: null })).toEqual({
      kind: 'refused',
      problem: 'Still reading the batches — try again in a moment.',
    });
  });

  test('a batch + serial SKU sends both arms (FEFO or override); a count unequal to the quantity is blocked', () => {
    const fefo = body(parse(draft({ skuId: 'sku-ls', direction: 'remove', quantity: '2', serials: 'S1\nS2' }), lotSerial));
    expect(fefo.batch).toBeUndefined();
    expect(fefo.serials).toEqual(['S1', 'S2']);
    expect(fefo.quantityDelta).toBe(-2);
    const override = body(
      parse(draft({ skuId: 'sku-ls', direction: 'remove', quantity: '2', serials: 'S1, S2', batchMode: 'pick', batchCode: 'L2', overrideReason: 'r' }), lotSerial),
    );
    expect(override.batch).toEqual({ code: 'L2', overrideReason: 'r' });
    expect(override.serials).toEqual(['S1', 'S2']);
    const added = body(parse(draft({ skuId: 'sku-ls', direction: 'add', quantity: '1', serials: 'S9', batchCode: 'L1' }), lotSerial));
    expect(added).toMatchObject({ quantityDelta: 1, batch: { code: 'L1' }, serials: ['S9'] });
    expect(parse(draft({ skuId: 'sku-ls', direction: 'remove', quantity: '2', serials: 'S1' }), lotSerial)).toEqual({
      kind: 'refused',
      problem: 'PHONE is serial-tracked — list one serial per unit: 1 listed for 2.',
    });
  });

  test('a duplicated serial is refused, never dropped', () => {
    expect(parse(draft({ skuId: 'sku-ls', direction: 'add', quantity: '2', serials: 'S1\nS1', batchCode: 'L1' }), lotSerial)).toEqual({
      kind: 'refused',
      problem: 'S1 is listed twice — one serial per unit.',
    });
  });

  test('the order of the problems: bin, direction, SKU, kit / catch-weight, quantity, reason, note', () => {
    expect(parse(draft({ binId: '' }))).toEqual({ kind: 'refused', problem: 'Pick the bin.' });
    expect(parse(draft({ direction: '' }))).toEqual({ kind: 'refused', problem: 'Choose Add or Remove.' });
    expect(parse(draft({ direction: 'add' }), null)).toEqual({ kind: 'refused', problem: 'Pick the SKU.' });
    expect(parseAdjustment({ warehouseId: 'w', draft: draft({ direction: 'add', quantity: '1' }), sku: untracked, isKit: true, batches: null, held: null, nowMs: NOW })).toEqual({
      kind: 'refused',
      problem: 'X is a kit — a kit holds no stock; adjust its component SKUs.',
    });
    expect(parse(draft({ direction: 'add', quantity: '1' }), { ...untracked, catchWeightTracked: true })).toEqual({
      kind: 'refused',
      problem: `${CATCH_WEIGHT_NOT_HERE}.`,
    });
    expect(parse(draft({ direction: 'add', quantity: '0' }))).toEqual({ kind: 'refused', problem: 'Type how many units to add — a positive number.' });
    expect(parse(draft({ direction: 'remove', quantity: '' }))).toEqual({ kind: 'refused', problem: 'Type how many units to remove — a positive number.' });
    expect(parse(draft({ direction: 'add', quantity: '1', reasonCode: '' }))).toEqual({ kind: 'refused', problem: 'Pick a reason for the adjustment.' });
    expect(parse(draft({ direction: 'add', quantity: '1', note: '  ' }))).toEqual({
      kind: 'refused',
      problem: 'Add a note — what was found, and why the stock changes.',
    });
    expect(parse(draft({ direction: 'add', quantity: '1', note: 'x'.repeat(501) }))).toEqual({ kind: 'refused', problem: 'The note is at most 500 characters.' });
  });

  test('the bounds: a code over 64, an override reason over 200, a batch without stock here, an unreal date, over 1000 serials', () => {
    expect(parse(draft({ skuId: 'sku-lot', direction: 'add', quantity: '1', batchCode: 'B'.repeat(65) }), lot)).toEqual({
      kind: 'refused',
      problem: 'A batch code is at most 64 characters.',
    });
    expect(
      parse(draft({ skuId: 'sku-lot', direction: 'remove', quantity: '1', batchMode: 'pick', batchCode: 'L2', overrideReason: 'r'.repeat(201) }), lot),
    ).toEqual({ kind: 'refused', problem: 'Keep the override reason to 200 characters.' });
    expect(
      parse(draft({ skuId: 'sku-lot', direction: 'remove', quantity: '1', batchMode: 'pick', batchCode: 'L0', overrideReason: 'r' }), lot, {
        batches: [L1, L2, batch('L0', 0, null)],
      }),
    ).toEqual({ kind: 'refused', problem: 'Batch L0 holds no stock in this bin now — pick another.' });
    expect(parse(draft({ skuId: 'sku-lot', direction: 'add', quantity: '1', batchCode: 'L9', expiryDate: '2027-02-30' }), lot)).toEqual({
      kind: 'refused',
      problem: 'The expiry date is not a real date.',
    });
    expect(parse(draft({ skuId: 'sku-lot', direction: 'add', quantity: '1', batchCode: 'L9', mfgDate: '2027-13-01' }), lot)).toEqual({
      kind: 'refused',
      problem: 'The manufacturing date is not a real date.',
    });
    const many = Array.from({ length: 1001 }, (_, i) => `S${i}`).join('\n');
    expect(parse(draft({ skuId: 'sku-ls', direction: 'add', quantity: '1001', batchCode: 'L1', serials: many }), lotSerial)).toEqual({
      kind: 'refused',
      problem: 'An adjustment carries at most 1000 serials — split it.',
    });
  });

  test('the row path: an Add of an inactive SKU is refused (the picker rule); a Remove of it is not', () => {
    const inactive = { ...untracked, status: 'inactive' } as const;
    expect(parse(draft({ direction: 'add', quantity: '1' }), inactive)).toEqual({ kind: 'refused', problem: 'X is inactive — an Add takes active SKUs only.' });
    expect(parse(draft({ direction: 'remove', quantity: '1' }), inactive).kind).toBe('ok');
  });

  test('addExpiredBatchWarning: an Add into an expired batch, existing or new, warns without blocking', () => {
    const old = batch('OLD', 4, '2026-01-01T00:00:00.000Z');
    expect(addExpiredBatchWarning({ batchCode: 'OLD', expiryDate: '' }, [old, L1], NOW)).toBe(
      'Batch OLD is already past its expiry — FEFO will never draw it; check the date before adding stock to it.',
    );
    expect(addExpiredBatchWarning({ batchCode: 'L1', expiryDate: '' }, [old, L1], NOW)).toBeNull();
    expect(addExpiredBatchWarning({ batchCode: 'L9', expiryDate: '2026-10-01' }, [old, L1], NOW)).toContain('Batch L9 is already past its expiry');
    expect(addExpiredBatchWarning({ batchCode: 'L9', expiryDate: '2027-10-01' }, [old, L1], NOW)).toBeNull();
    expect(addExpiredBatchWarning({ batchCode: '', expiryDate: '2026-10-01' }, [old], NOW)).toBeNull();
    // Non-blocking: the body still goes.
    expect(parse(draft({ skuId: 'sku-lot', direction: 'add', quantity: '1', batchCode: 'OLD' }), lot, { batches: [old] }).kind).toBe('ok');
  });

  test('the quantity at the SKU precision: refused, never rounded', () => {
    expect(body(parse(draft({ skuId: 'sku-kg', direction: 'add', quantity: '2.5' }), kg)).quantityDelta).toBe(2.5);
    expect(parse(draft({ skuId: 'sku-kg', direction: 'add', quantity: '2.5005' }), kg)).toEqual({
      kind: 'refused',
      problem: 'kg takes at most 3 decimal place(s) — 2.5005 has more.',
    });
    expect(parse(draft({ direction: 'add', quantity: '1.5' }))).toEqual({ kind: 'refused', problem: 'each counts in whole units — 1.5 is not one.' });
    // The shared helper the 2-4a write-off now uses: the caller's own words for a blank field.
    expect(parseAdjustQuantity('', untracked, 'Type how many units to write off — a positive number.')).toEqual({
      qty: null,
      problem: 'Type how many units to write off — a positive number.',
    });
  });
});

// ── the answer ───────────────────────────────────────────────────────────────

const SKU = { id: '0198f7a2-1b3c-7d4e-8f90-00000000c001', code: 'SPF', uom: 'each', uomPrecision: 0 } as const;
const WH = '0198f7a2-1b3c-7d4e-8f90-99aabbccddee';
const BIN = '0198f7a2-1b3c-7d4e-8f90-00000000b001';
const SUBMITTED = Date.parse('2026-10-23T06:00:00.000Z');
const labels = { warehouseId: WH, binId: BIN, binCode: 'A-01', sku: SKU, submittedAtMs: SUBMITTED };

describe('adjustOutcome — decision 11', () => {
  test('201: "Adjusted — SPF −2 each in A-01", built from the response, with the ledger link', () => {
    const outcome = adjustOutcome(
      {
        kind: 'applied',
        adjustment: {
          event: { id: 'e', seq: 9, type: 'stock.adjusted', skuId: SKU.id, binId: BIN, quantityDelta: -2, occurredAt: 'x', recordedAt: 'x' },
          onHand: {} as never,
        },
      },
      labels,
    );
    expect(outcome).toEqual({
      tone: 'accepted',
      word: 'Adjusted',
      reason: 'SPF −2 each in A-01.',
      link: { href: adjustLedgerHref(WH, SKU.id, BIN, SUBMITTED), label: 'See it in the ledger' },
    });
  });

  test('the ledger link is a ledger drill the /inventory/ledger page parses (SKU, bin, stock.adjusted, from a minute before the submit)', () => {
    const href = adjustLedgerHref(WH, SKU.id, BIN, SUBMITTED);
    const params = Object.fromEntries(new URL(href, 'http://x').searchParams);
    expect(new URL(href, 'http://x').pathname).toBe('/inventory/ledger');
    expect(parseDrill('ledger', params)).toEqual({
      list: 'ledger',
      warehouseId: WH,
      skuId: SKU.id,
      binId: BIN,
      type: ['stock.adjusted'],
      from: '2026-10-23T05:59:00.000Z',
    });
  });

  test('202: "Pending approval — over the 10 threshold" at the SKU precision, with the queue link', () => {
    const pend = {
      pendingAdjustment: { quantityDelta: 25, thresholdQuantityAtRequest: 10 } as never,
    };
    const outcome = adjustOutcome({ kind: 'pending', pending: pend }, labels);
    expect(outcome.tone).toBe('warning');
    expect(outcome.word).toBe('Pending approval');
    expect(outcome.reason).toBe("Over the 10 threshold — SPF +25 each in A-01 waits for an owner's approval; stock is unchanged until then.");
    expect(outcome.link).toEqual({ href: ADJUSTMENT_PENDINGS_HREF, label: 'Open the approval queue' });
    const kgOutcome = adjustOutcome({ kind: 'pending', pending: { pendingAdjustment: { quantityDelta: -12.5, thresholdQuantityAtRequest: 10 } as never } }, {
      ...labels,
      sku: { ...SKU, uom: 'kg', uomPrecision: 3 },
    });
    expect(kgOutcome.reason).toContain('Over the 10.000 threshold — SPF −12.500 kg in A-01');
  });
});

describe('adjustReason — every code in words', () => {
  const p = (status: number, code: string, title = code, detail?: string) => new ApiProblem(code, status, detail, title);

  test('the domain refusals', () => {
    expect(adjustReason(p(422, 'insufficient-on-hand'))).toBe('The bin (or the batch) holds fewer units than that now — refresh and try a smaller quantity.');
    expect(adjustReason(p(400, 'bin-retired'))).toBe('The bin is retired — nothing was changed.');
    expect(adjustReason(p(400, 'qc-bin-not-adjustable'))).toBe('A QC-hold or in-transit bin cannot be adjusted — its stock moves by its own task.');
    expect(adjustReason(p(400, 'returns-bin-not-adjustable'))).toBe(
      'The RETURNS bin cannot be adjusted — returned units move by a return receipt and its disposition.',
    );
    expect(adjustReason(p(400, 'damaged-bin-write-off-only'))).toBe('The DAMAGED bin only takes a write-off — use Write off on its row.');
    expect(adjustReason(p(409, 'kit-cannot-hold-stock'))).toBe('A kit holds no stock — adjust its component SKUs.');
    expect(adjustReason(p(422, 'insufficient-on-hand', 'No batch to draw', 'Bin x holds no non-expired batch'))).toBe(
      'No unexpired batch holds stock here now — pick the batch, with a reason.',
    );
    expect(adjustReason(p(409, 'duplicate-serial', 'd', 'Serial S1 is already in bin A'))).toBe('A serial is already in stock — an Add takes only serials that are not on hand.');
    expect(adjustReason(p(409, 'serial-elsewhere', 's', 'server words'))).toBe('A serial is in another bin — check the serials against this bin.');
    expect(adjustReason(p(404, 'serial-unknown', 's', 'server words'))).toBe('A serial is unknown for this SKU — check the serials.');
    expect(adjustReason(p(409, 'client-departed'))).toBe(CLIENT_DEPARTED_REASON);
  });

  test('a batch not-found vs a bin or SKU not-found', () => {
    expect(adjustReason(p(404, 'not-found', 'Batch not found'), { batchCode: 'L2' })).toBe(
      'Batch L2 no longer exists for this SKU — reload the batches and pick again.',
    );
    expect(adjustReason(p(404, 'not-found', 'Bin not found'), { batchCode: 'L2' })).toBe('The bin or the SKU no longer exists — reload and pick again.');
    expect(adjustReason(p(404, 'not-found', 'Batch not found'))).toBe('The bin or the SKU no longer exists — reload and pick again.');
  });

  test('the house codes, and the transport arm', () => {
    expect(adjustReason(p(403, 'role-denied'))).toBe('Your role cannot adjust stock.');
    expect(adjustReason(p(403, 'permission-denied'))).toBe('That warehouse belongs to another tenant — sign in again.');
    // A fixed sentence for every code — never the server's detail.
    expect(adjustReason(p(400, 'validation-failed', 'v', 'serials contains duplicates'))).toBe(
      'The server refused the adjustment as sent — check the quantity, the batch and the serials, then try again.',
    );
    expect(adjustReason(p(422, 'idempotency-key-reuse'))).toBe(
      'This adjustment was already sent with different details — change something and send it again.',
    );
    expect(adjustReason(p(409, 'conflict'))).toBe('The same adjustment is still being processed — try again to read the result.');
    expect(adjustReason(p(500, 'request-failed'))).toBe('The server could not record the adjustment — try again.');
    expect(adjustReason(p(418, 'brand-new', 't', 'the server words'))).toBe('Not adjusted (brand-new).');
    expect(adjustReason(p(418, 'brand-new'))).toBe('Not adjusted (brand-new).');
    expect(adjustReason(new TypeError('Failed to fetch'))).toBe(UNREACHABLE_REASON);
  });
});
