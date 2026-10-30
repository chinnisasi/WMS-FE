import { describe, expect, test } from 'bun:test';

import { ApiProblem } from './api/client';
import {
  CLIENT_RETURN_STATUS_LABEL,
  RTC_ADDRESS_LABEL,
  RTC_CANCELLED_WATERMARK,
  RTC_DAMAGED_GROUP,
  RTC_DRAFT_WATERMARK,
  RTC_INVOICE_ADVICE,
  RTC_NOT_A_TAX_INVOICE,
  RTC_SOURCE_LABEL,
  advisedBrandDocument,
  buildRtcCreateBody,
  cancelPickedInstruction,
  clientReturnNoteModel,
  consigneeAddressLines,
  consigneeStateLabel,
  emptyRtcDispatchExtra,
  emptyRtcDraft,
  keyForBody,
  limitSelectionToOneClient,
  parseRtcCancelReason,
  parseRtcDispatch,
  pickedShort,
  pruneRtcDraft,
  RTC_DAMAGED_SHORT_PICK_NOTE,
  RTC_SHORT_PICK_NOTE,
  rtcCancelledOutcome,
  shortPickNotes,
  rtcAddressBlock,
  rtcAddressMissing,
  rtcCancelConfirmSentence,
  rtcReason,
  rtcRefusalReloads,
  rtcRefusalStalesReturnable,
  rtcSelectable,
  stagedUnits,
  type RtcDraft,
} from './client-returns';
import { emptyConsignmentDraft } from './consignment-capture';
import {
  CLIENT,
  CLIENT_B,
  RRL_1,
  RRL_2,
  RRL_SERIAL,
  WH,
  awaitingLine,
  clientReturn,
  damagedArm,
  dispatchedClientReturn,
  glowClient,
  pickedClientReturn,
} from './test/client-return-fixtures';

/**
 * Story 4-7c — the return to client's pure half: the words, the refusal copy
 * by code, the create draft's caps (open quantity, the shared DAMAGED pool, a
 * serial line exactly 1, a returned case refused), the queue's one-client
 * selection (A12), the dispatch body (no debit note; the consignee GSTIN and
 * declared value — A2, A9), the advised document (A2), the A11 floor copy,
 * and the note's model (A2's consignee block, A9's grouping).
 */

const problem = (code: string, extensions: Record<string, unknown> = {}) => new ApiProblem(code, 409, 'detail', 'title', extensions);

describe('words', () => {
  test('every status, source and address kind is named', () => {
    expect(CLIENT_RETURN_STATUS_LABEL).toEqual({
      draft: 'Draft — awaiting pick',
      picked: 'Picked — ready to dispatch',
      dispatched: 'Dispatched',
      cancelled: 'Cancelled',
    });
    expect(RTC_SOURCE_LABEL).toEqual({ returns: 'Returns area', damaged: 'Damaged area' });
    expect(RTC_ADDRESS_LABEL).toEqual({ return: 'Return address', registered: 'Registered address' });
  });
});

