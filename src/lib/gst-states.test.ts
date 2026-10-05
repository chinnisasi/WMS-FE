import { describe, expect, test } from 'bun:test';

import {
  GST_STATE_NAMES,
  GSTIN_STATE_CODES,
  STATE_OPTIONS,
  buyerGstinStateMismatch,
  gstinStateMismatch,
  tenantGstinStateMismatch,
  gstinStateName,
  isGstinStateCode,
} from './gst-states';

describe('gst-states (story 8-1d)', () => {
  test('GSTIN_STATE_CODES mirrors wms-be byte-for-byte: GST_STATE_NAMES minus 99, sorted', () => {
    // wms-be src/shared/primitives/gstin.ts `GSTIN_STATE_CODES`; the backend
    // pins its copy against the gst_state_codes table (issuance-gate-parity.spec.ts).
    expect([...GSTIN_STATE_CODES]).toEqual([
      '01', '02', '03', '04', '05', '06', '07', '08', '09', '10',
      '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
      '21', '22', '23', '24', '26', '27', '29', '30', '31', '32',
      '33', '34', '35', '36', '37', '38', '97',
    ]);
    expect([...GSTIN_STATE_CODES]).toEqual(Object.keys(GST_STATE_NAMES).filter((code) => code !== '99').sort());
  });

  test('the predicate refuses the merged, pre-GST, Centre-Jurisdiction and unassigned codes', () => {
    expect(['25', '28', '99', '92', '00', '96'].map(isGstinStateCode)).toEqual([false, false, false, false, false, false]);
    expect(['01', '26', '27', '29', '38', '97'].map(isGstinStateCode)).toEqual([true, true, true, true, true, true]);
  });

  test('the State select offers the official names for 01–38 and 97 — never 99 — alphabetically', () => {
    expect(STATE_OPTIONS).toHaveLength(37);
    expect(STATE_OPTIONS).toContain('Karnataka');
    expect(STATE_OPTIONS).toContain('Other Territory');
    expect(STATE_OPTIONS).toContain('Dadra and Nagar Haveli and Daman and Diu');
    expect(STATE_OPTIONS).not.toContain('Other Country');
    expect([...STATE_OPTIONS]).toEqual([...STATE_OPTIONS].sort((a, b) => a.localeCompare(b)));
  });

  test('a GSTIN names its state by prefix, trimmed; an unusable prefix names none', () => {
    expect(gstinStateName(' 29aapcd1234k1z5 ')).toBe('Karnataka');
    expect(gstinStateName('27')).toBe('Maharashtra');
    expect(gstinStateName('')).toBeNull();
    expect(gstinStateName('2')).toBeNull();
    expect(gstinStateName('99AAPCD1234K1Z5')).toBeNull();
    expect(gstinStateName('92AAPCD1234K1Z5')).toBeNull();
  });

  test('the warehouse mismatch warning: only when both are chosen and they differ', () => {
    const warning = gstinStateMismatch('27AAPCD1234K1Z5', 'Karnataka')!;
    expect(warning).toContain('registered in Maharashtra');
    expect(warning).toContain('origin state is Karnataka');
    expect(warning).toContain('e-way bills must be generated on the portal');
    expect(gstinStateMismatch('29AAPCD1234K1Z5', 'Karnataka')).toBeNull();
    expect(gstinStateMismatch('', 'Karnataka')).toBeNull();
    expect(gstinStateMismatch('27AAPCD1234K1Z5', '')).toBeNull();
  });

  test('the tenant-GSTIN fallback warning, and the buyer ship-to warning', () => {
    expect(tenantGstinStateMismatch('27AAPCD1234K1Z5', 'Karnataka')).toContain('tenant GSTIN (state Maharashtra)');
    expect(tenantGstinStateMismatch('29AAPCD1234K1Z5', 'Karnataka')).toBeNull();
    expect(tenantGstinStateMismatch(null, 'Karnataka')).toBeNull();
    expect(tenantGstinStateMismatch('27AAPCD1234K1Z5', '')).toBeNull();
    expect(buyerGstinStateMismatch('29AAPCD1234K1Z5', 'Maharashtra')).toContain('ship-to state is Maharashtra');
    expect(buyerGstinStateMismatch('27AAPCD1234K1Z5', 'Maharashtra')).toBeNull();
    expect(buyerGstinStateMismatch('', 'Maharashtra')).toBeNull();
  });
});
