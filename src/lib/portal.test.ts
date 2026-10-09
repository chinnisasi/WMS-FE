import { describe, expect, test } from 'bun:test';

import { ApiProblem } from './api/client';
import { drainPortalSkus } from './use-portal';
import {
  isClientSuspended,
  parsePortalAsnCreate,
  PORTAL_SKU_MAX_PAGES,
  PORTAL_SKU_PAGE_LIMIT,
  portalAsnReason,
  portalSkuOption,
  portalWarehouseOptions,
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

// ── Story 21-7b — announcing a shipment ─────────────────────────────────────

describe('parsePortalAsnCreate (story 21-7b)', () => {
  const W = 'w-1';
  const line = { skuId: 's-1', qty: '12' };

  test('builds {warehouseId, asnCode, expectedAt?, lines[{skuId, announcedQty}]} — never a clientId, never a line id', () => {
    const parsed = parsePortalAsnCreate({ asnCode: '  ASN-9 ', expectedAt: '2026-10-20T10:00', lines: [line] }, W);
    expect(parsed.problem).toBeNull();
    expect(Object.keys(parsed.body!).sort()).toEqual(['asnCode', 'expectedAt', 'lines', 'warehouseId']);
    expect(parsed.body).toEqual({ warehouseId: W, asnCode: 'ASN-9', expectedAt: new Date('2026-10-20T10:00').toISOString(), lines: [{ skuId: 's-1', announcedQty: 12 }] });
  });

  test('a blank expected arrival is ABSENT; a line carrying an id has it stripped', () => {
    const parsed = parsePortalAsnCreate({ asnCode: 'ASN-9', expectedAt: '  ', lines: [{ id: 'line-1', skuId: 's-1', qty: '2.5' }] }, W);
    expect(parsed.body).toEqual({ warehouseId: W, asnCode: 'ASN-9', lines: [{ skuId: 's-1', announcedQty: 2.5 }] });
    expect(Object.keys(parsed.body!.lines[0]!).sort()).toEqual(['announcedQty', 'skuId']);
  });

  test('names the first problem and sends nothing', () => {
    expect(parsePortalAsnCreate({ asnCode: 'ASN-9', expectedAt: '', lines: [line] }, '')).toEqual({ body: null, problem: 'Choose the warehouse the shipment arrives at.' });
    expect(parsePortalAsnCreate({ asnCode: '   ', expectedAt: '', lines: [line] }, W).body).toBeNull();
    expect(parsePortalAsnCreate({ asnCode: 'X'.repeat(65), expectedAt: '', lines: [line] }, W).body).toBeNull();
    // 64 code points pass, astral characters counted once each.
    expect(parsePortalAsnCreate({ asnCode: '𝔸'.repeat(64), expectedAt: '', lines: [line] }, W).problem).toBeNull();
    expect(parsePortalAsnCreate({ asnCode: 'ASN-9', expectedAt: 'tomorrow', lines: [line] }, W).problem).toBe('The expected arrival is not a date and time.');
    expect(parsePortalAsnCreate({ asnCode: 'ASN-9', expectedAt: '', lines: [{ skuId: '', qty: '' }] }, W).problem).toBe('Add at least one line — a SKU and a quantity.');
    expect(parsePortalAsnCreate({ asnCode: 'ASN-9', expectedAt: '', lines: [{ skuId: 's-1', qty: '0' }] }, W).problem).toBe('Every quantity is a decimal greater than zero.');
    expect(parsePortalAsnCreate({ asnCode: 'ASN-9', expectedAt: '', lines: [{ skuId: '', qty: '3' }] }, W).problem).toBe('Every line needs a SKU.');
  });
});

describe('the announce form helpers (story 21-7b)', () => {
  test('portalSkuOption maps the portal vocabulary onto the line rows’ minimal option', () => {
    expect(portalSkuOption({ skuId: 's-1', skuCode: 'RICE', skuName: 'Rice', baseUom: 'kg', uomPrecision: 3 })).toEqual({ id: 's-1', code: 'RICE', name: 'Rice', uom: 'kg', uomPrecision: 3 });
  });

  test('a warehouse shows its city only when another shares its name', () => {
    expect(
      portalWarehouseOptions([
        { warehouseId: 'w-3', warehouseName: 'Annex', city: 'Chennai' },
        { warehouseId: 'w-1', warehouseName: 'Main', city: 'Bengaluru' },
        { warehouseId: 'w-2', warehouseName: 'Main', city: null },
      ]),
    ).toEqual([
      { id: 'w-3', label: 'Annex' },
      { id: 'w-1', label: 'Main (Bengaluru)' },
      { id: 'w-2', label: 'Main' },
    ]);
  });

  test('drainPortalSkus follows nextCursor to the end, and stops at 20 pages saying so', async () => {
    const sku = (n: number) => ({ skuId: `s-${n}`, skuCode: `S-${n}`, skuName: `S ${n}`, baseUom: 'each', uomPrecision: 0 });
    const seen: (string | null)[] = [];
    const two = await drainPortalSkus(async (cursor) => {
      seen.push(cursor);
      return cursor === null ? { items: [sku(1)], nextCursor: 'c-2' } : { items: [sku(2)], nextCursor: null };
    });
    expect(seen).toEqual([null, 'c-2']);
    expect(two).toEqual({ skus: [sku(1), sku(2)], truncated: false });
    let calls = 0;
    const endless = await drainPortalSkus(async () => {
      calls += 1;
      return { items: [sku(calls)], nextCursor: `c-${calls + 1}` };
    });
    expect(calls).toBe(PORTAL_SKU_MAX_PAGES);
    expect(endless.truncated).toBe(true);
    expect(endless.skus).toHaveLength(PORTAL_SKU_MAX_PAGES);
    expect(PORTAL_SKU_MAX_PAGES).toBe(20);
    expect(PORTAL_SKU_PAGE_LIMIT).toBe(100);
  });
});

describe('portalAsnReason (story 21-7b)', () => {
  test('the session codes read as the portal reads them', () => {
    expect(portalAsnReason(new ApiProblem('client-suspended', 403))).toBe(PORTAL_SUSPENDED_MESSAGE);
    expect(portalAsnReason(new ApiProblem('unauthenticated', 401))).toBe('Your session expired — sign in again.');
    expect(portalAsnReason(new ApiProblem('role-denied', 403))).toBe('This page is for client-portal users — sign in with your portal account.');
    expect(portalAsnReason(new ApiProblem('permission-denied', 403))).toBe('This page is for client-portal users — sign in with your portal account.');
  });

  test('every write refusal has portal wording', () => {
    expect(portalAsnReason(new ApiProblem('not-found', 404, 'No SKU with id "x" exists for this client.'))).toBe(
      'A SKU or warehouse is no longer available — reload the form and pick again.',
    );
    expect(portalAsnReason(new ApiProblem('duplicate-asn-code', 409, 'Client BRAND-A already has …'))).toBe(
      'You already have a shipment notice with this reference — use another one.',
    );
    expect(portalAsnReason(new ApiProblem('kit-cannot-hold-stock', 409))).toBe('A kit cannot be announced — announce the SKUs it is made of instead.');
    // Never the server's validator wording.
    expect(portalAsnReason(new ApiProblem('validation-failed', 400, 'lines.0.announcedQty must not be greater than 9000000000'))).toBe(
      'Check the quantities, the reference and the expected arrival, then try again.',
    );
    expect(portalAsnReason(new ApiProblem('validation-failed', 400))).toBe('Check the quantities, the reference and the expected arrival, then try again.');
    expect(portalAsnReason(new ApiProblem('idempotency-key-reuse', 422))).toBe(
      'This submission was already processed with different details — reload and try again.',
    );
    expect(portalAsnReason(new ApiProblem('conflict', 409))).toBe('The same submission is still being processed — try again in a moment.');
    expect(portalAsnReason(new ApiProblem('something-new', 418))).toBe('The shipment notice was not sent (something-new).');
    expect(portalAsnReason(new TypeError('fetch failed'))).toBe('The API is unreachable — is wms-be running?');
  });
});
