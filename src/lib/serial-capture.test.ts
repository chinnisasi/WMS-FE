import { describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import type { GoodsReceiptLineEntryDto } from '@/lib/api/generated';
import { SERIAL_STATE_LABEL, filterSerials, grnLineRecallLabel, grnSerialSummary, qcSkippedLabel, unreadableSerialLabel } from './grn-lines';
import { EXCESS_SERIALS_SHOWN, decisionReason, excessSerialsLabel } from './over-receipt';
import { GRN_REFUSAL_LABEL, GRN_SERIAL_IN_STOCK_GUIDANCE, GRN_SERIAL_FORMAT_GUIDANCE, GRN_SERIALS_REQUIRED_GUIDANCE, rejectedOpGuidance } from './review-queue';
import {
  emptySkuCreateDraft,
  parseSkuCreateDraft,
  serialFormatCreateField,
  serialFormatEditField,
  serialFormatOf,
  trackingLabel,
} from './sku-admin';

/** Story 2-6a — the web's serial-capture words and the SKU format rules. */

type Serial = NonNullable<GoodsReceiptLineEntryDto['serials']>[number];

describe('GRN line serials (A19, A22)', () => {
  const serials: Serial[] = [
    { serial: 'SN-A', state: 'applied' },
    { serial: 'SN-B', state: 'applied', afterWriteOff: true },
    { serial: 'sn-c', state: 'pending' },
    { serial: 'SN-D', state: 'rejected' },
  ];

  test('each state in words', () => {
    expect(SERIAL_STATE_LABEL).toEqual({ applied: 'Booked', pending: 'Awaiting approval', rejected: 'Approval rejected' });
  });

  test('the collapsed summary counts the states in a fixed order, and the re-received units', () => {
    expect(grnSerialSummary(serials)).toBe('4 serials · 2 booked · 1 awaiting approval · 1 approval rejected · 1 re-received after write-off');
    expect(grnSerialSummary([{ serial: 'X', state: 'applied' }])).toBe('1 serial · 1 booked');
    expect(grnSerialSummary([])).toBeNull();
    expect(grnSerialSummary(undefined)).toBeNull();
  });

  test('the search is case-insensitive and trimmed; blank shows every serial', () => {
    expect(filterSerials(serials, '  sn-c ').map((s) => s.serial)).toEqual(['sn-c']);
    expect(filterSerials(serials, 'sn-').map((s) => s.serial)).toEqual(['SN-A', 'SN-B', 'sn-c', 'SN-D']);
    expect(filterSerials(serials, '')).toBe(serials);
    expect(filterSerials(serials, 'zzz')).toEqual([]);
  });

  test('unreadable units and the QC skip in words, absent when not set', () => {
    expect(unreadableSerialLabel({ unreadableSerialQty: 1 })).toBe('1 unit — serial unreadable');
    expect(unreadableSerialLabel({ unreadableSerialQty: 3 })).toBe('3 units — serial unreadable');
    expect(unreadableSerialLabel({})).toBeNull();
    expect(qcSkippedLabel({ qcSkipped: 'serial-tracked' })).toBe('QC on receipt skipped — serial-tracked');
    expect(qcSkippedLabel({})).toBeNull();
    // Story 3-7a — the line's lot is on an open live recall.
    expect(grnLineRecallLabel({ recallCode: 'RCL-000003' })).toBe('Under recall RCL-000003 — keep it apart');
    expect(grnLineRecallLabel({})).toBeNull();
  });
});

describe('over-receipt serials (A5)', () => {
  test('names the first serials, counts the rest, and says what the decision did', () => {
    expect(excessSerialsLabel(['C'], 'pending')).toBe('Serials (1, book on approval): C');
    expect(excessSerialsLabel(['C'], 'approved')).toBe('Serials (1, booked): C');
    expect(excessSerialsLabel(['C'], 'rejected')).toBe('Serials (1, not booked): C');
    const many = Array.from({ length: EXCESS_SERIALS_SHOWN + 2 }, (_, i) => `S${i}`);
    expect(excessSerialsLabel(many, 'pending')).toBe(`Serials (12, book on approval): ${many.slice(0, 10).join(', ')} and 2 more`);
    expect(excessSerialsLabel(undefined, 'pending')).toBeNull();
    expect(excessSerialsLabel([], 'pending')).toBeNull();
  });

  test("an approve refused for a serial (409 serial-in-stock …) shows the server's detail verbatim", () => {
    const detail = 'Serial "SN-1" is already in stock at A-01 (WH1) — one serial is one unit, so this excess cannot be approved. Reject it, then check the units.';
    for (const code of ['serial-in-stock', 'serial-in-transit', 'serial-pending-approval', 'serial-dispatched-use-returns', 'serial-blocked']) {
      expect(decisionReason(new ApiProblem(code, 409, detail))).toBe(detail);
    }
  });
});

describe('serial refusal words (the 8 codes)', () => {
  test('every new code has words', () => {
    expect(GRN_REFUSAL_LABEL['serials-required']).toBe('serial numbers missing');
    expect(GRN_REFUSAL_LABEL['serial-in-stock']).toBe('serial already in stock');
    expect(GRN_REFUSAL_LABEL['serial-dispatched-use-returns']).toBe('serial left on an order — receive as a return');
    expect(GRN_REFUSAL_LABEL['serial-format-invalid']).toBe('not a valid IMEI');
  });

  test("a grn.lines-refused row reads one remedy per serial code it carries, in the server's precedence", () => {
    const row: Parameters<typeof rejectedOpGuidance>[0] = {
      opType: 'grn.lines-refused',
      problemCode: 'serials-required',
      payload: { refusals: [{ reason: 'serial-format-invalid' }, { reason: 'serial-in-stock' }, { reason: 'serials-required' }] },
    };
    expect(rejectedOpGuidance(row)).toEqual([GRN_SERIALS_REQUIRED_GUIDANCE, GRN_SERIAL_IN_STOCK_GUIDANCE, GRN_SERIAL_FORMAT_GUIDANCE]);
  });
});

describe('the SKU serial format (A15)', () => {
  test('create sends only imei on a serial-tracked SKU', () => {
    expect(serialFormatCreateField(true, 'imei')).toEqual({ serialFormat: 'imei' });
    expect(serialFormatCreateField(true, 'free')).toEqual({});
    expect(serialFormatCreateField(false, 'imei')).toEqual({});
    const parsed = parseSkuCreateDraft({ ...emptySkuCreateDraft(), code: 'PH-1', name: 'Phone', serialTracked: true, serialFormat: 'imei' }, false);
    expect(parsed.problem).toBeNull();
    expect(parsed.body).toMatchObject({ serialTracked: true, serialFormat: 'imei' });
    const plain = parseSkuCreateDraft({ ...emptySkuCreateDraft(), code: 'PH-2', name: 'Phone', serialTracked: false, serialFormat: 'imei' }, false);
    expect(plain.body).not.toHaveProperty('serialFormat');
  });

  test('edit sends the format only when it changed on a still-serial SKU; ending serial tracking sends none', () => {
    expect(serialFormatEditField({ serialFormat: 'free' }, true, 'imei')).toEqual({ serialFormat: 'imei' });
    expect(serialFormatEditField({ serialFormat: 'imei' }, true, 'free')).toEqual({ serialFormat: 'free' });
    expect(serialFormatEditField({ serialFormat: 'imei' }, true, 'imei')).toEqual({});
    expect(serialFormatEditField({ serialFormat: 'imei' }, false, 'free')).toEqual({});
    expect(serialFormatOf({})).toBe('free');
  });

  test('the table reads Serial (IMEI) for an imei SKU', () => {
    expect(trackingLabel({ batchTracked: true, serialTracked: true, catchWeightTracked: false, serialFormat: 'imei' })).toBe('Batch + Serial (IMEI)');
    expect(trackingLabel({ batchTracked: false, serialTracked: true, catchWeightTracked: false })).toBe('Serial');
    expect(trackingLabel({ batchTracked: false, serialTracked: false, catchWeightTracked: false, serialFormat: 'free' })).toBe('—');
  });
});
