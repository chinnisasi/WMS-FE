import { describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import type { AsnImportResponseDto } from '@/lib/api/generated';
import {
  ASN_IMPORT_COLUMNS,
  ASN_IMPORT_REASON_LABEL,
  ASN_IMPORT_CLIENT_HELP,
  acceptedLineCount,
  asnImportErrorReport,
  asnImportOutcome,
  asnImportReason,
  asnImportReasonLabel,
  asnImportReportName,
  asnImportTemplate,
  fileReadProblem,
} from '@/lib/asn-import';
import { AUDIT_TARGET_LABEL, auditTargetLabel } from '@/lib/audit';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import { asnReason, withoutKits } from '@/lib/asns';

function result(over: Partial<AsnImportResponseDto> = {}): AsnImportResponseDto {
  return {
    importId: null,
    dryRun: true,
    warehouseId: 'wh-1',
    fileSha256: 'c0ffee'.repeat(10) + 'abcd',
    rowCount: 10,
    asnCount: 3,
    acceptedCount: 3,
    refusedCount: 0,
    asns: [
      { asnId: null, asnCode: 'A', clientId: 'c', clientLabel: 'GLOWCO', lineCount: 5, firstRow: 2 },
      { asnId: null, asnCode: 'B', clientId: 'c', clientLabel: 'GLOWCO', lineCount: 4, firstRow: 7 },
      { asnId: null, asnCode: 'C', clientId: 'd', clientLabel: 'ACME', lineCount: 1, firstRow: 11 },
    ],
    errors: [],
    ...over,
  };
}

describe('the template', () => {
  test('its header is the file contract, with two example lines of one ASN', () => {
    const lines = asnImportTemplate('BLR-DC').trimEnd().split('\n');
    expect(lines[0]).toBe('asn_code,client,warehouse,expected_at,sku,quantity');
    expect(ASN_IMPORT_COLUMNS.join(',')).toBe(lines[0]!);
    expect(lines.slice(1)).toEqual(['ASN-1001,,BLR-DC,2026-10-20,SKU-CODE-1,24', 'ASN-1001,,BLR-DC,2026-10-20,SKU-CODE-2,6']);
    expect(asnImportTemplate(null).split('\n')[1]).toBe('ASN-1001,,,2026-10-20,SKU-CODE-1,24');
  });
});

describe('the outcome sentences', () => {
  test('Check file: "3 ASNs, 10 lines ready", nothing written', () => {
    expect(acceptedLineCount(result())).toBe(10);
    expect(asnImportOutcome(result())).toEqual({
      tone: 'accepted',
      word: '3 ASNs, 10 lines ready',
      reason: 'Nothing has been written yet — Import creates them.',
    });
  });

  test('Check file with a refused ASN names it beside what is ready', () => {
    const outcome = asnImportOutcome(
      result({
        acceptedCount: 2,
        refusedCount: 1,
        asns: result().asns.slice(0, 2),
        errors: [
          { rowNumber: 7, asnCode: 'GLOW-ASN-9', code: 'unknown-sku', detail: 'No SKU with code "X" exists in this tenant.', sku: 'X', quantity: '1' },
          { rowNumber: 7, asnCode: 'GLOW-ASN-9', code: 'asn-rows-disagree', detail: 'warehouse differs', sku: 'X', quantity: '1' },
          { rowNumber: 8, asnCode: 'GLOW-ASN-9', code: 'invalid-quantity', detail: 'x', sku: 'Y', quantity: 'x' },
        ],
      }),
    );
    expect(outcome.word).toBe('2 ASNs, 9 lines ready');
    // Rows, not errors: row 7 carries two problems.
    expect(outcome.reason).toBe(
      '1 ASN refused — 2 rows with problems, listed below. An ASN with any bad row is refused whole; Import creates the others. Nothing has been written yet.',
    );
  });

  test('a refused row with no asn_code (no ASN refused) is still named — never a bare green success', () => {
    const outcome = asnImportOutcome(
      result({
        dryRun: false,
        importId: 'i',
        errors: [{ rowNumber: 12, asnCode: null, code: 'missing-value', detail: 'asn_code is blank', sku: 'S', quantity: '1' }],
      }),
    );
    expect(outcome.word).toBe('3 ASNs announced');
    expect(outcome.reason).toBe('1 row with problems, listed below. Fix those rows and upload them again — an ASN already created is refused as a used code.');
  });

  test('Import: "N ASNs announced"; none at all is a rejection', () => {
    expect(asnImportOutcome(result({ dryRun: false, importId: 'i' })).word).toBe('3 ASNs announced');
    const none = asnImportOutcome(result({ dryRun: false, importId: 'i', acceptedCount: 0, refusedCount: 1, asns: [] }));
    expect(none.tone).toBe('rejected');
    expect(none.word).toBe('No ASNs imported');
    expect(asnImportOutcome(result({ acceptedCount: 0, asns: [] })).word).toBe('Nothing to import');
  });
});

describe('the error report', () => {
  test('every refused row: row number, ASN code, its sku and quantity, code, reason in words, detail — BOM-led, formula cells guarded', () => {
    const report = asnImportErrorReport(
      result({
        errors: [
          { rowNumber: 7, asnCode: 'GLOW-ASN-9', code: 'unknown-sku', detail: 'No SKU with code "X" exists in this tenant.', sku: 'X', quantity: '5' },
          { rowNumber: 12, asnCode: null, code: 'missing-value', detail: 'asn_code is blank — every row names the ASN it belongs to.', sku: 'GLOW-1', quantity: null },
          { rowNumber: 13, asnCode: '=HYPERLINK("x")', code: 'invalid-asn-code', detail: 'too long', sku: null, quantity: '=1+1' },
        ],
      }),
    );
    expect(report.startsWith('\uFEFF')).toBe(true);
    expect(report.slice(1).trimEnd().split('\n')).toEqual([
      'row_number,asn_code,sku,quantity,code,reason,detail',
      '7,"GLOW-ASN-9","X","5","unknown-sku","Unknown SKU","No SKU with code ""X"" exists in this tenant."',
      '12,"","GLOW-1","","missing-value","Missing value","asn_code is blank — every row names the ASN it belongs to."',
      `13,"'=HYPERLINK(""x"")","","'=1+1","invalid-asn-code","ASN code too long","too long"`,
    ]);
  });

  test('its name carries the import id, else the file digest', () => {
    expect(asnImportReportName(result({ importId: 'i-1' }))).toBe('asn-import-i-1-errors.csv');
    expect(asnImportReportName(result())).toBe('asn-import-c0ffeec0ffee-errors.csv');
  });

  test('every generated reason code has words; an unknown one prints as itself', () => {
    for (const label of Object.values(ASN_IMPORT_REASON_LABEL)) expect(label.length).toBeGreaterThan(0);
    expect(asnImportReasonLabel('kit-cannot-hold-stock')).toBe('Kit SKU');
    // Story 1-1: a blank-client ASN whose codes several clients hold.
    expect(asnImportReasonLabel('client-required')).toBe('Name the client — several clients hold these codes');
    expect(ASN_IMPORT_CLIENT_HELP).toContain('a SKU code is unique per client');
    expect(ASN_IMPORT_CLIENT_HELP).toContain("blank = the client the ASN's other rows name");
    expect(asnImportReasonLabel('constructor')).toBe('constructor');
  });
});

describe('asnImportReason', () => {
  test('the file-level refusals in words; detail where the server names the problem; the transport arm', () => {
    expect(asnImportReason(new ApiProblem('import-too-large', 422, 'The file announces 501 ASNs — the cap is 500 per import.'))).toBe(
      'The file announces 501 ASNs — the cap is 500 per import.',
    );
    expect(asnImportReason(new ApiProblem('missing-columns', 400, 'The header row is missing the required column "quantity".'))).toBe(
      'The header row is missing the required column "quantity".',
    );
    expect(asnImportReason(new ApiProblem('unsupported-file-type', 415, 'Only .csv and .xlsx files can be imported (got "a.pdf").'))).toBe(
      'Only .csv and .xlsx files can be imported — save the sheet as CSV or Excel (PDF is not read).',
    );
    expect(asnImportReason(new ApiProblem('role-denied', 403, 'x'))).toBe('Your role cannot import advance shipment notices.');
    expect(asnImportReason(new ApiProblem('idempotency-key-reuse', 422, 'x'))).toBe(
      'This import was already run with a different file — pick the file again and check it before importing.',
    );
    expect(asnImportReason(new TypeError('Failed to fetch'))).toBe(UNREACHABLE_REASON);
  });
});

describe('the audit label', () => {
  test('an asn_import target reads "ASN import"', () => {
    expect(AUDIT_TARGET_LABEL.asn_import).toBe('ASN import');
    expect(auditTargetLabel({ targetType: 'asn_import', targetId: '0198f7a2-aaaa-7d4e-8f90-000000000001' })).toBe('ASN import 00000001');
  });
});

describe('kits on the operator ASN form', () => {
  test('the pickers drop kits, keeping a SKU already on the document; the 409 has words', () => {
    const options = [{ id: 'sku-1' }, { id: 'kit-1' }, { id: 'kit-2' }];
    const kits = new Set(['kit-1', 'kit-2']);
    expect(withoutKits(options, kits).map((o) => o.id)).toEqual(['sku-1']);
    expect(withoutKits(options, kits, new Set(['kit-2'])).map((o) => o.id)).toEqual(['sku-1', 'kit-2']);
    expect(withoutKits(options, new Set()).map((o) => o.id)).toEqual(['sku-1', 'kit-1', 'kit-2']);
    expect(asnReason(new ApiProblem('kit-cannot-hold-stock', 409, 'Advance shipment notice line names kit SKU(s) "KIT-1".'))).toBe(
      'Advance shipment notice line names kit SKU(s) "KIT-1".',
    );
    expect(asnReason(new ApiProblem('kit-cannot-hold-stock', 409))).toBe(
      'A kit SKU cannot be announced — a kit holds no stock of its own; announce its component SKUs instead.',
    );
  });
});

describe('file read problems', () => {
  test('a file the browser cannot read is named, not reported as an unreachable API', () => {
    expect(fileReadProblem('asns.csv')).toBe('asns.csv could not be read — it may have been moved or changed since you picked it. Pick it again.');
  });
});
