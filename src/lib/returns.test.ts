import { describe, expect, test } from 'bun:test';

import { ApiProblem } from './api/client';
import type { BinResponse, ReturnableLineDto } from './api/generated';
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
  DISPOSITIONED_BADGE,
  DISPOSITION_OUTCOME_LABEL,
  DISPOSITION_REASON_LABEL,
  DISPOSITION_REASON_OPTIONS,
  awaitingCaptureText,
  dispositionActionLabel,
  dispositionHistoryText,
  dispositionOutcome,
  dispositionReason,
  dispositionRefusalReloads,
  disposedWhole,
  emptyDispositionDraft,
  lineAwaitsDisposition,
  lineDispositionSplit,
  lineDispositionState,
  lineDispositionText,
  parseDisposition,
  quarantineUnavailable,
  restockTargetBins,
  returnAgeLabel,
  returnAgeNeedsAttention,
  scrapConfirmText,
  type AwaitingReturnLine,
  type DispositionDraft,
  receiptHeading,
  receiptLineText,
  receivedOfAuthorized,
  AWAITING_REVIEW_BADGE,
  REVERSED_BADGE,
  RETURN_ORIGIN_LABEL,
  REVIEW_STATUS_LABEL,
  MATCH_KIND_LABEL,
  REJECT_REASON_LABEL,
  REJECT_REASON_OPTIONS,
  NOT_OUR_GOODS_HINT,
  CLIENT_PROMPTED_WARNING,
  blindAcceptedOutcome,
  blindRejectedOutcome,
  blindReviewReason,
  blindReviewRefusalReloads,
  isBlindReturn,
  openRmaForSuggestion,
  parcelReferenceText,
  parseRejectDraft,
  previewBlindLinks,
  reviewBadge,
  reviewSummaryText,
  sameParcelText,
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
    // Story 4-7b — the label map knows `unannounced` (a blind line's reason), the create options never offer it.
    expect(RETURN_REASON_LABEL.unannounced).toBe('Unannounced');
    expect(RETURN_REASON_OPTIONS.map((o) => o.value)).not.toContain('unannounced');
    expect(returnReasonText({ reasonCode: 'unannounced', reasonNote: null })).toBe('Unannounced');
  });

  test('cancel is offered on an open return only; create on a dispatched order only', () => {
    expect(canCancelReturn('open')).toBe(true);
    expect(canCancelReturn('cancelled')).toBe(false);
    expect(canCreateReturn('dispatched')).toBe(true);
    for (const status of ['accepted', 'ready_to_dispatch', 'cancelled']) expect(canCreateReturn(status)).toBe(false);
  });

  test('the list cells: order reference else the order id; the lines summary; reasons with their notes', () => {
    expect(returnOrderLabel({ orderReference: 'SHOP-#1', orderId: 'o-1' })).toBe('SHOP-#1');
    // Story 4-1b — no reference: the order id's short form (its last 8 characters).
    expect(returnOrderLabel({ orderReference: null, orderId: '0198f7a2-1b3c-7d4e-8f90-0000000000b1' })).toBe('000000b1');
    // Story 4-7b — an unannounced return linked to no order.
    expect(returnOrderLabel({ orderReference: null, orderId: null })).toBe('Unannounced');
    expect(returnOrderLabel({ orderReference: 'SHOP-#9', orderId: null })).toBe('SHOP-#9');
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

  test('the badges are word-first', () => {
    expect(AWAITING_DISPOSITION_BADGE).toBe('↩ Awaiting disposition');
    expect(DISPOSITIONED_BADGE).toBe('✓ Dispositioned');
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
    const base = {
      id: 'rrl-1',
      rmaLineId: 'l',
      skuId: 's',
      qty: 1,
      condition: 'resaleable' as const,
      note: null,
      batchCode: null,
      serialNumber: null,
      weightGrams: null,
      openQty: 1,
      restockedQty: 0,
      scrappedQty: 0,
      onHoldQty: 0,
      failedInspectionQty: 0,
    };
    expect(receiptLineText(base)).toBe('1 × Resaleable');
    expect(receiptLineText({ ...base, condition: 'opened', batchCode: 'B1', serialNumber: 'SN-1', note: 'seal cut' })).toBe(
      '1 × Opened · batch B1 · serial SN-1 · “seal cut”',
    );
    expect(receiptLineText({ ...base, condition: 'damaged', weightGrams: 2340 })).toBe('1 × Damaged · 2.340 kg');
  });
});


