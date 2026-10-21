/**
 * Story 5-3a — the operational registers on the web (`/reports`, the
 * "Operational reports" section): each register's label and period rule,
 * the default client and warehouse, the downloaded file's name and the
 * refusal copy.
 *
 * Pure: no React, no fetch — pinned by `reports.test.ts`. The rows, the
 * columns and every rule that refuses are the backend's (`GET …/warehouses/
 * {w}/reports/{report}`); this file only decides what to send and what to
 * call the file.
 */
import { ApiProblem } from '@/lib/api/client';
import type { ReportFormat, ReportName } from '@/lib/api/client';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import { istDateOf } from '@/lib/rate-cards';

/** One register's words and its period rule (`dated`: an inclusive IST period; else as of now). */
export interface ReportDefinition {
  readonly label: string;
  readonly description: string;
  readonly dated: boolean;
}

/**
 * Every register the backend serves — a `Record` over the generated union,
 * so a register added to the API fails this build until it is named here.
 */
export const REPORTS: Readonly<Record<ReportName, ReportDefinition>> = {
  'stock-on-hand': {
    label: 'Stock on hand',
    description: 'Every bin × batch with stock, system bins flagged, with HSN and expiry.',
    dated: false,
  },
  'inbound-register': {
    label: 'Inbound register',
    description: 'Every goods receipt line: document, vendor, gate-in, supplier invoice and e-way bill.',
    dated: true,
  },
  'outbound-register': {
    label: 'Outbound register',
    description: 'Every order line: consignee, destination, first dispatch, carrier and AWB.',
    dated: true,
  },
  ledger: {
    label: 'Stock ledger',
    description: 'Every stock movement: signed quantity, bins, batch, reference and who.',
    dated: true,
  },
  'batch-ageing': {
    label: 'Batch ageing / near expiry',
    description: 'Every batch with stock, soonest expiry first, with days to expiry.',
    dated: false,
  },
};

/** The registers in menu order. */
export const REPORT_ORDER: readonly ReportName[] = ['stock-on-hand', 'inbound-register', 'outbound-register', 'ledger', 'batch-ageing'];

export const REPORT_FORMAT_LABEL: Readonly<Record<ReportFormat, string>> = {
  csv: 'CSV',
  xlsx: 'Excel (.xlsx)',
};

/** The "client" select's value for every client. */
export const ALL_REPORT_CLIENTS = '';

/**
 * The register's client (decision 9): a local pick (All included) while it
 * is still listed, else the active switcher client while listed, else every
 * client (`null`). Keyed derivation — the caller never resets a pick.
 */
export function resolveReportClient(
  picked: string | null,
  activeClientId: string | null,
  listedIds: readonly string[],
): string | null {
  if (picked === ALL_REPORT_CLIENTS) return null;
  if (picked !== null && listedIds.includes(picked)) return picked;
  if (activeClientId !== null && listedIds.includes(activeClientId)) return activeClientId;
  return null;
}

/** The register's warehouse (decision 9): a local pick while it is still listed, else the first (or only) one. */
export function resolveReportWarehouse(picked: string | null, listedIds: readonly string[]): string | null {
  if (picked !== null && listedIds.includes(picked)) return picked;
  return listedIds[0] ?? null;
}

/** A code made safe for a filename: letters, digits and `-` only. */
export function reportSlug(code: string): string {
  const slug = code.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug === '' ? 'x' : slug;
}

/**
 * The downloaded file's name (CORS hides the server's `Content-Disposition`):
 * `<report>-<WH>[-<client>]-<from>_<to>.<ext>` for a dated register,
 * `<report>-<WH>[-<client>]-asof-<IST date>.<ext>` for a snapshot. The
 * as-of date is the IST date of `now` — never the viewer's local date.
 */
export function reportFilename(input: {
  report: ReportName;
  format: ReportFormat;
  warehouseCode: string;
  clientCode: string | null;
  period: { from: string; to: string } | null;
  now: number;
}): string {
  const span = input.period === null ? `asof-${istDateOf(input.now)}` : `${input.period.from}_${input.period.to}`;
  const parts = [input.report, reportSlug(input.warehouseCode), ...(input.clientCode === null ? [] : [reportSlug(input.clientCode)]), span];
  return `${parts.join('-')}.${input.format}`;
}

/** The backend's row cap (`REGISTER_MAX_ROWS`) — the fallback when a 422 does not carry `maxRows`. */
export const REPORT_MAX_ROWS = 50_000;

/**
 * The register refusal copy — branched on `code`, never on prose. A 422's
 * cap is read from the problem (`maxRows`), and the advice follows the
 * register: a snapshot has no period to shorten.
 */
export function reportReason(error: unknown, report: ReportName): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'report-too-large': {
        const cap = typeof error.extensions.maxRows === 'number' ? error.extensions.maxRows : REPORT_MAX_ROWS;
        const advice = REPORTS[report].dated ? 'pick a client or a shorter period' : 'pick a client';
        return `This register has more than ${cap.toLocaleString('en-IN')} rows — ${advice}.`;
      }
      case 'report-unavailable':
        return 'The register could not be prepared just now (too slow, or the server is busy) — try again, or narrow the filters.';
      case 'validation-failed':
        return error.detail ?? 'That register cannot be prepared with these filters.';
      case 'unknown-warehouse':
        return 'That warehouse is no longer available — pick another.';
      case 'role-denied':
      case 'permission-denied':
        return 'Your session cannot download registers — sign in again.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      default:
        return error.detail ?? `Could not prepare the register (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}
