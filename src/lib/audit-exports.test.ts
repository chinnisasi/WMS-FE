import { describe, expect, test } from 'bun:test';

import { ApiProblem } from './api/client';
import {
  AUDIT_EXPORT_IN_PROGRESS,
  AUDIT_EXPORT_ROLE_DENIED,
  auditExportEventsLabel,
  auditExportFilename,
  auditExportFiltersLabel,
  auditExportSizeLabel,
  auditExportStatusLabel,
  exportReason,
  isExportRoleDenied,
} from './audit-exports';
import { AUDIT_TARGET_LABEL, istDayEnd, istDayStart } from './audit';

/** Story 9-3b — the "Your exports" list's words, pinned. */

const OWNER_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000a1';
const GONE_ID = '0198f7a2-1b3c-7d4e-8f90-0000000000ff';
const SYSTEM_ID = '01900000-0000-7000-8000-000000000000';
const USERS = { [OWNER_ID]: { email: 'owner@example.com' } };

describe('the status column', () => {
  test('queued and running read "Preparing…"; ready, expired; failed names its reason', () => {
    expect(auditExportStatusLabel({ status: 'queued', failureReason: null })).toBe('Preparing…');
    expect(auditExportStatusLabel({ status: 'running', failureReason: null })).toBe('Preparing…');
    expect(auditExportStatusLabel({ status: 'ready', failureReason: null })).toBe('Ready');
    expect(auditExportStatusLabel({ status: 'expired', failureReason: null })).toBe('Expired');
    expect(auditExportStatusLabel({ status: 'failed', failureReason: 'too-many-events' })).toBe('Failed — too many events — narrow the filters or dates');
    expect(auditExportStatusLabel({ status: 'failed', failureReason: 'interrupted' })).toBe('Failed — interrupted — run it again');
    expect(auditExportStatusLabel({ status: 'failed', failureReason: 'export-error' })).toBe('Failed — something went wrong — run it again');
  });
});

describe('the filters summary', () => {
  test('nothing exported narrowly reads "Everything"', () => {
    expect(auditExportFiltersLabel({}, USERS)).toBe('Everything');
  });

  test('the actor is the member’s email, "System" for the system actor, a short id for a member no longer listed', () => {
    expect(auditExportFiltersLabel({ actorUserId: OWNER_ID }, USERS)).toBe('owner@example.com');
    expect(auditExportFiltersLabel({ actorUserId: SYSTEM_ID }, USERS)).toBe('System');
    expect(auditExportFiltersLabel({ actorUserId: GONE_ID }, USERS)).toBe('user 000000ff');
    expect(auditExportFiltersLabel({ actorUserId: OWNER_ID }, null)).toBe('user 000000a1');
  });

  test('the prefix, the target type in words (with the target), and the IST dates — `to` as the day BEFORE the stored exclusive instant', () => {
    // The web's own range for 1–12 Oct, stored canonical UTC.
    const from = new Date(Date.parse(istDayStart('2026-10-01'))).toISOString();
    const to = new Date(Date.parse(istDayEnd('2026-10-12'))).toISOString();
    expect(to).toBe('2026-10-12T18:30:00.000Z');
    expect(
      auditExportFiltersLabel({ actionPrefix: 'transfer.', targetType: 'transfer_order', from, to }, USERS),
    ).toBe(`transfer.* · ${AUDIT_TARGET_LABEL.transfer_order} · 01 Oct 2026 – 12 Oct 2026`);
    // One day.
    expect(auditExportFiltersLabel({ from: istDayStart('2026-10-12'), to: istDayEnd('2026-10-12') }, USERS)).toBe('12 Oct 2026');
    expect(auditExportFiltersLabel({ to }, USERS)).toBe('to 12 Oct 2026');
    expect(auditExportFiltersLabel({ from }, USERS)).toBe('from 01 Oct 2026');
    expect(auditExportFiltersLabel({ targetType: 'audit_export', targetId: GONE_ID }, USERS)).toBe('Audit export 000000ff');
  });
});

describe('the numbers and the file name', () => {
  test('events in the Indian grouping; size of the gzipped file; a dash while unknown', () => {
    expect(auditExportEventsLabel(null)).toBe('—');
    expect(auditExportEventsLabel(100000)).toBe('1,00,000');
    expect(auditExportSizeLabel(null)).toBe('—');
    expect(auditExportSizeLabel(512)).toBe('512 B');
    expect(auditExportSizeLabel(2048)).toBe('2.0 KB');
    expect(auditExportSizeLabel(3 * 1024 * 1024 + 1024 * 512)).toBe('3.5 MB');
  });

  test('the file name is built from requestedAt on the IST clock (the header is not readable cross-origin)', () => {
    expect(auditExportFilename('2026-10-13T08:33:07.412Z')).toBe('audit-export-20261013-1403.csv');
    // 19:00Z is the next IST day.
    expect(auditExportFilename('2026-10-13T19:00:00.000Z')).toBe('audit-export-20261014-0030.csv');
  });
});

describe('exportReason', () => {
  test('each code the surface meets has its copy; validation shows the server’s detail', () => {
    const problem = (code: string, detail?: string) => new ApiProblem(code, 400, detail);
    expect(exportReason(problem('role-denied'))).toBe(AUDIT_EXPORT_ROLE_DENIED);
    expect(exportReason(problem('export-in-progress'))).toBe('An export is already running — wait for it to finish');
    expect(AUDIT_EXPORT_IN_PROGRESS).toBe('An export is already running — wait for it to finish');
    expect(exportReason(problem('export-not-ready'))).toBe('That export is not ready yet — the list shows where it is.');
    expect(exportReason(problem('export-expired'))).toBe('That export has expired and its file was deleted — export again.');
    expect(exportReason(problem('export-not-found'))).toBe('That export no longer exists — the list is refreshed.');
    expect(exportReason(problem('validation-failed', 'from must be strictly before to'))).toBe('from must be strictly before to');
    expect(exportReason(new TypeError('Failed to fetch'))).toContain('wms-be');
    expect(isExportRoleDenied(problem('role-denied'))).toBe(true);
    expect(isExportRoleDenied(problem('export-in-progress'))).toBe(false);
  });
});