// ── story 4-7a ───────────────────────────────────────────────────────────────

function receiptLine(over: Record<string, unknown> = {}) {
  return {
    id: 'rrl-1',
    rmaLineId: 'rl-1',
    skuId: 'sku-a',
    qty: 2,
    condition: 'resaleable' as const,
    note: null,
    batchCode: null,
    serialNumber: null,
    weightGrams: null,
    openQty: 2,
    restockedQty: 0,
    scrappedQty: 0,
    onHoldQty: 0,
    failedInspectionQty: 0,
    ...over,
  };
}

function awaiting(over: Partial<AwaitingReturnLine> = {}): AwaitingReturnLine {
  return {
    receiptLineId: 'rrl-1',
    receiptCode: 'RRN-0003',
    receivedAt: '2026-10-20T04:30:00.000Z',
    rmaId: 'rma-1',
    rmaCode: 'RMA-0007',
    orderReference: 'SHOP-#1',
    clientId: 'client-a',
    warehouseId: 'w-1',
    skuId: 'sku-a',
    skuCode: 'PLAIN-A',
    skuName: 'Plain A',
    uom: 'each',
    condition: 'resaleable',
    note: null,
    batchCode: null,
    serialNumber: null,
    weightGrams: null,
    receivedQty: 5,
    openQty: 5,
    onHoldQty: 0,
    priorQuarantines: 0,
    lastReasonCode: null,
    ...over,
  };
}

const DRAFT: DispositionDraft = { outcome: '', qty: '5', toBinId: '', reasonCode: '', note: '' };

describe('story 4-7a — the RMA-line badge (A7), from the receipts', () => {
  test('nothing received → none; any receipt line open or on hold → awaiting; all decided → dispositioned', () => {
    expect(lineDispositionState('rl-1', [])).toBe('none');
    expect(lineDispositionState('rl-1', [{ lines: [receiptLine({ rmaLineId: 'rl-2' })] }])).toBe('none');
    expect(lineDispositionState('rl-1', [{ lines: [receiptLine()] }])).toBe('awaiting');
    // Open 0 but a hold still unsettled: still awaiting.
    expect(lineDispositionState('rl-1', [{ lines: [receiptLine({ openQty: 0, onHoldQty: 2 })] }])).toBe('awaiting');
    // One receipt decided, a second still open: awaiting (grouped by RMA line across receipts).
    expect(
      lineDispositionState('rl-1', [
        { lines: [receiptLine({ openQty: 0, restockedQty: 2 })] },
        { lines: [receiptLine({ id: 'rrl-2', qty: 1, openQty: 1 })] },
      ]),
    ).toBe('awaiting');
    expect(
      lineDispositionState('rl-1', [
        { lines: [receiptLine({ openQty: 0, restockedQty: 1, scrappedQty: 1 })] },
        { lines: [receiptLine({ id: 'rrl-2', qty: 1, openQty: 0, failedInspectionQty: 1 })] },
      ]),
    ).toBe('dispositioned');
    expect(lineAwaitsDisposition('rl-1', [{ lines: [receiptLine()] }])).toBe(true);
    expect(lineAwaitsDisposition('rl-1', [{ lines: [receiptLine({ openQty: 0, restockedQty: 2 })] }])).toBe(false);
  });

  test('a figure an older payload lacks reads as undecided — never a false "Dispositioned"', () => {
    const old = { ...receiptLine(), openQty: undefined, onHoldQty: undefined } as unknown as ReturnType<typeof receiptLine>;
    expect(lineDispositionState('rl-1', [{ lines: [old] }])).toBe('awaiting');
  });

  test('the split sums across receipts and reads only its non-zero parts', () => {
    const split = lineDispositionSplit('rl-1', [
      { lines: [receiptLine({ qty: 4, openQty: 1, restockedQty: 2, onHoldQty: 1 })] },
      { lines: [receiptLine({ id: 'rrl-2', qty: 2, openQty: 0, scrappedQty: 1, failedInspectionQty: 1 })] },
    ])!;
    expect(split).toMatchObject({ received: 6, open: 1, restocked: 2, onHold: 1, scrapped: 1, failedInspection: 1, undecided: true });
    expect(lineDispositionText(split, { uom: 'each', uomPrecision: 0 })).toBe('2 restocked · 1 on hold · 1 failed inspection · 1 scrapped · 1 awaiting');
    expect(lineDispositionText({ ...split, restocked: 0, onHold: 0, scrapped: 0, failedInspection: 0 }, null)).toBeNull();
    expect(lineDispositionText({ ...split, restocked: 0.5, onHold: 0, scrapped: 0, failedInspection: 0, open: 0 }, { uom: 'kg', uomPrecision: 3 })).toBe(
      '0.500 restocked',
    );
  });
});

