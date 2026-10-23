import { describe, expect, test } from 'bun:test';

import {
  QC_FAIL_REASONS,
  buildInspectBody,
  draftTotals,
  expiredPassWarning,
  failedOf,
  initialArmDraft,
  inspectedResultLabel,
  inspectionSummary,
} from './qc-inspection';

const EACH = { uom: 'each', uomPrecision: 0 };
const KG = { uom: 'kg', uomPrecision: 3 };
const arm = (batchId: string | null, quantity: number, over: Record<string, unknown> = {}) => ({
  batchId,
  batchCode: batchId === null ? null : `LOT-${batchId}`,
  expiryDate: null,
  quantity,
  ...over,
});

describe('the inspection draft (story 2-8a)', () => {
  test('the server vocabulary, in its order', () => {
    expect(QC_FAIL_REASONS).toEqual(['damaged', 'expired', 'contaminated', 'wrong-item', 'spec-failure', 'other']);
  });

  test('Passed defaults to the whole arm as a plain decimal (never grouped)', () => {
    expect(initialArmDraft({ quantity: 3000 })).toEqual({ passed: '3000', reason: '' });
    expect(initialArmDraft({ quantity: 2.5 })).toEqual({ passed: '2.5', reason: '' });
  });

  test('failed = held − passed, exact at milli-units; out of range or not a number is null', () => {
    expect(failedOf(10, '7')).toBe(3);
    expect(failedOf(2.5, '1.75')).toBe(0.75);
    expect(failedOf(0.3, '0.1')).toBe(0.2);
    expect(failedOf(10, '11')).toBeNull();
    expect(failedOf(10, '-1')).toBeNull();
    expect(failedOf(10, '1e1')).toBeNull();
    expect(draftTotals([arm('a', 10), arm('b', 2)], [{ passed: '7', reason: '' }, { passed: '0', reason: '' }])).toEqual({ passed: 7, failed: 5 });
    expect(draftTotals([arm('a', 10)], [{ passed: 'x', reason: '' }])).toBeNull();
  });

  test('the body covers every arm; a failure carries its reason; held quantities are never sent', () => {
    const result = buildInspectBody(
      [arm(null, 10), arm('b', 4)],
      [
        { passed: '10', reason: '' },
        { passed: '1', reason: 'damaged' },
      ],
      '  crushed corner  ',
      EACH,
    );
    expect(result).toEqual({
      ok: true,
      body: {
        lines: [
          { batchId: null, passed: 10, failed: [] },
          { batchId: 'b', passed: 1, failed: [{ reason: 'damaged', quantity: 3 }] },
        ],
        note: 'crushed corner',
      },
      passed: 11,
      failed: 3,
    });
    // No note: the key is absent, not empty.
    const plain = buildInspectBody([arm(null, 2)], [{ passed: '2', reason: '' }], '   ', EACH);
    expect(plain.ok && plain.body).toEqual({ lines: [{ batchId: null, passed: 2, failed: [] }] });
  });

  test('refusals in words: a missing reason, Other without a note, finer than the unit, more than held, a long note', () => {
    const refuse = (drafts: { passed: string; reason: '' | 'other' | 'damaged' }[], note = '', sku = EACH, held = 10) => {
      const result = buildInspectBody([arm('b', held)], drafts, note, sku);
      return result.ok ? null : result.problem;
    };
    expect(refuse([{ passed: '7', reason: '' }])).toBe('Pick why 3 of LOT-b failed.');
    expect(refuse([{ passed: '7', reason: 'other' }])).toContain('needs a note');
    expect(refuse([{ passed: '7', reason: 'other' }], 'leaking')).toBeNull();
    expect(refuse([{ passed: '7.5', reason: 'damaged' }])).toContain('whole units');
    expect(refuse([{ passed: '1.2345', reason: 'damaged' }], '', KG, 2)).toContain('3 decimal place');
    expect(refuse([{ passed: '11', reason: '' }])).toContain('cannot be more');
    expect(refuse([{ passed: '', reason: '' }])).toContain('Enter the units');
    expect(refuse([{ passed: '10', reason: '' }], 'x'.repeat(501))).toContain('500');
  });

  test('the summary and an inspected row read "N pass, M fail → DAMAGED" at the unit precision', () => {
    expect(inspectionSummary(7, 3, 0)).toBe('7 pass, 3 fail → DAMAGED');
    expect(inspectionSummary(1.75, 0.75, 3)).toBe('1.750 pass, 0.750 fail → DAMAGED');
    expect(inspectedResultLabel({ heldQty: 10, failedQuantity: 3 }, 0)).toBe('7 pass, 3 fail → DAMAGED');
    expect(inspectedResultLabel({ heldQty: 6, failedQuantity: 0 }, 0)).toBe('6 pass, 0 fail → DAMAGED');
  });

  test('the expired-batch warning matches the server\'s rule: expired from the IST midnight that begins the expiry day', () => {
    const at = (iso: string) => Date.parse(iso);
    const arm18 = arm('b', 4, { expiryDate: '2026-10-18' });
    // 2026-10-18 begins at 2026-10-17T18:30Z (IST midnight).
    expect(expiredPassWarning(arm18, 4, at('2026-10-17T18:29:59.999Z'))).toBeNull(); // the day before, last instant
    expect(expiredPassWarning(arm18, 4, at('2026-10-17T18:30:00.001Z'))).toContain('expired on 2026-10-18'); // ON the expiry day
    expect(expiredPassWarning(arm18, 4, at('2026-10-19T06:00:00Z'))).toContain('expired on 2026-10-18');
    expect(expiredPassWarning(arm18, 0, at('2026-10-19T06:00:00Z'))).toBeNull(); // nothing passes
    expect(expiredPassWarning(arm(null, 4), 4, at('2026-10-19T06:00:00Z'))).toBeNull(); // no expiry
  });
});
