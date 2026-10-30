'use client';

import { useRef, useState, useSyncExternalStore } from 'react';

import { fetchApiCancelClientReturn } from '@/lib/api/client';
import type { ClientDto, ClientReturnDto, ClientReturnSummaryDto } from '@/lib/api/generated';
import { hiddenByClientFilterNote } from '@/lib/active-client';
import { readSession, subscribeSession } from '@/lib/auth';
import {
  CLIENT_RETURN_STATUSES,
  CLIENT_RETURN_STATUS_FILTER_LABEL,
  RTC_ADDRESS_LABEL,
  RTC_LIMITS,
  RTC_PICK_GUIDANCE,
  RTC_SOURCE_LABEL,
  canCancelClientReturn,
  consigneeStateLabel,
  canDispatchClientReturn,
  clientReturnStatusLabel,
  clientReturnStatusTone,
  lineQuantityLabel,
  parseRtcCancelReason,
  rtcCancelConfirmSentence,
  rtcCancelledOutcome,
  rtcCreatedOutcome,
  rtcDispatchedOutcome,
  rtcReason,
  rtcReasonWord,
  rtcRefusalReloads,
  shortPickNotes,
  stampLabel,
  summaryDocumentLabel,
  summaryQuantityLabel,
  summaryWhenLabel,
  type ClientReturnStatus,
} from '@/lib/client-returns';
import { BRAND_DOCUMENT_LABEL } from '@/lib/consignment-capture';
import { clientCell, showClients } from '@/lib/clients';
import { formatCount } from '@/lib/format-quantity';
import { formatIstDate } from '@/lib/rate-cards';
import { RETURN_CONDITION_LABEL, notifyReturnsDisposed } from '@/lib/returns';
import { ulid } from '@/lib/ulid';
import { useActiveClient } from '@/lib/use-active-client';
import { useClientReturn, useClientReturns } from '@/lib/use-client-returns';
import { readyClients } from '@/lib/use-clients';
import { useOutboundSkus } from '@/lib/use-outbound-orders';
import { roleHasCapability } from '@/lib/users';

import { DataTable, expandedRowId, type DataTableColumn } from '@/components/data-table/data-table';
import { FeedbackBanner } from '@/components/feedback/banner';
import { ClientReturnCreateDialog } from '@/components/returns/client-return-create-dialog';
import { ClientReturnDispatchDialog } from '@/components/returns/client-return-dispatch-dialog';
import { canPrintPackageLabels, PackageLabelsDialog } from '@/components/shared/package-labels-dialog';
import { ClientReturnNote } from '@/components/returns/client-return-note';
import { ClientFilterChip } from '@/components/shared/client-filter-chip';
import { EmptyState } from '@/components/shared/empty-state';
import { StatusChip } from '@/components/shared/status-chip';
import { ReadFailure, buttonClass, destructiveClass, inputClass, primaryClass, rowButtonClass } from '@/components/shared/surface';

/**
 * Story 4-7c (decision 14) — Returns → To client: the warehouse's returns to
 * client, newest first, under a status filter and the active-client filter.
 * Every staff role reads the list and the detail; **New return to client**
 * and Cancel are `returns.manage`'s (owner, ops manager), **Dispatch** is
 * `dispatch.execute`'s and is offered on a picked return only (a suspended
 * client is warned, never blocked — A8); Print works on any (a draft prints
 * as a pick list under the draft watermark). The pick happens on the
 * handheld (Returns out tab) — a draft says so. Most returns start from the
 * Awaiting disposition queue (select lines → Return to client); New here
 * starts one with nothing preselected (a client with only DAMAGED stock).
 *
 * Every mutation fires `notifyReturnsDisposed()` — the list, the open
 * detail, the awaiting queue and an open RMA's split re-read.
 */

type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string };