describe('story 4-7b — the badge of an unannounced return\'s line', () => {
  test('pending reads "Awaiting review" (never "Dispositioned"), rejected reads "Reversed", accepted behaves as 4-7a', () => {
    // Pending: open 0, nothing decided — 4-7a alone would say "Dispositioned".
    const pending = receiptLine({ openQty: 0, pendingReviewQty: 2, reversedQty: 0 });
    expect(lineDispositionState('rl-1', [{ lines: [pending] }])).toBe('pending-review');
    expect(lineAwaitsDisposition('rl-1', [{ lines: [pending] }])).toBe(false);
    const rejected = receiptLine({ openQty: 0, pendingReviewQty: 0, reversedQty: 2 });
    expect(lineDispositionState('rl-1', [{ lines: [rejected] }])).toBe('reversed');
    const accepted = receiptLine({ openQty: 2, pendingReviewQty: 0, reversedQty: 0 });
    expect(lineDispositionState('rl-1', [{ lines: [accepted] }])).toBe('awaiting');
    const acceptedDone = receiptLine({ openQty: 0, restockedQty: 2, pendingReviewQty: 0, reversedQty: 0 });
    expect(lineDispositionState('rl-1', [{ lines: [acceptedDone] }])).toBe('dispositioned');
    expect(lineDispositionSplit('rl-1', [{ lines: [pending] }])).toMatchObject({ pendingReview: 2, reversed: 0 });
    // An authorized line carries neither figure: unchanged.
    expect(lineDispositionSplit('rl-1', [{ lines: [receiptLine()] }])).toMatchObject({ pendingReview: 0, reversed: 0 });
    expect(AWAITING_REVIEW_BADGE).toContain('Awaiting review');
    expect(REVERSED_BADGE).toContain('Reversed');
  });
});

