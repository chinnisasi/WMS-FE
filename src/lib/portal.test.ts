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
  PASSWORD_RESET_DONE_NOTICE,
  orderDestination,
  orderReference,
  portalFollowOnOfText,
  portalLineShipped,
  portalShippedShortText,
  PORTAL_NAV,
  PORTAL_DISPOSITION_OUTCOME_LABEL,
  PORTAL_DISPOSITION_REASON_LABEL,
  PORTAL_RETURN_REASON_LABEL,
  PORTAL_RETURN_ORIGIN_LABEL,
  portalReturnOriginText,
  PORTAL_RETURN_STATUS_LABEL,
  portalDispositionSummary,
  portalDispositionText,
  portalReturnDecisionState,
  portalReturnFilterQuery,
  portalReturnOrder,
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
import { portalFileLine, portalShippingLine, portalShippingReason, portalShippingStatus } from './portal';
import { asnExpected, atLeastCount, orderTimeline, portalDateTime, portalNavCurrent, PORTAL_HOME } from './portal';

describe('portal routing (story 21-7)', () => {
  test('sign-in sends a client user to the portal and staff to Settings', () => {
    expect(signInDestination({ clientId: 'c-1' })).toBe('/portal'); // UI-1: the portal's Home
    expect(signInDestination({ clientId: null })).toBe('/settings');
    expect(signInDestination({})).toBe('/settings');
  });

  test('the login notice reads only the suspension query', () => {
    expect(loginNotice('suspended')).toBe(PORTAL_SUSPENDED_MESSAGE);
    expect(loginNotice(undefined)).toBeNull();
    expect(loginNotice('other')).toBeNull();
  });

  test('Home, then the six portal surfaces, in order (21-8 adds Service; UI-1 adds Home; 4-7a Returns)', () => {
    expect(PORTAL_NAV.map((item) => [item.label, item.href])).toEqual([
      ['Home', '/portal'],
      ['Stock', '/portal/stock'],
      ['Orders', '/portal/orders'],
      ['Inbound', '/portal/inbound'],
      ['Returns', '/portal/returns'],
      ['Recalls', '/portal/recalls'],
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
    // Story 6-1c — a completed reset, and the session end it caused.
    expect(loginNotice(undefined, undefined, 'done')).toBe(PASSWORD_RESET_DONE_NOTICE);
    expect(loginNotice(undefined, undefined, 'other')).toBeNull();
    expect(loginNotice('suspended', undefined, 'done')).toBe(PORTAL_SUSPENDED_MESSAGE);
    expect(loginNotice(undefined, 'password-reset')).toBe('Your password was reset — sign in with the new password.');
    expect(portalReadReason(new ApiProblem('client-departed', 403), 'your stock')).toBe(PORTAL_DEPARTED_MESSAGE);
    expect(portalAsnReason(new ApiProblem('client-departed', 403))).toBe(PORTAL_DEPARTED_MESSAGE);
  });
});

describe('portal figures', () => {
  test('quantities are grouped, never rounded and never assumed integral', () => {
    expect(portalQuantity(1500)).toBe('1,500');
    expect(portalQuantity(2.5)).toBe('2.5');
    expect(portalQuantity(1234567.125)).toBe('12,34,567.125');
    expect(portalQuantity(0)).toBe('0');
    expect(receivedOfLabel(12, 20.5)).toBe('12 of 20.5 received');
  });

  test('order labels', () => {
    expect(orderDestination({ destinationName: 'Asha', destinationCity: 'Bengaluru', destinationPincode: '560001' })).toBe('Asha · Bengaluru 560001');
    expect(orderDestination({ destinationName: null, destinationCity: null, destinationPincode: null })).toBe('—');
    expect(orderReference({ source: 'ingested', externalRef: 'SHOP-1' })).toBe('SHOP-1');
    expect(orderReference({ source: 'manual', externalRef: null })).toBe('Manual');
    // Story 4-1b — the client's own number wins, then the channel's; never an internal id.
    expect(orderReference({ source: 'manual', externalRef: null, clientOrderRef: 'SO-7' })).toBe('SO-7');
    expect(orderReference({ source: 'ingested', externalRef: 'SHOP-1', clientOrderRef: null })).toBe('SHOP-1');
    expect(orderReference({ source: 'ingested', externalRef: null, clientOrderRef: '' })).toBe('Channel');
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

  test('story 4-1b: the order number is trimmed and sent only when given; a shape the server refuses is a problem, nothing sent', () => {
    expect(parsePortalOrderCreate(draft({ clientOrderRef: '  SO-7 ' }), W).body).toMatchObject({ clientOrderRef: 'SO-7' });
    for (const blank of ['', '   ']) {
      expect(Object.keys(parsePortalOrderCreate(draft({ clientOrderRef: blank }), W).body!)).not.toContain('clientOrderRef');
    }
    for (const bad of ['x'.repeat(65), 'SO\t7', 'SO-é']) {
      const parsed = parsePortalOrderCreate(draft({ clientOrderRef: bad }), W);
      expect(parsed.body).toBeNull();
      expect(parsed.problem).toMatch(/^Your order number /);
    }
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
    // Story 4-1b — named by the client's own number when it gave one.
    expect(placedOrderBanner({ orderId: 'o', warehouseName: 'Main', lineCount: 1, placedAt: '2026-10-21T20:00:00.000Z', clientOrderRef: 'SO-7' }).word).toBe('Order SO-7 placed');
    expect(placedOrderBanner({ orderId: 'o', warehouseName: 'Main', lineCount: 1, placedAt: '2026-10-21T20:00:00.000Z', clientOrderRef: null }).word).toBe('Order placed');
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
      // Story 4-1b — the fixed sentence now names the order number too.
      ['validation-failed', 400, 'Check the quantities, the ship-to address, the buyer GSTIN and your order number, then try again.'],
      ['duplicate-client-order-ref', 409, 'That order number is already used by one of your open orders — use a different number.'],
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

  test('story 4-1b: a duplicate order number echoes only what the user typed — never the server detail', () => {
    expect(portalOrderReason(problem('duplicate-client-order-ref', 409), 'SO-7')).toBe(
      'Order number SO-7 is already used by one of your open orders — use a different number.',
    );
  });

  test('the transport arm is the house unreachable copy', () => {
    expect(portalOrderReason(new TypeError('fetch failed'))).toBe('The API is unreachable — is wms-be running?');
  });
});

describe('story UI-1 — Home counts, nav, and the order timeline', () => {
  test('atLeastCount: the number shown, "+" only when the list has another page — never the page size', () => {
    expect(atLeastCount(3, null)).toBe('3');
    expect(atLeastCount(3, 'CURSOR-2')).toBe('3+'); // a filtered page: at least 3
    expect(atLeastCount(0, 'CURSOR-2')).toBe('0+');
    expect(atLeastCount(0, null)).toBe('0');
  });

  test('asnExpected: announced or part-received only', () => {
    expect(asnExpected({ status: 'announced' })).toBe(true);
    expect(asnExpected({ status: 'partially_received' })).toBe(true);
    for (const status of ['received', 'closed', 'cancelled'] as const) expect(asnExpected({ status })).toBe(false);
  });

  test('portalNavCurrent: Home only on exact /portal; a surface on itself and its children', () => {
    expect(PORTAL_HOME).toBe('/portal');
    const home = { href: '/portal' };
    expect(portalNavCurrent(home, '/portal')).toBe(true);
    expect(portalNavCurrent(home, '/portal/stock')).toBe(false);
    expect(portalNavCurrent({ href: '/portal/orders' }, '/portal/orders')).toBe(true);
    expect(portalNavCurrent({ href: '/portal/orders' }, '/portal/orders/x')).toBe(true);
    expect(portalNavCurrent({ href: '/portal/orders' }, '/portal/ordersx')).toBe(false);
    expect(portalNavCurrent(home, null)).toBe(false);
  });

  const placed = '2026-10-26T08:35:00.000Z'; // 14:05 IST
  test('portalDateTime: IST date and 24-hour time', () => {
    expect(portalDateTime(placed)).toBe('26 Oct 2026, 14:05 IST');
  });

  test('orderTimeline: Placed with its IST time, then the steps of the status — no invented times', () => {
    const shape = (status: Parameters<typeof orderTimeline>[0]['status']) =>
      orderTimeline({ status, createdAt: placed }).map((s) => `${s.label}:${s.state}${s.time === undefined ? '' : '@'}`);
    expect(shape('accepted')).toEqual(['Placed:done@', 'Accepted:current', 'Packed:upcoming', 'Dispatched:upcoming']);
    expect(shape('ready_to_dispatch')).toEqual(['Placed:done@', 'Accepted:done', 'Packed:current', 'Dispatched:upcoming']);
    expect(shape('dispatched')).toEqual(['Placed:done@', 'Accepted:done', 'Packed:done', 'Dispatched:done']);
    // Cancelled: how far it got is not in the read, so the timeline does not guess.
    expect(shape('cancelled')).toEqual(['Placed:done@', 'Cancelled:stopped']);
    expect(orderTimeline({ status: 'accepted', createdAt: placed })[0]!.time).toBe('26 Oct 2026, 14:05 IST');
  });

  test('orderTimeline: a status this build does not know reads Placed alone', () => {
    const steps = orderTimeline({ status: 'on_hold' as never, createdAt: placed });
    expect(steps.map((s) => s.label)).toEqual(['Placed']);
  });
});

describe('story 4-7a — the portal returns', () => {
  const totals = { receivedTotal: 0, restockedTotal: 0, onHoldTotal: 0, failedInspectionTotal: 0, scrappedTotal: 0, openTotal: 0 };

  test('the split in words: only the non-zero parts, in the order of the work', () => {
    expect(portalDispositionSummary(totals)).toBe('Nothing received yet');
    expect(
      portalDispositionSummary({ receivedTotal: 8, restockedTotal: 3, onHoldTotal: 1, failedInspectionTotal: 1, scrappedTotal: 1, openTotal: 2 }),
    ).toBe('3 restocked · 1 held for inspection · 1 failed inspection · 1 scrapped · 2 awaiting a decision');
    expect(portalDispositionSummary({ ...totals, receivedTotal: 1500, restockedTotal: 1500 })).toBe('1,500 restocked');
  });

  test('the decision state: none before anything is back; awaiting while open or held; all decided after', () => {
    expect(portalReturnDecisionState(totals)).toBeNull();
    expect(portalReturnDecisionState({ receivedTotal: 2, openTotal: 1, onHoldTotal: 0 })).toEqual({ tone: 'warning', word: '↩ Awaiting a decision' });
    expect(portalReturnDecisionState({ receivedTotal: 2, openTotal: 0, onHoldTotal: 1 })?.tone).toBe('warning');
    expect(portalReturnDecisionState({ receivedTotal: 2, openTotal: 0, onHoldTotal: 0 })).toEqual({ tone: 'success', word: '✓ All decided' });
  });

  test('labels are Records over the generated unions, in the client’s words', () => {
    expect(PORTAL_RETURN_STATUS_LABEL.open).toBe('Expected back');
    expect(PORTAL_DISPOSITION_OUTCOME_LABEL).toEqual({ restock: 'Restocked', quarantine: 'Held for inspection', scrap: 'Scrapped' });
    expect(Object.keys(PORTAL_DISPOSITION_REASON_LABEL).sort()).toEqual(
      ['client-instruction', 'contaminated', 'damaged', 'defective', 'expired', 'missing-parts', 'needs-inspection', 'other'],
    );
    expect(PORTAL_RETURN_REASON_LABEL['changed-mind']).toBe('Changed mind');
  });

  test('a decision in words; the filter sends nothing for "all"; the order never falls back to an id', () => {
    expect(portalDispositionText({ outcome: 'scrap', qty: 2, reasonCode: 'damaged' })).toBe('Scrapped 2 · Damaged');
    expect(portalDispositionText({ outcome: 'restock', qty: 3, reasonCode: null })).toBe('Restocked 3');
    expect(portalReturnFilterQuery('all')).toBeNull();
    expect(portalReturnFilterQuery('awaiting')).toBe('awaiting');
    expect(portalReturnFilterQuery('dispositioned')).toBe('dispositioned');
    expect(portalReturnOrder({ orderReference: null })).toBe('—');
    expect(portalReturnOrder({ orderReference: 'SHOP-#1' })).toBe('SHOP-#1');
  });

  // Story 4-7b — an accepted unannounced return in the portal.
  test('an unannounced return names its origin and parcel; its reason is labelled; "No order" reads "—"', () => {
    expect(PORTAL_RETURN_REASON_LABEL.unannounced).toBe('Arrived without a return request');
    expect(Object.keys(PORTAL_RETURN_ORIGIN_LABEL).sort()).toEqual(['authorized', 'blind']);
    expect(portalReturnOriginText({ origin: 'authorized', parcelReference: null })).toBeNull();
    expect(portalReturnOriginText({ origin: 'blind', parcelReference: 'AWB123' })).toBe('Unannounced · parcel AWB123');
    expect(portalReturnOriginText({ origin: 'blind', parcelReference: null })).toBe('Unannounced');
    expect(portalReturnOrder({ orderReference: null })).toBe('—');
  });
});

// ── Story 4-2c — backorder follow-ons in the portal ─────────────────────────

describe('portal backorders (story 4-2c)', () => {
  test('a follow-on reference carries -BO{seq}; with no reference it reads "Manual · backorder 1" — never an internal id', () => {
    expect(orderReference({ source: 'manual', externalRef: null, clientOrderRef: '1042', followOnSeq: 1 })).toBe('1042-BO1');
    expect(orderReference({ source: 'ingested', externalRef: 'SHOP-1', clientOrderRef: null, followOnSeq: 2 })).toBe('SHOP-1-BO2');
    expect(orderReference({ source: 'manual', externalRef: null, clientOrderRef: null, followOnSeq: 1 })).toBe('Manual · backorder 1');
    expect(orderReference({ source: 'manual', externalRef: null, clientOrderRef: '1042', followOnSeq: null })).toBe('1042');
  });

  test('a follow-on detail reads "Backorder of 1042"; an original reads nothing', () => {
    expect(portalFollowOnOfText({ source: 'manual', externalRef: null, clientOrderRef: '1042', followOnSeq: 1 })).toMatch(/^Backorder of 1042 — /);
    expect(portalFollowOnOfText({ source: 'manual', externalRef: null, clientOrderRef: null, followOnSeq: 2 })).toMatch(/^Backorder 2 of your original order/);
    expect(portalFollowOnOfText({ source: 'manual', externalRef: null, clientOrderRef: '1042' })).toBeNull();
  });

  test('a dispatched parent with a follow-on: "Shipped 7 of 10 — 3 follow in 1042-BO1; ask the warehouse to cancel the remainder"', () => {
    const base = { source: 'manual' as const, externalRef: null, clientOrderRef: '1042', status: 'dispatched' as const, followOnOrderId: 'fo-1' };
    expect(portalShippedShortText({ ...base, lines: [{ qty: 6, shippedQty: 6 }, { qty: 4, shippedQty: 1 }] })).toBe(
      'Shipped 7 of 10 — 3 follow in 1042-BO1; ask the warehouse to cancel the remainder',
    );
    // A follow-on that itself shipped short opens the next in the chain.
    expect(portalShippedShortText({ ...base, followOnSeq: 1, lines: [{ qty: 3, shippedQty: 1 }] })).toBe(
      'Shipped 1 of 3 — 2 follow in 1042-BO2; ask the warehouse to cancel the remainder',
    );
    // Nothing before dispatch, with no follow-on, or with no shipped figure (pre-4-2c).
    expect(portalShippedShortText({ ...base, status: 'accepted', lines: [{ qty: 4, shippedQty: null }] })).toBeNull();
    expect(portalShippedShortText({ ...base, followOnOrderId: null, lines: [{ qty: 4, shippedQty: 3 }] })).toBeNull();
    expect(portalShippedShortText({ ...base, lines: [{ qty: 4 }] })).toBeNull();
  });

  test('a line\'s shipped figure, or null before dispatch', () => {
    expect(portalLineShipped({ qty: 10, shippedQty: 7 })).toBe('7 of 10 shipped');
    expect(portalLineShipped({ qty: 10, shippedQty: null })).toBeNull();
    expect(portalLineShipped({ qty: 10 })).toBeNull();
  });
});

describe('story 4-4a — the order Shipping section', () => {
  test('the status mirrors wms-be portalShippingStatus (A44, as built)', () => {
    const client = (verified: boolean) => ({ kind: 'client-label', status: 'labelled', labelVerified: verified });
    expect(portalShippingStatus('cancelled', client(true), false)).toBe('cancelled');
    expect(portalShippingStatus('accepted', null, false)).toBe('no-label-yet');
    expect(portalShippingStatus('accepted', client(true), false)).toBe('label-received');
    expect(portalShippingStatus('ready_to_dispatch', client(false), false)).toBe('label-received');
    expect(portalShippingStatus('ready_to_dispatch', client(true), false)).toBe('ready-for-pickup');
    expect(portalShippingStatus('accepted', { kind: 'courier-label', status: 'labelled', labelVerified: false }, false)).toBe('awb-received');
    expect(portalShippingStatus('ready_to_dispatch', { kind: 'carrier', status: 'labelled', labelVerified: false }, false)).toBe('awb-received');
    expect(portalShippingStatus('dispatched', { kind: 'client-label', status: 'handed_over', labelVerified: true }, true)).toBe('handed-over');
    expect(portalShippingStatus('dispatched', { kind: 'carrier', status: 'manifested', labelVerified: false }, true)).toBe('shipped');
    expect(portalShippingStatus('dispatched', null, true)).toBe('shipped');
    expect(portalShippingStatus('dispatched', null, false)).toBe('shipped-no-courier-record');
  });

  test('the status line names the courier, AWB and IST time once handed over', () => {
    expect(portalShippingLine({ status: 'handed-over', courierName: 'Delhivery', awb: '123456789012', handedOverAt: '2026-10-30T10:35:00.000Z' })).toBe(
      'Handed over to Delhivery — AWB 123456789012, 30 Oct 2026, 16:05 IST',
    );
    expect(portalShippingLine({ status: 'label-received', courierName: 'Delhivery', awb: '123456789012', handedOverAt: null })).toBe(
      'Label received — Delhivery AWB 123456789012',
    );
    expect(portalShippingLine({ status: 'no-label-yet', courierName: null, awb: null, handedOverAt: null })).toBe(
      'No label yet — upload one, send the AWB, or your courier brings it',
    );
  });

  test('file lines and refusals in client words', () => {
    expect(portalFileLine({ kind: 'eway-bill', fileName: 'SO-1-eway-bill-1.pdf', pageCount: 2, uploadedByYou: true })).toBe(
      'E-way bill · SO-1-eway-bill-1.pdf · 2 pages · uploaded by you',
    );
    expect(portalFileLine({ kind: 'signed-sheet', fileName: 'HO-0001-sheet-1.jpg', pageCount: null, uploadedByYou: false })).toBe(
      'Signed handover sheet · HO-0001-sheet-1.jpg',
    );
    expect(portalShippingReason(new ApiProblem('shipment-exists', 409, 'x', 'y', { kind: 'carrier' }), 'label')).toContain('already booked a courier');
    expect(portalShippingReason(new ApiProblem('shipment-exists', 409, 'x', 'y', { kind: 'client-label' }), 'label')).toContain('Replace');
    expect(portalShippingReason(new ApiProblem('not-found', 404), 'awb')).toContain('may not belong to your company');
    expect(portalShippingReason(new ApiProblem('pdf-unreadable', 422), 'label')).toContain('Remove the password');
  });
});

describe('story 4-4a review — FB10 portal refusals are client words, never the server detail', () => {
  test('every portal code has its own sentence; an unknown code a generic one', () => {
    const codes = ['shipment-exists', 'shipment-handed-over', 'awb-in-use', 'order-not-open', 'document-limit', 'attachment-type-unsupported', 'attachment-too-large', 'pdf-unreadable', 'pdf-too-many-pages', 'file-storage-unavailable', 'conflict', 'validation-failed', 'idempotency-key-reuse', 'brand-new'];
    for (const code of codes) {
      const words = portalShippingReason(new ApiProblem(code, 409, 'SERVER DETAIL on order SO-7 holder'), 'awb');
      expect(words).not.toContain('SERVER DETAIL');
      expect(words.startsWith('Your AWB was not sent')).toBe(true);
    }
  });
});
