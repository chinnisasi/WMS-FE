import { describe, expect, test } from 'bun:test';

import { ApiProblem } from './api/client';
import { MAX_ORDER_LINES } from './outbound-orders';
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
  PORTAL_DEPARTED_MESSAGE,
  availableHereLabel,
  MAX_PORTAL_ORDER_LINES,
  parsePortalOrderCreate,
  placedOrderBanner,
  portalInstantIst,
  portalOrderReason,
  type PortalOrderDraft,
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

  test('the five portal surfaces, in order (21-8 adds Service)', () => {
    expect(PORTAL_NAV.map((item) => [item.label, item.href])).toEqual([
      ['Stock', '/portal/stock'],
      ['Orders', '/portal/orders'],
      ['Inbound', '/portal/inbound'],
      ['Invoices', '/portal/invoices'],
      ['Service', '/portal/service'],
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

  test('story 1-2a: a departed client — the sign-in, the ended session and a portal read all say the account has ended', () => {
    expect(PORTAL_DEPARTED_MESSAGE).toBe("Your company's account with the warehouse has ended.");
    expect(loginNotice(undefined, 'client-departed')).toBe(PORTAL_DEPARTED_MESSAGE);
    expect(portalReadReason(new ApiProblem('client-departed', 403), 'your stock')).toBe(PORTAL_DEPARTED_MESSAGE);
    expect(portalAsnReason(new ApiProblem('client-departed', 403))).toBe(PORTAL_DEPARTED_MESSAGE);
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

// ── story 4-1a: placing an order ────────────────────────────────────────────

describe('parsePortalOrderCreate (story 4-1a)', () => {
  const W = '0198f7a2-1b3c-7d4e-8f90-0000000000a1';
  const S = '0198f7a2-1b3c-7d4e-8f90-0000000000b1';
  const ADDRESS = { contactName: ' Asha ', phone: '+91 90000 00000', line1: '1 MG Road', line2: '', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' };
  const draft = (extra: Partial<PortalOrderDraft> = {}): PortalOrderDraft => ({
    lines: [{ skuId: S, qty: '2.5' }],
    destination: ADDRESS,
    consigneeGstin: '',
    consigneeLegalName: '',
    ...extra,
  });

  test('the body is exactly {warehouseId, lines[{skuId, quantity}], destination} — no clientId, no ratePaise; blank GSTIN and name absent', () => {
    const parsed = parsePortalOrderCreate(draft(), W);
    expect(parsed.problem).toBeNull();
    expect(parsed.body).toEqual({
      warehouseId: W,
      lines: [{ skuId: S, quantity: 2.5 }],
      destination: { contactName: 'Asha', phone: '+91 90000 00000', line1: '1 MG Road', city: 'Bengaluru', state: 'Karnataka', pincode: '560001' },
    });
  });

  test('a GSTIN is trimmed and upper-cased; the legal name rides only beside it', () => {
    expect(parsePortalOrderCreate(draft({ consigneeGstin: ' 29aaacm4321k1z8 ', consigneeLegalName: ' Mysore Spices ' }), W).body).toMatchObject({
      consigneeGstin: '29AAACM4321K1Z8',
      consigneeLegalName: 'Mysore Spices',
    });
    expect(Object.keys(parsePortalOrderCreate(draft({ consigneeLegalName: 'Kept, not sent' }), W).body!)).not.toContain('consigneeLegalName');
  });

  test('MAX_PORTAL_ORDER_LINES is the staff order ceiling (the backend ArrayMaxSize both DTOs share)', () => {
    expect(MAX_PORTAL_ORDER_LINES).toBe(MAX_ORDER_LINES);
    expect(MAX_PORTAL_ORDER_LINES).toBe(200);
  });

  test("each line's quantity respects its SKU's declared precision, naming the line; a SKU missing from the options is the server's to judge", () => {
    const skus = { [S]: { code: 'TEE-RED', uom: 'each', uomPrecision: 0 }, KG: { code: 'RICE', uom: 'kg', uomPrecision: 3 } };
    expect(parsePortalOrderCreate(draft({ lines: [{ skuId: 'KG', qty: '2.5' }, { skuId: S, qty: '1.5' }] }), W, skus).problem).toBe(
      'Line 2: TEE-RED is counted in each — whole numbers only (got 1.5).',
    );
    expect(parsePortalOrderCreate(draft({ lines: [{ skuId: 'KG', qty: '0.0001' }] }), W, skus).problem).toBe(
      'Line 1: RICE is counted in kg — at most 3 decimal places (got 0.0001).',
    );
    expect(parsePortalOrderCreate(draft({ lines: [{ skuId: 'KG', qty: '2.125' }, { skuId: S, qty: '3' }] }), W, skus).problem).toBeNull();
    expect(parsePortalOrderCreate(draft({ lines: [{ skuId: S, qty: '1.5' }] }), W).problem).toBeNull();
  });

  test('the problems, each sending nothing', () => {
    expect(parsePortalOrderCreate(draft(), '').problem).toBe('Choose the warehouse the order ships from.');
    expect(parsePortalOrderCreate(draft({ lines: [{ skuId: '', qty: '' }] }), W).problem).toBe('Add at least one line — a SKU and a quantity.');
    expect(parsePortalOrderCreate(draft({ lines: [{ skuId: '', qty: '1' }] }), W).problem).toBe('Every line needs a SKU.');
    for (const qty of ['0', '-1', '1e3', 'abc']) {
      expect(parsePortalOrderCreate(draft({ lines: [{ skuId: S, qty }] }), W).problem).toBe('Every quantity is a decimal greater than zero.');
    }
    expect(parsePortalOrderCreate(draft({ lines: Array.from({ length: MAX_PORTAL_ORDER_LINES + 1 }, () => ({ skuId: S, qty: '1' })) }), W).problem).toBe(
      `An order carries at most ${MAX_PORTAL_ORDER_LINES} lines.`,
    );
    expect(parsePortalOrderCreate(draft({ destination: { ...ADDRESS, pincode: '5600' } }), W).problem).not.toBeNull();
    expect(parsePortalOrderCreate(draft({ consigneeGstin: 'NOT-A-GSTIN' }), W).problem).not.toBeNull();
    for (const result of [parsePortalOrderCreate(draft(), ''), parsePortalOrderCreate(draft({ consigneeGstin: 'X' }), W)]) {
      expect(result.body).toBeNull();
    }
  });
});

describe('the place-an-order helpers (story 4-1a)', () => {
  const row = (skuId: string, warehouseId: string, onHand: number, allocated: number) => ({
    skuId,
    skuCode: 'X',
    skuName: 'X',
    baseUom: 'each',
    warehouseId,
    warehouseName: 'W',
    onHand,
    allocated,
  });

  test('availableHereLabel: on hand less allocated at the chosen warehouse, never negative; nothing to say without a SKU or a warehouse', () => {
    const stock = [row('s-1', 'w-1', 10, 3), row('s-1', 'w-2', 1500, 0), row('s-2', 'w-1', 1, 4)];
    expect(availableHereLabel(stock, 's-1', 'w-1', 'each')).toBe('on hand, not yet allocated: 7 each');
    expect(availableHereLabel(stock, 's-1', 'w-2', 'each')).toBe('on hand, not yet allocated: 1,500 each');
    expect(availableHereLabel(stock, 's-2', 'w-1', 'kg')).toBe('on hand, not yet allocated: 0 kg');
    expect(availableHereLabel(stock, 's-3', 'w-1', undefined)).toBe('on hand, not yet allocated: 0');
    expect(availableHereLabel(stock, '', 'w-1', 'each')).toBeNull();
    expect(availableHereLabel(stock, 's-1', '', 'each')).toBeNull();
  });

  test('availableHereLabel: a TRUNCATED stock read with no row says nothing (never a false 0); a row it did read still shows', () => {
    const stock = [row('s-1', 'w-1', 10, 3)];
    expect(availableHereLabel(stock, 's-3', 'w-1', 'each', true)).toBeNull();
    expect(availableHereLabel(stock, 's-1', 'w-1', 'each', true)).toBe('on hand, not yet allocated: 7 each');
  });

  test('placedOrderBanner: built from the response — the line count, the warehouse and the IST time', () => {
    expect(placedOrderBanner({ orderId: 'o', warehouseName: 'Main', lineCount: 1, placedAt: '2026-10-21T20:00:00.000Z' })).toEqual({
      word: 'Order placed',
      // 20:00 UTC is 01:30 the NEXT day in IST.
      reason: '1 line to Main (22 Oct 2026, 01:30 IST) — follow it in the list below.',
    });
    expect(portalInstantIst('not a date')).toBe('not a date');
  });
});

describe('portalOrderReason (story 4-1a)', () => {
  const problem = (code: string, status: number, extensions: Record<string, unknown> = {}) =>
    new ApiProblem(code, status, 'SERVER DETAIL — reserved 3, site "WH-1"', 'Title', extensions);

  test('a fixed sentence per code — never the server detail', () => {
    const cases: [string, number, string][] = [
      ['not-found', 404, 'A SKU or warehouse is no longer available — reload the form and pick again.'],
      ['licence-not-covered', 409, 'A licence for one of these products is not on file with the warehouse — nothing was placed. Contact the warehouse.'],
      ['sku-inactive', 409, 'A SKU on this order is no longer active with the warehouse — remove it and place the rest.'],
      ['order-catalog-changed', 409, 'The warehouse changed one of these products while you ordered — nothing was placed. Reload the form and try again.'],
      ['reservation-store-unavailable', 503, 'The warehouse could not check stock just now — nothing was placed. Try again in a moment.'],
      ['conflict', 409, 'The same order is still being processed — try again in a moment.'],
      ['idempotency-key-reuse', 422, 'This submission was already processed with different details — reload and try again.'],
      ['validation-failed', 400, 'Check the quantities, the ship-to address and the buyer GSTIN, then try again.'],
      ['client-suspended', 403, "Your company's portal access is suspended."],
      ['client-departed', 403, "Your company's account with the warehouse has ended."],
      ['role-denied', 403, 'This page is for client-portal users — sign in with your portal account.'],
      ['permission-denied', 403, 'This page is for client-portal users — sign in with your portal account.'],
      ['unauthenticated', 401, 'Your session expired — sign in again.'],
      ['something-new', 409, 'The order was not placed (something-new).'],
    ];
    for (const [code, status, sentence] of cases) {
      expect(portalOrderReason(problem(code, status))).toBe(sentence);
    }
  });

  test('the shortage names the short SKUs from extensions.skuCodes', () => {
    expect(portalOrderReason(problem('order-backorder-rejected', 409, { skuCodes: ['A-1', 'A-2'] }))).toBe(
      'Not enough stock at this warehouse for A-1, A-2 — nothing was placed. Lower the quantities or choose another warehouse.',
    );
    expect(portalOrderReason(problem('order-backorder-rejected', 409))).toContain('for some lines');
  });

  test('the transport arm is the house unreachable copy', () => {
    expect(portalOrderReason(new TypeError('fetch failed'))).toBe('The API is unreachable — is wms-be running?');
  });
});