describe('story 4-7b — the blind-return vocabulary and review', () => {
  const blind = (over: Record<string, unknown> = {}) =>
    ({
      code: 'RMA-0042',
      origin: 'blind',
      reviewStatus: 'pending',
      reviewReasonCode: null,
      reviewNote: null,
      parcelReference: 'AWB123',
      ...over,
    }) as never;

  test('the label maps are Records over the generated unions', () => {
    expect(RETURN_ORIGIN_LABEL).toEqual({ authorized: 'Authorized', blind: 'Unannounced' });
    expect(REVIEW_STATUS_LABEL).toEqual({ pending: 'Awaiting review', accepted: 'Accepted', rejected: 'Reversed' });
    expect(MATCH_KIND_LABEL).toEqual({ awb: 'matched by AWB', 'order-reference': 'matched by order reference' });
    expect(Object.keys(REJECT_REASON_LABEL)).toEqual(['mis-scanned', 'not-our-goods', 'duplicate', 'other']);
    expect(REJECT_REASON_OPTIONS.map((o) => o.value)).toEqual(['mis-scanned', 'not-our-goods', 'duplicate', 'other']);
    expect(NOT_OUR_GOODS_HINT).toBe('Hand these back to the carrier or receive them for the right client');
    expect(CLIENT_PROMPTED_WARNING).toBe("Client chosen by the operator — the barcode is also another client's");
  });

  test('the list badge and the detail sentence follow the review; an authorized return has neither', () => {
    expect(isBlindReturn({ origin: undefined })).toBe(false);
    expect(reviewBadge({ origin: 'authorized', reviewStatus: null })).toBeNull();
    expect(reviewBadge({ origin: 'blind', reviewStatus: 'pending' })).toEqual({ word: 'Awaiting review', tone: 'warning' });
    expect(reviewBadge({ origin: 'blind', reviewStatus: 'rejected' })).toEqual({ word: 'Reversed', tone: 'neutral' });
    expect(reviewBadge({ origin: 'blind', reviewStatus: 'accepted' })).toEqual({ word: 'Accepted', tone: 'success' });
    expect(reviewSummaryText({ origin: 'authorized', reviewStatus: null, reviewReasonCode: null, reviewNote: null, parcelReference: null })).toBeNull();
    expect(reviewSummaryText(blind())).toContain('Awaiting review on the Unannounced tab');
    expect(reviewSummaryText(blind({ reviewStatus: 'rejected', reviewReasonCode: 'other', reviewNote: 'wrong dock' }))).toContain('(Other — wrong dock)');
    expect(parcelReferenceText({ parcelReference: null })).toBe('none scanned');
    expect(sameParcelText({ sameParcelRmas: [] })).toBeNull();
    expect(sameParcelText({ sameParcelRmas: [{ id: 'x', code: 'RMA-0040', reviewStatus: 'rejected' }] })).toBe('Also received as RMA-0040 (Reversed)');
    expect(openRmaForSuggestion({ openRmasForSuggestedOrder: [{ id: 'r', code: 'RMA-0012', status: 'open' }] })).toMatchObject({ code: 'RMA-0012' });
    expect(openRmaForSuggestion({})).toBeNull();
  });

  test('the reject draft: a reason, a note for "other", at most 200; a blank note is absent', () => {
    expect(parseRejectDraft({ reasonCode: '', note: '' }).problem).toBe('Pick why this parcel is rejected.');
    expect(parseRejectDraft({ reasonCode: 'other', note: '   ' }).problem).toBe('The reason “Other” needs a note saying why.');
    expect(parseRejectDraft({ reasonCode: 'other', note: 'x'.repeat(201) }).problem).toBe('Keep the note to 200 characters.');
    expect(parseRejectDraft({ reasonCode: 'mis-scanned', note: '  ' }).body).toEqual({ reasonCode: 'mis-scanned' });
    expect(parseRejectDraft({ reasonCode: 'other', note: ' wrong dock ' }).body).toEqual({ reasonCode: 'other', note: 'wrong dock' });
  });

  test('the link preview mirrors A11: first fitting order line, capacity decremented, serials subset, kit parents skipped', () => {
    const order = {
      lines: [
        rl({ orderLineId: 'kit', skuId: 'x', kitParent: true, returnableQty: 9 }),
        rl({ orderLineId: 'o1', skuId: 'x', returnableQty: 2 }),
        rl({ orderLineId: 'o2', skuId: 'x', returnableQty: 2 }),
        rl({ orderLineId: 'o3', skuId: 's', serialTracked: true, returnableQty: 1, returnableSerials: [serial('SN-1')] }),
      ],
    };
    const line = (id: string, skuId: string, qty: number, serials: string[] = []) => ({ id, skuId, receivedQty: qty, serials: serials.map(serial) });
    // X 2 + X 1 over order lines X 2 + X 2: both link.
    expect(previewBlindLinks([line('a', 'x', 2), line('b', 'x', 1)], order).map((p) => p.links)).toEqual([true, true]);
    // X 3 fits no single line.
    expect(previewBlindLinks([line('a', 'x', 3)], order).map((p) => p.links)).toEqual([false]);
    // A serial not returnable on the line stays unlinked; a returnable one links; reused in the same parcel it does not.
    expect(previewBlindLinks([line('a', 's', 1, ['SN-9'])], order)[0]!.links).toBe(false);
    expect(previewBlindLinks([line('a', 's', 1, ['SN-1']), line('b', 's', 1, ['SN-1'])], order).map((p) => p.links)).toEqual([true, false]);
    // Fractions compare in milli.
    expect(previewBlindLinks([line('a', 'x', 1.5), line('b', 'x', 0.5)], { lines: [rl({ orderLineId: 'o', skuId: 'x', returnableQty: 2 })] }).map((p) => p.links)).toEqual([
      true,
      true,
    ]);
  });

  test('the accept banner is built from the response: the order, or none, and the unlinked lines by SKU', () => {
    const lines = [
      { id: 'l1', skuId: 'sku-a', receivedQty: 2 },
      { id: 'l2', skuId: 'sku-b', receivedQty: 1 },
    ] as never;
    const codes: Record<string, string> = { 'sku-a': 'SKU-A', 'sku-b': 'SKU-B' };
    expect(blindAcceptedOutcome({ code: 'RMA-0042', orderId: 'o-1', orderReference: 'SHOP-1', lines, unlinkedLines: [] }).word).toBe(
      'RMA-0042 accepted — linked to order SHOP-1',
    );
    const partial = blindAcceptedOutcome({ code: 'RMA-0042', orderId: 'o-1', orderReference: 'SHOP-1', lines, unlinkedLines: ['l2'] }, (id) => codes[id] ?? null);
    expect(partial.reason).toContain('Not linked (no order line could take it): SKU-B × 1');
    const none = blindAcceptedOutcome({ code: 'RMA-0042', orderId: null, orderReference: null, lines, unlinkedLines: ['l1', 'l2'] });
    expect(none.word).toBe('RMA-0042 accepted with no order');
    expect(blindRejectedOutcome({ code: 'RMA-0042', reviewReasonCode: 'not-our-goods' }).reason).toContain(NOT_OUR_GOODS_HINT);
  });

  test('the review refusals branch on the code; the moved-on ones reload', () => {
    const p = (code: string, status = 409, ext: Record<string, unknown> = {}) =>
      new ApiProblem(code, status, 'd', 't', ext);
    expect(blindReviewReason(p('review-not-pending', 409, { reviewStatus: 'accepted' }))).toBe("This parcel's review is already accepted — the queue has refreshed.");
    expect(blindReviewReason(p('reject-above-threshold', 409, { threshold: 10, totalQty: 12 }))).toContain('removes 12 units, above your write-off threshold of 10');
    expect(blindReviewReason(p('order-client-mismatch'))).toContain("another client's");
    expect(blindReviewReason(p('document-warehouse-mismatch'))).toContain("another warehouse's");
    expect(blindReviewReason(p('order-not-dispatched', 409, { orderStatus: 'accepted' }))).toContain('not dispatched');
    expect(blindReviewReason(p('disposition-scope-quarantined'))).toContain('reconcile quarantine');
    expect(blindReviewReason(p('rma-not-blind', 409, { origin: 'authorized' }))).toContain('authorized');
    expect(blindReviewReason(new Error('offline'))).toBe(UNREACHABLE_REASON);
    expect(blindReviewRefusalReloads(p('review-not-pending'))).toBe(true);
    expect(blindReviewRefusalReloads(p('rma-not-blind'))).toBe(true);
    expect(blindReviewRefusalReloads(p('not-found', 404))).toBe(true);
    expect(blindReviewRefusalReloads(p('reject-above-threshold'))).toBe(false);
    // 4-7a dispose on a line not accepted.
    expect(dispositionRefusalReloads(p('review-pending'))).toBe(true);
    expect(dispositionReason(p('review-rejected'))).toContain('rejected at review');
  });
});

