import { describe, expect, test } from 'bun:test';

import { ApiProblem } from './api/client';
import type { ReturnableLineDto } from './api/generated';
import {
  EMPTY_RETURN_LINE,
  MAX_RETURN_SERIALS_PER_LINE,
  RETURN_REASON_LABEL,
  RETURN_REASON_OPTIONS,
  RETURN_STATUS_LABEL,
  canCancelReturn,
  canCreateReturn,
  cancelRefusalReloads,
  filterSerials,
  groupReturnableLines,
  parseCancelReason,
  parseReturnDraft,
  pruneReturnDraft,
  refreshesReturnable,
  returnCancelledOutcome,
  returnCreatedWord,
  returnLinesSummary,
  returnOrderLabel,
  returnReason,
  returnReasonText,
  selectAllSerials,
  AWAITING_DISPOSITION_BADGE,
  RETURN_CONDITION_LABEL,
  lineAwaitsDisposition,
  receiptHeading,
  receiptLineText,
  receivedOfAuthorized,
} from './returns';
import { UNREACHABLE_REASON } from './outbound-orders';

function rl(over: Partial<ReturnableLineDto> = {}): ReturnableLineDto {
  return {
    orderLineId: 'line-a',
    parentLineId: null,
    skuId: 'sku-a',
    kitParent: false,
    dispatchedQty: 3,
    authorizedQty: 0,
    returnableQty: 3,
    serialTracked: false,
    returnableSerials: [],
    ...over,
  };
}

const serial = (n: string) => ({ id: `id-${n}`, serialNumber: n });

describe('words', () => {
  test('statuses and reasons are word-first, over the generated unions', () => {
    expect(RETURN_STATUS_LABEL).toEqual({ open: 'Open', partially_received: 'Partly received', received: 'Received', cancelled: 'Cancelled' });
    expect(RETURN_REASON_OPTIONS.map((o) => o.value)).toEqual([
      'damaged',
      'defective',
      'wrong-item',
      'not-as-described',
      'changed-mind',
      'other',
    ]);
    expect(RETURN_REASON_LABEL['wrong-item']).toBe('Wrong item');
  });

  test('cancel is offered on an open return only; create on a dispatched order only', () => {
    expect(canCancelReturn('open')).toBe(true);
    expect(canCancelReturn('cancelled')).toBe(false);
    expect(canCreateReturn('dispatched')).toBe(true);
    for (const status of ['accepted', 'ready_to_dispatch', 'cancelled']) expect(canCreateReturn(status)).toBe(false);
  });

  test('the list cells: order reference else the order id; the lines summary; reasons with their notes', () => {
    expect(returnOrderLabel({ orderReference: 'SHOP-#1', orderId: 'o-1' })).toBe('SHOP-#1');
    expect(returnOrderLabel({ orderReference: null, orderId: 'o-1' })).toBe('o-1');
    const lines = [
      { skuId: 'a', authorizedQty: 2 },
      { skuId: 'b', authorizedQty: 1.25 },
    ] as never;
    // Counts only — quantities in different units are never summed.
    expect(returnLinesSummary({ lines })).toBe('2 lines · 2 SKUs');
    expect(returnLinesSummary({ lines: [{ skuId: 'a', authorizedQty: 1 }] as never })).toBe('1 line · 1 SKU');
    expect(returnReasonText({ reasonCode: 'damaged', reasonNote: null })).toBe('Damaged');
    expect(returnReasonText({ reasonCode: 'other', reasonNote: 'box torn' })).toBe('Other — box torn');
    expect(returnCreatedWord({ code: 'RMA-0007' })).toBe('Return RMA-0007 created');
    expect(returnCancelledOutcome({ code: 'RMA-0007' }).word).toBe('Return RMA-0007 cancelled');
  });
});

describe('the returnable read, grouped and filtered', () => {
  test('kit components group under their parent; plain lines stand alone', () => {
    const groups = groupReturnableLines([
      rl({ orderLineId: 'kit', kitParent: true, dispatchedQty: 0, returnableQty: 0 }),
      rl({ orderLineId: 'c1', parentLineId: 'kit' }),
      rl({ orderLineId: 'plain' }),
      rl({ orderLineId: 'c2', parentLineId: 'kit' }),
    ]);
    expect(groups.map((g) => [g.line.orderLineId, g.children.map((c) => c.orderLineId)])).toEqual([
      ['kit', ['c1', 'c2']],
      ['plain', []],
    ]);
  });

  test('the serial filter matches a substring, case-insensitively; select-all adds what is shown, capped at 500', () => {
    const serials = [serial('SN-AB1'), serial('SN-ab2'), serial('SN-XY3')];
    expect(filterSerials(serials, ' ab ').map((s) => s.serialNumber)).toEqual(['SN-AB1', 'SN-ab2']);
    expect(filterSerials(serials, '')).toEqual(serials);
    expect(selectAllSerials(['SN-XY3'], filterSerials(serials, 'ab'))).toEqual(['SN-XY3', 'SN-AB1', 'SN-ab2']);
    const many = Array.from({ length: 600 }, (_, i) => serial(`S-${i}`));
    expect(selectAllSerials([], many)).toHaveLength(MAX_RETURN_SERIALS_PER_LINE);
  });
});