describe('refusals by code', () => {
  test('create refusals read their extensions', () => {
    expect(rtcReason(problem('exceeds-awaiting', { awaitingQty: 2 }))).toBe('A returned line has 2 awaiting a decision now — refresh and lower the quantity.');
    expect(rtcReason(problem('rtc-exceeds-damaged', { onHandQty: 10, claimedQty: 4, availableQty: 6, requestedQty: 7 }))).toBe(
      'DAMAGED holds 10, 4 already claimed by open returns — at most 6 can go on a new return (asked 7). Refresh and lower the quantity.',
    );
    expect(rtcReason(problem('client-address-missing', { addressKind: 'return', clientId: CLIENT }))).toContain('no return address on file');
    expect(rtcReason(problem('client-address-missing', { addressKind: 'registered' }))).toContain('no registered address on file');
    expect(rtcReason(problem('rtc-sku-unsupported', { skuCode: 'CASE-1' }))).toContain('CASE-1 cannot go on a return to client');
    expect(rtcReason(problem('review-pending'))).toContain('awaiting review');
    expect(rtcReason(problem('mixed-client'))).toContain("one client's goods");
  });

  test('dispatch and cancel refusals; an unknown code falls back to the detail', () => {
    expect(rtcReason(problem('rtc-not-picked', { rtcStatus: 'draft' }), 'dispatch')).toBe(
      'Only a picked return is dispatched (it is draft — awaiting pick now) — pick it on the handheld first, or refresh.',
    );
    expect(rtcReason(problem('rtc-closed', { rtcStatus: 'dispatched' }), 'cancel')).toContain('(it is dispatched now)');
    expect(rtcReason(problem('rtc-damaged-short', { onHandQty: 1, pickedQty: 3, skuCode: 'SKU-D', batchCode: null }), 'dispatch')).toContain('DAMAGED holds 1 of SKU-D');
    expect(rtcReason(problem('role-denied'), 'dispatch')).toBe('Your role cannot dispatch returns to client.');
    expect(rtcReason(new ApiProblem('brand-new-code', 409, 'Server words'))).toBe('Server words');
    expect(rtcReason(new Error('x'))).not.toContain('x');
  });

  test('which refusals reload the RTC, stale the returnable read, or name the missing address', () => {
    expect(rtcRefusalReloads(problem('rtc-closed'))).toBe(true);
    expect(rtcRefusalReloads(problem('rtc-damaged-short'))).toBe(false);
    expect(rtcRefusalStalesReturnable(problem('exceeds-awaiting'))).toBe(true);
    expect(rtcRefusalStalesReturnable(problem('rtc-exceeds-damaged'))).toBe(true);
    expect(rtcAddressMissing(problem('client-address-missing', { addressKind: 'registered', clientId: CLIENT }))).toEqual({ addressKind: 'registered', clientId: CLIENT });
    expect(rtcAddressMissing(problem('mixed-client'))).toBeNull();
  });
});

describe('A11 — the floor copy', () => {
  test('a picked RTC cancel names the staged units per area', () => {
    const picked = pickedClientReturn();
    expect(stagedUnits(picked)).toEqual({ returns: 3, damaged: 3 });
    expect(cancelPickedInstruction(picked)).toBe('Return the staged units to the Returns area (3) and the Damaged area (3)');
    expect(rtcCancelConfirmSentence(picked)).toBe(
      'Cancel RTC-0001? Nothing has moved in the system. Return the staged units to the Returns area (3) and the Damaged area (3).',
    );
    expect(rtcCancelConfirmSentence(clientReturn())).toBe(
      'Cancel RTC-0001? Nothing has moved — its returned units go back to awaiting disposition and its claim on DAMAGED is released.',
    );
    expect(pickedShort(picked)).toBe(true);
    expect(pickedShort(clientReturn())).toBe(false);
  });

  test('the cancel reason is required and bounded', () => {
    expect(parseRtcCancelReason('  ').problem).toBe('Say why the return is cancelled.');
    expect(parseRtcCancelReason(' wrong lines ').reason).toBe('wrong lines');
    expect(parseRtcCancelReason('x'.repeat(501)).problem).toContain('500');
  });
});

describe('A12 — the queue selection is one client', () => {
  const rows = [
    awaitingLine({ receiptLineId: 'a1' }),
    awaitingLine({ receiptLineId: 'b1', clientId: CLIENT_B }),
    awaitingLine({ receiptLineId: 'a2' }),
  ];
  test('a change that mixes clients keeps the selected client only', () => {
    expect([...limitSelectionToOneClient(rows, new Set(['a1']), new Set(['a1', 'b1']))]).toEqual(['a1']);
    expect([...limitSelectionToOneClient(rows, new Set(['a1']), new Set(['a1', 'a2']))]).toEqual(['a1', 'a2']);
  });
  test('Select all from empty keeps the first selected row’s client', () => {
    expect([...limitSelectionToOneClient(rows, new Set(), new Set(['a1', 'b1', 'a2']))]).toEqual(['a1', 'a2']);
    expect([...limitSelectionToOneClient(rows, new Set(), new Set(['b1']))]).toEqual(['b1']);
  });
  test('a returned case is never selectable', () => {
    expect(rtcSelectable(awaitingLine({ weightGrams: 2340 }))).toBe(false);
    expect(rtcSelectable(awaitingLine())).toBe(true);
  });
});