describe('story 4-7a — the disposition vocabulary', () => {
  test('outcomes and reasons are Records over the generated unions (allowlists)', () => {
    expect(DISPOSITION_OUTCOME_LABEL).toEqual({ restock: 'Restock', quarantine: 'Quarantine', scrap: 'Scrap' });
    expect(Object.keys(DISPOSITION_REASON_LABEL)).toEqual([
      'damaged',
      'defective',
      'expired',
      'missing-parts',
      'contaminated',
      'needs-inspection',
      'client-instruction',
      'other',
    ]);
    expect(DISPOSITION_REASON_OPTIONS.at(-1)).toEqual({ value: 'other', label: 'Other (say why)' });
  });

  test('a serial unit or a returned case is whole and cannot be quarantined, with the reason in words', () => {
    expect(disposedWhole(awaiting())).toBe(false);
    expect(disposedWhole(awaiting({ serialNumber: 'SN-1' }))).toBe(true);
    expect(disposedWhole(awaiting({ weightGrams: 2340 }))).toBe(true);
    expect(quarantineUnavailable(awaiting())).toBeNull();
    expect(quarantineUnavailable(awaiting({ serialNumber: 'SN-1' }))).toContain("A serial unit can't be quarantined");
    expect(quarantineUnavailable(awaiting({ weightGrams: 2340 }))).toContain("A returned case can't be quarantined");
  });

  test('captures, age and history (A14)', () => {
    expect(awaitingCaptureText(awaiting())).toBe('—');
    expect(awaitingCaptureText(awaiting({ batchCode: 'B1', serialNumber: 'SN-1', weightGrams: 2340 }))).toBe('batch B1 · serial SN-1 · 2.340 kg');
    const at = Date.parse('2026-10-20T04:30:00.000Z');
    expect(returnAgeLabel('2026-10-20T04:30:00.000Z', at + 10_000)).toBe('Just now');
    expect(returnAgeLabel('2026-10-20T04:30:00.000Z', at + 40 * 60_000)).toBe('40 min');
    expect(returnAgeLabel('2026-10-20T04:30:00.000Z', at + 5 * 3_600_000)).toBe('5 h');
    expect(returnAgeLabel('2026-10-20T04:30:00.000Z', at + 86_400_000)).toBe('1 day');
    expect(returnAgeLabel('2026-10-20T04:30:00.000Z', at + 12 * 86_400_000)).toBe('12 days');
    expect(returnAgeLabel('garbage', at)).toBe('—');
    expect(returnAgeNeedsAttention('2026-10-20T04:30:00.000Z', at + 6 * 86_400_000)).toBe(false);
    expect(returnAgeNeedsAttention('2026-10-20T04:30:00.000Z', at + 7 * 86_400_000)).toBe(true);
    expect(dispositionHistoryText(awaiting())).toBeNull();
    expect(dispositionHistoryText(awaiting({ priorQuarantines: 2, lastReasonCode: 'damaged' }))).toBe('Quarantined 2× · last: Damaged');
    expect(dispositionHistoryText(awaiting({ priorQuarantines: 1 }))).toBe('Quarantined 1×');
    expect(dispositionHistoryText(awaiting({ lastReasonCode: 'other' }))).toBe('Last: Other');
    expect(dispositionHistoryText(awaiting({ lastReasonCode: 'from-the-future' }))).toBe('Last: from-the-future');
  });
});