export function ClientReturnsCard({ warehouseId, warehouseLabel }: { warehouseId: string; warehouseLabel: string | null }) {
  const active = useActiveClient();
  const [status, setStatus] = useState<ClientReturnStatus | null>(null);
  const list = useClientReturns(warehouseId, status, active.filter);
  const clients = readyClients(active.clients);
  const skus = useOutboundSkus();
  const skuMap = skus.state === 'ready' ? skus.data : null;
  const precisionOf = (skuId: string): number | null => skuMap?.[skuId]?.uomPrecision ?? null;
  const tenantName = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.name ?? null,
    () => null,
  );
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );
  const canManage = roleHasCapability(role, 'returns.manage');
  const canDispatch = roleHasCapability(role, 'dispatch.execute');
  // Story 4-5a (A27) — package labels are a station print (labels.execute, the 2-10b precedent).
  const canPrintLabels = roleHasCapability(role, 'labels.execute');

  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ outcome: Outcome; hidden: string | null } | null>(null);

  const rows = list.state === 'ready' ? list.data.items : [];
  const columns: DataTableColumn<ClientReturnSummaryDto>[] = [
    {
      key: 'code',
      header: 'Return',
      render: (row) => (
        <button
          type="button"
          aria-expanded={expandedId === row.id}
          aria-controls={expandedRowId(row.id)}
          aria-label={`${expandedId === row.id ? 'Hide' : 'Show'} ${row.code}`}
          onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
          className="font-mono text-xs text-(--primary) underline underline-offset-2"
        >
          {row.code}
        </button>
      ),
    },
    ...(showClients(clients)
      ? [
          {
            key: 'client',
            header: 'Client',
            render: (row: ClientReturnSummaryDto) => clientCell(row.clientId, clients ?? [], tenantName),
          } satisfies DataTableColumn<ClientReturnSummaryDto>,
        ]
      : []),
    { key: 'sendTo', header: 'Send to', priority: 2, render: (row) => RTC_ADDRESS_LABEL[row.consigneeAddressKind] ?? row.consigneeAddressKind },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <StatusChip tone={clientReturnStatusTone(row.status)} data-testid={`rtc-status-${row.code}`}>
          {clientReturnStatusLabel(row.status)}
        </StatusChip>
      ),
    },
    { key: 'lineCount', header: 'Lines', numeric: true },
    { key: 'units', header: 'Units', numeric: true, render: (row) => summaryQuantityLabel(row) },
    {
      key: 'document',
      header: 'Document · AWB',
      priority: 2,
      render: (row) => {
        const label = summaryDocumentLabel(row);
        return label === null ? <span className="text-(--muted-foreground)">—</span> : <span className="font-mono text-xs">{label}</span>;
      },
    },
    { key: 'when', header: 'Last change (IST)', priority: 3, render: (row) => <span className="text-xs">{summaryWhenLabel(row)}</span> },
  ];

  return (
    <section className="flex flex-col gap-3 rounded-md border border-(--border) p-3 text-sm" data-testid="client-returns-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-medium">Returns to client</h2>
          <ClientFilterChip active={active} tenantName={active.tenantName} />
          <div className="max-w-3xl text-(--muted-foreground)">
            {`${warehouseLabel ?? 'This warehouse'} — returned and damaged units going back to their brand, newest first. Start one from Awaiting disposition (select the lines → Return to client), pick it on the handheld, dispatch it here with the brand's challan; the units leave at dispatch.`}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={list.reload} className={rowButtonClass}>
            Refresh
          </button>
          {canManage && !creating && (
            <button
              type="button"
              onClick={() => {
                setBanner(null);
                setCreating(true);
              }}
              className={primaryClass}
            >
              New return to client
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1 text-xs" role="tablist" aria-label="Return to client status">
        {[null, ...CLIENT_RETURN_STATUSES].map((option) => (
          <button
            key={option ?? 'all'}
            type="button"
            role="tab"
            aria-selected={status === option}
            onClick={() => setStatus(option)}
            className={`rounded-sm border border-(--border) px-2 py-1 ${status === option ? 'bg-(--muted) font-medium' : 'hover:bg-(--muted)'}`}
          >
            {option === null ? 'All' : CLIENT_RETURN_STATUS_FILTER_LABEL[option]}
          </button>
        ))}
      </div>

      {canManage && creating && (
        <ClientReturnCreateDialog
          warehouseId={warehouseId}
          warehouseLabel={warehouseLabel ?? 'this warehouse'}
          clientId={active.state === 'client' ? active.client.id : null}
          preselected={[]}
          clients={clients}
          tenantName={tenantName}
          precisionOf={precisionOf}
          onCancel={() => setCreating(false)}
          onCreated={(rtc) => {
            setCreating(false);
            setBanner({ outcome: rtcCreatedOutcome(rtc), hidden: hiddenByClientFilterNote(active, rtc.clientId, clients, tenantName) });
            setExpandedId(rtc.id);
            list.reload();
            notifyReturnsDisposed();
          }}
        />
      )}

      {banner !== null && (
        <div className="flex flex-col gap-1">
          <FeedbackBanner tone={banner.outcome.tone} word={banner.outcome.word} reason={banner.outcome.reason} />
          {banner.hidden !== null && <div className="text-xs text-(--muted-foreground)">{banner.hidden}</div>}
        </div>
      )}

      {list.state === 'failed' ? (
        <ReadFailure word="Returns to client unavailable" reason={list.reason} onRetry={list.reload} />
      ) : (
        <DataTable<ClientReturnSummaryDto>
          key={`${status ?? '*'}#${list.epoch}`}
          columns={columns}
          rows={rows}
          nextCursor={list.state === 'ready' ? list.data.nextCursor : null}
          onCursor={list.onCursor}
          renderExpanded={(row) =>
            expandedId === row.id ? (
              <ClientReturnDetail
                key={row.id}
                id={row.id}
                clients={clients}
                canManage={canManage}
                canDispatch={canDispatch}
                canPrintLabels={canPrintLabels}
                precisionOf={precisionOf}
                onOutcome={(outcome) => setBanner({ outcome, hidden: null })}
              />
            ) : null
          }
          rowNoun={{ one: 'return', many: 'returns' }}
          loading={list.state === 'loading' ? 'Loading returns to client…' : undefined}
          emptyMessage={
            status !== null ? (
              <EmptyState
                kind="filtered"
                action={
                  <button type="button" className={rowButtonClass} onClick={() => setStatus(null)}>
                    Show every status
                  </button>
                }
              >
                No {CLIENT_RETURN_STATUS_FILTER_LABEL[status].toLowerCase()} returns to client here.
              </EmptyState>
            ) : (
              <EmptyState kind="first-use">
                No returns to client yet.{canManage ? ' Select returned lines under Awaiting disposition and choose Return to client.' : ''}
              </EmptyState>
            )
          }
        />
      )}
    </section>
  );
}

/** The expanded row: the frozen brand and address, the lines, the stamps, the actions and the printable note. */
function ClientReturnDetail({
  id,
  clients,
  canManage,
  canDispatch,
  canPrintLabels = false,
  precisionOf,
  onOutcome,
}: {
  id: string;
  clients: readonly ClientDto[] | null;
  canManage: boolean;
  canDispatch: boolean;
  canPrintLabels?: boolean;
  precisionOf: (skuId: string) => number | null;
  onOutcome: (outcome: Outcome) => void;
}) {
  const detail = useClientReturn(id);
  const [mode, setMode] = useState<'view' | 'dispatch' | 'cancel' | 'labels'>('view');

  if (detail.state === 'loading') return <div className="text-xs text-(--muted-foreground)">Loading the return…</div>;
  if (detail.state === 'failed') return <ReadFailure word="Return not loaded" reason={detail.reason} onRetry={detail.reload} />;
  const rtc = detail.data;
  const offerDispatch = canDispatch && canDispatchClientReturn(rtc.status);
  const offerCancel = canManage && canCancelClientReturn(rtc.status);
  const offerLabels = canPrintLabels && canPrintPackageLabels(rtc.status);
  const clientStatus = clients?.find((entry) => entry.id === rtc.clientId)?.status ?? null;
  const address = rtc.consigneeAddress;

  return (
    <div className="flex flex-col gap-3 py-2 text-xs" data-testid={`rtc-detail-${rtc.code}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-medium">{rtc.code}</span>
          <StatusChip tone={clientReturnStatusTone(rtc.status)}>{clientReturnStatusLabel(rtc.status)}</StatusChip>
        </div>
        <div className="flex flex-wrap gap-2">
          {offerDispatch && mode !== 'dispatch' && (
            <button type="button" className={primaryClass} onClick={() => setMode('dispatch')}>
              Dispatch
            </button>
          )}
          {offerCancel && mode !== 'cancel' && (
            <button type="button" className={buttonClass} onClick={() => setMode('cancel')}>
              Cancel return
            </button>
          )}
          {offerLabels && mode !== 'labels' && (
            <button type="button" className={buttonClass} onClick={() => setMode('labels')} data-testid="rtc-package-labels">
              Print package labels
            </button>
          )}
          <button type="button" className={buttonClass} onClick={() => window.print()}>
            {rtc.status === 'dispatched' ? 'Print dispatch note' : rtc.status === 'cancelled' ? 'Print cancelled return' : 'Print pick list'}
          </button>
        </div>
      </div>

      {rtc.status === 'draft' && (
        <div role="status" className="rounded-sm border border-(--primary) bg-(--primary)/10 px-3 py-2 text-sm" data-testid="rtc-pick-guidance">
          {RTC_PICK_GUIDANCE}
        </div>
      )}
      {rtc.status === 'picked' && shortPickNotes(rtc).length > 0 && (
        <div role="status" className="rounded-sm border border-(--warning) bg-(--warning)/10 px-3 py-2 text-sm" data-testid="rtc-short-pick">
          Picked short. {shortPickNotes(rtc).join('. ')}.
        </div>
      )}

      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5" aria-label="Return details">
        <dt className="text-(--muted-foreground)">Brand</dt>
        <dd>
          {rtc.client.legalName ?? rtc.client.name} <span className="font-mono">({rtc.client.code})</span>
          {rtc.client.gstin === null ? ' · Unregistered' : ` · GSTIN ${rtc.client.gstin}`}
        </dd>
        <dt className="text-(--muted-foreground)">Send to</dt>
        <dd>
          {RTC_ADDRESS_LABEL[rtc.consigneeAddressKind]} — {[address.contactName, address.line1, address.line2, address.city, consigneeStateLabel(address), address.pincode].filter((part) => part !== null && part !== '').join(', ')}
        </dd>
        <dt className="text-(--muted-foreground)">Created</dt>
        <dd>{stampLabel(rtc.created)}</dd>
        <dt className="text-(--muted-foreground)">Picked</dt>
        <dd>{rtc.picked === null ? 'Not yet — on the handheld' : stampLabel(rtc.picked)}</dd>
        {rtc.dispatch !== null && (
          <>
            <dt className="text-(--muted-foreground)">Dispatched</dt>
            <dd>
              {stampLabel(rtc.dispatch)} · {BRAND_DOCUMENT_LABEL[rtc.dispatch.brandDocument.type]}{' '}
              <span className="font-mono">{rtc.dispatch.brandDocument.number}</span> ({formatIstDate(rtc.dispatch.brandDocument.date)}) ·{' '}
              <span className="data">{formatCount(rtc.dispatch.packageCount)}</span> package{rtc.dispatch.packageCount === 1 ? '' : 's'}
              {rtc.dispatch.trackingRef === null ? '' : ` · AWB/LR ${rtc.dispatch.trackingRef}`}
            </dd>
          </>
        )}
        {rtc.cancellation !== null && (
          <>
            <dt className="text-(--muted-foreground)">Cancelled</dt>
            <dd>
              {stampLabel(rtc.cancellation)} — {rtc.cancellation.reason}
            </dd>
          </>
        )}
        {rtc.note !== null && (
          <>
            <dt className="text-(--muted-foreground)">Note</dt>
            <dd>{rtc.note}</dd>
          </>
        )}
      </dl>

      <div className="overflow-x-auto rounded-sm border border-(--border)">
        <table className="w-full text-left text-xs" aria-label={`${rtc.code} lines`}>
          <thead className="bg-(--muted)">
            <tr>
              <th className="h-8 px-2 font-medium">SKU</th>
              <th className="px-2 font-medium">From</th>
              <th className="px-2 font-medium">Return · grade</th>
              <th className="px-2 font-medium">Batch · serial</th>
              <th className="px-2 font-medium">Reason</th>
              <th className="data px-2 text-right font-medium">Quantity</th>
              <th className="data px-2 text-right font-medium">Picked</th>
            </tr>
          </thead>
          <tbody>
            {rtc.lines.map((line) => (
              <tr key={line.id} className="border-t border-(--border)">
                <td className="px-2 py-1">
                  <span className="font-mono">{line.skuCode}</span> <span className="text-(--muted-foreground)">{line.skuName}</span>
                </td>
                <td className="px-2 py-1">{RTC_SOURCE_LABEL[line.source] ?? line.source}</td>
                <td className="px-2 py-1">
                  {line.rmaCode === null ? '—' : <span className="font-mono">{line.rmaCode}</span>}
                  {line.orderReference === null ? '' : ` · ${line.orderReference}`}
                  {line.condition === null ? '' : ` · ${RETURN_CONDITION_LABEL[line.condition] ?? line.condition}`}
                </td>
                <td className="px-2 py-1 font-mono">{[line.batchCode, line.serialNumber].filter((part) => part !== null).join(' · ') || '—'}</td>
                <td className="px-2 py-1">{rtcReasonWord(line.reasonCode)}</td>
                <td className="data px-2 py-1 text-right">
                  {lineQuantityLabel(line.quantity, precisionOf(line.skuId))} {line.uom}
                </td>
                <td className="data px-2 py-1 text-right">{line.pickedQuantity === null ? '—' : lineQuantityLabel(line.pickedQuantity, precisionOf(line.skuId))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {mode === 'labels' && offerLabels && (
        <PackageLabelsDialog
          kind="rtc"
          documentId={rtc.id}
          documentCode={rtc.code}
          dispatchedCount={rtc.dispatch?.packageCount ?? null}
          onClose={() => setMode('view')}
        />
      )}

      {mode === 'dispatch' && offerDispatch && (
        <ClientReturnDispatchDialog
          rtc={rtc}
          clientStatus={clientStatus}
          onClose={() => setMode('view')}
          onStale={() => notifyReturnsDisposed()}
          onDispatched={(dispatched) => {
            setMode('view');
            onOutcome(rtcDispatchedOutcome(dispatched));
            notifyReturnsDisposed();
          }}
        />
      )}

      {mode === 'cancel' && offerCancel && (
        <CancelConfirm
          rtc={rtc}
          onClose={() => setMode('view')}
          onCancelled={(cancelled) => {
            setMode('view');
            onOutcome(rtcCancelledOutcome(cancelled));
            notifyReturnsDisposed();
          }}
          onRejected={(reason, stale) => {
            onOutcome({ tone: 'rejected', word: 'Not cancelled', reason });
            if (stale) {
              setMode('view');
              notifyReturnsDisposed();
            }
          }}
        />
      )}

      <div className="flex flex-col gap-1">
        <span className="font-medium">
          {rtc.status === 'dispatched' ? 'Dispatch note' : rtc.status === 'cancelled' ? 'Cancelled — prints marked as not dispatched' : 'Pick list (prints as a draft)'}
        </span>
        <ClientReturnNote rtc={rtc} precisionOf={precisionOf} />
      </div>
    </div>
  );
}

/**
 * Cancel with a reason. The key lives with the confirmation: minted on its
 * first press, reused by every retry of it, cleared when the reason changes
 * (it is in the hash). A picked return's units are staged on the dock — the
 * confirmation says where each area's units go back (A11).
 */
function CancelConfirm({
  rtc,
  onClose,
  onCancelled,
  onRejected,
}: {
  rtc: ClientReturnDto;
  onClose: () => void;
  onCancelled: (rtc: ClientReturnDto) => void;
  onRejected: (reason: string, stale: boolean) => void;
}) {
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const keyRef = useRef<string | null>(null);

  async function confirm() {
    const session = readSession();
    if (session === null) {
      setProblem('Your session expired — sign in again.');
      return;
    }
    if (inFlight.current) return;
    const parsed = parseRtcCancelReason(reason);
    if (parsed.reason === null) {
      setProblem(parsed.problem);
      return;
    }
    const key = keyRef.current ?? ulid();
    keyRef.current = key;
    inFlight.current = true;
    setBusy(true);
    try {
      const cancelled = await fetchApiCancelClientReturn(session.tenant.id, rtc.id, parsed.reason, key);
      keyRef.current = null;
      onCancelled(cancelled);
    } catch (error) {
      onRejected(rtcReason(error, 'cancel'), rtcRefusalReloads(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div role="group" aria-label={`Cancel ${rtc.code}`} className="flex max-w-3xl flex-col gap-2 rounded-sm border border-(--destructive) bg-(--destructive)/5 p-3">
      <div className="text-sm" data-testid="rtc-cancel-sentence">
        {rtcCancelConfirmSentence(rtc)}
      </div>
      <input
        type="text"
        aria-label="Cancel reason"
        placeholder="Why (required)"
        maxLength={RTC_LIMITS.cancelReason}
        value={reason}
        disabled={busy}
        onChange={(event) => {
          setReason(event.target.value);
          setProblem(null);
          keyRef.current = null;
        }}
        className={inputClass}
      />
      {problem !== null && (
        <div role="alert" className="text-xs text-(--destructive)">
          {problem}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void confirm()} className={destructiveClass}>
          {busy ? 'Cancelling…' : 'Cancel this return'}
        </button>
        <button type="button" disabled={busy} onClick={onClose} className={buttonClass}>
          Keep it
        </button>
      </div>
    </div>
  );
}