describe('the create draft', () => {
  const awaiting = [awaitingLine(), awaitingLine({ receiptLineId: RRL_2, openQty: 2, receivedQty: 2, rmaCode: 'RMA-0004' }), awaitingLine({ receiptLineId: RRL_SERIAL, serialNumber: 'SN-1', openQty: 1, receivedQty: 1 })];
  const damaged = [damagedArm()];
  const context = { warehouseId: WH, client: glowClient() };

  test('preselected lines start at their whole open quantity, the return address and the brand’s instruction', () => {
    const draft = emptyRtcDraft([awaiting[0]!, awaiting[2]!]);
    expect(draft.consigneeAddress).toBe('return');
    expect(draft.returns).toEqual({
      [RRL_1]: { quantity: '4', reason: 'client-instruction' },
      [RRL_SERIAL]: { quantity: '1', reason: 'client-instruction' },
    });
  });

  test('a mixed RETURNS + DAMAGED draft builds one body; blank and 0 lines stay out', () => {
    const draft: RtcDraft = {
      consigneeAddress: 'return',
      note: '  ',
      returns: { [RRL_1]: { quantity: '4', reason: 'client-instruction' }, [RRL_2]: { quantity: '0', reason: 'client-instruction' } },
      damaged: { [`${damagedArm().skuId}|`]: { quantity: '2', reason: 'damaged' } },
    };
    const built = buildRtcCreateBody(draft, { awaiting, damaged }, context);
    expect(built).toEqual({
      ok: true,
      lineCount: 2,
      body: {
        warehouseId: WH,
        consigneeAddress: 'return',
        lines: [
          { source: 'returns', returnReceiptLineId: RRL_1, quantity: 4, reasonCode: 'client-instruction' },
          { source: 'damaged', skuId: damagedArm().skuId, quantity: 2, reasonCode: 'damaged' },
        ],
      },
    });
  });

  test('caps: the open quantity, the pool after RTV and RTC claims, a serial line exactly 1, the unit precision', () => {
    const base = emptyRtcDraft([]);
    const over = buildRtcCreateBody({ ...base, returns: { [RRL_2]: { quantity: '3', reason: 'client-instruction' } } }, { awaiting, damaged }, context);
    expect(over).toMatchObject({ ok: false, lineId: `r:${RRL_2}` });
    expect(over.ok === false && over.problem).toContain('2 each await a decision');
    const pool = buildRtcCreateBody({ ...base, damaged: { [`${damagedArm().skuId}|`]: { quantity: '3', reason: 'damaged' } } }, { awaiting, damaged }, context);
    expect(pool.ok === false && pool.problem).toBe('SKU-D: at most 2 each can go back (DAMAGED holds 3, 1 claimed by RTV-0002) — the line asks 3.');
    const serial = buildRtcCreateBody({ ...base, returns: { [RRL_SERIAL]: { quantity: '0.5', reason: 'client-instruction' } } }, { awaiting, damaged }, context);
    expect(serial.ok === false && serial.problem).toContain('serial SN-1 is one unit');
    const precision = buildRtcCreateBody({ ...base, returns: { [RRL_1]: { quantity: '1.5', reason: 'client-instruction' } } }, { awaiting, damaged }, { ...context, precisionOf: () => 0 });
    expect(precision.ok === false && precision.problem).toContain('counts in whole units');
    const fractional = buildRtcCreateBody(
      { ...base, damaged: { [`${damagedArm().skuId}|`]: { quantity: '1.25', reason: 'damaged' } } },
      { awaiting, damaged: [damagedArm({ uom: 'kg', uomPrecision: 3, available: 2.5, onHand: 2.5, claimedRtv: 0, claimedBy: [] })] },
      context,
    );
    expect(fractional.ok && fractional.body.lines[0]!.quantity).toBe(1.25);
  });

  test('a returned case, a vanished line, an empty draft, Other without a note, and a client lacking the address are refused', () => {
    const base = emptyRtcDraft([]);
    const cased = buildRtcCreateBody({ ...base, returns: { [RRL_1]: { quantity: '1', reason: 'client-instruction' } } }, { awaiting: [awaitingLine({ weightGrams: 2340 })], damaged }, context);
    expect(cased.ok === false && cased.problem).toContain('returned case');
    const gone = buildRtcCreateBody({ ...base, returns: { nope: { quantity: '1', reason: 'client-instruction' } } }, { awaiting, damaged }, context);
    expect(gone.ok === false && gone.problem).toContain('no longer awaiting');
    expect(buildRtcCreateBody(base, { awaiting, damaged }, context)).toEqual({ ok: false, problem: 'Enter a quantity on at least one line — the units to send back.' });
    const other = buildRtcCreateBody({ ...base, returns: { [RRL_1]: { quantity: '1', reason: 'other' } } }, { awaiting, damaged }, context);
    expect(other).toMatchObject({ ok: false, lineId: `r:${RRL_1}` });
    const withNote = buildRtcCreateBody({ ...base, note: ' brand asked ', returns: { [RRL_1]: { quantity: '1', reason: 'other' } } }, { awaiting, damaged }, context);
    expect(withNote.ok && withNote.body.note).toBe('brand asked');
    const noReturnAddress = glowClient({ returnAddress: null });
    expect(rtcAddressBlock(noReturnAddress, 'return')).toBe('This client has no return address on file');
    expect(rtcAddressBlock(noReturnAddress, 'registered')).toBeNull();
    const blocked = buildRtcCreateBody({ ...base, returns: { [RRL_1]: { quantity: '1', reason: 'client-instruction' } } }, { awaiting, damaged }, { ...context, client: noReturnAddress });
    expect(blocked.ok === false && blocked.problem).toContain('no return address');
  });

  test('one key per draft: the same body reuses it, an edit mints a new one', () => {
    let n = 0;
    const mint = () => `k${++n}`;
    const first = keyForBody(null, '{"a":1}', mint);
    expect(keyForBody(first, '{"a":1}', mint)).toBe(first);
    expect(keyForBody(first, '{"a":2}', mint).key).toBe('k2');
  });
});

