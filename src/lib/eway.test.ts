import { describe, expect, test } from 'bun:test';

import { ApiProblem } from './api/client';
import type { EwayBillDto } from './api/generated';
import {
  BLOCKER_LABEL,
  TERMINAL_BLOCKER_HINT,
  blockerHint,
  canSelect,
  configureReason,
  dismissReason,
  downloadLabel,
  draftFromTransport,
  ewayJsonFilename,
  ewayListReason,
  exportReason,
  generateEwayReason,
  istLocalToIso,
  overrideStateCodes,
  parseDismissReason,
  parseRecordDraft,
  parseThresholdDraft,
  parseTransportDraft,
  readExportRefusals,
  recordReason,
  selectionGstin,
  skippedLabel,
  splitSelection,
  thresholdAmountLabel,
  thresholdRuleLabel,
  transportReason,
  transportSummary,
  type TransportDraft,
} from './eway';
import { GST_STATE_NAMES } from './invoices';
import { UNREACHABLE_REASON } from './outbound-orders';

/** Story 8-2b — the e-way section's pure decisions. */

const EMPTY_TRANSPORT = {
  transMode: null,
  vehicleNo: null,
  vehicleType: null,
  transporterId: null,
  transporterName: null,
  transDocNo: null,
  transDocDate: null,
  distanceKm: null,
} as unknown as EwayBillDto['transport'];

function bill(overrides: Partial<EwayBillDto> = {}): EwayBillDto {
  return {
    id: 'b-1',
    invoiceId: 'i-1',
    invoiceNo: '29/2627/000001',
    invoiceIssuedAt: '2026-10-04T05:00:00.000Z',
    originGstin: '29AAAPZ1234C1ZV',
    consigneeGstin: null,
    b2b: false,
    status: 'pending',
    consignmentValuePaise: 7_080_000,
    thresholdPaise: 5_000_000,
    thresholdRule: 'national',
    transport: EMPTY_TRANSPORT,
    ewbNo: null,
    ewbGeneratedAt: null,
    ewbValidUntil: null,
    source: null as unknown as EwayBillDto['source'],
    dismissedReason: null,
    lastError: null,
    gatewayClaimedAt: null,
    lastExportedAt: null,
    lastExportedBy: null,
    blockers: [],
    gatewayAvailable: false,
    createdAt: '2026-10-04T05:00:00.000Z',
    updatedAt: '2026-10-04T05:00:00.000Z',
    ...overrides,
  };
}

const problem = (code: string, status = 409, detail?: string, extensions: Record<string, unknown> = {}) =>
  new ApiProblem(code, status, detail, 'Refused', extensions);

describe('blocker copy', () => {
  test('every one of the eleven codes has a label (invoice-unavailable added by the 8-2b review)', () => {
    expect(Object.keys(BLOCKER_LABEL).sort()).toEqual(
      [
        'address-incomplete', 'doc-too-old', 'hsn-issue', 'invoice-unavailable', 'needs-irn', 'rate-not-standard',
        'ship-to-differs', 'state-unresolved', 'too-many-lines', 'transport-incomplete', 'unsupported-supply',
      ].sort(),
    );
  });

  test('a terminal blocker sends the user to the portal and back; fixable ones say how to fix', () => {
    expect(blockerHint({ code: 'ship-to-differs', terminal: true })).toBe(TERMINAL_BLOCKER_HINT);
    expect(TERMINAL_BLOCKER_HINT).toContain('NIC portal');
    expect(TERMINAL_BLOCKER_HINT).toContain('record its number here');
    expect(blockerHint({ code: 'transport-incomplete', terminal: false })).toContain('transporter id');
    expect(blockerHint({ code: 'needs-irn', terminal: false })).toContain('IRN');
  });

  test('threshold and transport labels', () => {
    expect(thresholdRuleLabel('national')).toBe('National');
    expect(thresholdRuleLabel('state:27')).toBe('State override (27 — Maharashtra)');
    expect(thresholdAmountLabel(null)).toBe('None required');
    expect(thresholdAmountLabel(5_000_000)).toBe('₹50,000.00');
    expect(transportSummary(EMPTY_TRANSPORT)).toBe('Not entered');
    expect(transportSummary({ ...EMPTY_TRANSPORT, transMode: 1, vehicleNo: 'KA01AB1234', distanceKm: 840 })).toBe('Road · KA01AB1234 · 840 km');
  });
});

