/**
 * Story 21-8 — per-client service reporting on the web: the default period,
 * the period parse, every tile's value, counts and population caption, and
 * the refusal mappers for the operator section (`/reports`) and the portal
 * Service page (`/portal/service`).
 *
 * Pure: no React, no fetch — pinned by `service-report.test.ts`. The figures
 * are the backend's (one facade read behind both routes); this file formats,
 * it never computes a KPI.
 */
import { ApiProblem } from '@/lib/api/client';
import type { ClientDto, ServiceReportDto } from '@/lib/api/generated';
import { clientLabel } from '@/lib/clients';
import { formatFigure, shortDate } from '@/lib/overview';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import { portalReadReason } from '@/lib/portal';
import { istDateOf } from '@/lib/rate-cards';
import { parseCustomRange } from '@/lib/usage';

/** The backend's bound on one service report (inclusive days) — `MAX_SERVICE_REPORT_DAYS`. */
export const MAX_SERVICE_REPORT_DAYS = 366;

/** The default period's length in days, today included. */
export const DEFAULT_SERVICE_DAYS = 30;

/** `YYYY-MM-DD` plus `days` (UTC arithmetic on a date — no zone). */
function addIsoDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The default period: the last 30 days ending today — `to` is the IST date
 * of `now` (never the viewer's local date: between 00:00 and 05:30 IST a
 * viewer west of India is still on yesterday), `from` is `to − 29`.
 */
export function defaultServicePeriod(now: number): { from: string; to: string } {
  const to = istDateOf(now);
  return { from: addIsoDays(to, -(DEFAULT_SERVICE_DAYS - 1)), to };
}

/** The period inputs → a period to send, or a problem shown instead (nothing is sent). */
export function parseServicePeriod(from: string, to: string): ReturnType<typeof parseCustomRange> {
  return parseCustomRange(from, to, MAX_SERVICE_REPORT_DAYS);
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * A client picker option: every status is reportable (a suspended or
 * departed client's history still happened), so the status is named rather
 * than the option hidden; the tenant's own client reads as the company.
 */
export function serviceClientOption(client: Pick<ClientDto, 'systemOwned' | 'code' | 'name' | 'status'>, tenantName: string | null): string {
  const label = clientLabel(client as ClientDto, tenantName);
  return client.status === 'active' ? label : `${label} (${client.status})`;
}

/** One tile's render model. */
export interface ServiceTile {
  readonly label: string;
  readonly value: string;
  /** The counts behind the figure (KpiTile `secondary`). */
  readonly secondary: string;
  /** The population the figure is computed over. */
  readonly caption: string;
  /** Extra notes beneath (the backlog, the pack-check counting note). */
  readonly notes: readonly string[];
}

/** The three tiles, in order: dock-to-stock, pick accuracy, dispatch timeliness. */
export function serviceTiles(report: ServiceReportDto): readonly ServiceTile[] {
  const dock = report.dockToStock;
  const accuracy = report.pickAccuracy;
  const timeliness = report.dispatchTimeliness;
  const accuracyNotes = [`${plural(accuracy.packFailures, 'failed pack check', 'failed pack checks')}`];
  if (accuracy.packFailuresCountingSince !== null) {
    accuracyNotes.push(`Pack checks counted since ${shortDate(accuracy.packFailuresCountingSince)}`);
  }
  return [
    {
      label: 'Dock-to-stock (median)',
      value: formatFigure(dock.medianMinutes, 'minutes'),
      secondary: plural(dock.placements, 'placement', 'placements'),
      caption: 'Placements made in the period: GRN recorded → placed in a bin',
      notes: [],
    },
    {
      label: 'Pick accuracy',
      value: formatServiceRate(accuracy.accuracy),
      secondary: `${plural(accuracy.linesDispatched, 'line', 'lines')} dispatched · ${accuracy.linesShortPicked} short-picked`,
      caption: 'Order lines dispatched in the period that never had a short pick',
      notes: accuracyNotes,
    },
    {
      label: `Dispatched within ${report.targetHours} h`,
      value: formatServiceRate(timeliness.onTimeRate),
      secondary: `${timeliness.onTime} of ${plural(timeliness.ordersDispatched, 'order', 'orders')} · median ${formatFigure(timeliness.medianMinutes, 'minutes')}`,
      caption: 'Orders dispatched in the period, from received to dispatched',
      notes: [`${plural(timeliness.lateNotDispatched, 'order', 'orders')} late, not yet dispatched (received in the period)`],
    },
  ];
}

/** The operator section's refusal copy. */
export function serviceReportReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'not-found':
        return 'That client or warehouse is no longer available — pick again.';
      case 'report-unavailable':
        return SERVICE_TIMEOUT_REASON;
      case 'validation-failed':
        return error.detail ?? 'That period cannot be reported on.';
      case 'permission-denied':
      case 'role-denied':
        return 'Your session cannot read this report — sign in again.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      default:
        return error.detail ?? `Could not load the report (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/** The 503 copy, both surfaces. */
export const SERVICE_TIMEOUT_REASON = 'The report took too long — try a shorter period';
/** The portal's 404 copy — the only 404 the portal route answers is the warehouse. */
export const PORTAL_SERVICE_WAREHOUSE_GONE = 'That warehouse is no longer available';

/** The portal page's refusal copy: the session codes through `portalReadReason`, plus 404 and 503. */
export function portalServiceReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    if (error.code === 'not-found') return PORTAL_SERVICE_WAREHOUSE_GONE;
    if (error.code === 'report-unavailable') return SERVICE_TIMEOUT_REASON;
    if (error.code === 'validation-failed') return error.detail ?? 'That period cannot be reported on.';
  }
  return portalReadReason(error, 'your service report');
}

/**
 * A service ratio as a percentage. `formatFigure` rounds to one decimal, so a
 * rate ≥ 0.9995 but below 1 (one short line in 5,000) would read "100%" — a
 * claim of perfection the figure does not make. Below 1 never shows 100%:
 * it reads "99.9%". Exactly 1 still reads "100%".
 */
export function formatServiceRate(value: number | null): string {
  const formatted = formatFigure(value, 'percent');
  return value !== null && value < 1 && formatted === '100%' ? '99.9%' : formatted;
}