describe('the dispatch', () => {
  const rtc = pickedClientReturn();
  const now = Date.parse('2026-10-22T06:00:00.000Z');
  const capture = { ...emptyConsignmentDraft(rtc.client.gstin, now), documentNumber: 'CH-9', transporterId: 'tr-1', trackingRef: '777', packageCount: '2', debitNoteNumber: 'DN-1' };

  test('the body carries no debit note; the consignee GSTIN and declared value join it as sent', () => {
    const parsed = parseRtcDispatch(capture, { consigneeGstin: '27aaaca1234a1z5', declaredValue: '12500.50' }, rtc, now);
    expect(parsed).toEqual({
      ok: true,
      body: {
        brandDocument: { type: 'challan', number: 'CH-9', date: '2026-10-22' },
        consignorGstin: '29GLOWC1234G1Z5',
        consigneeGstin: '27AAACA1234A1Z5',
        declaredValuePaise: 1250050,
        transporterId: 'tr-1',
        trackingRef: '777',
        packageCount: 2,
      },
    });
  });

  test('blank extras stay absent; a bad GSTIN or value names its field', () => {
    const blank = parseRtcDispatch(capture, { consigneeGstin: '', declaredValue: '' }, rtc, now);
    expect(blank.ok && 'consigneeGstin' in blank.body).toBe(false);
    expect(blank.ok && 'declaredValuePaise' in blank.body).toBe(false);
    expect(parseRtcDispatch(capture, { consigneeGstin: 'XX', declaredValue: '' }, rtc, now)).toMatchObject({ ok: false, extra: 'consigneeGstin' });
    expect(parseRtcDispatch(capture, { consigneeGstin: '', declaredValue: '1.234' }, rtc, now)).toMatchObject({ ok: false, extra: 'declaredValue' });
    expect(parseRtcDispatch(capture, { consigneeGstin: '', declaredValue: '10000000001' }, rtc, now)).toMatchObject({ ok: false, extra: 'declaredValue' });
    expect(parseRtcDispatch({ ...capture, documentNumber: '' }, emptyRtcDispatchExtra(null), rtc, now)).toMatchObject({ ok: false, field: 'documentNumber' });
  });

  test('A2 — the advised document follows the two GSTINs’ state prefixes', () => {
    expect(advisedBrandDocument('29GLOWC1234G1Z5', '29GLOWC1234G1Z5').type).toBe('challan');
    expect(advisedBrandDocument('29GLOWC1234G1Z5', '').type).toBe('challan');
    expect(advisedBrandDocument('', '27AAACA1234A1Z5').type).toBe('challan');
    const inter = advisedBrandDocument('27AAACA1234A1Z5', '29GLOWC1234G1Z5');
    expect(inter.type).toBe('invoice');
    expect(inter.advice).toBe(`${RTC_INVOICE_ADVICE} (Maharashtra → Karnataka)`);
  });
});

