'use client';

import Link from 'next/link';
import { Fragment, useMemo, useRef, useState } from 'react';

import { fetchApiCreateCounts } from '@/lib/api/client';
import type { CountTaskListEntryDto, SkuResponse } from '@/lib/api/generated';
import {
  COUNT_TASK_ORIGINS,
  COUNT_TASK_ORIGIN_LABEL,
  COUNT_TASK_STATUSES,
  COUNT_TASK_STATUS_LABEL,
  COUNT_VARIANCE_STATUS_LABEL,
  PENDING_NO_LINES_COPY,
  ZONE_TOO_LARGE_NOTE,
  VARIANCE_QUEUE_HREF,
  VARIANCE_QUEUE_LINK_LABEL,
  countTasksEmptyMessage,
  countableBins,
  countableZones,
  createCountsOutcome,
  createCountsReason,
  createdByLabel,
  notifyCountsChanged,
  plannerNames,
  tooManyBinsNote,
  varianceCountLabel,
  zoneTooLarge,
  type CountTaskOrigin,
  type CountTaskStatus,
} from '@/lib/counts';
import { quantityLabel } from '@/lib/format-quantity';
import { ledgerQuantityLabel, ledgerRecordedLabel } from '@/lib/ledger';
import type { ActiveClientState } from '@/lib/use-active-client';
import { useCountTaskDetail, useCountTasks, useCountZones } from '@/lib/use-counts';
import { useSkuMap, useUserMap } from '@/lib/use-inbound';
import { useWarehouseBins } from '@/lib/use-inventory';
import { ulid } from '@/lib/ulid';

import { FeedbackBanner } from '@/components/feedback/banner';
import { AllClientsNote } from '@/components/shared/client-filter-chip';
import { ReadFailure, Section, buttonClass, inputClass, primaryClass, rowButtonClass, selectClass } from '@/components/shared/surface';

type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string } | null;

const thClass = 'h-10 border-b border-(--border) px-3 text-left font-medium text-(--muted-foreground)';

/**
 * Story 3-5a — the count tasks of one warehouse: newest first, status and
 * origin filters, "Load more". A row expands to its detail — expected beside
 * counted, the variances and the recount a variance names. The list is NOT
 * filtered by the client switcher (a bin can hold several clients' goods),
 * so it says "All clients".
 */
