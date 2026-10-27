import { describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import {
  AUDIT_ROLE_DENIED,
  AUDIT_TARGET_LABEL,
  AUDIT_TARGET_OPTIONS,
  AUDIT_UNAVAILABLE,
  EMPTY_AUDIT_FILTERS,
  SYSTEM_ACTOR_ID,
  SYSTEM_ACTOR_OPTION,
  auditActorLabel,
  auditFilterKey,
  auditHappenedLabel,
  auditReason,
  auditRecordedLabel,
  auditTargetLabel,
  istDayEnd,
  istDayStart,
  parseAuditFilters,
} from '@/lib/audit';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';

/**
 * Story 9-3a — the Audit section's pure half: the filter parse (what is
 * never sent), the IST day → instant rule, every cell's words and the
 * refusal mapper.
 */

const SYSTEM_ID = '01900000-0000-7000-8000-000000000000';
const USER_ID = '0198f7a2-1b3c-7d4e-8f90-000000000001';

describe('the IST day → instant rule', () => {
  test('from = the day at 00:00 IST; to = the NEXT day at 00:00 IST (half-open)', () => {
    expect(istDayStart('2026-10-12')).toBe('2026-10-12T00:00:00+05:30');
    expect(istDayEnd('2026-10-12')).toBe('2026-10-13T00:00:00+05:30');
    // Month and year rollover.
    expect(istDayEnd('2026-10-31')).toBe('2026-11-01T00:00:00+05:30');
    expect(istDayEnd('2026-12-31')).toBe('2027-01-01T00:00:00+05:30');
  });

  test('a row recorded at 23:59 IST on the 12th is inside the day; 00:00 IST on the 13th is not', () => {
    const query = parseAuditFilters({ ...EMPTY_AUDIT_FILTERS, fromDate: '2026-10-12', toDate: '2026-10-12' }).query!;
    const inside = Date.parse('2026-10-12T18:29:00Z'); // 23:59 IST
    const outside = Date.parse('2026-10-12T18:30:00Z'); // 00:00 IST the 13th
    const from = Date.parse(query.from!);
    const to = Date.parse(query.to!);
    expect(inside >= from && inside < to).toBe(true);
    expect(outside >= from && outside < to).toBe(false);
  });
});

describe('parseAuditFilters', () => {
  test('an empty draft sends no filter at all', () => {
    expect(parseAuditFilters(EMPTY_AUDIT_FILTERS)).toEqual({ query: {}, problem: null });
  });

  test('every filter, combined: actor, a trimmed prefix, a target type, the IST window', () => {
    expect(
      parseAuditFilters(
        { actor: USER_ID, actionPrefix: '  transfer. ', targetType: 'transfer_order', fromDate: '2026-10-01', toDate: '2026-10-12' },
      ),
    ).toEqual({
      query: {
        actorUserId: USER_ID,
        actionPrefix: 'transfer.',
        targetType: 'transfer_order',
        from: '2026-10-01T00:00:00+05:30',
        to: '2026-10-13T00:00:00+05:30',
      },
      problem: null,
    });
  });

  test('"System" sends the system actor id — typed from the generated response literal, needing no read first', () => {
    expect(SYSTEM_ACTOR_ID).toBe(SYSTEM_ID);
    expect(parseAuditFilters({ ...EMPTY_AUDIT_FILTERS, actor: SYSTEM_ACTOR_OPTION }).query).toEqual({ actorUserId: SYSTEM_ID });
  });

  test('refuses what the backend would 400: from after to, a prefix with `%` or capitals, an impossible date', () => {
    expect(parseAuditFilters({ ...EMPTY_AUDIT_FILTERS, fromDate: '2026-10-13', toDate: '2026-10-12' })).toEqual({
      query: null,
      problem: 'The start date is after the end date.',
    });
    expect(parseAuditFilters({ ...EMPTY_AUDIT_FILTERS, actionPrefix: 'a%' }).query).toBeNull();
    expect(parseAuditFilters({ ...EMPTY_AUDIT_FILTERS, actionPrefix: 'Transfer.' }).query).toBeNull();
    expect(parseAuditFilters({ ...EMPTY_AUDIT_FILTERS, fromDate: '2026-02-30' }).query).toBeNull();
    // One day (from = to) is lawful.
    expect(parseAuditFilters({ ...EMPTY_AUDIT_FILTERS, fromDate: '2026-10-12', toDate: '2026-10-12' }).problem).toBeNull();
  });

  test('the filter key changes with every filter and is stable for the same tuple', () => {
    const a = auditFilterKey({ actionPrefix: 'transfer.' });
    expect(auditFilterKey({ actionPrefix: 'transfer.' })).toBe(a);
    expect(auditFilterKey({ actionPrefix: 'po.' })).not.toBe(a);
    expect(auditFilterKey({ actionPrefix: 'transfer.', targetType: 'order' })).not.toBe(a);
    expect(auditFilterKey({})).not.toBe(a);
    // The target id is part of the tuple (a cursor is never replayed across targets).
    expect(auditFilterKey({ actionPrefix: 'transfer.', targetId: '0198f7a2-aaaa-7d4e-8f90-000000000001' })).not.toBe(a);
  });
});

describe('the cells', () => {
  test('Recorded on the IST clock', () => {
    expect(auditRecordedLabel('2026-10-12T18:29:00.000Z')).toBe('12 Oct 2026, 23:59:00');
  });

  test('"happened HH:MM" only when occurredAt differs from recordedAt by more than a minute', () => {
    expect(auditHappenedLabel({ recordedAt: '2026-04-01T10:00:00.000Z', occurredAt: '2026-04-01T08:00:00.000Z' })).toBe('happened 13:30');
    expect(auditHappenedLabel({ recordedAt: '2026-04-01T10:00:00.000Z', occurredAt: '2026-04-01T09:59:00.000Z' })).toBeNull();
    expect(auditHappenedLabel({ recordedAt: '2026-04-01T10:00:00.000Z', occurredAt: '2026-04-01T10:00:00.000Z' })).toBeNull();
  });

  test('Who: the email; "System" for actorKind system; a short id for an unknown user', () => {
    const users = { [USER_ID]: { email: 'owner@example.com' } };
    expect(auditActorLabel({ actorKind: 'user', actorUserId: USER_ID }, users)).toBe('owner@example.com');
    expect(auditActorLabel({ actorKind: 'system', actorUserId: SYSTEM_ID }, users)).toBe('System');
    // An unknown user: the id's random TAIL (a UUIDv7's head is its timestamp — alike across a day).
    expect(auditActorLabel({ actorKind: 'user', actorUserId: '0198f7a2-ffff-7d4e-8f90-000000000009' }, users)).toBe('00000009');
    expect(auditActorLabel({ actorKind: 'user', actorUserId: USER_ID }, null)).toBe('00000001');
  });

  test('Target: the type in words and a short id, plain text; an unknown type prints as itself', () => {
    expect(auditTargetLabel({ targetType: 'transfer_order', targetId: '0198f7a2-aaaa-7d4e-8f90-000000000001' })).toBe('Transfer 00000001');
    expect(auditTargetLabel({ targetType: 'return_authorization', targetId: '0198f7a2-aaaa-7d4e-8f90-000000000001' })).toBe('Return 00000001');
    expect(auditTargetLabel({ targetType: 'spaceship', targetId: '0198f7a2-aaaa-7d4e-8f90-000000000001' })).toBe('spaceship 00000001');
  });

  test('the target-type select lists the generated vocabulary, labelled, once each', () => {
    expect(AUDIT_TARGET_OPTIONS).toHaveLength(Object.keys(AUDIT_TARGET_LABEL).length);
    expect(new Set(AUDIT_TARGET_OPTIONS.map((option) => option.value)).size).toBe(AUDIT_TARGET_OPTIONS.length);
    expect(AUDIT_TARGET_OPTIONS.map((option) => option.value)).toEqual(
      expect.arrayContaining(['transfer_order', 'purchase_order', 'goods_receipt', 'device', 'tenant']),
    );
  });
});

describe('auditReason', () => {
  test('role-denied, report-unavailable, validation-failed (the detail), the transport arm', () => {
    expect(auditReason(new ApiProblem('role-denied', 403, 'Role "ops_manager" does not include the "audit.view" capability.'))).toBe(AUDIT_ROLE_DENIED);
    expect(AUDIT_ROLE_DENIED).toBe('Only the owner can read the audit trail');
    expect(auditReason(new ApiProblem('report-unavailable', 503, 'took too long'))).toBe(AUDIT_UNAVAILABLE);
    expect(AUDIT_UNAVAILABLE).toBe('Narrow the filters or dates');
    expect(auditReason(new ApiProblem('validation-failed', 400, 'from must be strictly before to'))).toBe('from must be strictly before to');
    expect(auditReason(new ApiProblem('something-new', 418))).toBe('Could not load the audit trail (something-new).');
    expect(auditReason(new Error('fetch failed'))).toBe(UNREACHABLE_REASON);
  });
});

describe('story 4-7a — the return disposition audit target', () => {
  test('named in words', () => {
    expect(AUDIT_TARGET_LABEL.return_disposition).toBe('Return disposition');
  });
});