describe('the note model', () => {
  test('a draft prints a pick list under the watermark, grouped by RMA then the DAMAGED stock', () => {
    const model = clientReturnNoteModel(clientReturn());
    expect(model.dispatched).toBe(false);
    expect(model.watermark).toBe(RTC_DRAFT_WATERMARK);
    expect(model.copies).toEqual(['Pick list']);
    expect(model.lines.map((line) => line.group)).toEqual(['RMA-0003 — customer return of order SHOP-1001', RTC_DAMAGED_GROUP]);
    expect(model.lines[0]!.detail).toBe('received opened');
    expect(model.lines[1]!.detail).toBeUndefined();
    expect(model.lines.map((line) => line.reason)).toEqual(['Client instruction', 'Damaged']);
    expect(model.consignee.heading).toBe('Return to GlowCo Consumer Pvt Ltd — return address');
    expect(model.consignee.facts).toEqual([{ label: 'GSTIN', value: '29GLOWC1234G1Z5 (Karnataka)' }]);
    expect(model.consignee.lines).toContain('State: Karnataka');
    expect(model.capture).toEqual([]);
    expect(model.footer).toBe(RTC_NOT_A_TAX_INVOICE);
    expect(clientReturnNoteModel({ ...clientReturn(), status: 'cancelled' }).watermark).toBe(RTC_CANCELLED_WATERMARK);
  });

  test('dispatched: three copies of the shipped quantities, "Unregistered" for a null consignee GSTIN, the declared value by the consignor', () => {
    const model = clientReturnNoteModel(dispatchedClientReturn());
    expect(model.copies).toEqual(['Consignee copy', 'Transporter copy', 'Warehouse copy']);
    expect(model.watermark).toBeNull();
    expect(model.lines.map((line) => line.quantity)).toEqual(['3', '3']);
    expect(model.consignee.facts).toEqual([{ label: 'GSTIN', value: 'Unregistered' }]);
    expect(model.consignor.facts).toEqual([{ label: 'GSTIN', value: '29GLOWC1234G1Z5 (Karnataka)' }]);
    const capture = Object.fromEntries(model.capture.map((row) => [row.label, row.value]));
    expect(capture["Consignor's document"]).toBe('Delivery challan CH-9 · 22 Oct 2026');
    expect(capture['Declared value']).toBe('₹12,500.50 (declared by the consignor)');
    expect(capture['Transporter']).toBe('VRL Logistics (TR-VRL)');
    expect(capture['AWB / LR']).toBe('777');
    expect(capture['Packages']).toBe('2');
  });

  test('a registered address prints its state code; a serial prints on its line', () => {
    expect(
      consigneeAddressLines({ kind: 'registered', contactName: null, phone: null, line1: '4 Brigade Road', line2: null, city: 'Bengaluru', state: null, stateCode: '29', pincode: '560001' }),
    ).toEqual(['4 Brigade Road', 'Bengaluru — 560001', 'State: 29 Karnataka']);
    const base = clientReturn();
    const serial = clientReturnNoteModel({ ...base, lines: [{ ...base.lines[0]!, serialNumber: 'SN-1', quantity: 1 }] });
    expect(serial.lines[0]!.detail).toBe('received opened · serial SN-1');
  });
});

