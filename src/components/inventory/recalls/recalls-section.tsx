'use client';

import { useState, useSyncExternalStore, type FormEvent } from 'react';

import { clientFilterKey, defaultFormClientId, showClients } from '@/lib/active-client';
import type { RecallListEntryDto } from '@/lib/api/generated';
import { istDateLabel } from '@/lib/audit-exports';
import { readSession, subscribeSession } from '@/lib/auth';
import { RECALL_MODE_LABEL, RECALL_STATUS_LABEL, openRecallOutcome, recallHref, type RecallMode, type RecallStatus } from '@/lib/recalls';
import { roleHasCapability } from '@/lib/users';
import { useActiveClient, type ActiveClientState } from '@/lib/use-active-client';
import { readyClients } from '@/lib/use-clients';
import { EMPTY_RECALL_FILTERS, useRecallByCode, useRecallList, type RecallListFilters } from '@/lib/use-recalls';

import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { FeedbackBanner } from '@/components/feedback/banner';
import { OpenRecallForm } from '@/components/inventory/recalls/open-recall-form';
import { RecallDetail } from '@/components/inventory/recalls/recall-detail';
import { ClientFilterChip } from '@/components/shared/client-filter-chip';
import { EmptyState } from '@/components/shared/empty-state';
import { RecallChips } from '@/components/shared/recall-figures';
import { SkeletonBar } from '@/components/shared/skeleton';
import { ReadFailure, Section, buttonClass, inputClass, primaryClass, rowButtonClass, selectClass } from '@/components/shared/surface';

/** Story 3-7a — the role holding `qc.manage` opens, adds to and closes recalls; every staff role reads them. */
export const RECALL_ROLE_DENIED = 'Your role can read recalls; an owner or ops manager opens and closes them.';

/** Rewrites the URL in place (the page-tabs rule: no server round trip); a no-op outside a browser. */
function writeUrl(href: string): void {
  if (typeof window !== 'undefined') window.history.replaceState(null, '', href);
}

/**
 * Story 3-7a — Inventory → Recalls (decision 11). Tenant-wide (a recall
 * blocks a lot in every warehouse), so it sits outside the warehouse gate.
 * The list (filtered by the shell's client switcher, plus status, kind and
 * the brand's reference), "Open a recall" for `qc.manage`, and one recall's
 * detail in place of the list — linked as `?tab=recalls&recall=RCL-x` (a
 * batch under recall links here by its code).
 */
export function RecallsSection({ initialRecall = null }: { readonly initialRecall?: string | null }) {
  const active = useActiveClient();
  const [openCode, setOpenCode] = useState<{ code: string; id: string | null } | null>(initialRecall === null ? null : { code: initialRecall, id: null });
  const [banner, setBanner] = useState<{ word: string; reason: string } | null>(null);

  const show = (entry: { code: string; id: string }) => {
    setOpenCode(entry);
    writeUrl(recallHref(entry.code));
  };
  const back = () => {
    setOpenCode(null);
    setBanner(null);
    writeUrl(recallHref());
  };

  if (openCode !== null) {
    return (
      <Section title="Recalls">
        {banner !== null && <FeedbackBanner tone="accepted" word={banner.word} reason={banner.reason} />}
        {openCode.id !== null ? <RecallDetail key={openCode.id} recallId={openCode.id} onBack={back} /> : <ResolveRecall code={openCode.code} onBack={back} />}
      </Section>
    );
  }
  return (
    <RecallList
      key={clientFilterKey(active.filter)}
      active={active}
      onShow={show}
      onOpened={(recall) => {
        setBanner(openRecallOutcome(recall));
        show({ code: recall.code, id: recall.id });
      }}
    />
  );
}

/** A recall named by its code in the URL: found → its detail; not found → a sentence and the way back. */
function ResolveRecall({ code, onBack }: { readonly code: string; readonly onBack: () => void }) {
  const found = useRecallByCode(code);
  const back = (
    <button type="button" className={rowButtonClass} onClick={onBack}>
      ← All recalls
    </button>
  );
  if (found.state === 'loading') {
    return (
      <div className="flex flex-col gap-2" role="status" aria-label={`Finding ${code}`}>
        <div>{back}</div>
        <SkeletonBar className="h-6 w-48" />
      </div>
    );
  }
  if (found.state === 'failed') {
    return (
      <div className="flex flex-col gap-2">
        <div>{back}</div>
        <ReadFailure word="Recall not loaded" reason={found.reason} onRetry={found.reload} />
      </div>
    );
  }
  if (found.data === null) {
    return (
      <div className="flex flex-col gap-2">
        <div>{back}</div>
        <FeedbackBanner tone="warning" word="Recall not found" reason={`No recall ${code} in this tenant — it may have been mistyped.`} />
      </div>
    );
  }
  return <RecallDetail recallId={found.data.id} onBack={onBack} />;
}

const STATUSES: readonly RecallStatus[] = ['open', 'closed'];
const MODES: readonly RecallMode[] = ['live', 'mock'];