describe('story 4-7a — restock targets', () => {
  function bin(id: string, over: Partial<BinResponse> = {}): BinResponse {
    return {
      id,
      tenantId: 't',
      warehouseId: 'w-1',
      zoneId: 'z',
      code: id.toUpperCase(),
      capacity: 100,
      lengthMm: null,
      widthMm: null,
      heightMm: null,
      maxWeightGrams: null,
      storageClass: 'ambient',
      dedicatedClientId: null,
      type: 'shelf',
      blocked: false,
      retiredAt: null,
      retiredBy: null,
      systemOwned: false,
      createdAt: '',
      ...over,
    } as BinResponse;
  }
  const bins = [
    bin('b-2'),
    bin('b-1'),
    bin('returns', { systemOwned: true }),
    bin('retired', { retiredAt: '2026-01-01T00:00:00.000Z' }),
    bin('blocked', { blocked: true }),
    bin('cage', { storageClass: 'secure' }),
    bin('mine', { dedicatedClientId: 'client-a' }),
    bin('theirs', { dedicatedClientId: 'client-b' }),
    bin('cold', { storageClass: 'chilled' }),
  ];

  test('storage bins only: no system, retired, blocked or other-client bin; secure only with secure.move; sorted', () => {
    const operator = restockTargetBins(bins, null, 'client-a', 'operator').map((b) => b.id);
    expect(operator).toEqual(['b-1', 'b-2', 'cold', 'mine']);
    const manager = restockTargetBins(bins, null, 'client-a', 'ops_manager').map((b) => b.id);
    expect(manager).toContain('cage');
    expect(manager).not.toContain('theirs');
  });

  test('with the SKU known, its storage class decides (a chilled SKU never into an ambient bin)', () => {
    const ids = restockTargetBins(bins, { storageClass: 'chilled', clientId: 'client-a' }, 'client-a', 'operator').map((b) => b.id);
    expect(ids).toContain('cold');
    expect(ids).not.toContain('b-1');
  });
});