export function CountTasks({
  tenantId,
  warehouseId,
  canManage,
  canResolve,
  viewerId,
  active,
}: {
  tenantId: string;
  warehouseId: string;
  canManage: boolean;
  canResolve: boolean;
  viewerId: string | null;
  active: ActiveClientState;
}) {
  const [status, setStatus] = useState<CountTaskStatus | null>(null);
  const [origin, setOrigin] = useState<CountTaskOrigin | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const tasks = useCountTasks(warehouseId, status, origin);
  const users = useUserMap();
  const planners = useMemo(() => plannerNames(users), [users]);

  return (
    <Section
      title="Tasks"
      action={
        canManage && !creating ? (
          <button type="button" className={primaryClass} onClick={() => setCreating(true)}>
            New count
          </button>
        ) : undefined
      }
    >
      <AllClientsNote active={active} title="Counts are not filtered by client — a bin can hold several clients' goods." />
      {canManage && creating && (
        <NewCountForm tenantId={tenantId} warehouseId={warehouseId} onClose={() => setCreating(false)} />
      )}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-2">
          <span className="text-(--muted-foreground)">Status</span>
          <select
            aria-label="Status"
            className={`${selectClass} w-auto py-1`}
            value={status ?? ''}
            onChange={(e) => setStatus(e.target.value === '' ? null : (e.target.value as CountTaskStatus))}
          >
            <option value="">All</option>
            {COUNT_TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {COUNT_TASK_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-(--muted-foreground)">Origin</span>
          <select
            aria-label="Origin"
            className={`${selectClass} w-auto py-1`}
            value={origin ?? ''}
            onChange={(e) => setOrigin(e.target.value === '' ? null : (e.target.value as CountTaskOrigin))}
          >
            <option value="">All</option>
            {COUNT_TASK_ORIGINS.map((o) => (
              <option key={o} value={o}>
                {COUNT_TASK_ORIGIN_LABEL[o]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {tasks.state === 'loading' && <div className="text-(--muted-foreground)">Loading counts…</div>}
      {tasks.state === 'failed' && <ReadFailure word="Counts not loaded" reason={tasks.reason} onRetry={tasks.reload} />}
      {tasks.state === 'ready' && (
        <>
          <div className="overflow-x-auto rounded-md border border-(--border)">
            <table className="w-full border-collapse text-sm" data-testid="count-tasks">
              <thead className="bg-(--muted)">
                <tr>
                  <th scope="col" className={thClass}>Bin</th>
                  <th scope="col" className={thClass}>Origin</th>
                  <th scope="col" className={thClass}>Status</th>
                  <th scope="col" className={`${thClass} text-right`}>Lines</th>
                  <th scope="col" className={thClass}>Variances</th>
                  <th scope="col" className={thClass}>Planned by</th>
                  <th scope="col" className={thClass}>Created (IST)</th>
                  <th scope="col" className={thClass}>Counted (IST)</th>
                  <th scope="col" className={thClass}>
                    <span className="sr-only">Detail</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {tasks.data.items.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="h-24 px-3 text-center text-(--muted-foreground)">
                      {countTasksEmptyMessage(status, origin)}
                    </td>
                  </tr>
                ) : (
                  tasks.data.items.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      viewerId={viewerId}
                      planners={planners}
                      expanded={expandedId === task.id}
                      onToggle={() => setExpandedId(expandedId === task.id ? null : task.id)}
                      canResolve={canResolve}
                      canInspect={canManage || canResolve}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
          {tasks.moreError !== null && <FeedbackBanner tone="rejected" word="More counts not loaded" reason={tasks.moreError} />}
          {tasks.data.nextCursor !== null && (
            <button type="button" className={`${buttonClass} w-fit`} onClick={tasks.loadMore} disabled={tasks.loadingMore}>
              {tasks.loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      )}
    </Section>
  );
}

function TaskRow({
  task,
  viewerId,
  planners,
  expanded,
  onToggle,
  canResolve,
  canInspect,
}: {
  task: CountTaskListEntryDto;
  viewerId: string | null;
  planners: Readonly<Record<string, string>> | null;
  expanded: boolean;
  onToggle: () => void;
  canResolve: boolean;
  /**
   * The detail shows expected quantities — a gated read on the server
   * (counts.manage or variances.resolve); the operator, who counts blind,
   * gets no Details control.
   */
  canInspect: boolean;
}) {
  return (
    <Fragment>
      <tr data-row-id={task.id} className="h-10 border-b border-(--border) last:border-b-0">
        <td className="px-3 py-1 font-medium">{task.binCode}</td>
        <td className="px-3 py-1">{COUNT_TASK_ORIGIN_LABEL[task.origin]}</td>
        <td className="px-3 py-1">{COUNT_TASK_STATUS_LABEL[task.status]}</td>
        <td className="data px-3 py-1 text-right">{task.lineCount}</td>
        <td className="px-3 py-1">{varianceCountLabel(task)}</td>
        <td className="px-3 py-1">{createdByLabel(task.createdBy, viewerId, planners)}</td>
        <td className="px-3 py-1">{ledgerRecordedLabel(task.createdAt)}</td>
        <td className="px-3 py-1">{task.completedAt === null ? '—' : ledgerRecordedLabel(task.completedAt)}</td>
        <td className="px-3 py-1">
          {canInspect && (
            <button type="button" className={rowButtonClass} aria-expanded={expanded} onClick={onToggle}>
              {expanded ? 'Hide' : 'Details'}
            </button>
          )}
        </td>
      </tr>
      {expanded && canInspect && (
        <tr className="border-b border-(--border) last:border-b-0">
          <td colSpan={9} className="bg-(--muted) px-3 py-2">
            <TaskDetail taskId={task.id} canResolve={canResolve} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function TaskDetail({ taskId, canResolve }: { taskId: string; canResolve: boolean }) {
  const detail = useCountTaskDetail(taskId);
  const skus = useSkuMap();
  if (detail.state === 'loading') return <div className="text-(--muted-foreground)">Loading the count…</div>;
  if (detail.state === 'failed') return <ReadFailure word="Count not loaded" reason={detail.reason} onRetry={detail.reload} />;
  const { lines, variances, recountTaskId, task } = detail.data;
  const sku = (skuId: string): SkuResponse | null => skus?.[skuId] ?? null;
  const codeOf = (skuId: string) => lines.find((line) => line.skuId === skuId)?.skuCode ?? sku(skuId)?.code ?? `SKU …${skuId.slice(-8)}`;
  return (
    <div className="flex flex-col gap-3" data-testid={`count-detail-${taskId}`}>
      <table className="w-full border-collapse text-sm" aria-label="Count lines">
        <thead>
          <tr>
            <th scope="col" className={thClass}>SKU</th>
            <th scope="col" className={`${thClass} text-right`}>Expected</th>
            <th scope="col" className={`${thClass} text-right`}>Counted</th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td colSpan={3} className="px-3 py-2 text-(--muted-foreground)">
                {task.status === 'pending' ? PENDING_NO_LINES_COPY : 'The bin was empty when the count was planned, and nothing was counted.'}
              </td>
            </tr>
          ) : (
            lines.map((line) => (
              <tr key={line.skuId} className="border-b border-(--border) last:border-b-0">
                <td className="px-3 py-1">
                  {line.skuCode}
                  {line.skuName === null ? '' : ` · ${line.skuName}`}
                </td>
                <td className="data px-3 py-1 text-right">{quantityLabel(line.expectedQuantity, sku(line.skuId))}</td>
                <td className="data px-3 py-1 text-right">
                  {line.countedQuantity === null ? (task.status === 'pending' ? 'Not counted yet' : '—') : quantityLabel(line.countedQuantity, sku(line.skuId))}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      {task.status === 'completed' && (
        <div className="flex flex-col gap-1">
          <h3 className="font-medium">Variances</h3>
          {variances.length === 0 ? (
            <div className="text-(--muted-foreground)">Every line matched — no variance.</div>
          ) : (
            <ul className="flex flex-col gap-1" aria-label="Variances">
              {variances.map((variance) => (
                <li key={variance.id}>
                  {codeOf(variance.skuId)}: {ledgerQuantityLabel(variance.delta, sku(variance.skuId))} ({COUNT_VARIANCE_STATUS_LABEL[variance.status]}
                  {variance.epochConflict ? ' — the bin moved during the count' : ''})
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {recountTaskId !== null && <div>Recount task …{recountTaskId.slice(-8)} was created to resolve a variance.</div>}
      {canResolve && variances.some((variance) => variance.status === 'open') && (
        <Link href={VARIANCE_QUEUE_HREF} className="w-fit text-(--primary) underline underline-offset-2">
          {VARIANCE_QUEUE_LINK_LABEL}
        </Link>
      )}
    </div>
  );
}

/**
 * The bulk create (`counts.manage`): a zone's countable bins, or chosen
 * bins. One key per draft — reused across retries of an unchanged selection,
 * cleared on any selection change and on success.
 */
function NewCountForm({ tenantId, warehouseId, onClose }: { tenantId: string; warehouseId: string; onClose: () => void }) {
  const bins = useWarehouseBins(warehouseId);
  const zones = useCountZones(warehouseId);
  const [mode, setMode] = useState<'zone' | 'bins'>('zone');
  const [zoneId, setZoneId] = useState<string>('');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const keyRef = useRef<string | null>(null);
  const sending = useRef(false);

  const binList = useMemo(() => (bins.state === 'ready' ? countableBins(bins.data) : []), [bins]);
  const zoneList = useMemo(
    () => (bins.state === 'ready' && zones.state === 'ready' ? countableZones(zones.data, bins.data) : []),
    [bins, zones],
  );
  const shown = useMemo(() => {
    const needle = search.trim().toUpperCase();
    return needle === '' ? binList : binList.filter((bin) => bin.code.toUpperCase().includes(needle));
  }, [binList, search]);

  // Every selection edit is a new draft — a new key on the next submit.
  function edit(apply: () => void) {
    keyRef.current = null;
    setOutcome(null);
    apply();
  }

  const capNote = mode === 'bins' ? tooManyBinsNote(picked.size) : null;
  const ready = mode === 'zone' ? zoneId !== '' : picked.size > 0 && capNote === null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready || sending.current) return;
    sending.current = true;
    setBusy(true);
    setOutcome(null);
    const key = (keyRef.current ??= ulid());
    try {
      const response = await fetchApiCreateCounts(
        tenantId,
        mode === 'zone' ? { warehouseId, zoneId } : { warehouseId, binIds: [...picked] },
        key,
      );
      setOutcome(createCountsOutcome(response));
      keyRef.current = null;
      setPicked(new Set());
      setZoneId('');
      notifyCountsChanged();
    } catch (error) {
      setOutcome({ tone: 'rejected', word: 'Not created', reason: createCountsReason(error) });
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <form aria-label="New count" onSubmit={submit} className="flex flex-col gap-3 rounded-md border border-(--border) p-3">
      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="sr-only">Count</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="count-mode" checked={mode === 'zone'} onChange={() => edit(() => setMode('zone'))} />
          A whole zone
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="count-mode" checked={mode === 'bins'} onChange={() => edit(() => setMode('bins'))} />
          Chosen bins
        </label>
      </fieldset>
      {bins.state === 'loading' && <div className="text-(--muted-foreground)">Loading bins…</div>}
      {bins.state === 'failed' && <ReadFailure word="Bins not loaded" reason={bins.reason} onRetry={bins.reload} />}
      {mode === 'zone' && zones.state === 'failed' && <ReadFailure word="Zones not loaded" reason={zones.reason} onRetry={zones.reload} />}
      {bins.state === 'ready' && mode === 'zone' && zones.state === 'loading' && <div className="text-(--muted-foreground)">Loading zones…</div>}
      {bins.state === 'ready' && mode === 'zone' && zones.state === 'ready' && (
        <label className="flex flex-col gap-1 text-sm">
          <span>Zone</span>
          <select aria-label="Zone" className={selectClass} value={zoneId} onChange={(e) => edit(() => setZoneId(e.target.value))}>
            <option value="">Choose a zone…</option>
            {zoneList.map(({ zone, binCount }) => (
              <option key={zone.id} value={zone.id} disabled={zoneTooLarge(binCount)}>
                {zone.code} {zone.name} ({binCount} {binCount === 1 ? 'bin' : 'bins'}
                {zoneTooLarge(binCount) ? ' — too many to count whole' : ''})
              </option>
            ))}
          </select>
          {zoneList.some(({ binCount }) => zoneTooLarge(binCount)) && (
            <span className="text-xs text-(--muted-foreground)">{ZONE_TOO_LARGE_NOTE}</span>
          )}
        </label>
      )}
      {bins.state === 'ready' && mode === 'bins' && (
        <div className="flex flex-col gap-2 text-sm">
          <input
            aria-label="Find bins"
            className={inputClass}
            placeholder="Filter by bin code"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span>{picked.size} selected</span>
            <button
              type="button"
              className={rowButtonClass}
              onClick={() => edit(() => setPicked(new Set([...picked, ...shown.map((bin) => bin.id)])))}
              disabled={shown.length === 0}
            >
              Select all shown
            </button>
            <button type="button" className={rowButtonClass} onClick={() => edit(() => setPicked(new Set()))} disabled={picked.size === 0}>
              Clear
            </button>
          </div>
          <div className="max-h-60 overflow-y-auto rounded-sm border border-(--border) p-2" role="group" aria-label="Bins">
            {shown.length === 0 ? (
              <div className="text-(--muted-foreground)">No countable bin matches.</div>
            ) : (
              shown.map((bin) => (
                <label key={bin.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    aria-label={bin.code}
                    checked={picked.has(bin.id)}
                    onChange={(e) =>
                      edit(() => {
                        const next = new Set(picked);
                        if (e.target.checked) next.add(bin.id);
                        else next.delete(bin.id);
                        setPicked(next);
                      })
                    }
                  />
                  {bin.code}
                </label>
              ))
            )}
          </div>
          {capNote !== null && <div className="text-(--destructive)">{capNote}</div>}
        </div>
      )}
      <div className="text-xs text-(--muted-foreground)">
        A bin that already has an open count is skipped. Bulk-created counts reach the handhelds at their next refresh — no notification is sent.
      </div>
      {outcome !== null && <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />}
      <div className="flex gap-2">
        <button type="submit" className={primaryClass} disabled={!ready || busy}>
          {busy ? 'Creating…' : 'Create counts'}
        </button>
        <button type="button" className={buttonClass} onClick={onClose}>
          Close
        </button>
      </div>
    </form>
  );
}
