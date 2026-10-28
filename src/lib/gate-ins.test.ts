import { afterEach, describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import type { GateInDetailDto } from '@/lib/api/generated';
import { UNREACHABLE_REASON } from './outbound-orders';
import {
  EMPTY_DRAFT_DOCUMENT,
  actionInstant,
  GATE_IN_STATUS_LABEL,
  VEHICLE_RULE,
  alreadyRecordedSentence,
  amendGateInBody,
  confirmQuestion,
  createGateInBody,
  draftOfGateIn,
  emptyGateInDraft,
  gateInActions,
  gateInClientName,
  gateInReason,
  grnGateInLabel,
  isTransporterRefusal,
  isoToIstLocal,
  istLocalNow,
  istLocalToIso,
  istToday,
  linkOptionLabel,
  packagesLabel,
  packagesWords,
  parseActionDraft,
  parseGateInDraft,
  savedLinkOption,
  unloadOutcome,
  vehicleLabel,
  type GateInDraft,
} from './gate-ins';

const NOW = Date.parse('2026-10-21T10:00:00+05:30');
const PARTNER = '0198f7a2-1b3c-7d4e-8f90-0000000000p1';
const PO = '0198f7a2-1b3c-7d4e-8f90-0000000000f1';

function draft(patch: Partial<GateInDraft> = {}): GateInDraft {
  return {
    ...emptyGateInDraft(NOW),
    vehicleNo: 'ka-01.ab 1234',
    transporterPartnerId: PARTNER,
    sealNumber: 'S-991, C-12',
    documents: [],
    ...patch,
  };
}

describe('IST helpers — a datetime-local value is IST, whatever the browser zone', () => {
  // `bun test` runs in UTC unless TZ says otherwise; restore by assignment
  // (the service-report precedent) so no later file inherits the zone.
  const originalTz = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  test('between 00:00 and 05:30 IST in a browser west of India, the prefill is the IST day and time (never the local one)', () => {
    process.env.TZ = 'America/Los_Angeles';
    const at = Date.parse('2026-10-21T02:15:00+05:30'); // 2026-10-20 13:45 in Los Angeles
    // Meaningful: the viewer's local date really is the day before.
    expect(new Date(at).getDate()).toBe(20);
    expect(istLocalNow(at)).toBe('2026-10-21T02:15');
    expect(istToday(at)).toBe('2026-10-21');
    expect(isoToIstLocal('2026-10-20T20:45:00.000Z')).toBe('2026-10-21T02:15');
    // And back: the typed IST wall clock is the same instant.
    expect(istLocalToIso('2026-10-21T02:15')).toBe('2026-10-20T20:45:00.000Z');
    expect(istLocalToIso(isoToIstLocal('2026-10-20T20:45:00.000Z')!)).toBe('2026-10-20T20:45:00.000Z');
  });

  test('a browser east of India too (Tokyo, 00:30 IST)', () => {
    process.env.TZ = 'Asia/Tokyo';
    expect(istLocalNow(Date.parse('2026-10-21T00:30:00+05:30'))).toBe('2026-10-21T00:30');
  });

  test('a malformed instant has no IST wall clock; a malformed local time no instant', () => {
    expect(isoToIstLocal('nope')).toBeNull();
    expect(istLocalToIso('2026-02-30T10:00')).toBeNull();
    expect(istLocalToIso('')).toBeNull();
  });
});

describe('words', () => {
  test('packages in words: short, excess, matches — and no flag when undeclared', () => {
    expect(packagesWords({ packagesFlag: 'short', packagesDifference: 2 })).toBe('2 short');
    expect(packagesWords({ packagesFlag: 'excess', packagesDifference: 3 })).toBe('3 excess');
    expect(packagesWords({ packagesFlag: 'matches', packagesDifference: 0 })).toBe('Matches');
    expect(packagesWords({ packagesFlag: null, packagesDifference: null })).toBeNull();
    expect(packagesLabel({ packagesFlag: 'short', packagesDifference: 2, packagesDeclared: 12, packagesCounted: 10 })).toBe('10 of 12 · 2 short');
    // Undeclared (decision 11): the count, no flag.
    expect(packagesLabel({ packagesFlag: null, packagesDifference: null, packagesDeclared: null, packagesCounted: 10 })).toBe('10 counted');
    expect(packagesLabel({ packagesFlag: null, packagesDifference: null, packagesDeclared: 12, packagesCounted: null })).toBe('12 declared');
    expect(packagesLabel({ packagesFlag: null, packagesDifference: null, packagesDeclared: null, packagesCounted: null })).toBe('—');
  });

  test('the vehicle reads "Hand delivery" when there is none; the GRN cell reads GI-x · vehicle', () => {
    expect(vehicleLabel({ vehicleNo: 'KA01AB1234', handDelivery: false })).toBe('KA01AB1234');
    expect(vehicleLabel({ vehicleNo: null, handDelivery: true })).toBe('Hand delivery');
    expect(grnGateInLabel({ gateInCode: 'GI-0001', vehicleNo: 'KA01AB1234' })).toBe('GI-0001 · KA01AB1234');
    expect(grnGateInLabel({ gateInCode: 'GI-0002' })).toBe('GI-0002');
    expect(grnGateInLabel({})).toBe('—');
  });

  test('every status has its label', () => {
    expect(GATE_IN_STATUS_LABEL).toEqual({ gated_in: 'Gated in', unloading: 'Unloading', unloaded: 'Unloaded', gated_out: 'Gated out' });
  });
});

describe('actions follow the state', () => {
  test('Start only on gated_in; End on gated_in or unloading; Edit and Gate out on anything not gated_out', () => {
    expect(gateInActions('gated_in')).toEqual({ start: true, end: true, edit: true, gateOut: true });
    expect(gateInActions('unloading')).toEqual({ start: false, end: true, edit: true, gateOut: true });
    expect(gateInActions('unloaded')).toEqual({ start: false, end: false, edit: true, gateOut: true });
    expect(gateInActions('gated_out')).toEqual({ start: false, end: false, edit: false, gateOut: false });
  });

  test('Gate out confirms "Closes GI-x; no further edits."', () => {
    expect(confirmQuestion('gate-out', 'GI-0001')).toBe('Closes GI-0001; no further edits.');
  });

  test('the confirmation time and count parse; a bad count names the bound', () => {
    expect(parseActionDraft('start', { time: '2026-10-21T09:40', count: '' })).toEqual({
      occurredAt: '2026-10-21T04:10:00.000Z',
      packagesCounted: null,
      problem: null,
    });
    expect(parseActionDraft('end', { time: '2026-10-21T09:40', count: '10' })).toEqual({
      occurredAt: '2026-10-21T04:10:00.000Z',
      packagesCounted: 10,
      problem: null,
    });
    expect(parseActionDraft('end', { time: '2026-10-21T09:40', count: '1e3' }).problem).toContain('whole number');
    expect(parseActionDraft('end', { time: '2026-10-21T09:40', count: '1000001' }).problem).toContain('10,00,000');
    expect(parseActionDraft('gate-out', { time: '', count: '' }).problem).toBe('Enter the date and time (IST).');
  });

  test('a default (unedited) action time sends the untrimmed instant of the first press, reused on a retry; an edited one as typed', () => {
    const pressed = { current: null as string | null };
    const at = Date.parse('2026-10-21T04:10:42.123Z');
    expect(actionInstant(false, '2026-10-21T04:10:00.000Z', pressed, at)).toBe('2026-10-21T04:10:42.123Z');
    expect(actionInstant(false, '2026-10-21T04:10:00.000Z', pressed, at + 5000)).toBe('2026-10-21T04:10:42.123Z');
    expect(actionInstant(true, '2026-10-21T04:10:00.000Z', { current: null }, at)).toBe('2026-10-21T04:10:00.000Z');
  });
});

describe('the unload answer — applied: false is never a success', () => {
  const gateIn = { code: 'GI-0001', unloadStartedAt: '2026-10-21T04:10:00.000Z', unloadEndedAt: '2026-10-21T05:00:00.000Z', packagesCounted: 10, packagesDeclared: 12 };

  test('applied: false says "Already recorded at {time} IST"', () => {
    const start = unloadOutcome('start', { applied: false, gateIn });
    expect(start.tone).toBe('warning');
    expect(start.word).toBe('Already recorded at 21 Oct 2026, 09:40 IST');
    const end = unloadOutcome('end', { applied: false, gateIn });
    expect(end.word).toBe('Already recorded at 21 Oct 2026, 10:30 IST');
    expect(end.reason).toContain('your count was not recorded');
    expect(alreadyRecordedSentence(null)).toBe('Already recorded');
  });

  test('applied: true — the end names the count and the flag, from the response', () => {
    expect(unloadOutcome('end', { applied: true, gateIn })).toEqual({
      tone: 'accepted',
      word: 'Unload ended on GI-0001',
      reason: 'Ended at 21 Oct 2026, 10:30 IST; 10 packages counted — 2 short.',
    });
    expect(unloadOutcome('start', { applied: true, gateIn }).word).toBe('Unload started on GI-0001');
  });
});

describe('the draft parser — one problem naming the field or the row', () => {
  test('the matrix gate-in: plate normalised, EWB spaces stripped, every field present (blank → null)', () => {
    const parsed = parseGateInDraft(
      draft({
        containerNo: 'msku-123 4567',
        packagesDeclared: '12',
        dockDoor: ' D3 ',
        documents: [
          { kind: 'invoice', number: 'INV-77', documentDate: '2026-10-20', ewayBillNo: '1234 5678 9012', link: `po:${PO}` },
          { kind: 'bill_of_entry', number: 'BE-1', documentDate: '2026-10-19', ewayBillNo: '', link: '' },
        ],
      }),
      NOW,
    );
    expect(parsed.problem).toBeNull();
    expect(parsed.header).toEqual({
      handDelivery: false,
      vehicleNo: 'KA01AB1234',
      containerNo: 'MSKU1234567',
      transporterPartnerId: PARTNER,
      transporterName: null,
      lrNumber: null,
      driverName: null,
      driverPhone: null,
      sealStatus: 'intact',
      sealNumber: 'S-991, C-12',
      packagesDeclared: 12,
      dockDoor: 'D3',
      gatedInAt: '2026-10-21T04:30:00.000Z',
      documents: [
        { kind: 'invoice', number: 'INV-77', documentDate: '2026-10-20', ewayBillNo: '123456789012', poId: PO, asnId: null },
        { kind: 'bill_of_entry', number: 'BE-1', documentDate: '2026-10-19', ewayBillNo: null, poId: null, asnId: null },
      ],
      appointmentId: null,
    });
    expect(createGateInBody(parsed.header!, 'wh-1', true)).toMatchObject({ warehouseId: 'wh-1', gatedInAt: '2026-10-21T04:30:00.000Z' });
    // The prefilled time is the form's OPEN time: untouched, it is not sent (the server stamps its now at save).
    const untouched = createGateInBody(parsed.header!, 'wh-1', false);
    expect('gatedInAt' in untouched).toBe(false);
    expect(emptyGateInDraft(NOW).gatedInAtEdited).toBe(false);
    // Story 2-3b — an unscheduled create sends no appointmentId at all (the pre-2-3b body).
    expect('appointmentId' in untouched).toBe(false);
  });

  test('story 2-3b — a linked create carries appointmentId; blank is unscheduled', () => {
    const APPT = '0198f7a2-1b3c-7d4e-8f90-0000000000d1';
    const linked = parseGateInDraft(draft({ appointmentId: APPT }), NOW);
    expect(linked.header?.appointmentId).toBe(APPT);
    expect(createGateInBody(linked.header!, 'wh-1', false).appointmentId).toBe(APPT);
    expect(parseGateInDraft(draft({ appointmentId: '' }), NOW).header?.appointmentId).toBeNull();
    expect(emptyGateInDraft(NOW).appointmentPicked).toBe(false);
  });

  test('BH-series and temporary plates are accepted; a bad plate quotes the rule', () => {
    expect(parseGateInDraft(draft({ vehicleNo: '22 BH 1234 AA' }), NOW).header?.vehicleNo).toBe('22BH1234AA');
    expect(parseGateInDraft(draft({ vehicleNo: 'T0822KA1234Z' }), NOW).header?.vehicleNo).toBe('T0822KA1234Z');
    expect(parseGateInDraft(draft({ vehicleNo: 'KA1' }), NOW).problem).toBe(`The vehicle number is ${VEHICLE_RULE}.`);
    expect(VEHICLE_RULE).toBe('4–15 letters and digits; spaces, dots and hyphens are ignored');
  });

  test('hand delivery makes the vehicle optional; otherwise it is required', () => {
    expect(parseGateInDraft(draft({ vehicleNo: '' }), NOW).problem).toContain('Hand delivery');
    const hand = parseGateInDraft(draft({ vehicleNo: '', handDelivery: true }), NOW);
    expect(hand.problem).toBeNull();
    expect(hand.header?.vehicleNo).toBeNull();
    expect(hand.header?.handDelivery).toBe(true);
  });

  test('the transporter: a picked partner or a typed name, exactly one sent', () => {
    expect(parseGateInDraft(draft({ transporterPartnerId: '' }), NOW).problem).toContain('Not listed');
    const typed = parseGateInDraft(draft({ transporterMode: 'typed', transporterName: ' VRL Logistics ' }), NOW);
    expect(typed.header?.transporterName).toBe('VRL Logistics');
    expect(typed.header?.transporterPartnerId).toBeNull();
    expect(parseGateInDraft(draft({ transporterMode: 'typed', transporterName: '' }), NOW).problem).toBe('Type the transporter name.');
  });

  test('bad fields are each named: phone, seal, packages', () => {
    expect(parseGateInDraft(draft({ driverPhone: 'abc' }), NOW).problem).toContain("driver's phone");
    expect(parseGateInDraft(draft({ driverPhone: '+91 (98450) 12-345' }), NOW).header?.driverPhone).toBe('+919845012345');
    expect(parseGateInDraft(draft({ sealStatus: 'intact', sealNumber: '' }), NOW).problem).toContain('Enter the seal number');
    // No seal: the number is never sent (the input is hidden).
    expect(parseGateInDraft(draft({ sealStatus: 'none', sealNumber: 'stale' }), NOW).header?.sealNumber).toBeNull();
    expect(parseGateInDraft(draft({ packagesDeclared: '1.5' }), NOW).problem).toContain('Packages declared');
    expect(parseGateInDraft(draft({ packagesDeclared: '' }), NOW).header?.packagesDeclared).toBeNull();
  });

  test('document rows: an 11-digit EWB, a duplicate number, a date after today in IST, a missing number — each names its row', () => {
    const row = (patch: Partial<typeof EMPTY_DRAFT_DOCUMENT>) => ({ ...EMPTY_DRAFT_DOCUMENT, number: 'INV-1', documentDate: '2026-10-20', ...patch });
    expect(parseGateInDraft(draft({ documents: [row({ ewayBillNo: '12345678901' })] }), NOW).problem).toBe(
      'Document 1: the e-way bill number is 12 digits (spaces are ignored).',
    );
    expect(parseGateInDraft(draft({ documents: [row({}), row({ number: 'inv-1' })] }), NOW).problem).toBe(
      'Document 2 repeats document 1 — each invoice number appears once on a gate-in.',
    );
    // The same number on another kind is a different paper.
    expect(parseGateInDraft(draft({ documents: [row({}), row({ kind: 'challan' })] }), NOW).problem).toBeNull();
    expect(parseGateInDraft(draft({ documents: [row({ documentDate: '2026-10-22' })] }), NOW).problem).toBe(
      'Document 1: the document is dated 2026-10-22, after today (2026-10-21, IST).',
    );
    expect(parseGateInDraft(draft({ documents: [row({ documentDate: '2026-02-30' })] }), NOW).problem).toContain('not a real date');
    expect(parseGateInDraft(draft({ documents: [row({ number: '' , ewayBillNo: '123456789012' })] }), NOW).problem).toBe('Document 1: enter the document number.');
    // A fully blank row is dropped.
    expect(parseGateInDraft(draft({ documents: [EMPTY_DRAFT_DOCUMENT] }), NOW).header?.documents).toEqual([]);
  });

  test('a document dated today in IST is fine even at 01:00 IST (the browser zone never moves "today")', () => {
    const at = Date.parse('2026-10-21T01:00:00+05:30');
    const parsed = parseGateInDraft(
      draft({ gatedInAt: '2026-10-21T01:00', documents: [{ ...EMPTY_DRAFT_DOCUMENT, number: 'INV-1', documentDate: '2026-10-21' }] }),
      at,
    );
    expect(parsed.problem).toBeNull();
  });
});

describe('Edit — a full replacement; the time only while gated_in or when changed', () => {
  const detail = {
    status: 'unloading',
    gatedInAt: '2026-10-21T04:30:12.345Z',
    handDelivery: false,
    vehicleNo: 'KA01AB1234',
    containerNo: null,
    transporterPartnerId: null,
    transporterName: 'VRL',
    lrNumber: 'LR-9',
    driverName: null,
    driverPhone: '9845012345',
    sealStatus: 'none',
    sealNumber: null,
    packagesDeclared: null,
    dockDoor: null,
    documents: [
      { id: 'd2', position: 1, kind: 'challan', number: 'CH-2', documentDate: '2026-10-19', ewayBillNo: null, poId: null, asnId: 'asn-1', poCode: null, asnCode: 'ASN-7' },
      { id: 'd1', position: 0, kind: 'invoice', number: 'INV-1', documentDate: '2026-10-20', ewayBillNo: '123456789012', poId: PO, asnId: null, poCode: 'PO-1001', asnCode: null },
    ],
  } as unknown as GateInDetailDto;

  test('the draft of a gate-in keeps every field, the documents in position order, and the saved links', () => {
    const d = draftOfGateIn(detail);
    expect(d.transporterMode).toBe('typed');
    expect(d.gatedInAt).toBe('2026-10-21T10:00');
    expect(d.documents.map((doc) => doc.link)).toEqual([`po:${PO}`, 'asn:asn-1']);
    expect(savedLinkOption(detail.documents[1]!)).toEqual({ value: `po:${PO}`, label: 'PO-1001 (not open)' });
  });

  test('every field is sent (a cleared LR is null); an unchanged time while unloading is not sent', () => {
    const d = { ...draftOfGateIn(detail), lrNumber: '' };
    const parsed = parseGateInDraft(d, NOW);
    const body = amendGateInBody(parsed.header!, detail, d.gatedInAt);
    expect(body.lrNumber).toBeNull();
    expect('gatedInAt' in body).toBe(false);
    expect('warehouseId' in body).toBe(false);
    // Story 2-3b — the amend ALWAYS states the link: null clears (no appointment stored here).
    expect('appointmentId' in body).toBe(true);
    expect(body.appointmentId).toBeNull();
  });

  test('story 2-3b — the edit draft keeps the stored link (never re-guessed) and sends it; a cleared pick sends null', () => {
    const APPT = '0198f7a2-1b3c-7d4e-8f90-0000000000d1';
    const linked = { ...detail, appointment: { id: APPT, code: 'DA-0001' }, dockDoor: 'D3' } as unknown as GateInDetailDto;
    const d = draftOfGateIn(linked);
    expect(d.appointmentId).toBe(APPT);
    expect(d.appointmentPicked).toBe(true);
    expect(d.dockDoorEdited).toBe(true);
    expect(amendGateInBody(parseGateInDraft(d, NOW).header!, linked, d.gatedInAt).appointmentId).toBe(APPT);
    expect(amendGateInBody(parseGateInDraft({ ...d, appointmentId: '' }, NOW).header!, linked, d.gatedInAt).appointmentId).toBeNull();
    // A stored blank door may be prefilled by an appointment pick.
    expect(draftOfGateIn(detail).dockDoorEdited).toBe(false);
  });

  test('while gated_in the stored instant rides unchanged (never the minute-truncated input); a changed time is sent', () => {
    const gatedIn = { ...detail, status: 'gated_in' } as GateInDetailDto;
    const d = draftOfGateIn(gatedIn);
    const header = parseGateInDraft(d, NOW).header!;
    expect(amendGateInBody(header, gatedIn, d.gatedInAt).gatedInAt).toBe('2026-10-21T04:30:12.345Z');
    expect(amendGateInBody(header, gatedIn, '2026-10-21T09:00').gatedInAt).toBe(header.gatedInAt);
  });
});

describe('link options', () => {
  test('"PO-1001 · vendor · client" — the parts that exist', () => {
    expect(linkOptionLabel('PO-1001', 'Acme Foods', 'GlowCo')).toBe('PO-1001 · Acme Foods · GlowCo');
    expect(linkOptionLabel('ASN-7', null, 'GlowCo')).toBe('ASN-7 · GlowCo');
  });
});

describe('gateInReason — every code', () => {
  const problem = (code: string, status = 409, detail?: string) => new ApiProblem(code, status, detail);

  test('the gate-in arms', () => {
    expect(gateInReason(problem('validation-failed', 400, 'Document 2 (invoice X): …'))).toBe('Document 2 (invoice X): …');
    expect(gateInReason(problem('time-in-future', 400))).toContain('5 minutes ahead');
    expect(gateInReason(problem('time-out-of-order', 400))).toContain('before the gate-in');
    expect(gateInReason(problem('not-found', 404, 'No purchase order with id "x" exists in this tenant.'))).toContain('No purchase order');
    expect(gateInReason(problem('partner-not-transporter'))).toBe('That partner is not a transporter — pick another, or type the name.');
    expect(gateInReason(problem('transporter-inactive'))).toBe('That transporter is inactive — pick another, or type the name.');
    expect(gateInReason(problem('document-warehouse-mismatch'))).toContain('another warehouse');
    expect(gateInReason(problem('gate-in-closed'))).toContain('gated out');
    expect(gateInReason(problem('gate-in-time-locked'))).toContain('locked once the unload starts');
    expect(gateInReason(problem('gate-in-field-locked'))).toBe('The seal and the packages declared are locked once the unload ends — leave them as recorded.');
  });

  test('the house arms and the transport arm', () => {
    expect(gateInReason(problem('role-denied', 403))).toBe('Your role cannot record gate-ins.');
    expect(gateInReason(problem('permission-denied', 403))).toContain('another tenant');
    expect(gateInReason(problem('unauthenticated', 401))).toContain('sign in again');
    expect(gateInReason(problem('idempotency-key-reuse', 422))).toContain('different details');
    expect(gateInReason(problem('conflict', 409))).toContain('retry');
    expect(gateInReason(problem('mystery', 500))).toBe('The gate-in was not saved (mystery).');
    expect(gateInClientName({ name: 'GlowCo', systemOwned: false }, 'Priya')).toBe('GlowCo');
    expect(gateInClientName({ name: 'x', systemOwned: true }, 'Priya Logistics')).toBe('Priya Logistics');
    expect(gateInClientName(undefined, null)).toBeNull();
    expect(gateInReason(new TypeError('Failed to fetch'))).toBe(UNREACHABLE_REASON);
  });

  test('the transporter refusals re-read the picker', () => {
    expect(isTransporterRefusal(problem('partner-not-transporter'))).toBe(true);
    expect(isTransporterRefusal(problem('transporter-inactive'))).toBe(true);
    expect(isTransporterRefusal(problem('not-found', 404))).toBe(false);
  });
});
