/**
 * Story 9-3b — the `/reports` "Your exports" list (the async audit export):
 * its words, the filter summary, the file name and the refusal mapper.
 *
 * Pure: no React, no fetch — pinned by `audit-exports.test.ts`. The export
 * is the backend's (`POST/GET …/reporting/audit/exports`, owner-only); this
 * file formats it.
 */
import { ApiProblem } from '@/lib/api/client';
import type { AuditExportDto, UserResponse } from '@/lib/api/generated';
import { AUDIT_TARGET_LABEL, SYSTEM_ACTOR_ID, shortIdTail, type AuditTargetType } from '@/lib/audit';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';

/** The anchor the panel's audit-export entries link to (`/reports#audit-exports`). */
export const AUDIT_EXPORTS_ANCHOR = 'audit-exports';

/**
 * Asks a mounted "Your exports" list to reload and scroll into view. The
 * bell's `audit-export` entry dispatches it on click: Next's `<Link>`
 * navigates with `history.pushState`, which fires no `hashchange`, so a
 * click while already on `/reports` would otherwise refresh nothing. With
 * no list mounted the event is simply unheard (the list's mount handling
 * reads the hash instead).
 */
export const AUDIT_EXPORTS_REFRESH_EVENT = 'wms:audit-exports-refresh';

export function requestAuditExportsRefresh(): void {
  window.dispatchEvent(new CustomEvent(AUDIT_EXPORTS_REFRESH_EVENT));
}

export type AuditExportStatus = AuditExportDto['status'];
type AuditExportFailure = NonNullable<AuditExportDto['failureReason']>;

/**
 * Why an export failed, in words — a `Record` over the GENERATED enum, so a
 * reason the backend adds fails this file's compile until it has copy.
 */
export const AUDIT_EXPORT_FAILURE_LABEL: Readonly<Record<AuditExportFailure, string>> = {
  'too-many-events': 'too many events — narrow the filters or dates',
  interrupted: 'interrupted — run it again',
  'export-error': 'something went wrong — run it again',
};

/** The status column: queued and running both read "Preparing…" (there is no polling — Refresh re-reads). */
export function auditExportStatusLabel(row: Pick<AuditExportDto, 'status' | 'failureReason'>): string {
  switch (row.status) {
    case 'queued':
    case 'running':
      return 'Preparing…';
    case 'ready':
      return 'Ready';
    case 'failed':
      return row.failureReason === null ? 'Failed' : `Failed — ${AUDIT_EXPORT_FAILURE_LABEL[row.failureReason]}`;
    case 'expired':
      return 'Expired';
    default: {
      const unknown: never = row.status;
      return String(unknown);
    }
  }
}

const IST_DATE = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric' });
const IST_DATE_TIME = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function format(formatter: Intl.DateTimeFormat, ms: number, withTime: boolean): string {
  const parts = formatter.formatToParts(new Date(ms));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  const date = `${part('day')} ${part('month')} ${part('year')}`;
  return withTime ? `${date}, ${part('hour')}:${part('minute')}` : date;
}

/** `13 Oct 2026, 14:03` on the IST clock. */
export function istDateTimeLabel(iso: string): string {
  return format(IST_DATE_TIME, Date.parse(iso), true);
}

/** `13 Oct 2026` — the IST calendar day an instant falls on. */
export function istDateLabel(iso: string): string {
  return format(IST_DATE, Date.parse(iso), false);
}

/**
 * The exported filters in words. The actor is the member's email ("System"
 * for the system actor, a short id for a member no longer listed); the
 * target type in words; `from` as its IST day; `to` — stored EXCLUSIVE, at
 * the IST midnight AFTER the last day the web asked for — as the IST day
 * just before it, so a range reads exactly as it was chosen.
 */
export function auditExportFiltersLabel(
  filters: AuditExportDto['filters'],
  users: Readonly<Record<string, Pick<UserResponse, 'email'>>> | null,
): string {
  const parts: string[] = [];
  if (filters.actorUserId !== undefined) {
    parts.push(
      filters.actorUserId === SYSTEM_ACTOR_ID ? 'System' : (users?.[filters.actorUserId]?.email ?? `user ${shortIdTail(filters.actorUserId)}`),
    );
  }
  if (filters.actionPrefix !== undefined) parts.push(`${filters.actionPrefix}*`);
  if (filters.targetType !== undefined) {
    const label = (AUDIT_TARGET_LABEL as Readonly<Record<AuditTargetType, string>>)[filters.targetType] ?? filters.targetType;
    parts.push(filters.targetId === undefined ? label : `${label} ${shortIdTail(filters.targetId)}`);
  } else if (filters.targetId !== undefined) {
    parts.push(`target ${shortIdTail(filters.targetId)}`);
  }
  const from = filters.from === undefined ? null : istDateLabel(filters.from);
  const to = filters.to === undefined ? null : istDateLabel(new Date(Date.parse(filters.to) - 1).toISOString());
  if (from !== null && to !== null) parts.push(from === to ? from : `${from} – ${to}`);
  else if (from !== null) parts.push(`from ${from}`);
  else if (to !== null) parts.push(`to ${to}`);
  return parts.length === 0 ? 'Everything' : parts.join(' · ');
}

/** The events column: a count once known, else a dash. */
export function auditExportEventsLabel(rowCount: number | null): string {
  return rowCount === null ? '—' : rowCount.toLocaleString('en-IN');
}

/** The size column: the gzipped file's size. */
export function auditExportSizeLabel(byteSize: number | null): string {
  if (byteSize === null) return '—';
  if (byteSize < 1024) return `${byteSize} B`;
  if (byteSize < 1024 * 1024) return `${(byteSize / 1024).toFixed(1)} KB`;
  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The download's file name, `audit-export-<IST yyyyMMdd-HHmm>.csv`, built from
 * the export's `requestedAt` — the server's `Content-Disposition` carries the
 * same name, but CORS does not expose that header to the page.
 */
export function auditExportFilename(requestedAt: string): string {
  const ist = new Date(Date.parse(requestedAt) + 5.5 * 3_600_000).toISOString();
  return `audit-export-${ist.slice(0, 4)}${ist.slice(5, 7)}${ist.slice(8, 10)}-${ist.slice(11, 13)}${ist.slice(14, 16)}.csv`;
}

export const AUDIT_EXPORT_ROLE_DENIED = 'Only the owner can export the audit trail';
export const AUDIT_EXPORT_IN_PROGRESS = 'An export is already running — wait for it to finish';

/** The export surface's refusal copy — branching on `code`, never prose. */
export function exportReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'role-denied':
        return AUDIT_EXPORT_ROLE_DENIED;
      case 'export-in-progress':
        return AUDIT_EXPORT_IN_PROGRESS;
      case 'export-not-ready':
        return 'That export is not ready yet — the list shows where it is.';
      case 'export-expired':
        return 'That export has expired and its file was deleted — export again.';
      case 'export-not-found':
        return 'That export no longer exists — the list is refreshed.';
      case 'validation-failed':
        return error.detail ?? 'Those filters cannot be exported.';
      case 'permission-denied':
        return 'Your session belongs to another company — sign in again.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      default:
        return error.detail ?? `The export could not be completed (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/** Whether a refusal means the caller may not export at all (the export surface hides). */
export function isExportRoleDenied(error: unknown): boolean {
  return error instanceof ApiProblem && error.code === 'role-denied';
}
