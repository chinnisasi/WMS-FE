'use client';

import { useState, useSyncExternalStore, type FormEvent } from 'react';

import type { AuditEventDto } from '@/lib/api/generated';
import {
  AUDIT_TARGET_OPTIONS,
  EMPTY_AUDIT_FILTERS,
  SYSTEM_ACTOR_OPTION,
  auditActorLabel,
  auditFilterKey,
  auditHappenedLabel,
  auditRecordedLabel,
  auditTargetLabel,
  parseAuditFilters,
  type AuditFilterDraft,
  type AuditFilterQuery,
  type AuditTargetType,
} from '@/lib/audit';
import { readSession, subscribeSession } from '@/lib/auth';
import { roleHasCapability } from '@/lib/users';
import { useAuditMembers, useAuditTrail } from '@/lib/use-audit-trail';

import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { ReadFailure, Section, buttonClass } from '@/components/shared/surface';

const labelClass = 'text-xs text-(--muted-foreground)';
const inputClass = 'h-8 rounded-sm border border-(--border) bg-transparent px-2 text-sm';

/**
 * Story 9-3a — the `/reports` Audit section (FR-28): every state-changing
 * action — who, what, when, and the thing it changed — newest recorded first,
 * filterable by actor, action prefix, target type and IST dates.
 *
 * Owner-only: it renders only for a role holding `audit.view` (the mirror),
 * and the backend's guard is the authority — a role it refuses reads "Only
 * the owner can read the audit trail". Filters are component state (lost on
 * reload); the cursor is scoped to the applied filter tuple and the table is
 * keyed on it, so a filter change starts at page 1 with Prev disabled. The
 * Target column is plain text: no deep links (PENDING).
 */
export function AuditTrail() {
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );
  if (!roleHasCapability(role, 'audit.view')) return null;
  return <AuditTrailSection />;
}

function AuditTrailSection() {
  const [draft, setDraft] = useState<AuditFilterDraft>(EMPTY_AUDIT_FILTERS);
  const [applied, setApplied] = useState<AuditFilterQuery>({});
  const [problem, setProblem] = useState<string | null>(null);
  const trail = useAuditTrail(applied);
  const members = useAuditMembers();
  const memberList = members.state === 'ready' ? members.data : [];
  const userMap = members.state === 'ready' ? Object.fromEntries(members.data.map((user) => [user.id, user])) : null;

  const edit = (patch: Partial<AuditFilterDraft>) => setDraft((current) => ({ ...current, ...patch }));

  const apply = (event: FormEvent) => {
    event.preventDefault();
    const parsed = parseAuditFilters(draft, trail.state === 'ready' ? trail.data.systemActorId : null);
    if (parsed.problem !== null) {
      setProblem(parsed.problem);
      return;
    }
    setProblem(null);
    setApplied(parsed.query);
  };

  const columns: readonly DataTableColumn<AuditEventDto>[] = [
    {
      key: 'recordedAt',
      header: 'Recorded (IST)',
      render: (row) => {
        const happened = auditHappenedLabel(row);
        return (
          <span className="flex flex-col">
            <time dateTime={row.recordedAt}>{auditRecordedLabel(row.recordedAt)}</time>
            {happened !== null && <span className="text-xs text-(--muted-foreground)">{happened}</span>}
          </span>
        );
      },
    },
    { key: 'who', header: 'Who', render: (row) => <span className="text-xs">{auditActorLabel(row, userMap)}</span> },
    { key: 'action', header: 'Action', render: (row) => <span className="font-mono text-xs">{row.action}</span> },
    { key: 'target', header: 'Target', render: (row) => <span className="text-xs">{auditTargetLabel(row)}</span> },
  ];

  return (
    <Section title="Audit">
      <form className="flex flex-wrap items-end gap-2" onSubmit={apply} aria-label="Audit filters">
        <label className="flex min-w-48 flex-col gap-1">
          <span className={labelClass}>Actor</span>
          <select
            className={inputClass}
            aria-label="Audit actor"
            value={draft.actor}
            onChange={(event) => edit({ actor: event.target.value })}
          >
            <option value="">Everyone</option>
            <option value={SYSTEM_ACTOR_OPTION}>System</option>
            {memberList.map((user) => (
              <option key={user.id} value={user.id}>
                {user.email}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-40 flex-col gap-1">
          <span className={labelClass}>Action starts with</span>
          <input
            className={inputClass}
            aria-label="Audit action prefix"
            placeholder="transfer."
            value={draft.actionPrefix}
            onChange={(event) => edit({ actionPrefix: event.target.value })}
          />
        </label>
        <label className="flex min-w-40 flex-col gap-1">
          <span className={labelClass}>Target type</span>
          <select
            className={inputClass}
            aria-label="Audit target type"
            value={draft.targetType}
            onChange={(event) => edit({ targetType: event.target.value as AuditTargetType | '' })}
          >
            <option value="">Every type</option>
            {AUDIT_TARGET_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>From (IST)</span>
          <input
            type="date"
            className={inputClass}
            aria-label="Audit from date"
            value={draft.fromDate}
            onChange={(event) => edit({ fromDate: event.target.value })}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>To (IST)</span>
          <input
            type="date"
            className={inputClass}
            aria-label="Audit to date"
            value={draft.toDate}
            onChange={(event) => edit({ toDate: event.target.value })}
          />
        </label>
        <button type="submit" className={buttonClass}>
          Apply
        </button>
      </form>
      {members.state === 'failed' && (
        <div role="alert" className="text-xs text-(--destructive)">
          Members not loaded — the actor filter lists only System. {members.reason}{' '}
          <button type="button" className="underline underline-offset-2" onClick={members.reload}>
            Retry
          </button>
        </div>
      )}
      {problem !== null && (
        <div role="alert" className="text-xs text-(--destructive)">
          {problem}
        </div>
      )}
      {trail.state === 'failed' ? (
        <ReadFailure word="Audit trail unavailable" reason={trail.reason} onRetry={trail.reload} />
      ) : (
        // Keyed on the applied filter tuple: a filter change remounts the
        // table, so its Prev/Next stack starts again at page 1.
        <DataTable<AuditEventDto>
          key={auditFilterKey(applied)}
          columns={columns}
          rows={trail.state === 'ready' ? trail.data.items : []}
          nextCursor={trail.state === 'ready' ? trail.data.nextCursor : null}
          onCursor={trail.onCursor}
          emptyMessage={trail.state === 'loading' ? 'Loading the audit trail…' : 'No actions match these filters.'}
        />
      )}
    </Section>
  );
}
