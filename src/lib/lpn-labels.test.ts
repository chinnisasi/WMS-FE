import { afterEach, describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import {
  chunkIds,
  defaultUnitsPerLabel,
  labelledQuantity,
  lpnCountLabel,
  lpnLabelsBody,
  lpnLabelsFilename,
  lpnRefusal,
  mintBody,
  splitLabelQuantities,
  mintedButNotDownloaded,
  splitPreview,
  unlabelledOf,
  voidBody,
} from '@/lib/lpn-labels';

function problem(code: string, status: number, extensions: Record<string, unknown> = {}, detail?: string): ApiProblem {
  return new ApiProblem(code, status, detail, undefined, extensions);
}

describe('LPN labels (story 2-10b)', () => {
  const savedTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = savedTz;
  });

  test('the split: full labels plus one remainder, in integer thousandths', () => {
    expect(splitLabelQuantities(100, 40, 0)).toEqual([40, 40, 20]);
    expect(splitLabelQuantities(100, 50, 0)).toEqual([50, 50]);
    expect(splitLabelQuantities(100, 100, 0)).toEqual([100]);
    expect(splitLabelQuantities(30, 100, 0)).toEqual([30]);
    // Fractions exact: 12.5 / 2.5 and 10 / 3 never drift.
    expect(splitLabelQuantities(12.5, 2.5, 3)).toEqual([2.5, 2.5, 2.5, 2.5, 2.5]);
    expect(splitLabelQuantities(10, 3.333, 3)).toEqual([3.333, 3.333, 3.333, 0.001]);
    expect(splitLabelQuantities(0.3, 0.1, 3)).toEqual([0.1, 0.1, 0.1]);
    // Nothing to label, a non-positive figure, a figure finer than the unit allows.
    expect(splitLabelQuantities(0, 40, 0)).toEqual([]);
    expect(splitLabelQuantities(100, 0, 0)).toEqual([]);
    expect(splitLabelQuantities(100, Number.NaN, 0)).toEqual([]);
    expect(splitLabelQuantities(100, 1.5, 0)).toEqual([]);
    expect(splitLabelQuantities(10, 0.0005, 3)).toEqual([]);
  });

  test('the default units per label: pallet, else carton, else case, else the whole quantity', () => {
    const sku = (levels: [string, number][]) => ({ uomConversions: levels.map(([uom, factor]) => ({ uom, factor })) }) as never;
    expect(defaultUnitsPerLabel(sku([['case', 12], ['carton', 48], ['pallet', 960]]), 2000)).toBe(960);
    expect(defaultUnitsPerLabel(sku([['case', 12], ['carton', 48]]), 2000)).toBe(48);
    expect(defaultUnitsPerLabel(sku([['case', 12], ['box', 6]]), 2000)).toBe(12);
    expect(defaultUnitsPerLabel(sku([['box', 6]]), 70)).toBe(70);
    expect(defaultUnitsPerLabel(null, 70)).toBe(70);
  });

  test("unlabelledOf reads the server's per-line figure; an unnamed line is 0", () => {
    const lines = [{ grnLineId: 'l1', unlabelledQty: 40 }, { grnLineId: 'l2', unlabelledQty: 12.5 }];
    expect(unlabelledOf(lines, 'l1')).toBe(40);
    expect(unlabelledOf(lines, 'l2')).toBe(12.5);
    expect(unlabelledOf(lines, 'l3')).toBe(0);
  });

  test('a mint whose download failed names what was created and points at the reprint', () => {
    expect(mintedButNotDownloaded(['LPN-000001', 'LPN-000002', 'LPN-000003'], 'offline')).toBe(
      'LPN-000001–LPN-000003 were created, but the download failed (offline) — tick them in the list and download again; do not create them again.',
    );
    expect(mintedButNotDownloaded(['LPN-000009'], 'x')).toContain('LPN-000009 was created');
  });

  test('labelled: voided LPNs free their quantity', () => {
    const lpns = [
      { qty: 40, status: 'active' as const },
      { qty: 40, status: 'placed' as const },
      { qty: 15.5, status: 'voided' as const },
    ];
    expect(labelledQuantity(lpns)).toBe(80);
    expect(lpnCountLabel(lpns)).toBe('2 LPNs');
    expect(lpnCountLabel([{ status: 'voided' }])).toBeNull();
    expect(lpnCountLabel([{ status: 'active' }])).toBe('1 LPN');
  });

  test('the preview: every quantity for a short split, a summary for a long one', () => {
    expect(splitPreview([40, 40, 20])).toBe('3 labels: 40, 40, 20');
    expect(splitPreview([5])).toBe('1 label: 5');
    expect(splitPreview(splitLabelQuantities(4780, 40, 0))).toBe('120 labels: 119 × 40 and 1 × 20');
    expect(splitPreview(splitLabelQuantities(400, 40, 0))).toBe('10 labels: 10 × 40');
    expect(splitPreview([])).toBe('No labels');
  });

  test('the bodies: mint, void (trimmed note only when present), print (size only on a thermal label, a4 only as PDF)', () => {
    expect(mintBody('l1', [40, 20])).toEqual({ lines: [{ grnLineId: 'l1', quantities: [40, 20] }] });
    expect(voidBody('misprint', '   ')).toEqual({ reasonCode: 'misprint' });
    expect(voidBody('other', '  wet  ')).toEqual({ reasonCode: 'other', note: 'wet' });
    expect(lpnLabelsBody({ lpnIds: ['a'] }, 'zpl', '2x1')).toEqual({ lpnIds: ['a'], format: 'zpl', layout: 'label', size: '2x1' });
    expect(lpnLabelsBody({ grnLineId: 'l1' }, 'zpl', 'a4')).toEqual({ grnLineId: 'l1', format: 'pdf', layout: 'a4' });
  });

  test('chunks of 1000 in order', () => {
    const ids = Array.from({ length: 2400 }, (_v, i) => `id-${i}`);
    const chunks = chunkIds(ids);
    expect(chunks.map((c) => c.length)).toEqual([1000, 1000, 400]);
    expect(chunks[1]![0]).toBe('id-1000');
    expect(chunkIds([])).toEqual([]);
  });

  test('the filename: lpn-labels-<GRN>-<YYYYMMDD>.<ext>, the GRN code folded; a chunked part names itself', () => {
    expect(lpnLabelsFilename('GRN-0007', 'zpl', '2026-10-21T10:00:00.000Z')).toBe('lpn-labels-GRN-0007-20261021.zpl');
    expect(lpnLabelsFilename('GRN 1/"é', 'pdf', '2026-10-21T10:00:00.000Z')).toBe('lpn-labels-GRN-1----20261021.pdf');
    expect(lpnLabelsFilename('GRN-0007', 'pdf', '2026-10-21T10:00:00.000Z', { n: 2, of: 3 })).toBe('lpn-labels-GRN-0007-20261021-part2of3.pdf');
    expect(lpnLabelsFilename('GRN-0007', 'pdf', '2026-10-21T10:00:00.000Z', { n: 1, of: 1 })).toBe('lpn-labels-GRN-0007-20261021.pdf');
  });

  test('the filename date is the IST date at the boundary — for a viewer outside IST between 00:00 and 05:30 IST too', () => {
    process.env.TZ = 'America/New_York';
    const justAfter = Date.parse('2026-10-21T19:00:00.000Z');
    expect(new Date(justAfter).getDate()).toBe(21);
    expect(lpnLabelsFilename('G', 'zpl', justAfter)).toBe('lpn-labels-G-20261022.zpl');
    expect(lpnLabelsFilename('G', 'zpl', '2026-10-21T18:30:00.000Z')).toBe('lpn-labels-G-20261022.zpl');
    expect(lpnLabelsFilename('G', 'zpl', '2026-10-21T18:29:59.999Z')).toBe('lpn-labels-G-20261021.zpl');
  });

  test('refusals branch on code and list lpnCodes', () => {
    expect(lpnRefusal(new Error('boom'))).toEqual({ reason: UNREACHABLE_REASON, lpnCodes: [] });
    expect(lpnRefusal(problem('lpn-quantity-exceeds-line', 422, { remaining: 10 })).reason).toContain('Only 10 more');
    expect(lpnRefusal(problem('lpn-quantity-exceeds-line', 422, { remaining: 0 })).reason).toContain('already on a label');
    expect(lpnRefusal(problem('too-many-labels', 422, { count: 2400 })).reason).toContain('2400');
    expect(lpnRefusal(problem('lpn-voided', 422, { lpnCodes: ['LPN-000001', 7] }))).toMatchObject({ lpnCodes: ['LPN-000001'] });
    expect(lpnRefusal(problem('lpn-code-too-long-for-label', 422, { lpnCodes: ['LPN-12345678'] })).lpnCodes).toEqual(['LPN-12345678']);
    expect(lpnRefusal(problem('lpn-not-active', 409, { lpnCode: 'LPN-000002', lpnStatus: 'placed' }))).toEqual({
      reason: 'This LPN was already put away — it cannot be voided.',
      lpnCodes: ['LPN-000002'],
    });
    expect(lpnRefusal(problem('lpn-not-active', 409, { lpnStatus: 'voided' })).reason).toBe('This LPN is already voided.');
    expect(lpnRefusal(problem('no-lpns-to-print', 404)).reason).toContain('create labels first');
    expect(lpnRefusal(problem('role-denied', 403)).reason).toContain('Your role');
    expect(lpnRefusal(problem('validation-failed', 400, {}, 'quantities must be whole')).reason).toBe('quantities must be whole');
    expect(lpnRefusal(problem('something-new', 418)).reason).toContain('something-new');
  });
});