describe('selection', () => {
  test('one GSTIN per file: only pending bills of the selected GSTIN are selectable', () => {
    const a = bill();
    const other = bill({ id: 'b-2', originGstin: '27AAAPZ1234C1ZV' });
    expect(selectionGstin([])).toBeNull();
    expect(canSelect(other, null)).toBe(true);
    expect(canSelect(other, selectionGstin([a]))).toBe(false);
    expect(canSelect(bill({ status: 'generated' }), null)).toBe(false);
  });

  test('ready vs blocked, and the button copy', () => {
    const ready = bill();
    const blocked = bill({ id: 'b-3', blockers: [{ code: 'transport-incomplete', terminal: false }] });
    const split = splitSelection([ready, blocked]);
    expect(split.ready.map((b) => b.id)).toEqual(['b-1']);
    expect(split.blocked.map((b) => b.id)).toEqual(['b-3']);
    expect(downloadLabel(1)).toBe('Download NIC JSON (1)');
    expect(skippedLabel(0)).toBeNull();
    expect(skippedLabel(2)).toBe('2 skipped (blocked)');
  });

  test('the download name carries the GSTIN and the IST stamp', () => {
    expect(ewayJsonFilename('29AAAPZ1234C1ZV', Date.parse('2026-10-04T05:00:00.000Z'))).toBe('ewb-bulk-29AAAPZ1234C1ZV-20261004-1030.json');
    expect(ewayJsonFilename('29AAAPZ1234C1ZV', Date.parse('2026-10-03T19:00:00.000Z'))).toBe('ewb-bulk-29AAAPZ1234C1ZV-20261004-0030.json');
  });
});

describe('refusals', () => {
  test('reads the per-bill reasons of eway-not-exportable, and ignores any other problem', () => {
    const err = problem('eway-not-exportable', 409, 'x', { bills: [{ id: 'b-1', reasons: ['mixed-gstin', 'needs-irn'] }, { junk: true }] });
    expect(readExportRefusals(err)).toEqual([{ id: 'b-1', reasons: ['mixed-gstin', 'needs-irn'] }]);
    expect(readExportRefusals(problem('eway-claimed'))).toBeNull();
    expect(readExportRefusals(new Error('x'))).toBeNull();
  });

  test('the export refusal names each bill and its reasons', () => {
    const err = problem('eway-not-exportable', 409, 'x', {
      bills: [
        { id: 'b-1', reasons: ['mixed-gstin'] },
        { id: 'b-2', reasons: ['not-pending', 'transport-incomplete'] },
      ],
    });
    const labelOf = (id: string) => (id === 'b-1' ? '29/2627/000001' : '29/2627/000002');
    expect(exportReason(err, labelOf)).toBe(
      'Nothing was exported — 29/2627/000001: a different GSTIN from the rest; 29/2627/000002: no longer pending, Transport details needed.',
    );
  });

  test('each mapper branches on code; the transport arm renders the house unreachable copy', () => {
    for (const mapper of [ewayListReason, exportReason, transportReason, recordReason, dismissReason, generateEwayReason, configureReason]) {
      expect(mapper(new Error('Failed to fetch'))).toBe(UNREACHABLE_REASON);
      expect(mapper(problem('role-denied', 403))).toContain('Your role cannot');
      expect(mapper(problem('weird', 500, 'server words'))).toBe('server words');
    }
    expect(recordReason(problem('eway-not-pending'))).toContain('no longer pending');
    expect(dismissReason(problem('eway-claimed'))).toContain('in flight');
    expect(recordReason(problem('ewb-no-taken'))).toContain('already recorded');
    expect(transportReason(problem('validation-failed', 400, 'vehicleType is required'))).toBe('vehicleType is required');
    expect(transportReason(problem('idempotency-key-reuse', 422))).toContain('different details');
    expect(generateEwayReason(problem('gateway-unconfigured', 501))).toContain('download the NIC JSON');
    expect(generateEwayReason(problem('eway-gateway-refused', 422, 'Bad vehicle'))).toBe('The gateway refused this bill: Bad vehicle');
    expect(generateEwayReason(problem('eway-gateway-unavailable', 503))).toContain('two minutes');
    expect(generateEwayReason(problem('eway-not-exportable', 409, 'x', { bills: [{ id: 'b-1', reasons: ['needs-irn'] }] }), () => 'INV-1')).toBe(
      'Blocked — INV-1: Needs an IRN (e-invoicing).',
    );
    expect(configureReason(problem('not-found', 404))).toContain("tenant's registrations");
    expect(ewayListReason(problem('invalid-cursor', 400))).toContain('first page');
  });
});