describe('story 4-7a — parseDisposition', () => {
  test('an outcome is required; the open quantity is pre-filled at the SKU precision', () => {
    expect(parseDisposition(DRAFT, awaiting(), 'w-1', 0).problem).toContain('Choose what happens');
    expect(emptyDispositionDraft(awaiting({ openQty: 1.5 }), 3).qty).toBe('1.500');
    expect(emptyDispositionDraft(awaiting({ openQty: 2 }), null).qty).toBe('2');
  });

  test('a restock names its bin and never a reason or note', () => {
    expect(parseDisposition({ ...DRAFT, outcome: 'restock' }, awaiting(), 'w-1', 0).problem).toBe('Pick the storage bin the units go to.');
    const parsed = parseDisposition({ ...DRAFT, outcome: 'restock', qty: ' 3 ', toBinId: 'b-1', reasonCode: 'damaged', note: 'x' }, awaiting(), 'w-1', 0);
    expect(parsed.body).toEqual({ warehouseId: 'w-1', receiptLineId: 'rrl-1', outcome: 'restock', qty: 3, toBinId: 'b-1' });
  });

  test('quarantine and scrap need a reason, a note for Other, ≤ 200 characters; a blank note is absent', () => {
    expect(parseDisposition({ ...DRAFT, outcome: 'scrap' }, awaiting(), 'w-1', 0).problem).toBe('Pick why these units are scrapped.');
    expect(parseDisposition({ ...DRAFT, outcome: 'quarantine' }, awaiting(), 'w-1', 0).problem).toBe('Pick why these units are quarantined.');
    expect(parseDisposition({ ...DRAFT, outcome: 'scrap', reasonCode: 'other', note: '  ' }, awaiting(), 'w-1', 0).problem).toContain('needs a note');
    expect(parseDisposition({ ...DRAFT, outcome: 'scrap', reasonCode: 'damaged', note: 'x'.repeat(201) }, awaiting(), 'w-1', 0).problem).toContain(
      '200 characters',
    );
    expect(parseDisposition({ ...DRAFT, outcome: 'quarantine', reasonCode: 'needs-inspection', toBinId: 'b-1', note: '  ' }, awaiting(), 'w-1', 0).body).toEqual({
      warehouseId: 'w-1',
      receiptLineId: 'rrl-1',
      outcome: 'quarantine',
      qty: 5,
      reasonCode: 'needs-inspection',
    });
    expect(parseDisposition({ ...DRAFT, outcome: 'scrap', reasonCode: 'other', note: ' seal cut ' }, awaiting(), 'w-1', 0).body).toMatchObject({
      reasonCode: 'other',
      note: 'seal cut',
    });
  });

  test('the quantity: positive, at the SKU precision (never rounded), at most what is open', () => {
    const scrap = { ...DRAFT, outcome: 'scrap' as const, reasonCode: 'damaged' as const };
    expect(parseDisposition({ ...scrap, qty: '0' }, awaiting(), 'w-1', 0).problem).toBe('Enter a quantity greater than zero.');
    expect(parseDisposition({ ...scrap, qty: 'abc' }, awaiting(), 'w-1', 0).problem).toBe('Enter a quantity greater than zero.');
    expect(parseDisposition({ ...scrap, qty: '1.5' }, awaiting(), 'w-1', 0).problem).toBe('PLAIN-A is counted in each — whole numbers only (got 1.5).');
    // Unknown precision: the server judges it.
    expect(parseDisposition({ ...scrap, qty: '1.5' }, awaiting(), 'w-1', null).body?.qty).toBe(1.5);
    expect(parseDisposition({ ...scrap, qty: '6' }, awaiting(), 'w-1', 0).problem).toBe('Only 5 each still await a decision on this line.');
  });

  test('a serial unit is disposed whole (qty 1, the typed figure ignored) and never quarantined', () => {
    const serial = awaiting({ serialNumber: 'SN-1', receivedQty: 1, openQty: 1 });
    expect(parseDisposition({ ...DRAFT, outcome: 'restock', qty: '7', toBinId: 'b-1' }, serial, 'w-1', 0).body?.qty).toBe(1);
    expect(parseDisposition({ ...DRAFT, outcome: 'quarantine', reasonCode: 'damaged' }, serial, 'w-1', 0).problem).toContain('serial unit');
    expect(parseDisposition({ ...DRAFT, outcome: 'scrap', reasonCode: 'damaged' }, serial, 'w-1', 0).body?.qty).toBe(1);
  });
});

