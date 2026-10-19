/**
 * Story 9-3a — the `/reports` Audit section (FR-28): the filter parse, the
 * IST day → instant rule, every cell's words and the refusal mapper.
 *
 * Pure: no React, no fetch — pinned by `audit.test.ts`. The trail is the
 * backend's (`GET …/reporting/audit`, owner-only); this file formats it and
 * never sends a filter the backend would refuse.
 */
import { ApiProblem } from '@/lib/api/client';
import type { AuditEventDto, AuditTrailResponse, ReportingControllerAuditData, UserResponse } from '@/lib/api/generated';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';

type AuditQuery = NonNullable<ReportingControllerAuditData['query']>;

/** The generated `targetType` filter vocabulary (the backend's `AUDIT_TARGET_TYPES`). */
export type AuditTargetType = NonNullable<AuditQuery['targetType']>;

/**
 * Every target type, in words. Record-typed over the GENERATED union: a type
 * the backend adds fails this file's compile until it is named here, and a
 * type it drops fails it too — the select is never a hand-copied list.
 */
export const AUDIT_TARGET_LABEL: Readonly<Record<AuditTargetType, string>> = {
  advance_shipment_notice: 'ASN',
  // The ASN import (2026-10-17) — one file's run; each ASN it created has its own 'ASN' row.
  asn_import: 'ASN import',
  audit_export: 'Audit export',
  batch_alert: 'Batch alert',
  bin: 'Bin',
  carrier_connection: 'Carrier connection',
  catalog_import: 'Catalog import',
  channel_connection: 'Channel connection',
  client: 'Client',
  client_invoice: 'Client invoice',
  count_task: 'Count task',
  count_variance: 'Count variance',
  count_variance_policy: 'Variance policy',
  device: 'Device',
  eway_bill: 'E-way bill',
  eway_gstin_setting: 'E-way GSTIN setting',
  eway_state_threshold: 'E-way threshold',
  expiry_alert_policy: 'Expiry policy',
  goods_receipt: 'GRN',
  kit: 'Kit',
  ledger_chain_break: 'Ledger chain break',
  ledger_event: 'Ledger event',
  manifest: 'Manifest',
  order: 'Order',
  over_receipt: 'Over-receipt',
  // Story 1-3 — a business partner and one of its client links.
  partner: 'Partner',
  partner_link: 'Partner link',
  pick: 'Pick',
  picklist_line: 'Picklist line',
  product: 'Product',
  purchase_order: 'PO',
  putaway_placement: 'Putaway',
  qc_hold: 'QC hold',
  rate_card: 'Rate card',
  rejected_op: 'Rejected op',
  reorder_breach: 'Reorder breach',
  reorder_policy: 'Reorder policy',
  // Story 13-1 — a return authorization (RMA).
  return_authorization: 'Return',
  return_receipt: 'Return receipt',
  sku: 'SKU',
  stock_adjustment_pending: 'Pending adjustment',
  stock_adjustment_policy: 'Adjustment policy',
  suggested_po: 'Suggested PO',
  temperature_excursion: 'Excursion',
  tenant: 'Company',
  transfer_order: 'Transfer',
  user: 'User',
  // Story 1-3 — no writer stores it now; the rows written before the partner
  // master (`vendor.created`) still carry it, so the filter keeps it.
  vendor: 'Vendor (before partners)',
  warehouse: 'Warehouse',
  wave: 'Wave',
  wave_policy: 'Wave policy',
  zone: 'Zone',
};

/** The select's options, alphabetical by label. */
export const AUDIT_TARGET_OPTIONS: readonly { value: AuditTargetType; label: string }[] = (
  Object.keys(AUDIT_TARGET_LABEL) as AuditTargetType[]
)
  .map((value) => ({ value, label: AUDIT_TARGET_LABEL[value] }))
  .sort((a, b) => a.label.localeCompare(b.label));

/** The backend's `actionPrefix` shape (the DTO's `AUDIT_ACTION_PREFIX_RE`). */
export const AUDIT_ACTION_PREFIX_RE = /^[a-z][a-z_.-]{0,63}$/;

/** The actor filter's "System" choice. */
export const SYSTEM_ACTOR_OPTION = 'system';

/**
 * The system actor's id, typed as the GENERATED `AuditTrailResponse['systemActorId']`
 * literal: the backend publishes it as a one-value enum, so a backend change
 * fails this file's compile instead of silently filtering on a stale id. The
 * filter needs no successful read first (a 503 on the first page must not
 * disable "System").
 */
export const SYSTEM_ACTOR_ID: AuditTrailResponse['systemActorId'] = '01900000-0000-7000-8000-000000000000';

/** The random tail of a UUIDv7 — its first 8 characters are the timestamp, near-identical across a day's rows. */
export function shortIdTail(id: string): string {
  return id.slice(-8);
}

/** The filter inputs, as the section holds them (component state — lost on reload). */
export interface AuditFilterDraft {
  /** '' = everyone; a member's user id; `SYSTEM_ACTOR_OPTION` = the system actor. */
  readonly actor: string;
  readonly actionPrefix: string;
  /** '' = every type. */
  readonly targetType: AuditTargetType | '';
  /** IST dates `YYYY-MM-DD`, '' = open. */
  readonly fromDate: string;
  readonly toDate: string;
}

export const EMPTY_AUDIT_FILTERS: AuditFilterDraft = { actor: '', actionPrefix: '', targetType: '', fromDate: '', toDate: '' };

/** The query a parsed draft sends (no cursor — the hook adds it). */
export type AuditFilterQuery = Omit<AuditQuery, 'cursor' | 'limit'>;

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

function nextIsoDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/**
 * The IST calendar day `d` as the backend's half-open window: `from` = IST
 * midnight starting `d`, `to` = IST midnight starting the NEXT day — so a row
 * recorded at 23:59 IST is in, one at 00:00 IST the next day is out.
 */
export function istDayStart(date: string): string {
  return `${date}T00:00:00+05:30`;
}

export function istDayEnd(date: string): string {
  return istDayStart(nextIsoDay(date));
}

/**
 * The draft → the query to send, or a problem shown instead (nothing is
 * sent). Refuses what the backend would 400: a malformed action prefix, a
 * `from` after `to`. "System" sends `SYSTEM_ACTOR_ID`.
 */
export function parseAuditFilters(
  draft: AuditFilterDraft,
): { query: AuditFilterQuery; problem: null } | { query: null; problem: string } {
  const prefix = draft.actionPrefix.trim();
  if (prefix !== '' && !AUDIT_ACTION_PREFIX_RE.test(prefix)) {
    return { query: null, problem: 'An action prefix is lowercase letters, dots, dashes and underscores — like "transfer." or "stock_adjustment."' };
  }
  if (draft.fromDate !== '' && !isRealDate(draft.fromDate)) return { query: null, problem: 'The start date is not a real date.' };
  if (draft.toDate !== '' && !isRealDate(draft.toDate)) return { query: null, problem: 'The end date is not a real date.' };
  if (draft.fromDate !== '' && draft.toDate !== '' && draft.fromDate > draft.toDate) {
    return { query: null, problem: 'The start date is after the end date.' };
  }
  let actorUserId: string | undefined;
  if (draft.actor === SYSTEM_ACTOR_OPTION) {
    actorUserId = SYSTEM_ACTOR_ID;
  } else if (draft.actor !== '') {
    actorUserId = draft.actor;
  }
  return {
    query: {
      ...(actorUserId === undefined ? {} : { actorUserId }),
      ...(prefix === '' ? {} : { actionPrefix: prefix }),
      ...(draft.targetType === '' ? {} : { targetType: draft.targetType }),
      ...(draft.fromDate === '' ? {} : { from: istDayStart(draft.fromDate) }),
      ...(draft.toDate === '' ? {} : { to: istDayEnd(draft.toDate) }),
    },
    problem: null,
  };
}

/** A canonical key of the filter tuple — the cursor is scoped to it, and the table is keyed on it. */
export function auditFilterKey(query: AuditFilterQuery | null): string {
  if (query === null) return 'invalid';
  return JSON.stringify([
    query.actorUserId ?? '',
    query.actionPrefix ?? '',
    query.targetType ?? '',
    query.targetId ?? '',
    query.from ?? '',
    query.to ?? '',
  ]);
}

const IST_DATE_TIME = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const IST_HOUR_MINUTE = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function parts(format: Intl.DateTimeFormat, iso: string): (type: Intl.DateTimeFormatPartTypes) => string {
  const list = format.formatToParts(new Date(iso));
  return (type) => list.find((p) => p.type === type)?.value ?? '';
}

/** `12 Oct 2026, 23:59:00` on the IST clock — the Recorded column. */
export function auditRecordedLabel(iso: string): string {
  const part = parts(IST_DATE_TIME, iso);
  return `${part('day')} ${part('month')} ${part('year')}, ${part('hour')}:${part('minute')}:${part('second')}`;
}

/**
 * "happened HH:MM" (IST) when the action's own time is more than a minute
 * from when the server recorded it — a device or command time (putaway, an
 * offline op resolved later); null otherwise.
 */
export function auditHappenedLabel(row: Pick<AuditEventDto, 'recordedAt' | 'occurredAt'>): string | null {
  const drift = Math.abs(Date.parse(row.recordedAt) - Date.parse(row.occurredAt));
  if (!(drift > 60_000)) return null;
  const part = parts(IST_HOUR_MINUTE, row.occurredAt);
  return `happened ${part('hour')}:${part('minute')}`;
}

/** Who: the member's email; "System" for the system actor; the id's random tail for a user no longer listed. */
export function auditActorLabel(
  row: Pick<AuditEventDto, 'actorKind' | 'actorUserId'>,
  users: Readonly<Record<string, Pick<UserResponse, 'email'>>> | null,
): string {
  if (row.actorKind === 'system') return 'System';
  return users?.[row.actorUserId]?.email ?? shortIdTail(row.actorUserId);
}

/** Target: the type in words plus the id's random tail — plain text (no deep links; story 9-3a). */
export function auditTargetLabel(row: Pick<AuditEventDto, 'targetType' | 'targetId'>): string {
  const label = (AUDIT_TARGET_LABEL as Readonly<Record<string, string>>)[row.targetType] ?? row.targetType;
  return `${label} ${shortIdTail(row.targetId)}`;
}

export const AUDIT_ROLE_DENIED = 'Only the owner can read the audit trail';
export const AUDIT_UNAVAILABLE = 'Narrow the filters or dates';

/** The section's refusal copy — branching on `code`, never prose. */
export function auditReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'role-denied':
        return AUDIT_ROLE_DENIED;
      case 'report-unavailable':
        return AUDIT_UNAVAILABLE;
      case 'validation-failed':
        return error.detail ?? 'Those filters cannot be read.';
      case 'invalid-cursor':
        return 'That page is no longer valid — go back to the first page.';
      case 'permission-denied':
        return 'Your session belongs to another company — sign in again.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      default:
        return error.detail ?? `Could not load the audit trail (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}