describe('parseReturnDraft', () => {
  const lines = [
    rl({ orderLineId: 'kit', kitParent: true, returnableQty: 0 }),
    rl({ orderLineId: 'a' }),
    rl({ orderLineId: 'b' }),
    rl({ orderLineId: 's', serialTracked: true, returnableSerials: [serial('X'), serial('Y')] }),
  ];

  test('only lines above zero are sent; a serial line sends its checked numbers as the quantity; blank text stays absent', () => {
    const { body, problem } = parseReturnDraft(
      'order-1',
      {
        externalReference: '  CH-9  ',
        lines: {
          a: { ...EMPTY_RETURN_LINE, qty: '1.5', reasonCode: 'damaged', reasonNote: '  ' },
          b: { ...EMPTY_RETURN_LINE, qty: '0', reasonCode: 'damaged' },
          s: { ...EMPTY_RETURN_LINE, serials: ['Y', 'X'], reasonCode: 'other', reasonNote: ' torn ' },
          kit: { ...EMPTY_RETURN_LINE, qty: '2', reasonCode: 'damaged' },
        },
      },
      lines,
    );
    expect(problem).toBeNull();
    expect(body).toEqual({
      orderId: 'order-1',
      externalReference: 'CH-9',
      lines: [
        { orderLineId: 'a', qty: 1.5, reasonCode: 'damaged' },
        { orderLineId: 's', qty: 2, reasonCode: 'other', reasonNote: 'torn', serialNumbers: ['Y', 'X'] },
      ],
    });
  });

  test('refusals: nothing above zero, a missing reason, other without a note, a malformed quantity, an overlong reference', () => {
    const draft = (entry: Partial<typeof EMPTY_RETURN_LINE>, externalReference = '') => ({
      externalReference,
      lines: { a: { ...EMPTY_RETURN_LINE, ...entry } },
    });
    expect(parseReturnDraft('o', draft({}), lines).problem).toBe('Enter a quantity above zero on at least one line.');
    expect(parseReturnDraft('o', draft({ qty: '1' }), lines).problem).toBe('Every returned line needs a reason.');
    expect(parseReturnDraft('o', draft({ qty: '1', reasonCode: 'other' }), lines).problem).toContain('needs a note');
    expect(parseReturnDraft('o', draft({ qty: '1e3', reasonCode: 'damaged' }), lines).problem).toContain('decimal');
    expect(parseReturnDraft('o', draft({ qty: '1', reasonCode: 'damaged' }, 'x'.repeat(65)), lines).problem).toContain('64');
    // The client never pre-refuses the returnable bound — the server owns it.
    expect(parseReturnDraft('o', draft({ qty: '99', reasonCode: 'damaged' }), lines).body?.lines[0]?.qty).toBe(99);
  });

  test('the 500-serial cap holds across the whole request, not only per line', () => {
    const numbers = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}-${i}`);
    const twoSerialLines = [
      rl({ orderLineId: 's1', serialTracked: true, returnableQty: 300 }),
      rl({ orderLineId: 's2', serialTracked: true, returnableQty: 300 }),
    ];
    const draft = (a: number, b: number) => ({
      externalReference: '',
      lines: {
        s1: { ...EMPTY_RETURN_LINE, serials: numbers('A', a), reasonCode: 'damaged' as const },
        s2: { ...EMPTY_RETURN_LINE, serials: numbers('B', b), reasonCode: 'damaged' as const },
      },
    });
    expect(parseReturnDraft('o', draft(250, 250), twoSerialLines).problem).toBeNull();
    expect(parseReturnDraft('o', draft(250, 251), twoSerialLines).problem).toContain('500 serials in all');
  });

  test('pruning against a reloaded read drops refused serials and lines with nothing left, and is idempotent', () => {
    const reloaded = [
      rl({ orderLineId: 'a', returnableQty: 0 }),
      rl({ orderLineId: 'b', returnableQty: 1 }),
      rl({ orderLineId: 's', serialTracked: true, returnableSerials: [serial('Y')] }),
    ];
    const draft = {
      externalReference: 'R',
      lines: {
        a: { ...EMPTY_RETURN_LINE, qty: '2', reasonCode: 'damaged' as const },
        b: { ...EMPTY_RETURN_LINE, qty: '1', reasonCode: 'damaged' as const },
        s: { ...EMPTY_RETURN_LINE, serials: ['X', 'Y'], reasonCode: 'damaged' as const },
        gone: { ...EMPTY_RETURN_LINE, qty: '1', reasonCode: 'damaged' as const },
      },
    };
    const pruned = pruneReturnDraft(draft, reloaded);
    expect(pruned.lines).toEqual({ b: draft.lines.b, s: { ...draft.lines.s, serials: ['Y'] } });
    expect(pruned.externalReference).toBe('R');
    expect(pruneReturnDraft(pruned, reloaded)).toBe(pruned);
  });

  test('a cancel reason is required and bounded', () => {
    expect(parseCancelReason('  kept it ')).toEqual({ reason: 'kept it', problem: null });
    expect(parseCancelReason('   ').problem).toBe('Say why — a reason is required.');
    expect(parseCancelReason('x'.repeat(501)).problem).toContain('500');
  });
});

describe('returnReason', () => {
  const problem = (code: string, status = 409, extensions: Record<string, unknown> = {}, detail?: string) =>
    new ApiProblem(code, status, detail, 'Refused', extensions);

  test('every code of the error table, in its words', () => {
    expect(returnReason(problem('role-denied', 403))).toBe("You can't manage returns");
    expect(returnReason(problem('not-found', 404))).toBe('Order or return not found');
    expect(returnReason(problem('order-not-dispatched'))).toBe('Only a dispatched order can be returned');
    expect(returnReason(problem('line-not-of-order', 400))).toBe("That line isn't on this order");
    expect(returnReason(problem('kit-parent-not-returnable', 400))).toBe("Return the kit's components");
    expect(returnReason(problem('exceeds-returnable', 409, { orderLineId: 'a', returnableQty: 1.25 }))).toBe(
      'More than can be returned — 1.25 left',
    );
    expect(returnReason(problem('serial-not-dispatched', 409, { serialNumber: 'SN-9' }))).toBe("Serial SN-9 wasn't dispatched on this line");
    expect(returnReason(problem('serial-already-authorized', 409, { serialNumber: 'SN-9' }))).toBe('Serial SN-9 is already on a return');
    expect(returnReason(problem('rma-transition-invalid'))).toBe('This return can no longer be cancelled');
    expect(returnReason(problem('validation-failed', 400, {}, 'lines[0]: reasonCode "other" requires a reasonNote saying why.'))).toBe(
      'lines[0]: reasonCode "other" requires a reasonNote saying why.',
    );
    expect(returnReason(new Error('Failed to fetch'))).toBe(UNREACHABLE_REASON);
  });

  test('the refusals that reload the returnable read, and the cancel 409 that reloads the list', () => {
    expect(refreshesReturnable(problem('exceeds-returnable'))).toBe(true);
    expect(refreshesReturnable(problem('serial-not-dispatched'))).toBe(true);
    expect(refreshesReturnable(problem('serial-already-authorized'))).toBe(true);
    expect(refreshesReturnable(problem('order-not-dispatched'))).toBe(false);
    expect(refreshesReturnable(new Error('x'))).toBe(false);
    expect(cancelRefusalReloads(problem('rma-transition-invalid'))).toBe(true);
    expect(cancelRefusalReloads(problem('validation-failed', 400))).toBe(false);
  });
});

describe('story 13-2 — receipts and the awaiting badge', () => {
  test('conditions are word-first, over the generated union', () => {
    expect(RETURN_CONDITION_LABEL).toEqual({ resaleable: 'Resaleable', opened: 'Opened', damaged: 'Damaged', 'missing-parts': 'Missing parts' });
  });

  test('the badge is word-first and shows on a line once anything is received', () => {
    expect(AWAITING_DISPOSITION_BADGE).toBe('↩ Awaiting disposition');
    expect(lineAwaitsDisposition({ receivedQty: 0 })).toBe(false);
    expect(lineAwaitsDisposition({ receivedQty: 0.5 })).toBe(true);
    expect(receivedOfAuthorized({ receivedQty: 1, authorizedQty: 2 }, { uom: 'pcs', uomPrecision: 0 })).toBe('1 of 2 pcs received');
    expect(receivedOfAuthorized({ receivedQty: 0.5, authorizedQty: 1.25 }, { uom: 'kg', uomPrecision: 3 })).toBe('0.500 of 1.250 kg received');
    expect(receivedOfAuthorized({ receivedQty: 1, authorizedQty: 2 }, null)).toBe('1 of 2 units received');
  });

  test('Cancel hides once anything is received: only an open authorization can be cancelled', () => {
    expect(canCancelReturn('open')).toBe(true);
    expect(canCancelReturn('partially_received')).toBe(false);
    expect(canCancelReturn('received')).toBe(false);
    expect(canCancelReturn('cancelled')).toBe(false);
  });

  test('a receipt and its lines in words', () => {
    expect(receiptHeading({ code: 'RRN-0003', operatorEmail: 'ravi@example.com' })).toBe('RRN-0003 · ravi@example.com');
    expect(receiptHeading({ code: 'RRN-0003', operatorEmail: null })).toBe('RRN-0003 · unknown operator');
    const base = { rmaLineId: 'l', skuId: 's', qty: 1, condition: 'resaleable' as const, note: null, batchCode: null, serialNumber: null, weightGrams: null };
    expect(receiptLineText(base)).toBe('1 × Resaleable');
    expect(receiptLineText({ ...base, condition: 'opened', batchCode: 'B1', serialNumber: 'SN-1', note: 'seal cut' })).toBe(
      '1 × Opened · batch B1 · serial SN-1 · “seal cut”',
    );
    expect(receiptLineText({ ...base, condition: 'damaged', weightGrams: 2340 })).toBe('1 × Damaged · 2.340 kg');
  });
});