describe('story 4-7a — the words around a decision', () => {
  test('the action label and the scrap confirmation', () => {
    expect(dispositionActionLabel('', null)).toBe('Record decision');
    expect(dispositionActionLabel('restock', '3 each')).toBe('Restock 3 each');
    expect(dispositionActionLabel('scrap', '2 each')).toBe('Scrap 2 each…');
    expect(scrapConfirmText(awaiting(), '2 each', 'Damaged')).toBe(
      "Scrap 2 each of PLAIN-A from RMA-0007 (Damaged)? The units are written off and leave stock — this can't be undone.",
    );
  });

  test('the outcome is built from the RESPONSE, summing every disposition', () => {
    const entry = { id: 'd', receiptLineId: 'rrl-1', rmaId: 'rma-1', qty: 2, toBinId: 'b-1', qcHoldId: null, ledgerEventId: 'e' };
    expect(dispositionOutcome({ dispositions: [{ ...entry, outcome: 'restock' }, { ...entry, outcome: 'restock', qty: 1 }] }, awaiting(), 'A-01', 0)).toEqual({
      word: 'Restocked 3 each of PLAIN-A',
      reason: 'Moved from the Returns bin to A-01 (RMA-0007).',
    });
    expect(dispositionOutcome({ dispositions: [{ ...entry, outcome: 'quarantine' }] }, awaiting(), null, 0).word).toBe('Quarantined 2 each of PLAIN-A');
    expect(dispositionOutcome({ dispositions: [{ ...entry, outcome: 'scrap', qty: 0.5 }] }, { ...awaiting(), uom: 'kg' }, null, 3).word).toBe(
      'Scrapped 0.500 kg of PLAIN-A',
    );
  });

  test('refusals by code: the bound with its figure, the write-off threshold, the gates; the transport arm', () => {
    const problem = (code: string, extensions: Record<string, unknown> = {}, detail?: string) => new ApiProblem(code, 409, detail, 'x', extensions);
    expect(dispositionReason(problem('exceeds-awaiting', { awaitingQty: 2 }), 'each')).toBe(
      'Only 2 each still await a decision on this line — the queue has refreshed.',
    );
    expect(dispositionReason(problem('scrap-above-threshold', { awaitingQty: 30, threshold: 10 }), 'each')).toBe(
      'Above your write-off threshold of 10 each — scrap at most 10 each at a time or raise the threshold in the adjustment policy.',
    );
    expect(dispositionReason(problem('disposition-not-supported'))).toContain("can't be quarantined");
    expect(dispositionReason(problem('batch-expired'))).toContain('expired');
    expect(dispositionReason(problem('batch-blocked'))).toContain('blocked');
    expect(dispositionReason(problem('disposition-scope-quarantined'))).toContain('reconcile quarantine');
    expect(dispositionReason(problem('document-warehouse-mismatch'))).toContain('another warehouse');
    expect(dispositionReason(problem('bin-client-mismatch'))).toContain('another client');
    expect(dispositionReason(problem('bin-full', {}, 'A-01 is full (100 of 100)'))).toBe('A-01 is full (100 of 100)');
    expect(dispositionReason(problem('bin-full'))).toBe('That bin has no room for this — pick another.');
    for (const code of ['bin-retired', 'bin-blocked', 'bin-storage-mismatch', 'bin-segregation-conflict', 'bin-occupancy-conflict', 'bin-overweight', 'bin-volume-exceeded', 'bin-item-oversize']) {
      expect(dispositionReason(problem(code))).not.toContain(code);
    }
    expect(dispositionReason(new ApiProblem('validation-failed', 400, 'toBinId is a system bin', 'x'))).toBe('toBinId is a system bin');
    expect(dispositionReason(new ApiProblem('role-denied', 403, undefined, 'x'))).toContain("can't decide returns");
    expect(dispositionReason(new ApiProblem('brand-new', 409, undefined, 'x'))).toBe('Not recorded (brand-new).');
    expect(dispositionReason(new Error('offline'))).toBe(UNREACHABLE_REASON);
  });

  test('the line-moved refusals reload the queue; a gate refusal does not', () => {
    for (const code of ['exceeds-awaiting', 'not-found', 'document-warehouse-mismatch', 'disposition-not-supported']) {
      expect(dispositionRefusalReloads(new ApiProblem(code, 409, undefined, 'x'))).toBe(true);
    }
    expect(dispositionRefusalReloads(new ApiProblem('bin-full', 409, undefined, 'x'))).toBe(false);
    expect(dispositionRefusalReloads(new Error('offline'))).toBe(false);
  });
});
