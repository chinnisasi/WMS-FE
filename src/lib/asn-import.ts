/**
 * The ASN import (2026-10-17) — the pure half of the Inbound ASN card's
 * "Import from file": the template, the refused-row reasons in words, the
 * result's summary sentences, the CSV error report, and the refusal mapper.
 * The server parses the file (CSV or XLSX); this client never reads it.
 *
 * Pure: no React, no fetch — pinned by `asn-import.test.ts`.
 */
import { ApiProblem } from '@/lib/api/client';
import type { AsnImportResponseDto, AsnImportRowErrorDto } from '@/lib/api/generated';
import { csvField } from '@/lib/csv';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';

export type AsnImportRowErrorCode = AsnImportRowErrorDto['code'];

/** The backend's caps, mirrored (`asn-import.parse.ts`, `sheet-reader.ts`). */
export const MAX_ASN_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_ASN_IMPORT_ROWS = 5_000;
export const MAX_ASN_IMPORT_ASNS = 500;

/** The on-screen refused-rows table shows a bounded window; the CSV report carries every row. */
export const MAX_RENDERED_IMPORT_ERRORS = 100;

/** The file's columns, in the template's order (the server reads them in any order, case-insensitively). */
export const ASN_IMPORT_COLUMNS = ['asn_code', 'client', 'warehouse', 'expected_at', 'sku', 'quantity'] as const;

/**
 * The downloadable template: the header, then two example lines of one ASN.
 * `client` blank means "the client the SKUs belong to"; `warehouse` blank
 * means the warehouse the card is showing.
 */
export function asnImportTemplate(warehouseCode: string | null): string {
  const warehouse = warehouseCode ?? '';
  return (
    [
      ASN_IMPORT_COLUMNS.join(','),
      `ASN-1001,,${warehouse},2026-10-20,SKU-CODE-1,24`,
      `ASN-1001,,${warehouse},2026-10-20,SKU-CODE-2,6`,
    ].join('\n') + '\n'
  );
}

/**
 * Story 1-1 — what a blank client cell means. A SKU code is unique per
 * client, so a blank row takes the client its ASN's other rows name, else
 * the client its SKUs belong to; an ASN whose codes several clients hold
 * must name its client (`client-required` otherwise).
 */
export const ASN_IMPORT_CLIENT_HELP =
  "blank = the client the ASN's other rows name, else the client the SKUs belong to; a SKU code is unique per client, so when several clients hold an ASN's codes, name its client on at least one row";

/** Each refused row's reason, in words — a `Record` over the generated union, so a new code fails the build. */
export const ASN_IMPORT_REASON_LABEL: Readonly<Record<AsnImportRowErrorCode, string>> = {
  'unknown-client': 'Unknown client',
  'unknown-warehouse': 'Unknown warehouse',
  'wrong-warehouse': 'Another warehouse',
  'unknown-sku': 'Unknown SKU',
  'sku-client-mismatch': "SKU of another client",
  'mixed-client': 'SKUs of several clients',
  // Story 1-1: a blank-client ASN whose codes are held by several clients.
  'client-required': 'Name the client — several clients hold these codes',
  'kit-cannot-hold-stock': 'Kit SKU',
  'duplicate-asn-code': 'ASN code already used',
  'invalid-asn-code': 'ASN code too long',
  'too-many-lines': 'More than 200 lines',
  'asn-rows-disagree': 'Rows disagree',
  'duplicate-sku-in-asn': 'SKU listed twice',
  'invalid-quantity': 'Invalid quantity',
  'quantity-precision': 'Too many decimals',
  'invalid-expected-at': 'Invalid expected date',
  'missing-value': 'Missing value',
};