function RecallList({
  active,
  onShow,
  onOpened,
}: {
  readonly active: ActiveClientState;
  readonly onShow: (entry: { code: string; id: string }) => void;
  readonly onOpened: (recall: { code: string; id: string; mode: string; lots: readonly { blockedByRecall: boolean }[] }) => void;
}) {
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );
  const canManage = roleHasCapability(role, 'qc.manage');
  const [filters, setFilters] = useState<RecallListFilters>(EMPTY_RECALL_FILTERS);
  const [refDraft, setRefDraft] = useState('');
  const [opening, setOpening] = useState(false);
  const list = useRecallList(active.filter, filters);
  const clients = readyClients(active.clients);
  const multiClient = showClients(clients);
  const filtered = filters.status !== null || filters.mode !== null || filters.externalRef !== null;

  const applyRef = (event: FormEvent) => {
    event.preventDefault();
    const ref = refDraft.trim();
    setFilters((f) => ({ ...f, externalRef: ref === '' ? null : ref }));
  };

  const columns: DataTableColumn<RecallListEntryDto>[] = [
    {
      key: 'code',
      header: 'Recall',
      render: (row) => (
        <span className="flex flex-col">
          <span className="font-mono text-xs font-medium">{row.code}</span>
          {row.externalRef !== null && <span className="text-xs text-(--muted-foreground)">Ref {row.externalRef}</span>}
        </span>
      ),
    },
    ...(multiClient ? [{ key: 'client', header: 'Client', render: (row: RecallListEntryDto) => <span className="font-mono text-xs">{row.clientCode}</span> }] : []),
    { key: 'status', header: 'Status', render: (row) => <RecallChips status={row.status} mode={row.mode} /> },
    { key: 'lots', header: 'Lots', numeric: true, render: (row) => row.lotCount.toLocaleString('en-IN') },
    {
      key: 'reason',
      header: 'Reason',
      priority: 2,
      render: (row) => (
        <span className="block max-w-80 truncate text-xs" title={row.reasonNote}>
          {row.reasonNote}
        </span>
      ),
    },
    { key: 'opened', header: 'Opened', render: (row) => istDateLabel(row.openedAt) },
    { key: 'closed', header: 'Closed', priority: 3, render: (row) => (row.closedAt === null ? '—' : istDateLabel(row.closedAt)) },
    {
      key: 'open',
      header: '',
      render: (row) => (
        <button type="button" className={rowButtonClass} onClick={() => onShow({ code: row.code, id: row.id })} aria-label={`Open recall ${row.code}`}>
          Open
        </button>
      ),
    },
  ];

  return (
    <Section
      title="Recalls"
      action={
        canManage && !opening ? (
          <button type="button" className={primaryClass} onClick={() => setOpening(true)}>
            Open a recall
          </button>
        ) : null
      }
    >
      <div className="max-w-3xl text-(--muted-foreground)">
        When a brand recalls a lot: block it in every warehouse at once, see where the units sit and which open orders hold them, trace every shipment and
        receipt, and give the brand its report.
      </div>
      <ClientFilterChip active={active} tenantName={active.tenantName} />
      {!canManage && <div className="text-xs text-(--muted-foreground)">{RECALL_ROLE_DENIED}</div>}
      {canManage && opening && (
        <OpenRecallForm
          clients={clients ?? []}
          defaultClientId={defaultFormClientId(active, clients, '')}
          onCancel={() => setOpening(false)}
          onOpened={(recall) => {
            setOpening(false);
            onOpened(recall);
          }}
        />
      )}

      <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Filter recalls">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-(--muted-foreground)">Status</span>
          <select
            aria-label="Status"
            className={`${selectClass} w-auto py-1`}
            value={filters.status ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value === '' ? null : (e.target.value as RecallStatus) }))}
          >
            <option value="">All statuses</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {RECALL_STATUS_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-(--muted-foreground)">Kind</span>
          <select
            aria-label="Kind"
            className={`${selectClass} w-auto py-1`}
            value={filters.mode ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, mode: e.target.value === '' ? null : (e.target.value as RecallMode) }))}
          >
            <option value="">Live and mock</option>
            {MODES.map((value) => (
              <option key={value} value={value}>
                {RECALL_MODE_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
        <form className="flex items-end gap-2" onSubmit={applyRef} role="search" aria-label="Find by brand reference">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-(--muted-foreground)">Brand reference</span>
            <input name="externalRef" className={`${inputClass} w-48 py-1`} value={refDraft} onChange={(e) => setRefDraft(e.target.value)} placeholder="Exact reference" />
          </label>
          <button type="submit" className={buttonClass}>
            Find
          </button>
        </form>
        {filtered && (
          <button
            type="button"
            className={rowButtonClass}
            onClick={() => {
              setFilters(EMPTY_RECALL_FILTERS);
              setRefDraft('');
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {list.state === 'failed' ? (
        <ReadFailure word="Recalls not loaded" reason={list.reason} onRetry={list.reload} />
      ) : (
        <DataTable<RecallListEntryDto>
          key={`${filters.status ?? ''}|${filters.mode ?? ''}|${filters.externalRef ?? ''}#${list.epoch}`}
          columns={columns}
          rows={list.state === 'ready' ? list.data.items : []}
          nextCursor={list.state === 'ready' ? list.data.nextCursor : null}
          onCursor={list.onCursor}
          loading={list.state === 'loading' ? 'Loading recalls…' : undefined}
          rowNoun={{ one: 'recall', many: 'recalls' }}
          emptyMessage={
            filtered ? (
              <EmptyState
                kind="filtered"
                action={
                  <button type="button" className={rowButtonClass} onClick={() => {
                      setFilters(EMPTY_RECALL_FILTERS);
                      setRefDraft('');
                    }}>
                    Clear filters
                  </button>
                }
              >
                No recall matches these filters.
              </EmptyState>
            ) : (
              <EmptyState kind="first-use">
                {active.state === 'client' ? `No recalls for ${active.client.code} yet.` : 'No recalls yet — open one when a brand recalls a lot.'}
              </EmptyState>
            )
          }
        />
      )}
    </Section>
  );
}
