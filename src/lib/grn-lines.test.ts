import { describe, expect, test } from 'bun:test';

import { grnDamagedSuffix, grnLineAppliedLabel, grnLineBatchDatesLabel, grnLineConditionLabel, grnShortSuffix } from './grn-lines';

/** Story 2-4a — a goods receipt's condition in words. */

const each = { uom: 'each', uomPrecision: 0 };
const kg = { uom: 'kg', uomPrecision: 3 };

describe('grnLineConditionLabel', () => {
  test('good only; good + damaged + short with their reasons; an all-damaged line; an unknown code shows itself', () => {
    expect(grnLineConditionLabel({ qty: 5 }, each)).toBe('good 5');
    expect(
      grnLineConditionLabel({ qty: 90, damagedQty: 10, damageReasonCode: 'crushed', shortQty: 5, shortReasonCode: 'not-shipped' }, each),
    ).toBe('good 90 · damaged 10 (Crushed) · short 5 (Not shipped)');
    expect(grnLineConditionLabel({ qty: 0, damagedQty: 2.5, damageReasonCode: 'wet' }, kg)).toBe('good 0.000 · damaged 2.500 (Wet)');
    expect(grnLineConditionLabel({ qty: 1, damagedQty: 1, damageReasonCode: 'melted' as never }, null)).toBe('good 1 · damaged 1 (melted)');
  });

  test('the applied part only when it differs from the good units', () => {
    expect(grnLineAppliedLabel({ qty: 12, appliedQty: 12 }, each)).toBe('');
    expect(grnLineAppliedLabel({ qty: 12, appliedQty: 10 }, each)).toBe(' · applied 10 each (+2 pending)');
  });
});

describe('the list suffixes', () => {
  test('"+N damaged" and "· N short" only when present (an older server sends neither)', () => {
    expect(grnDamagedSuffix({ damagedUnits: 3 })).toBe(' +3 damaged');
    expect(grnDamagedSuffix({ damagedUnits: 0 })).toBe('');
    expect(grnDamagedSuffix({} as never)).toBe('');
    expect(grnShortSuffix({ shortUnits: 2 })).toBe(' · 2 short');
    expect(grnShortSuffix({ shortUnits: 0 })).toBe('');
  });
});

describe('story 2-4b: grnLineBatchDatesLabel', () => {
  test('mfg and exp after the batch, the expiry marked when derived from shelf life', () => {
    expect(grnLineBatchDatesLabel({ batchMfgDate: '2026-09-01', batchExpiryDate: '2027-02-28', expirySource: 'derived' })).toBe(
      'mfg 2026-09-01 · exp 2027-02-28 (from shelf life)',
    );
    expect(grnLineBatchDatesLabel({ batchMfgDate: null, batchExpiryDate: '2027-01-31', expirySource: 'typed' })).toBe('exp 2027-01-31');
    expect(grnLineBatchDatesLabel({ batchMfgDate: '2026-09-01', batchExpiryDate: null, expirySource: null })).toBe('mfg 2026-09-01');
    expect(grnLineBatchDatesLabel({ batchMfgDate: null, batchExpiryDate: '2027-01-31', expirySource: null })).toBe('exp 2027-01-31');
    expect(grnLineBatchDatesLabel({ batchMfgDate: null, batchExpiryDate: null, expirySource: null })).toBeNull();
    // An older answer without the keys says nothing.
    expect(grnLineBatchDatesLabel({})).toBeNull();
  });
});
