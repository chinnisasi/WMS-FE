import { describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import {
  bindHandoverKey,
  candidateBlocker,
  codTotalLabel,
  dispatchesByHandover,
  emptyHandoverDraft,
  EMPTY_ROW,
  fileLine,
  handoverOutcome,
  handoverRefusals,
  HANDOVER_REFUSAL_WORD,
  isPdfHead,
  matchScan,
  mismatchedOrderIds,
  parcelTagFilename,
  parseHandoverDraft,
  parseLabelDraft,
  parsePackageCount,
  parseShippingReason,
  parseWeightGrams,
  sheetCell,
  sheetParty,
  shippingCell,
  shippingFileProblem,
  shippingReason,
  verifiedLine,
} from './shipping';

const ORDER_A = '01a18ba8-4743-79dd-8fe5-145b99902272';
const ORDER_B = '01a18ba8-4743-79dd-8fe5-145b99902273';
const ORDER_C = '01a18ba8-4743-79dd-8fe5-145b99902274';

const shipment = (over: Record<string, unknown> = {}) => ({
  kind: 'client-label' as const,
  status: 'labelled' as const,
  trackingNumber: '123456789012',
  carrierName: 'Delhivery',
  labelVerifiedAt: null as string | null,
  ...over,
});

describe('the Shipping cell (A20)', () => {
  test('not read yet is null; none and voided read as no courier record', () => {
    expect(shippingCell(undefined)).toBeNull();
    expect(shippingCell(null)).toEqual({ word: 'No courier record yet', tone: 'neutral' });
    expect(shippingCell(shipment({ status: 'voided' }))?.word).toBe('No courier record yet');
  });

  test('a client label: verified ✓ or not verified (amber, word first)', () => {
    expect(shippingCell(shipment())).toEqual({ word: 'Client label · AWB …9012 · not verified', tone: 'warning' });
    expect(shippingCell(shipment({ labelVerifiedAt: '2026-10-30T10:00:00Z' }))).toEqual({
      word: 'Client label · AWB …9012 · verified ✓',
      tone: 'success',
    });
  });

  test('a courier label, a carrier label and a handed-over parcel', () => {
    expect(shippingCell(shipment({ kind: 'courier-label' }))?.word).toBe('Courier label · AWB …9012 pre-advised');
    expect(shippingCell(shipment({ kind: 'carrier', trackingNumber: 'SBX-0001' }))?.word).toBe('Carrier label · Delhivery …0001');
    expect(shippingCell(shipment({ kind: undefined, status: 'manifested', trackingNumber: 'SBX-0001' }))?.word).toBe(
      'Carrier label · Delhivery …0001 · manifested',
    );
    expect(shippingCell(shipment({ status: 'handed_over' }))).toEqual({ word: 'Handed over · AWB …9012', tone: 'success' });
  });

  test('only a live client-arranged shipment is dispatched by a handover', () => {
    expect(dispatchesByHandover(shipment())).toBe(true);
    expect(dispatchesByHandover(shipment({ kind: 'courier-label' }))).toBe(true);
    expect(dispatchesByHandover(shipment({ status: 'voided' }))).toBe(false);
    expect(dispatchesByHandover(shipment({ kind: 'carrier' }))).toBe(false);
    expect(dispatchesByHandover(shipment({ kind: undefined }))).toBe(false);
    expect(dispatchesByHandover(null)).toBe(false);
  });

  test('verified line', () => {
    expect(verifiedLine({ kind: 'courier-label', labelVerifiedAt: null, labelVerifyMethod: null })).toBeNull();
    expect(verifiedLine({ kind: 'client-label', labelVerifiedAt: null, labelVerifyMethod: null })).toContain('Not verified');
    expect(verifiedLine({ kind: 'client-label', labelVerifiedAt: 'x', labelVerifyMethod: 'handover-scan' })).toBe('Verified ✓ — scanned at handover');
  });
});

describe('words', () => {
  test('a file line names the kind, the derived name, pages, size and who uploaded', () => {
    expect(
      fileLine({ purpose: 'shipping-document', docKind: 'eway-bill', fileName: 'SO-1-eway-bill-1.pdf', pageCount: 2, byteSize: 2048, source: 'portal' }),
    ).toBe('E-way bill · SO-1-eway-bill-1.pdf · 2 pages · 2 KB · uploaded by the client');
    expect(fileLine({ purpose: 'handover-sheet', docKind: null, fileName: 'HO-0001-sheet-1.jpg', pageCount: null, byteSize: null, source: 'handheld' })).toBe(
      'Signed sheet · HO-0001-sheet-1.jpg · photographed on the handheld',
    );
  });

  test('the parcel tag file name and the sheet cell', () => {
    expect(parcelTagFilename('SO 1042/BO1', 'zpl')).toBe('SO-1042-BO1-parcel-tag.zpl');
    expect(parcelTagFilename('', 'pdf')).toBe('order-parcel-tag.pdf');
    expect(sheetCell(0)).toEqual({ word: 'Not uploaded', tone: 'warning' });
    expect(sheetCell(2).word).toBe('✓ 2 pages');
  });

  test('COD totals', () => {
    expect(codTotalLabel(0, 0)).toBe('All prepaid — no cash to collect');
    expect(codTotalLabel(2, 125000)).toBe('COD ₹1,250.00 on 2 parcels');
  });

  test('the handover outcome is built from the response', () => {
    expect(
      handoverOutcome({
        handover: { code: 'HO-0007', courierName: 'Delhivery' } as never,
        parcels: [{}, {}, {}] as never,
      }),
    ).toEqual({
      word: 'HO-0007 recorded',
      reason: '3 parcels handed over to Delhivery; their orders are dispatched. Print the sheet for the courier to sign.',
    });
  });
});

describe('the refusal copy (by code, never prose)', () => {
  test('the transport arm is the house unreachable copy', () => {
    expect(shippingReason(new Error('Failed to fetch'), 'label')).toBe(UNREACHABLE_REASON);
  });

  test('every story code has words', () => {
    const codes = [
      'order-not-open',
      'shipment-handed-over',
      'shipment-not-client-arranged',
      'attachment-type-unsupported',
      'attachment-too-large',
      'pdf-unreadable',
      'pdf-too-many-pages',
      'file-storage-unavailable',
      'file-storage-failed',
      'file-storage-busy',
      'no-client-label',
      'label-in-use',
      'document-limit',
      'handover-sheet-limit',
      'handover-client-mismatch',
      'handover-parcels-refused',
      'client-departed',
      'not-found',
      'role-denied',
      'idempotency-key-reuse',
    ];
    for (const code of codes) {
      const words = shippingReason(new ApiProblem(code, 409), 'handover');
      expect(words).not.toContain(`(${code})`);
    }
    expect(shippingReason(new ApiProblem('dispatch-via-handover', 409), 'handover')).toContain('the handover dispatches it');
  });

  test('a label refusal of the type says PDF; the AWB-in-use detail renders verbatim', () => {
    expect(shippingReason(new ApiProblem('attachment-type-unsupported', 415), 'label')).toContain('must be a PDF');
    expect(shippingReason(new ApiProblem('awb-in-use', 409, 'AWB 77001 is already on order SO-9'), 'awb')).toBe('AWB 77001 is already on order SO-9');
    expect(shippingReason(new ApiProblem('pdf-unreadable', 422), 'label')).toContain('Remove the password or print restriction');
  });

  test('an unknown code falls back to the detail, then names the code', () => {
    expect(shippingReason(new ApiProblem('brand-new', 409, 'Server words'), 'void')).toBe('Server words');
    expect(shippingReason(new ApiProblem('brand-new', 409), 'void')).toBe('The shipment was not voided (brand-new).');
  });

  test('the per-parcel refusals map by order, and the mismatch names its orders', () => {
    const problem = new ApiProblem('handover-parcels-refused', 409, 'x', 'y', {
      parcels: [
        { orderId: ORDER_A, code: 'label-not-verified', detail: 'd1' },
        { orderId: ORDER_B, code: 'something-new' },
        'junk',
      ],
    });
    const map = handoverRefusals(problem);
    expect(map.get(ORDER_A)).toEqual({ code: 'label-not-verified', word: 'Label not verified — scan it here', detail: 'd1' });
    expect(map.get(ORDER_B)?.word).toBe('something-new');
    expect(map.size).toBe(2);
    expect(handoverRefusals(new ApiProblem('conflict', 409)).size).toBe(0);
    expect(mismatchedOrderIds(new ApiProblem('handover-client-mismatch', 409, 'x', 'y', { orderIds: [ORDER_C, 3] }))).toEqual([ORDER_C]);
  });

  test('every generated refusal code has words', () => {
    for (const word of Object.values(HANDOVER_REFUSAL_WORD)) expect(word.length).toBeGreaterThan(0);
  });
});

describe('parsers', () => {
  test('package count and weight', () => {
    expect(parsePackageCount('')).toEqual({ value: undefined, problem: null });
    expect(parsePackageCount('3')).toEqual({ value: 3, problem: null });
    expect(parsePackageCount('0').problem).not.toBeNull();
    expect(parsePackageCount('1e3').problem).not.toBeNull();
    expect(parsePackageCount('1000').problem).not.toBeNull();
    expect(parseWeightGrams('1250')).toEqual({ value: 1250, problem: null });
    expect(parseWeightGrams('1.5').problem).not.toBeNull();
    expect(parseWeightGrams('1000001').problem).not.toBeNull();
  });

  test('the label draft normalises the AWB and takes exactly one courier', () => {
    expect(parseLabelDraft({ awb: '1234 5678-9012', transporterId: '', courierName: ' Delhivery ', packageCount: '2' })).toEqual({
      awb: '123456789012',
      courier: { courierName: 'Delhivery' },
      packageCount: 2,
      problem: null,
    });
    expect(parseLabelDraft({ awb: '123', transporterId: '', courierName: 'X', packageCount: '' }).problem).toContain('4–50');
    expect(parseLabelDraft({ awb: 'O8FE5145B99902272', transporterId: '', courierName: 'X', packageCount: '' }).problem).toContain('parcel tag');
    expect(parseLabelDraft({ awb: '77001', transporterId: '', courierName: ' ', packageCount: '' }).problem).toContain('Name the courier');
    expect(parseLabelDraft({ awb: '77001', transporterId: 'p-1', courierName: '', packageCount: '' })).toMatchObject({ courier: { transporterId: 'p-1' } });
    // A Devanagari courier name of 100 code points is allowed; 101 is not.
    expect(parseLabelDraft({ awb: '77001', transporterId: '', courierName: 'क'.repeat(100), packageCount: '' }).problem).toBeNull();
    expect(parseLabelDraft({ awb: '77001', transporterId: '', courierName: 'क'.repeat(101), packageCount: '' }).problem).not.toBeNull();
  });

  test('a reason is 1–200 characters', () => {
    expect(parseShippingReason('  ')).toMatchObject({ reason: null });
    expect(parseShippingReason(' Wrong AWB ')).toEqual({ reason: 'Wrong AWB', problem: null });
    expect(parseShippingReason('x'.repeat(201))).toMatchObject({ reason: null });
  });

  test('the file rule: a label is a PDF by its bytes, a document a PDF or a photo', async () => {
    const pdf = new File(['%PDF-1.7 rest'], 'label.bin');
    const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])], 'label.pdf', { type: 'application/pdf' });
    expect(isPdfHead(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe(true);
    expect(await shippingFileProblem(pdf, 'label')).toBeNull();
    expect(await shippingFileProblem(jpeg, 'label')).toContain('must be a PDF');
    expect(await shippingFileProblem(jpeg, 'document')).toBeNull();
    expect(await shippingFileProblem(new File(['hello world'], 'a.txt'), 'document')).toContain('Only a PDF');
    expect(await shippingFileProblem(new File([], 'a.pdf'), 'document')).toContain('empty');
  });
});

