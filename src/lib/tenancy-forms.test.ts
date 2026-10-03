import { describe, expect, test } from 'bun:test';

import { emptyDestinationFields } from './outbound-orders';
import { registerTenantBody, warehouseBody, warehouseCreatedReason } from './tenancy-forms';

const ORIGIN = {
  contactName: 'Priya Sharma',
  phone: '+91 98450 12345',
  line1: '12, Peenya Industrial Area',
  line2: '',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560066',
};

describe('registerTenantBody (story 8-1c)', () => {
  const base = { name: 'Priya Spices', ownerEmail: 'priya@example.com', password: 'hunter2hunter2' };

  test('a padded lowercase GSTIN is sent trimmed and uppercased', () => {
    expect(registerTenantBody({ ...base, gstinText: ' 29aapcd1234k1z5 ' })).toEqual({
      body: { ...base, gstin: '29AAPCD1234K1Z5' },
    });
  });

  test('a blank GSTIN is omitted — no gstin key, never ""', () => {
    for (const blank of ['', '   ']) {
      const result = registerTenantBody({ ...base, gstinText: blank });
      expect('body' in result).toBe(true);
      if ('body' in result) {
        expect('gstin' in result.body).toBe(false);
        expect(result.body).toEqual(base);
      }
    }
  });

  test('a malformed GSTIN is a problem naming the field, and no body', () => {
    const result = registerTenantBody({ ...base, gstinText: '29ABC' });
    expect('body' in result).toBe(false);
    expect('problem' in result && result.problem).toStartWith('Business GSTIN is 15 characters');
  });
});

describe('warehouseBody (story 8-1c)', () => {
  test('the GSTIN rides the body beside the parsed origin', () => {
    expect(warehouseBody({ code: 'BLR-01', name: 'Whitefield', origin: ORIGIN, gstinText: '29aapcd1234k1z5' })).toEqual({
      body: {
        code: 'BLR-01',
        name: 'Whitefield',
        origin: {
          contactName: 'Priya Sharma',
          phone: '+91 98450 12345',
          line1: '12, Peenya Industrial Area',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560066',
        },
        gstin: '29AAPCD1234K1Z5',
      },
    });
  });

  test('a blank GSTIN is omitted', () => {
    const result = warehouseBody({ code: 'BLR-01', name: 'Whitefield', origin: ORIGIN, gstinText: ' ' });
    expect('body' in result && 'gstin' in result.body).toBe(false);
  });

  test('a malformed GSTIN is refused, naming the warehouse GSTIN', () => {
    const result = warehouseBody({ code: 'BLR-01', name: 'Whitefield', origin: ORIGIN, gstinText: '29ABC' });
    expect('problem' in result && result.problem).toStartWith('Warehouse GSTIN is 15 characters');
  });

  test('the address is refused before the GSTIN (lines → address → GSTIN order)', () => {
    const result = warehouseBody({
      code: 'BLR-01',
      name: 'Whitefield',
      origin: emptyDestinationFields(),
      gstinText: '29ABC',
    });
    expect('problem' in result && result.problem).toStartWith('The origin needs');
  });
});

describe('warehouseCreatedReason (story 8-1c)', () => {
  test('echoes the STORED GSTIN with its permanence when there is one', () => {
    expect(warehouseCreatedReason({ code: 'BLR-01', name: 'Whitefield', gstin: '29AAPCD1234K1Z5' })).toBe(
      "BLR-01 Whitefield now appears in the sidebar switcher. GSTIN 29AAPCD1234K1Z5 — can't be changed later.",
    );
  });

  test('says nothing about a GSTIN when none was stored', () => {
    expect(warehouseCreatedReason({ code: 'BLR-01', name: 'Whitefield', gstin: null })).toBe(
      'BLR-01 Whitefield now appears in the sidebar switcher.',
    );
  });
});
