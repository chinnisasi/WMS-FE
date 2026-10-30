import { describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import type { FreightConsignmentViewDto, FreightLoadViewDto } from '@/lib/api/generated';
import {
  EMPTY_FREIGHT_HEADER,
  addSeal,
  bindFreightKey,
  canRecordDelivery,
  candidateGateNote,
  capacityCell,
  clientCodesLabel,
  createLoadBody,
  defaultDecision,
  deliveryLine,
  dispatchOutcome,
  emptyDispatchDraft,
  freightOrderRefusals,
  freightReason,
  kgLabel,
  loadedWords,
  loadingOrder,
  moveStop,
  orderFreightLine,
  packagesWords,
  parseDeliveryDraft,
  parseDispatchDraft,
  parseFreightHeader,
  parseLrDraft,
  rebaseDispatchDraft,
  selectionTotals,
  type DispatchDraft,
} from './freight';

export const NOW = Date.parse('2026-10-30T10:30:00.000Z'); // 16:00 IST

export function consignment(over: Partial<FreightConsignmentViewDto> = {}): FreightConsignmentViewDto {
  return {
    id: 'c-1',
    orderId: 'o-1',
    orderLabel: 'SO-1',
    orderStatus: 'ready_to_dispatch',
    clientId: 'cl-a',
    clientCode: 'ACME',
    stopSeq: 1,
    consignmentRef: 'LD-0001/01',
    status: 'planned',
    consignee: { name: 'Buyer', city: 'Pune', state: 'MH', pincode: '411001' },
    lr: { number: null, date: null, terms: null },
    packages: { total: 15, pallets: 15, loaded: 15, staleScans: 0, packed: true },
    weightGrams: 9_840_000,
    gate: { state: 'ready', blocking: false },
    eway: { number: null, validUntil: null },
    invoice: null,
    loadException: null,
    complianceException: null,
    dispatchedAt: null,
    delivery: null,
    ...over,
  };
}

export function load(over: Partial<FreightLoadViewDto> = {}): FreightLoadViewDto {
  return {
    id: 'l-1',
    code: 'LD-0001',
    status: 'open',
    mode: 'ltl',
    warehouseId: 'w-1',
    transporter: { partnerId: 'p-1', name: 'VRL', snapshot: null },
    vehicle: { type: 'hcv', number: 'KA01AB1234', containerNumber: null, capacityKg: 20_000, reportedAt: null },
    driver: { name: 'Ravi', phone: '9876543210', licenceNumber: null },
    dockDoor: 'D-3',
    seals: [],
    note: null,
    loadingStartedAt: null,
    dispatchedAt: null,
    dispatchedBy: null,
    dispatchSource: null,
    partB: { required: false, confirmedAt: null, confirmedBy: null },
    capacityExceeded: false,
    totals: { consignments: 2, packages: 21, loaded: 21, pallets: 15, grossWeightGrams: 10_000_000, weightKnown: true, overCapacity: false },
    consignments: [
      consignment(),
      consignment({
        id: 'c-2',
        orderId: 'o-3',
        orderLabel: 'SO-3',
        clientId: 'cl-b',
        clientCode: 'GLOW',
        stopSeq: 2,
        consignmentRef: 'LD-0001/02',
        packages: { total: 6, pallets: 0, loaded: 6, staleScans: 0, packed: true },
      }),
    ],
    removed: [],
    sheet: [],
    cancel: null,
    createdBy: 'u-1',
    createdAt: '2026-10-30T08:00:00.000Z',
    ...over,
  };
}

const problem = (code: string, extensions: Record<string, unknown> = {}, detail?: string) => new ApiProblem(code, 409, detail, 'x', extensions);

describe('freight words and figures', () => {
  test('loaded words, kg, capacity, packages, clients', () => {
    expect(loadedWords(340, 600)).toBe('340 of 600 loaded');
    expect(loadedWords(0, 0)).toBe('No packages yet');
    expect(kgLabel(9_840_000)).toBe('9,840 kg');
    expect(kgLabel(null)).toBe('—');
    expect(capacityCell(21_000_000, 20_000)).toEqual({ text: '21,000 of 20,000 kg', over: true });
    expect(capacityCell(null, 20_000)).toEqual({ text: '— of 20,000 kg', over: false });
    expect(capacityCell(5_000, null)).toEqual({ text: '5 kg', over: false });
    expect(packagesWords(17, 15)).toBe('15 pallets, 2 cartons');
    expect(packagesWords(1, 0)).toBe('1 carton');
    expect(clientCodesLabel({ clientCodes: ['ACME', 'GLOW'], clientMore: 2 })).toBe('ACME, GLOW +2');
  });

  test('the loading order is the reverse of the stop order; a stop moves one place', () => {
    expect(loadingOrder([{ stopSeq: 1 }, { stopSeq: 3 }, { stopSeq: 2 }]).map((s) => s.stopSeq)).toEqual([3, 2, 1]);
    expect(moveStop(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
    expect(moveStop(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
  });

  test('a blocking candidate is marked, never refused', () => {
    expect(candidateGateNote({ consignment: { state: 'missing', blocking: true } })).toBe('Invoice not recorded — record it first — it cannot leave until recorded.');
    expect(candidateGateNote({ consignment: { state: 'ready', blocking: false } })).toBeNull();
    expect(candidateGateNote({})).toBeNull();
  });

  test('the selection totals against capacity', () => {
    const rows = [
      { orderId: 'a', packages: { cartons: 2, pallets: 15, packed: true }, grossWeightGrams: 18_000_000 },
      { orderId: 'b', packages: { cartons: 6, pallets: 0, packed: true }, grossWeightGrams: 3_000_000 },
      { orderId: 'c', packages: { cartons: 1, pallets: 0, packed: false }, grossWeightGrams: null },
    ];
    expect(selectionTotals(rows, new Set(['a', 'b']), 20_000)).toEqual({ orders: 2, cartons: 8, pallets: 15, grams: 21_000_000, weightKnown: true, over: true });
    expect(selectionTotals(rows, new Set(['c']), null).weightKnown).toBe(false);
  });

  test('the delivery and the order block in words', () => {
    expect(deliveryLine({ outcome: 'delivered', deliveredAt: '2026-11-02T05:50:00.000Z', receiverName: 'A. Kumar', short: null, damaged: null, note: null })).toBe(
      'Delivered 02 Nov 2026, 11:20 IST — received by A. Kumar',
    );
    expect(deliveryLine({ outcome: 'delivered-with-exceptions', deliveredAt: '2026-11-02T05:50:00.000Z', receiverName: null, short: 0, damaged: 1, note: 'pallet 4 crushed corner' })).toBe(
      'Delivered with exceptions 02 Nov 2026, 11:20 IST — 1 damaged: “pallet 4 crushed corner”',
    );
    expect(deliveryLine({ outcome: 'refused', deliveredAt: '2026-11-02T05:50:00.000Z', receiverName: null, short: null, damaged: null, note: 'wrong item' })).toBe(
      'Refused by the consignee 02 Nov 2026, 11:20 IST: “wrong item”',
    );
    const block = {
      consignmentId: 'c-1',
      loadId: 'l-1',
      loadCode: 'LD-0007',
      consignmentRef: 'LD-0007/03',
      status: 'planned' as const,
      stopSeq: 3,
      lrNumber: null,
      lrDate: null,
      freightTerms: null,
      transporterName: 'VRL',
      vehicleNumber: null,
      dispatchedAt: null,
      packageCount: null,
      loadedPackageCount: null,
      loadException: null,
      delivery: null,
    };
    expect(orderFreightLine(block)).toBe('On truck LD-0007 (stop 3) — VRL');
    expect(orderFreightLine({ ...block, status: 'dispatched', vehicleNumber: 'KA01AB1234', lrNumber: '4410', dispatchedAt: '2026-10-30T10:35:00.000Z' })).toBe(
      'Left by truck LD-0007/03 on 30 Oct 2026, 16:05 IST — VRL, vehicle KA01AB1234, LR 4410',
    );
  });
});

describe('the load header', () => {
  test('a typed transporter, normalised vehicle and phone, blanks dropped', () => {
    const parsed = parseFreightHeader(
      { ...EMPTY_FREIGHT_HEADER, transporterKind: 'typed', transporterName: ' VRL Logistics ', vehicleNumber: 'ka-01 ab 1234', driverPhone: '98765 43210', capacityKg: '20000', dockDoor: 'd-3' },
      NOW,
    );
    expect(parsed).toEqual({
      body: { mode: 'ftl', transporter: { name: 'VRL Logistics' }, vehicleNumber: 'KA01AB1234', vehicleCapacityKg: 20000, driverPhone: '9876543210', dockDoor: 'D-3' },
      problem: null,
    });
    expect(createLoadBody(parsed.body!, ['o-1'])).toEqual({ ...parsed.body!, orderIds: ['o-1'] });
    expect(createLoadBody(parsed.body!, [])).toEqual(parsed.body!);
  });

  test('the shape rules', () => {
    const p = (over: Partial<typeof EMPTY_FREIGHT_HEADER>) => parseFreightHeader({ ...EMPTY_FREIGHT_HEADER, transporterId: 'p-1', ...over }, NOW).problem;
    expect(parseFreightHeader(EMPTY_FREIGHT_HEADER, NOW).problem).toContain('Pick the transporter');
    expect(p({ capacityKg: '70000' })).toContain('Capacity');
    expect(p({ driverLicenceNumber: 'DL-14' })).toContain('Driving licence');
    expect(p({ vehicleNumber: 'AB' })).toContain('Vehicle number');
    expect(p({ reportedAt: '2026-10-30T17:00' })).toBe('Reported at cannot be in the future.');
    expect(p({ reportedAt: '2026-10-30T15:00' })).toBeNull();
  });
});

describe('the departure draft', () => {
  test('defaults: full → Send, none → Leave, partial → choose, a blocking gate → Leave', () => {
    expect(defaultDecision(consignment())).toBe('dispatch');
    expect(defaultDecision(consignment({ packages: { total: 6, pallets: 0, loaded: 0, staleScans: 0, packed: true } }))).toBe('leave');
    expect(defaultDecision(consignment({ packages: { total: 6, pallets: 0, loaded: 5, staleScans: 0, packed: true } }))).toBeNull();
    expect(defaultDecision(consignment({ gate: { state: 'missing', blocking: true } }))).toBe('leave');
  });

  test('a full load sends both orders; the body carries the vehicle and seals', () => {
    let draft = emptyDispatchDraft(load());
    draft = { ...draft, seals: addSeal(draft.seals, ' s-991 ').seals, rows: { ...draft.rows, 'o-1': { ...draft.rows['o-1']!, lrNumber: '4410' } } };
    expect(parseDispatchDraft(draft, load(), NOW)).toEqual({
      body: {
        vehicleNumber: 'KA01AB1234',
        vehicleType: 'hcv',
        driverName: 'Ravi',
        driverPhone: '9876543210',
        seals: ['S-991'],
        consignments: [
          { orderId: 'o-1', decision: 'dispatch', lrNumber: '4410' },
          { orderId: 'o-3', decision: 'dispatch' },
        ],
      },
      problem: null,
    });
  });

  test('partly loaded needs the acknowledgement; every order left is a cancel', () => {
    const l = load({ consignments: [consignment({ packages: { total: 6, pallets: 0, loaded: 5, staleScans: 0, packed: true } })] });
    const draft = emptyDispatchDraft(l);
    expect(parseDispatchDraft(draft, l, NOW).problem).toBe('SO-1: choose Send or Leave on the dock.');
    const send = { ...draft, rows: { 'o-1': { ...draft.rows['o-1']!, decision: 'dispatch' as const } } };
    expect(parseDispatchDraft(send, l, NOW).problem).toContain('tick “Send with 1 unscanned”');
    const ack = { ...send, rows: { 'o-1': { ...send.rows['o-1']!, unscannedAcknowledged: true } } };
    expect(parseDispatchDraft(ack, l, NOW).body?.consignments).toEqual([{ orderId: 'o-1', decision: 'dispatch', unscannedAcknowledged: true }]);
    const leave = { ...draft, rows: { 'o-1': { ...draft.rows['o-1']!, decision: 'leave' as const } } };
    expect(parseDispatchDraft(leave, l, NOW).problem).toBe('Every order is left on the dock — cancel the load instead.');
  });

  test('one LR, one client; LR date window; Part B and capacity acknowledgements', () => {
    const base = emptyDispatchDraft(load());
    const shared: DispatchDraft = {
      ...base,
      rows: { 'o-1': { ...base.rows['o-1']!, lrNumber: '4410' }, 'o-3': { ...base.rows['o-3']!, lrNumber: '4410' } },
    };
    expect(parseDispatchDraft(shared, load(), NOW).problem).toBe('LR 4410 is given to orders of 2 clients — an LR covers one client’s goods.');
    const terms: DispatchDraft = { ...base, rows: { ...base.rows, 'o-1': { ...base.rows['o-1']!, freightTerms: 'paid' } } };
    expect(parseDispatchDraft(terms, load(), NOW).problem).toBe('SO-1: an LR date or freight terms need the LR number.');
    const late: DispatchDraft = { ...base, rows: { ...base.rows, 'o-1': { ...base.rows['o-1']!, lrNumber: '4410', lrDate: '2026-10-31' } } };
    expect(parseDispatchDraft(late, load(), NOW).problem).toContain('within 30 days before the departure (2026-10-30)');
    const partB = load({ partB: { required: true, confirmedAt: null, confirmedBy: null } });
    expect(parseDispatchDraft(emptyDispatchDraft(partB), partB, NOW).problem).toContain('Part B');
    expect(parseDispatchDraft({ ...emptyDispatchDraft(partB), ewayPartBConfirmed: true }, partB, NOW).body?.ewayPartBConfirmed).toBe(true);
    const heavy = load({ totals: { ...load().totals, overCapacity: true } });
    expect(parseDispatchDraft(emptyDispatchDraft(heavy), heavy, NOW).problem).toContain('over its stated capacity');
    expect(parseDispatchDraft({ ...emptyDispatchDraft(heavy), overCapacityAcknowledged: true }, heavy, NOW).body?.overCapacityAcknowledged).toBe(true);
  });

  test('the departure time: not in the future, not before the load was opened', () => {
    const base = emptyDispatchDraft(load());
    expect(parseDispatchDraft({ ...base, departedAt: '2026-10-30T16:30' }, load(), NOW).problem).toBe('Departed at cannot be in the future.');
    expect(parseDispatchDraft({ ...base, departedAt: '2026-10-30T13:00' }, load(), NOW).problem).toContain('before the load was opened');
    expect(parseDispatchDraft({ ...base, departedAt: '2026-10-30T15:00' }, load(), NOW).body?.departedAt).toBe('2026-10-30T09:30:00.000Z');
  });

  test('seals: normalised, refused when malformed, twice, or a sixth', () => {
    expect(addSeal([], 'seal 1')).toEqual({ seals: [], problem: 'A seal number is 1–30 letters, digits, “-” or “/”.' });
    expect(addSeal(['S-1'], 's-1').problem).toBe('Seal S-1 is already listed.');
    expect(addSeal(['1', '2', '3', '4', '5'], '6').problem).toBe('At most 5 seals.');
  });

  test('a members change keeps the vehicle and the surviving rows', () => {
    const draft = { ...emptyDispatchDraft(load()), driverName: 'Suresh' };
    const edited = { ...draft, rows: { ...draft.rows, 'o-1': { ...draft.rows['o-1']!, lrNumber: '77' } } };
    const reread = load({ consignments: [consignment(), consignment({ id: 'c-9', orderId: 'o-9', orderLabel: 'SO-9', stopSeq: 3 })] });
    const next = rebaseDispatchDraft(edited, reread);
    expect(next.driverName).toBe('Suresh');
    expect(Object.keys(next.rows)).toEqual(['o-1', 'o-9']);
    expect(next.rows['o-1']!.lrNumber).toBe('77');
  });

  test('the key is bound to the body', () => {
    let n = 0;
    const mint = () => `K${++n}`;
    const first = bindFreightKey(null, { a: 1 }, mint);
    expect(bindFreightKey(first, { a: 1 }, mint)).toBe(first);
    expect(bindFreightKey(first, { a: 2 }, mint).key).toBe('K2');
  });

  test('the outcome is built from the response', () => {
    expect(
      dispatchOutcome({
        load: load({ status: 'dispatched' }),
        dispatched: [
          { orderId: 'o-1', consignmentId: 'c-1', lrNumber: null, loadException: 'packages-unscanned', complianceException: null, followOnOrderId: null },
          { orderId: 'o-3', consignmentId: 'c-2', lrNumber: null, loadException: null, complianceException: null, followOnOrderId: null },
        ],
        left: [{ orderId: 'o-4', reason: 'Left on the dock at departure' }],
      }),
    ).toEqual({ word: 'LD-0001 departed', reason: '2 orders dispatched, 1 left on the dock, 1 with packages unscanned.' });
  });
});

describe('LR and delivery drafts', () => {
  test('an LR after departure needs a reason', () => {
    const dispatched = { status: 'dispatched' as const, dispatchedAt: '2026-10-30T10:35:00.000Z', orderLabel: 'SO-1' };
    expect(parseLrDraft({ lrNumber: 'vrl/blr-0042', lrDate: '', freightTerms: 'to-pay', reason: '' }, dispatched, NOW).problem).toContain('Say why');
    expect(parseLrDraft({ lrNumber: 'vrl/blr-0042', lrDate: '2026-10-30', freightTerms: 'to-pay', reason: 'Typo' }, dispatched, NOW)).toEqual({
      body: { lrNumber: 'VRL/BLR0042', lrDate: '2026-10-30', freightTerms: 'to-pay', reason: 'Typo' },
      problem: null,
    });
    expect(parseLrDraft({ lrNumber: 'O0123456789ABCDEF', lrDate: '', freightTerms: '', reason: '' }, { ...dispatched, status: 'planned' }, NOW).problem).toContain('parcel tag');
  });

  test('the delivery rules', () => {
    const facts = { packageCount: 15, dispatchedAt: '2026-10-30T10:35:00.000Z', amending: false };
    const later = Date.parse('2026-11-02T08:00:00.000Z');
    const base = { outcome: 'delivered-with-exceptions' as const, deliveredAt: '2026-11-02T11:20', receiverName: 'A. Kumar', short: '', damaged: '1', note: 'crushed', reason: '' };
    expect(parseDeliveryDraft(base, facts, later)).toEqual({
      body: { outcome: 'delivered-with-exceptions', deliveredAt: '2026-11-02T05:50:00.000Z', receiverName: 'A. Kumar', damagedPackageCount: 1, note: 'crushed' },
      problem: null,
    });
    expect(parseDeliveryDraft({ ...base, damaged: '16' }, facts, later).problem).toBe('Short and damaged together cannot pass the 15 packages sent.');
    expect(parseDeliveryDraft({ ...base, outcome: 'delivered' }, facts, later).problem).toContain('no short or damaged');
    expect(parseDeliveryDraft({ ...base, outcome: 'refused', note: '' }, facts, later).problem).toBe('Say why the consignee refused it.');
    expect(parseDeliveryDraft({ ...base, deliveredAt: '2026-10-30T15:00' }, facts, later).problem).toBe('Delivered at is before the truck left.');
    expect(parseDeliveryDraft(base, { ...facts, amending: true }, later).problem).toContain('amended');
  });

  test('recording is dispatch.execute; amending is orders.manage', () => {
    const left = consignment({ status: 'dispatched' });
    expect(canRecordDelivery(left, true, false)).toBe(true);
    const recorded = consignment({
      status: 'dispatched',
      delivery: { outcome: 'delivered', deliveredAt: '2026-11-02T05:50:00.000Z', receiverName: null, short: null, damaged: null, note: null, deliverySeq: 1, recordedAt: null, recordedBy: null },
    });
    expect(canRecordDelivery(recorded, true, false)).toBe(false);
    expect(canRecordDelivery(recorded, true, true)).toBe(true);
    expect(canRecordDelivery(consignment(), true, true)).toBe(false);
  });
});

describe('freight refusals', () => {
  test('per-order refusals by order, the other load named', () => {
    const map = freightOrderRefusals(
      problem('freight-orders-refused', {
        orders: [
          { orderId: 'o-5', code: 'order-on-freight-load', loadCode: 'LD-0002' },
          { orderId: 'o-9', code: 'order-has-courier-shipment', detail: 'void it' },
          { orderId: 'o-2', code: 'packages-not-loaded' },
        ],
      }),
    );
    expect(map.get('o-5')?.word).toBe('Already on truck LD-0002');
    expect(map.get('o-9')?.word).toBe('Has a courier or client label — void it first');
    expect(map.get('o-2')?.code).toBe('packages-not-loaded');
    expect(freightOrderRefusals(problem('load-full')).size).toBe(0);
  });

  test('every code has words; the transport arm is the house copy', () => {
    expect(freightReason(problem('load-full'), 'add')).toBe('Orders not added — a truck carries at most 100 orders. Start a second load.');
    expect(freightReason(problem('package-not-on-load', { loadCode: 'LD-0008' }), 'scan')).toBe('Not loaded — this package belongs to LD-0008, not this truck.');
    expect(freightReason(problem('package-code-ambiguous'), 'scan')).toContain('Scan each carton or pallet label');
    expect(freightReason(problem('role-denied'), 'delivery')).toContain('only an office role');
    expect(freightReason(problem('eway-part-b-unconfirmed', {}, 'Update Part B'), 'dispatch')).toBe('Update Part B');
    expect(freightReason(new Error('x'), 'read')).toBe('The API is unreachable — is wms-be running?');
  });
});