/** The reason in words, or the code itself for one this build does not know. */
export function asnImportReasonLabel(code: string): string {
  return Object.prototype.hasOwnProperty.call(ASN_IMPORT_REASON_LABEL, code)
    ? ASN_IMPORT_REASON_LABEL[code as AsnImportRowErrorCode]
    : code;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The lines the accepted ASNs carry. */
export function acceptedLineCount(result: Pick<AsnImportResponseDto, 'asns'>): number {
  return result.asns.reduce((total, asn) => total + asn.lineCount, 0);
}

/** The distinct spreadsheet rows refused (a row can carry more than one problem). */
export function refusedRowCount(result: Pick<AsnImportResponseDto, 'errors'>): number {
  return new Set(result.errors.map((error) => error.rowNumber)).size;
}

/**
 * The result's banner: Check file says what WOULD happen ("3 ASNs, 10 lines
 * ready"), Import what did ("3 ASNs announced"). Refused rows are named
 * whenever there are any — also a row with no `asn_code`, which belongs to
 * no ASN and so leaves `refusedCount` at 0 — never hidden behind a success
 * word.
 */
export function asnImportOutcome(result: AsnImportResponseDto): {
  tone: 'accepted' | 'rejected';
  word: string;
  reason: string;
} {
  const lines = acceptedLineCount(result);
  const ready = `${plural(result.acceptedCount, 'ASN', 'ASNs')}, ${plural(lines, 'line', 'lines')}`;
  const rows = refusedRowCount(result);
  const refused =
    result.errors.length === 0
      ? null
      : (result.refusedCount > 0 ? `${plural(result.refusedCount, 'ASN', 'ASNs')} refused — ` : '') +
        `${plural(rows, 'row', 'rows')} with problems, listed below`;
  if (result.dryRun) {
    return {
      tone: result.acceptedCount === 0 ? 'rejected' : 'accepted',
      word: result.acceptedCount === 0 ? 'Nothing to import' : `${ready} ready`,
      reason:
        refused === null
          ? 'Nothing has been written yet — Import creates them.'
          : `${refused}. An ASN with any bad row is refused whole; Import creates the others. Nothing has been written yet.`,
    };
  }
  return {
    tone: result.acceptedCount === 0 ? 'rejected' : 'accepted',
    word: result.acceptedCount === 0 ? 'No ASNs imported' : `${plural(result.acceptedCount, 'ASN', 'ASNs')} announced`,
    reason:
      refused === null
        ? `${plural(lines, 'line', 'lines')} announced — handhelds receive them like any other ASN.`
        : `${refused}. Fix those rows and upload them again — an ASN already created is refused as a used code.`,
  };
}

/**
 * The CSV error report, built from the response (the catalog import's
 * convention): every refused row with its spreadsheet row number, ASN code,
 * its own sku and quantity cells (so the line is identifiable), reason code and words, and the server's detail. UTF-8 BOM so Excel opens it
 * as UTF-8.
 */
export function asnImportErrorReport(result: Pick<AsnImportResponseDto, 'errors'>): string {
  const header = 'row_number,asn_code,sku,quantity,code,reason,detail';
  const lines = result.errors.map((error) =>
    [
      String(error.rowNumber),
      csvField(error.asnCode ?? ''),
      csvField(error.sku ?? ''),
      // The cell as written — text, so a guard keeps a formula inert.
      csvField(error.quantity ?? ''),
      csvField(error.code),
      csvField(asnImportReasonLabel(error.code)),
      csvField(error.detail),
    ].join(','),
  );
  return `\uFEFF${[header, ...lines].join('\n')}\n`;
}

/** The report's file name — the import's id when there is one, else the file's. */
export function asnImportReportName(result: Pick<AsnImportResponseDto, 'importId' | 'fileSha256'>): string {
  return `asn-import-${result.importId ?? result.fileSha256.slice(0, 12)}-errors.csv`;
}

/** The file could not be read in the browser (moved, deleted, or permission lost since it was picked). */
export function fileReadProblem(name: string): string {
  return `${name} could not be read — it may have been moved or changed since you picked it. Pick it again.`;
}

/** The file-level refusals of the import, branching on `code` — never on prose. */
export function asnImportReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'unsupported-file-type':
        return 'Only .csv and .xlsx files can be imported — save the sheet as CSV or Excel (PDF is not read).';
      case 'file-unreadable':
        return error.detail ?? 'The file could not be read — check it is a CSV or a one-sheet Excel file with a header row.';
      case 'missing-columns':
        return error.detail ?? 'The header is missing required columns (asn_code, sku, quantity) — start from the template.';
      case 'import-too-large':
        return (
          error.detail ??
          `The file is over a cap — at most ${MAX_ASN_IMPORT_ROWS.toLocaleString('en-IN')} rows, ${MAX_ASN_IMPORT_ASNS} ASNs and 5 MB per import.`
        );
      case 'not-found':
        return 'This warehouse no longer exists — refresh the page.';
      case 'role-denied':
        return 'Your role cannot import advance shipment notices.';
      case 'permission-denied':
        return 'Your session belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This import was already run with a different file — pick the file again and check it before importing.';
      case 'conflict':
        return 'The same import is still in flight — retry to read its settled result.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Attach a file and try again.';
      default:
        return error.detail ?? `The file was not imported (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}
