import { describe, expect, test } from 'bun:test';

import {
  ledgerArmLabel,
  ledgerBinsLabel,
  ledgerQuantityLabel,
  ledgerRecordedLabel,
  ledgerReferenceLabel,
} from './ledger';

/** Story 9-1b — the Ledger page's cell copy. */

const KG = { uom: 'kg', uomPrecision: 3 };
const EACH = { uom: 'each', uomPrecision: 0 };

describe('ledger cells', () => {
  test('the recorded instant on the IST clock, seconds shown', () => {
    expect(ledgerRecordedLabel('2026-10-06T10:00:05.123Z')).toBe('06 Oct 2026, 15:30:05');
    expect(ledgerRecordedLabel('2026-10-05T18:30:00.000Z')).toBe('06 Oct 2026, 00:00:00');
  });

  test('the signed quantity at the SKU precision, with a true minus', () => {
    expect(ledgerQuantityLabel(2.5, KG)).toBe('+2.500 kg');
    expect(ledgerQuantityLabel(-3, EACH)).toBe('−3 each');
    expect(ledgerQuantityLabel(-4, null)).toBe('−4 units');
  });

  test('bins by code, an unknown bin by short id, no bin as a dash', () => {
    const codes = { 'bin-aaaa-1111': 'RCV-01' };
    expect(ledgerBinsLabel({ fromBinId: 'bin-aaaa-1111', toBinId: 'bin-bbbb-2222' }, codes)).toBe('RCV-01 → bin-bbbb');
    expect(ledgerBinsLabel({ fromBinId: null, toBinId: 'bin-aaaa-1111' }, codes)).toBe('— → RCV-01');
    expect(ledgerBinsLabel({ fromBinId: null, toBinId: null }, null)).toBe('— → —');
  });

  test('the batch/serial arm as a short raw id', () => {
    expect(ledgerArmLabel({ batchRef: '0198f7a2-batch', serialRef: null })).toBe('batch 0198f7a2');
    expect(ledgerArmLabel({ batchRef: null, serialRef: '0198f7a3-serial' })).toBe('serial 0198f7a3');
    expect(ledgerArmLabel({ batchRef: null, serialRef: null })).toBe('—');
  });

  test('the reference: kind, then the typed fields that are present', () => {
    expect(ledgerReferenceLabel(null)).toBe('—');
    expect(ledgerReferenceLabel({ kind: 'grn-receipt', grnId: '0198aaaa-grn', poId: '0198bbbb-po' })).toBe(
      'grn-receipt · GRN 0198aaaa · PO 0198bbbb',
    );
    expect(ledgerReferenceLabel({ kind: 'manual-adjustment', reasonCode: 'stock-count', note: 'recount' })).toBe(
      'manual-adjustment · reason stock-count · “recount”',
    );
    expect(ledgerReferenceLabel({ kind: 'pick' })).toBe('pick');
  });
});
