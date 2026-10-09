import { describe, expect, test } from 'bun:test';

import { ApiProblem } from './api/client';
import {
  isClientSuspended,
  lineCountLabel,
  loginNotice,
  orderDestination,
  orderReference,
  PORTAL_NAV,
  PORTAL_SUSPENDED_MESSAGE,
  portalCompanyLabel,
  portalQuantity,
  portalReadReason,
  receivedOfLabel,
  signInDestination,
  skuLabel,
} from './portal';

describe('portal routing (story 21-7)', () => {
  test('sign-in sends a client user to the portal and staff to Settings', () => {
    expect(signInDestination({ clientId: 'c-1' })).toBe('/portal/stock');
    expect(signInDestination({ clientId: null })).toBe('/settings');
    expect(signInDestination({})).toBe('/settings');
  });

  test('the login notice reads only the suspension query', () => {
    expect(loginNotice('suspended')).toBe(PORTAL_SUSPENDED_MESSAGE);
    expect(loginNotice(undefined)).toBeNull();
    expect(loginNotice('other')).toBeNull();
  });

  test('the four portal surfaces, in order', () => {
    expect(PORTAL_NAV.map((item) => [item.label, item.href])).toEqual([
      ['Stock', '/portal/stock'],
      ['Orders', '/portal/orders'],
      ['Inbound', '/portal/inbound'],
      ['Invoices', '/portal/invoices'],
    ]);
  });

  test("the shell's company line: the client's name, then its code, then a neutral word", () => {
    const base = { token: 't', tenant: { id: 't', name: 'T', gstin: null }, expiresAt: 1, user: { id: 'u', email: 'e', role: 'client' as const, status: 'active' as const, clientId: 'c' } };
    expect(portalCompanyLabel({ ...base, client: { id: 'c', code: 'BRAND-A', name: 'Brand A' } })).toBe('Brand A');
    expect(portalCompanyLabel({ ...base, client: null })).toBe('Client portal');
    expect(portalCompanyLabel(null)).toBe('Client portal');
  });
});

describe('portal refusals', () => {
  test('client-suspended is recognised and worded; the transport arm keeps the house copy', () => {
    const suspended = new ApiProblem('client-suspended', 403);
    expect(isClientSuspended(suspended)).toBe(true);
    expect(isClientSuspended(new ApiProblem('role-denied', 403))).toBe(false);
    expect(portalReadReason(suspended, 'your stock')).toBe(PORTAL_SUSPENDED_MESSAGE);
    expect(portalReadReason(new TypeError('Failed to fetch'), 'your stock')).toBe('The API is unreachable — is wms-be running?');
    expect(portalReadReason(new ApiProblem('boom', 500, 'It broke.'), 'your stock')).toBe('It broke.');
  });
});

describe('portal figures', () => {
  test('quantities are grouped, never rounded and never assumed integral', () => {
    expect(portalQuantity(1500)).toBe('1,500');
    expect(portalQuantity(2.5)).toBe('2.5');
    expect(portalQuantity(1234567.125)).toBe('1,234,567.125');
    expect(portalQuantity(0)).toBe('0');
    expect(receivedOfLabel(12, 20.5)).toBe('12 of 20.5 received');
  });

  test('order labels', () => {
    expect(orderDestination({ destinationName: 'Asha', destinationCity: 'Bengaluru', destinationPincode: '560001' })).toBe('Asha · Bengaluru 560001');
    expect(orderDestination({ destinationName: null, destinationCity: null, destinationPincode: null })).toBe('—');
    expect(orderReference({ source: 'ingested', externalRef: 'SHOP-1' })).toBe('SHOP-1');
    expect(orderReference({ source: 'manual', externalRef: null })).toBe('Manual');
    expect(lineCountLabel(1)).toBe('1 line');
    expect(lineCountLabel(3)).toBe('3 lines');
    expect(skuLabel({ skuCode: null, skuName: null })).toBe('—');
    expect(skuLabel({ skuCode: 'A', skuName: 'Apple' })).toBe('A — Apple');
  });
});
