'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { fetchApiAuditExportFile, fetchApiRequestAuditExport } from '@/lib/api/client';
import type { AuditExportDto, UserResponse } from '@/lib/api/generated';
import type { AuditFilterQuery } from '@/lib/audit';
import {
  AUDIT_EXPORTS_ANCHOR,
  AUDIT_EXPORTS_REFRESH_EVENT,
  auditExportEventsLabel,
  auditExportFilename,
  auditExportFiltersLabel,
  auditExportSizeLabel,
  auditExportStatusLabel,
  exportReason,
  istDateTimeLabel,
} from '@/lib/audit-exports';
import { readSession, subscribeSession } from '@/lib/auth';
import { downloadBlob } from '@/lib/csv';
import { ulid } from '@/lib/ulid';
import type { Reloadable, ResourceState } from '@/lib/resource-state';

import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { ReadFailure, buttonClass, rowButtonClass } from '@/components/shared/surface';

type Exports = ResourceState<readonly AuditExportDto[]> & Reloadable & { denied: boolean };

function useTenantId(): string | null {
  return useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
}

/**
 * Story 9-3b — "Export the applied filters": queues an export of what the
 * table currently shows. It posts the APPLIED filters — a draft not yet
 * applied is not sent, and the label says so. A NEW Idempotency-Key is
 * minted per click (the `client-invoices.tsx` precedent): a key kept across
 * clicks would replay the first export's stale `queued` snapshot. It stays
 * enabled when the trail read failed with `report-unavailable` — the case an
 * export exists for. After it posts, the exports list reloads.
 */
export function AuditExportButton({ applied, onQueued }: { applied: AuditFilterQuery; onQueued: () => void }) {
  const tenantId = useTenantId();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const post = async () => {
    if (tenantId === null || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await fetchApiRequestAuditExport(tenantId, { ...applied }, ulid());
      if (!mounted.current) return;
      setMessage({ tone: 'ok', text: 'Export queued — it appears under Your exports, and the bell tells you when it is ready.' });
    } catch (error) {
      if (!mounted.current) return;
      setMessage({ tone: 'error', text: exportReason(error) });
    } finally {
      if (mounted.current) setBusy(false);
      onQueued();
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={buttonClass} disabled={busy || tenantId === null} onClick={() => void post()}>
        {busy ? 'Exporting…' : 'Export the applied filters'}
      </button>
      {message !== null && (
        <span role={message.tone === 'error' ? 'alert' : 'status'} className={message.tone === 'error' ? 'text-xs text-(--destructive)' : 'text-xs'}>
          {message.text}
        </span>
      )}
    </div>
  );
}

/**
 * Story 9-3b — "Your exports": the caller's own last 20 exports, newest
 * first. The wrapper carrying `id="audit-exports"` is ALWAYS rendered —
 * loading and failed states included — so the panel's link
 * (`/reports#audit-exports`) always has a target. On mount with that hash,
 * on every `hashchange` to it, and on the bell entry's refresh event
 * (`AUDIT_EXPORTS_REFRESH_EVENT`), the list reloads and scrolls into view
 * once it has read. A manual Refresh reloads; there is no polling.
 * Download fetches the file with the bearer header (`parseAs: 'blob'`) — a
 * plain link cannot carry it — and names it from `requestedAt`; a refusal
 * shows its reason and reloads the list.
 */
export function AuditExportsList({ exports, userMap }: { exports: Exports; userMap: Readonly<Record<string, Pick<UserResponse, 'email'>>> | null }) {
  const tenantId = useTenantId();
  const anchor = useRef<HTMLDivElement>(null);
  const scrollPending = useRef(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const { reload } = exports;

  useEffect(() => {
    if (window.location.hash === `#${AUDIT_EXPORTS_ANCHOR}`) scrollPending.current = true;
    const refresh = () => {
      scrollPending.current = true;
      reload();
    };
    const onHash = () => {
      if (window.location.hash === `#${AUDIT_EXPORTS_ANCHOR}`) refresh();
    };
    window.addEventListener('hashchange', onHash);
    // The bell's entry click (a pushState navigation fires no hashchange).
    window.addEventListener(AUDIT_EXPORTS_REFRESH_EVENT, refresh);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener(AUDIT_EXPORTS_REFRESH_EVENT, refresh);
    };
  }, [reload]);

  useEffect(() => {
    if (!scrollPending.current || exports.state === 'loading') return;
    scrollPending.current = false;
    anchor.current?.scrollIntoView?.({ block: 'start' });
  }, [exports.state]);

  const download = async (row: AuditExportDto) => {
    if (tenantId === null) return;
    setDownloading(row.id);
    setProblem(null);
    try {
      const blob = await fetchApiAuditExportFile(tenantId, row.id);
      downloadBlob(auditExportFilename(row.requestedAt), blob);
    } catch (error) {
      setProblem(exportReason(error));
      reload();
    } finally {
      setDownloading(null);
    }
  };

  const columns: readonly DataTableColumn<AuditExportDto>[] = [
    {
      key: 'requested',
      header: 'Requested (IST)',
      render: (row) => <time dateTime={row.requestedAt}>{istDateTimeLabel(row.requestedAt)}</time>,
    },
    { key: 'filters', header: 'Filters', render: (row) => <span className="text-xs">{auditExportFiltersLabel(row.filters, userMap)}</span> },
    { key: 'status', header: 'Status', render: (row) => <span className="text-xs">{auditExportStatusLabel(row)}</span> },
    { key: 'events', header: 'Events', render: (row) => auditExportEventsLabel(row.rowCount) },
    { key: 'size', header: 'Size', render: (row) => auditExportSizeLabel(row.byteSize) },
    {
      key: 'expires',
      header: 'Expires (IST)',
      render: (row) => (row.expiresAt === null ? '—' : <time dateTime={row.expiresAt}>{istDateTimeLabel(row.expiresAt)}</time>),
    },
    {
      key: 'download',
      header: '',
      render: (row) =>
        row.status === 'ready' ? (
          <button
            type="button"
            className={rowButtonClass}
            disabled={downloading !== null}
            aria-label={`Download the export requested ${istDateTimeLabel(row.requestedAt)}`}
            onClick={() => void download(row)}
          >
            {downloading === row.id ? 'Downloading…' : 'Download'}
          </button>
        ) : null,
    },
  ];

  return (
    <div id={AUDIT_EXPORTS_ANCHOR} ref={anchor} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">Your exports</h3>
        <button type="button" className={rowButtonClass} onClick={reload}>
          Refresh
        </button>
      </div>
      {problem !== null && (
        <div role="alert" className="text-xs text-(--destructive)">
          {problem}
        </div>
      )}
      {exports.state === 'failed' ? (
        <ReadFailure word="Exports unavailable" reason={exports.reason} onRetry={reload} />
      ) : (
        <DataTable<AuditExportDto>
          columns={columns}
          rows={exports.state === 'ready' ? exports.data : []}
          emptyMessage={exports.state === 'loading' ? 'Loading your exports…' : 'No exports yet'}
        />
      )}
    </div>
  );
}