describe('forms', () => {
  const blank: TransportDraft = draftFromTransport(EMPTY_TRANSPORT);

  test('Part B: blank fields are omitted (the PATCH replaces, so absent clears); distance is a whole km', () => {
    expect(parseTransportDraft(blank)).toEqual({ body: {} });
    expect(
      parseTransportDraft({ ...blank, transMode: '1', vehicleNo: ' KA01AB1234 ', vehicleType: 'R', distanceKm: '840', transporterName: '  ' }),
    ).toEqual({ body: { transMode: 1, vehicleNo: 'KA01AB1234', vehicleType: 'R', distanceKm: 840 } });
    expect(parseTransportDraft({ ...blank, distanceKm: '12.5' })).toHaveProperty('problem');
    expect(parseTransportDraft({ ...blank, distanceKm: '4001' })).toHaveProperty('problem');
    expect(draftFromTransport({ ...EMPTY_TRANSPORT, transMode: 2, transDocNo: 'RR1', distanceKm: 0 })).toMatchObject({ transMode: '2', transDocNo: 'RR1', distanceKm: '0' });
  });

  test('Part B: a draft switched from Road to Rail/Air/Ship (or to no mode) drops the hidden vehicle fields', () => {
    const road = { ...blank, transMode: '1' as const, vehicleNo: 'KA01AB1234', vehicleType: 'R' as const };
    expect(parseTransportDraft({ ...road, transMode: '2', transDocNo: 'RR1', transDocDate: '2026-10-05' })).toEqual({
      body: { transMode: 2, transDocNo: 'RR1', transDocDate: '2026-10-05' },
    });
    expect(parseTransportDraft({ ...road, transMode: '', transporterId: '29AABCT1234Q1ZP' })).toEqual({
      body: { transporterId: '29AABCT1234Q1ZP' },
    });
  });

  test('IST wall-clock → UTC instant', () => {
    expect(istLocalToIso('2026-10-04T10:30')).toBe('2026-10-04T05:00:00.000Z');
    expect(istLocalToIso('2026-10-04T00:15')).toBe('2026-10-03T18:45:00.000Z');
    expect(istLocalToIso('2026-02-30T10:00')).toBeNull();
    expect(istLocalToIso('')).toBeNull();
  });

  test('record: 12 digits (spaces tolerated), an IST time, an optional validity', () => {
    expect(parseRecordDraft({ ewbNo: '1412 3456 7890', generatedAt: '2026-10-04T10:30', validUntil: '' })).toEqual({
      body: { ewbNo: '141234567890', generatedAt: '2026-10-04T05:00:00.000Z' },
    });
    expect(parseRecordDraft({ ewbNo: '1412345678', generatedAt: '2026-10-04T10:30', validUntil: '' })).toHaveProperty('problem');
    expect(parseRecordDraft({ ewbNo: '141234567890', generatedAt: '', validUntil: '' })).toHaveProperty('problem');
    expect(parseRecordDraft({ ewbNo: '141234567890', generatedAt: '2026-10-04T10:30', validUntil: '2026-10-09T10:30' })).toEqual({
      body: { ewbNo: '141234567890', generatedAt: '2026-10-04T05:00:00.000Z', validUntil: '2026-10-09T05:00:00.000Z' },
    });
  });

  test('dismiss: 1–200 characters after trimming', () => {
    expect(parseDismissReason('  ')).toHaveProperty('problem');
    expect(parseDismissReason('x'.repeat(201))).toHaveProperty('problem');
    expect(parseDismissReason(' Collected ')).toEqual({ reason: 'Collected' });
  });

  test('threshold override: exact paise, or null for none required; 97/99 are never offered', () => {
    expect(parseThresholdDraft({ stateCode: '27', amount: '100000', noneRequired: false, effectiveFrom: '2026-04-01' })).toEqual({
      body: { stateCode: '27', thresholdPaise: 10_000_000, effectiveFrom: '2026-04-01' },
    });
    expect(parseThresholdDraft({ stateCode: '24', amount: 'junk', noneRequired: true, effectiveFrom: '2026-04-01' })).toEqual({
      body: { stateCode: '24', thresholdPaise: null, effectiveFrom: '2026-04-01' },
    });
    expect(parseThresholdDraft({ stateCode: '27', amount: '1.234', noneRequired: false, effectiveFrom: '2026-04-01' })).toHaveProperty('problem');
    expect(parseThresholdDraft({ stateCode: '', amount: '1', noneRequired: false, effectiveFrom: '2026-04-01' })).toHaveProperty('problem');
    const codes = overrideStateCodes(GST_STATE_NAMES);
    expect(codes).not.toContain('97');
    expect(codes).not.toContain('99');
    expect(codes).toContain('27');
    expect(codes).toHaveLength(36);
  });
});
