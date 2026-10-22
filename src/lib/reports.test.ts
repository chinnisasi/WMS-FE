import { describe, expect, test } from 'bun:test';

import { ApiProblem } from './api/client';
import { UNREACHABLE_REASON } from './outbound-orders';
import {
  ALL_REPORT_CLIENTS,
  REPORT_FORMAT_LABEL,
  REPORT_ORDER,
  REPORTS,
  reportFilename,
  reportReason,
  reportSlug,
  resolveReportClient,
  resolveReportWarehouse,
} from './reports';

/**
 * Story 5-3a — the operational registers' words, defaults, file name and
 * refusal copy.
 */

const A = '0198f7a2-1b3c-7d4e-8f90-cccccccccc0a';
const B = '0198f7a2-1b3c-7d4e-8f90-cccccccccc0b';

describe('the registers', () => {
  test('five registers in menu order; the three dated ones take a period, the two snapshots do not', () => {
    expect(REPORT_ORDER).toEqual(['stock-on-hand', 'inbound-register', 'outbound-register', 'ledger', 'batch-ageing']);
    expect(Object.keys(REPORTS).sort()).toEqual([...REPORT_ORDER].sort());
    expect(REPORT_ORDER.map((name) => [REPORTS[name].label, REPORTS[name].dated])).toEqual([
      ['Stock on hand', false],
      ['Inbound register', true],
      ['Outbound register', true],
      ['Stock ledger', true],
      ['Batch ageing / near expiry', false],
    ]);
    expect(REPORT_FORMAT_LABEL).toEqual({ csv: 'CSV', xlsx: 'Excel (.xlsx)' });
  });
});

describe('decision 9 — the defaults', () => {
  test('client: a local pick (All included), else the switcher client, else All', () => {
    expect(resolveReportClient(null, null, [A, B])).toBeNull();
    expect(resolveReportClient(null, B, [A, B])).toBe(B);
    expect(resolveReportClient(A, B, [A, B])).toBe(A);
    // A local All beats the switcher.
    expect(resolveReportClient(ALL_REPORT_CLIENTS, B, [A, B])).toBeNull();
    // A pick (or a switcher client) no longer listed falls through.
    expect(resolveReportClient('gone', B, [A, B])).toBe(B);
    expect(resolveReportClient(null, 'gone', [A, B])).toBeNull();
  });

  test('warehouse: a local pick while listed, else the first (or only) one, else none', () => {
    expect(resolveReportWarehouse(null, ['w1', 'w2'])).toBe('w1');
    expect(resolveReportWarehouse('w2', ['w1', 'w2'])).toBe('w2');
    expect(resolveReportWarehouse('gone', ['w1', 'w2'])).toBe('w1');
    expect(resolveReportWarehouse(null, [])).toBeNull();
  });
});

describe('the file name', () => {
  test('dated: <report>-<WH>[-<client>]-<from>_<to>.<ext>, codes slugged', () => {
    expect(
      reportFilename({ report: 'ledger', format: 'csv', warehouseCode: 'BLR-1', clientCode: 'ACME', period: { from: '2026-09-01', to: '2026-09-30' }, now: 0 }),
    ).toBe('ledger-BLR-1-ACME-2026-09-01_2026-09-30.csv');
    expect(
      reportFilename({ report: 'inbound-register', format: 'xlsx', warehouseCode: 'Main WH/2', clientCode: null, period: { from: '2026-09-01', to: '2026-09-01' }, now: 0 }),
    ).toBe('inbound-register-Main-WH-2-2026-09-01_2026-09-01.xlsx');
    expect(reportSlug('  ')).toBe('x');
    expect(reportSlug('A&B Ltd.')).toBe('A-B-Ltd');
  });

  test('snapshot: …-asof-<IST date of now> — at 18:30Z it is already the next IST day', () => {
    const name = (now: number) =>
      reportFilename({ report: 'stock-on-hand', format: 'xlsx', warehouseCode: 'W1', clientCode: 'self', period: null, now });
    expect(name(Date.parse('2026-10-21T18:29:59.999Z'))).toBe('stock-on-hand-W1-self-asof-2026-10-21.xlsx');
    expect(name(Date.parse('2026-10-21T18:30:00.000Z'))).toBe('stock-on-hand-W1-self-asof-2026-10-22.xlsx');
  });
});

describe('reportReason', () => {
  const problem = (code: string, status: number, detail?: string) => new ApiProblem(code, status, detail);

  test('too large: the cap from the problem, the advice per register (a snapshot has no period to shorten)', () => {
    const tooLarge = (maxRows?: number) => new ApiProblem('report-too-large', 422, 'x', 'Register too large', maxRows === undefined ? {} : { maxRows });
    expect(reportReason(tooLarge(1000), 'ledger')).toBe('This register has more than 1,000 rows — pick a client or a shorter period.');
    expect(reportReason(tooLarge(1000), 'stock-on-hand')).toBe('This register has more than 1,000 rows — pick a client.');
    expect(reportReason(tooLarge(), 'batch-ageing')).toBe('This register has more than 50,000 rows — pick a client.');
  });

  test('each register refusal by code, the server detail for validation, the transport arm', () => {
    expect(reportReason(problem('report-unavailable', 503, 'x'), 'ledger')).toBe(
      'The register could not be prepared just now (too slow, or the server is busy) — try again, or narrow the filters.',
    );
    expect(reportReason(problem('validation-failed', 400, 'from (2026-09-05) is after to (2026-09-01).'), 'ledger')).toBe('from (2026-09-05) is after to (2026-09-01).');
    expect(reportReason(problem('unknown-warehouse', 404, 'x'), 'ledger')).toBe('That warehouse is no longer available — pick another.');
    expect(reportReason(problem('role-denied', 403, 'This is an operator surface.'), 'ledger')).toBe('Your session cannot download registers — sign in again.');
    expect(reportReason(problem('mystery', 500), 'ledger')).toBe('Could not prepare the register (mystery).');
    expect(reportReason(new TypeError('Failed to fetch'), 'ledger')).toBe(UNREACHABLE_REASON);
  });
});