describe('the handover builder (A20, A49)', () => {
  const candidates = [
    { orderId: ORDER_A, orderLabel: 'SO-1', parcelTagCode: 'O8FE5145B99902272', shipment: { kind: 'client-label' as const, awb: '123456789012', courierName: 'Delhivery', packageCount: 1, labelVerified: true } },
    { orderId: ORDER_B, orderLabel: 'SO-2', parcelTagCode: 'O8FE5145B99902273', shipment: null },
    { orderId: ORDER_C, orderLabel: 'SO-3', parcelTagCode: 'O8FE5145B99902274', shipment: { kind: 'client-label' as const, awb: '555566667777', courierName: 'Delhivery', packageCount: null, labelVerified: false } },
  ];

  test('a row says why it cannot go', () => {
    expect(candidateBlocker(candidates[0]!, EMPTY_ROW)).toBeNull();
    expect(candidateBlocker(candidates[1]!, EMPTY_ROW)).toBe('Scan the courier’s AWB');
    expect(candidateBlocker(candidates[1]!, { ...EMPTY_ROW, awb: '77001' })).toBeNull();
    expect(candidateBlocker(candidates[2]!, EMPTY_ROW)).toBe('Label not verified — scan it here');
    expect(candidateBlocker(candidates[2]!, { ...EMPTY_ROW, awb: '5555 6666 7777' })).toBeNull();
    expect(candidateBlocker(candidates[2]!, { ...EMPTY_ROW, awb: '999988887777' })).toContain('not the client’s label');
    expect(candidateBlocker({ shipment: { kind: 'carrier', awb: 'SBX1', courierName: 'S', packageCount: 1, labelVerified: false } }, EMPTY_ROW)).toBe(
      'Carrier label — use the manifest',
    );
  });

  test('a scan: the AWB on record, the tag, the tag that needs an AWB, then that AWB', () => {
    expect(matchScan('1234-5678-9012', candidates, null)).toEqual({ kind: 'matched', orderId: ORDER_A, by: 'awb', needsAwb: false });
    expect(matchScan('o8fe5145b99902273', candidates, null)).toEqual({ kind: 'matched', orderId: ORDER_B, by: 'tag', needsAwb: true });
    expect(matchScan('77001', candidates, ORDER_B)).toEqual({ kind: 'awb-for', orderId: ORDER_B, awb: '77001' });
    expect(matchScan('77001', candidates, null).kind).toBe('unknown');
    expect(matchScan('O0000000000000000', candidates, null).kind).toBe('unknown');
    expect(matchScan('', candidates, null).kind).toBe('unknown');
    const twin = [...candidates, { ...candidates[1]!, orderId: 'other' }];
    expect(matchScan('O8FE5145B99902273', twin, null)).toEqual({ kind: 'ambiguous', orderIds: [ORDER_B, 'other'] });
  });

  const NOW = Date.parse('2026-10-30T10:30:00.000Z'); // 16:00 IST

  test('the draft → the body: normalised, blanks dropped, parcels in list order', () => {
    const draft = {
      ...emptyHandoverDraft('client-a'),
      courierName: ' Delhivery ',
      pickupPersonName: ' Ravi ',
      pickupPersonPhone: '+91 98765-43210',
      vehicleNumber: 'ka-01-ab-1234',
      rows: {
        [ORDER_A]: { ...EMPTY_ROW, selected: true },
        [ORDER_B]: { selected: true, awb: '77001', packageCount: '2', weightGrams: '1250' },
        [ORDER_C]: { ...EMPTY_ROW, selected: false },
      },
    };
    const parsed = parseHandoverDraft(draft, 'wh-1', candidates, NOW);
    expect(parsed).toEqual({
      problem: null,
      body: {
        warehouseId: 'wh-1',
        clientId: 'client-a',
        courier: { courierName: 'Delhivery' },
        pickupPersonName: 'Ravi',
        pickupPersonPhone: '+919876543210',
        vehicleNumber: 'KA01AB1234',
        parcels: [{ orderId: ORDER_A }, { orderId: ORDER_B, awb: '77001', packageCount: 2, weightGrams: 1250 }],
      },
    });
  });

  test('the draft refuses what the server would only 400', () => {
    const base = { ...emptyHandoverDraft('c'), courierName: 'D', pickupPersonName: 'R', rows: { [ORDER_A]: { ...EMPTY_ROW, selected: true } } };
    expect(parseHandoverDraft({ ...base, clientId: '' }, 'w', candidates, NOW).problem).toContain('client');
    expect(parseHandoverDraft({ ...base, courierName: '' }, 'w', candidates, NOW).problem).toContain('courier');
    expect(parseHandoverDraft({ ...base, pickupPersonName: '' }, 'w', candidates, NOW).problem).toContain('collected');
    expect(parseHandoverDraft({ ...base, pickupPersonPhone: '12' }, 'w', candidates, NOW).problem).toContain('phone');
    expect(parseHandoverDraft({ ...base, vehicleNumber: 'AB' }, 'w', candidates, NOW).problem).toContain('vehicle');
    expect(parseHandoverDraft({ ...base, pickedUpAt: '2026-10-30T16:10' }, 'w', candidates, NOW).problem).toContain('future');
    expect(parseHandoverDraft({ ...base, pickedUpAt: '2026-10-23T15:59' }, 'w', candidates, NOW).problem).toContain('7 days');
    expect(parseHandoverDraft({ ...base, pickedUpAt: '2026-10-29T09:00' }, 'w', candidates, NOW)).toMatchObject({
      body: { occurredAt: '2026-10-29T03:30:00.000Z' },
    });
    expect(parseHandoverDraft({ ...base, rows: {} }, 'w', candidates, NOW).problem).toContain('Tick or scan');
    expect(
      parseHandoverDraft(
        { ...base, rows: { [ORDER_B]: { ...EMPTY_ROW, selected: true, awb: '77001' }, [ORDER_C]: { ...EMPTY_ROW, selected: true, awb: '77-001' } } },
        'w',
        candidates,
        NOW,
      ).problem,
    ).toBe('AWB 77001 is on both SO-2 and SO-3.');
    expect(parseHandoverDraft({ ...base, transporterId: 'p-1', courierName: '' }, 'w', candidates, NOW)).toMatchObject({ body: { courier: { transporterId: 'p-1' } } });
  });

  test('one key per draft, bound to its body', () => {
    let n = 0;
    const mint = () => `K${++n}`;
    const body = { warehouseId: 'w', clientId: 'c', courier: { courierName: 'D' }, pickupPersonName: 'R', parcels: [{ orderId: ORDER_A }] };
    const first = bindHandoverKey(null, body, mint);
    expect(first.key).toBe('K1');
    expect(bindHandoverKey(first, { ...body }, mint)).toBe(first);
    expect(bindHandoverKey(first, { ...body, pickupPersonName: 'S' }, mint).key).toBe('K2');
  });
});

describe('the sheet parties (frozen, read defensively)', () => {
  test('legal name first, the address and the facts', () => {
    expect(
      sheetParty(
        { v: 1, code: 'GLOW', name: 'GlowCo', legalName: 'GlowCo Pvt Ltd', gstin: '29ABCDE1234F1Z5', registeredAddress: { line1: '1 MG Rd', line2: null, city: 'Bengaluru', stateCode: '29', pincode: '560001' } },
        'Client',
      ),
    ).toEqual({
      name: 'GlowCo Pvt Ltd',
      lines: ['1 MG Rd', 'Bengaluru 29 560001'],
      facts: [
        { label: 'Code', value: 'GLOW' },
        { label: 'GSTIN', value: '29ABCDE1234F1Z5' },
      ],
    });
  });

  test('a missing or odd snapshot prints its fallback', () => {
    expect(sheetParty(null, 'Delhivery')).toEqual({ name: 'Delhivery', lines: [], facts: [] });
    expect(sheetParty({ name: 7, originAddress: 'x' }, 'WH')).toEqual({ name: 'WH', lines: [], facts: [] });
  });
});
