import { describe, expect, test } from 'bun:test';

import { GSTIN_HELP, GSTIN_RE, parseGstinField } from './gstin';

describe('gstin (story 8-1c)', () => {
  test('GSTIN_RE mirrors the backend regex byte-for-byte', () => {
    // wms-be src/shared/primitives/gstin.ts:18
    expect(GSTIN_RE.source).toBe('^[0-9]{2}[A-Za-z0-9]{13}$');
    expect(GSTIN_RE.flags).toBe('');
  });

  test('a padded lowercase GSTIN is trimmed and uppercased', () => {
    expect(parseGstinField(' 29aapcd1234k1z5 ', 'Business GSTIN')).toEqual({
      gstin: '29AAPCD1234K1Z5',
      problem: null,
    });
  });

  test('a blank or whitespace-only field is absent — no gstin key at all', () => {
    for (const blank of ['', '   ', '\t']) {
      const parsed = parseGstinField(blank, 'Business GSTIN');
      expect(parsed.problem).toBeNull();
      expect('gstin' in parsed).toBe(false);
    }
  });

  test('a malformed GSTIN is a problem naming the field, and carries no value', () => {
    for (const bad of ['29ABC', 'AB29AAPCD1234K1', '29AAPCD1234K1Z5X', '29AAPCD-234K1Z5', '2']) {
      const parsed = parseGstinField(bad, 'Buyer GSTIN');
      expect(parsed.problem).toStartWith('Buyer GSTIN is 15 characters');
      expect('gstin' in parsed).toBe(false);
    }
  });

  test('the help copy says the value is create-only', () => {
    expect(GSTIN_HELP).toBe("Can't be changed after creation yet.");
  });
});