describe('code review — source-aware floor copy, the pruned draft, the consignee state', () => {
  const base = pickedClientReturn();
  const returnsOnly = { ...base, lines: [base.lines[0]!] };
  const damagedOnly = { ...base, lines: [base.lines[1]!] };

  test('the cancel names only the areas the RTC draws from', () => {
    expect(cancelPickedInstruction(returnsOnly)).toBe('Return the staged units to the Returns area (3)');
    expect(cancelPickedInstruction(damagedOnly)).toBe('Return the staged units to the Damaged area (3)');
    expect(rtcCancelConfirmSentence({ ...clientReturn(), lines: [clientReturn().lines[1]!] })).toBe('Cancel RTC-0001? Nothing has moved — its claim on DAMAGED is released.');
    expect(rtcCancelledOutcome({ ...clientReturn(), lines: [clientReturn().lines[0]!] }).reason).toBe('Its returned units go back to awaiting disposition.');
    expect(rtcCancelledOutcome(returnsOnly).reason).toBe('Its returned units go back to awaiting disposition. Return the staged units to the Returns area (3).');
  });

  test('the short-pick note follows the short source', () => {
    // The fixture: the returns line 3 of 4 (short), the damaged line whole.
    expect(shortPickNotes(base)).toEqual([RTC_SHORT_PICK_NOTE]);
    const damagedShort = { ...base, lines: [{ ...base.lines[0]!, pickedQuantity: 4 }, { ...base.lines[1]!, pickedQuantity: 1 }] };
    expect(shortPickNotes(damagedShort)).toEqual([RTC_DAMAGED_SHORT_PICK_NOTE]);
    expect(RTC_DAMAGED_SHORT_PICK_NOTE).toBe('Units you could not find stay in DAMAGED — raise a count for the DAMAGED area');
    const both = { ...base, lines: [base.lines[0]!, { ...base.lines[1]!, pickedQuantity: 1 }] };
    expect(shortPickNotes(both)).toEqual([RTC_SHORT_PICK_NOTE, RTC_DAMAGED_SHORT_PICK_NOTE]);
    expect(shortPickNotes(clientReturn())).toEqual([]);
  });

  test('a fresh read prunes lines it no longer offers; an untouched draft is returned as is', () => {
    const key = `${damagedArm().skuId}|`;
    const draft: RtcDraft = {
      consigneeAddress: 'return',
      note: '',
      returns: { [RRL_1]: { quantity: '4', reason: 'client-instruction' }, gone: { quantity: '1', reason: 'client-instruction' } },
      damaged: { [key]: { quantity: '2', reason: 'damaged' } },
    };
    const pruned = pruneRtcDraft(draft, { awaiting: [awaitingLine()], damaged: [damagedArm({ available: 0 })] });
    expect(Object.keys(pruned.returns)).toEqual([RRL_1]);
    expect(pruned.damaged).toEqual({});
    const kept = { ...draft, returns: { [RRL_1]: draft.returns[RRL_1]! } };
    expect(pruneRtcDraft(kept, { awaiting: [awaitingLine()], damaged: [damagedArm()] })).toBe(kept);
  });

  test('a registered-address consignee prints its state code’s name', () => {
    expect(consigneeStateLabel({ state: null, stateCode: '29' })).toBe('29 Karnataka');
    expect(consigneeStateLabel({ state: 'Karnataka', stateCode: null })).toBe('Karnataka');
    expect(consigneeStateLabel({ state: null, stateCode: null })).toBeNull();
  });
});
