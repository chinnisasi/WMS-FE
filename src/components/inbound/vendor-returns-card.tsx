'use client';

import { useRef, useState, useSyncExternalStore } from 'react';

import { fetchApiCancelVendorReturn } from '@/lib/api/client';
import type { VendorReturnDto, VendorReturnSummaryDto } from '@/lib/api/generated';
import { hiddenByClientFilterNote } from '@/lib/active-client';
import { notifyInboundChanged } from '@/lib/asns';
import { readSession, subscribeSession } from '@/lib/auth';
import { clientCell, showClients } from '@/lib/clients';
import { formatCount } from '@/lib/format-quantity';
import { formatIstDate, istDateOf } from '@/lib/rate-cards';
import { ulid } from '@/lib/ulid';
import type { ActiveClientState } from '@/lib/use-active-client';
import { readyClients } from '@/lib/use-clients';
import { useSkuMap } from '@/lib/use-inbound';
import { useVendorReturn, useVendorReturns } from '@/lib/use-vendor-returns';
import { roleHasCapability } from '@/lib/users';
import {
  BRAND_DOCUMENT_LABEL,
  CONSIGNEE_ADDRESS_LABEL,
  RTV_LIMITS,
  RTV_PICK_GUIDANCE,
  RTV_REASON_LABEL,
  VENDOR_RETURN_STATUSES,
  VENDOR_RETURN_STATUS_FILTER_LABEL,
  cancelConfirmSentence,
  cancelledOutcome,
  canCancelVendorReturn,
  canDispatchVendorReturn,
  createdOutcome,
  dispatchedOutcome,
  lineQuantityLabel,
  parseCancelReason,
  rtvReason,
  rtvRefusalReloads,
  stampLabel,
  summaryQuantityLabel,
  summaryWhenLabel,
  vendorReturnStatusLabel,
  vendorReturnStatusTone,
  type VendorReturnStatus,
} from '@/lib/vendor-returns';

import { DataTable, expandedRowId, type DataTableColumn } from '@/components/data-table/data-table';
import { FeedbackBanner } from '@/components/feedback/banner';
import { VendorReturnCreateDialog } from '@/components/inbound/vendor-return-create-dialog';
import { VendorReturnDispatchDialog } from '@/components/inbound/vendor-return-dispatch-dialog';
import { canPrintPackageLabels, PackageLabelsDialog } from '@/components/shared/package-labels-dialog';
import { VendorReturnNote } from '@/components/inbound/vendor-return-note';
import { ClientFilterChip } from '@/components/shared/client-filter-chip';
import { EmptyState } from '@/components/shared/empty-state';
import { StatusChip } from '@/components/shared/status-chip';
import { ReadFailure, buttonClass, destructiveClass, inputClass, primaryClass, rowButtonClass } from '@/components/shared/surface';

/**
 * Story 2-8b — Inbound → Returns to vendor: the active warehouse's returns
 * to vendor, newest first, under a status filter and the active-client
 * filter. Every staff role reads the list and the detail; **New return to
 * vendor** and Cancel are `rtv.manage`'s (owner, ops manager), **Dispatch**
 * is `dispatch.execute`'s and is offered on a picked return only; Print
 * works on any (a draft prints as a pick list under the draft watermark).
 * The pick happens on the handheld (Returns out tab) — a draft says so.
 *
 * The open form, the expanded row, the confirmation and the banner belong to
 * ONE warehouse (keyed derivation, guide §1.5). Every mutation fires
 * `notifyInboundChanged()` — the list, the open detail and the tab count
 * re-read; a create returns the list to page one.
 */

type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string };

export function VendorReturnsCard({
  active,
  warehouseId,
  warehouseLabel,
}: {
  active: ActiveClientState;
  warehouseId: string | null;
  warehouseLabel: string | null;
}) {
  const [status, setStatus] = useState<VendorReturnStatus | null>(null);
  const list = useVendorReturns(warehouseId, status, active.filter);
  const clients = readyClients(active.clients);
  const tenantName = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.name ?? null,
    () => null,
  );
  // The role through the subscription (the /me bootstrap rewrites it after mount).
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );
  const canManage = roleHasCapability(role, 'rtv.manage');
  const canDispatch = roleHasCapability(role, 'dispatch.execute');
  // Story 4-5a (A27) — package labels are a station print (labels.execute, the 2-10b precedent).
  const canPrintLabels = roleHasCapability(role, 'labels.execute');

  const [creatingFor, setCreatingFor] = useState<string | null>(null);
  const creating = creatingFor !== null && creatingFor === warehouseId;
  const [expandedFor, setExpandedFor] = useState<{ warehouseId: string; id: string } | null>(null);
  const expandedId = expandedFor !== null && expandedFor.warehouseId === warehouseId ? expandedFor.id : null;
  const [banner, setBanner] = useState<{ warehouseId: string; outcome: Outcome; hidden: string | null } | null>(null);
  const shownBanner = banner !== null && banner.warehouseId === warehouseId ? banner : null;

  function show(outcome: Outcome, hidden: string | null = null) {
    if (warehouseId !== null) setBanner({ warehouseId, outcome, hidden });
  }

  const rows = list.state === 'ready' ? list.data.items : [];
  const columns: DataTableColumn<VendorReturnSummaryDto>[] = [
    {
      key: 'code',
      header: 'Return',
      render: (row) => (
        <button
          type="button"
          aria-expanded={expandedId === row.id}
          aria-controls={expandedRowId(row.id)}
          aria-label={`${expandedId === row.id ? 'Hide' : 'Show'} ${row.code}`}
          onClick={() => warehouseId !== null && setExpandedFor(expandedId === row.id ? null : { warehouseId, id: row.id })}
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
            render: (row: VendorReturnSummaryDto) => clientCell(row.clientId, clients ?? [], tenantName),
          } satisfies DataTableColumn<VendorReturnSummaryDto>,
        ]
      : []),
    { key: 'vendor', header: 'Vendor', render: (row) => row.vendorName },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <StatusChip tone={vendorReturnStatusTone(row.status)} data-testid={`rtv-status-${row.code}`}>
          {vendorReturnStatusLabel(row.status)}
        </StatusChip>
      ),
    },
    { key: 'lineCount', header: 'Lines', numeric: true },
    { key: 'units', header: 'Units', numeric: true, render: (row) => summaryQuantityLabel(row) },
    {
      key: 'document',
      header: 'Document · AWB',
      priority: 2,
      render: (row) =>
        row.brandDocumentNumber === null ? (
          <span className="text-(--muted-foreground)">—</span>
        ) : (
          <span className="font-mono text-xs">
            {row.brandDocumentNumber}
            {row.trackingRef === null ? '' : ` · ${row.trackingRef}`}
          </span>
        ),
    },
    { key: 'when', header: 'Last change (IST)', priority: 3, render: (row) => <span className="text-xs">{summaryWhenLabel(row)}</span> },
  ];

  const renderExpanded = (row: VendorReturnSummaryDto) => {
    if (expandedId !== row.id || warehouseId === null) return null;
    return (
      <VendorReturnDetail
        key={`${warehouseId}|${row.id}`}
        id={row.id}
        canManage={canManage}
        canDispatch={canDispatch}
        canPrintLabels={canPrintLabels}
        onOutcome={(outcome) => show(outcome)}
      />
    );
  };

  return (
    <section className="flex flex-col gap-3 rounded-md border border-(--border) p-3 text-sm" data-testid="vendor-returns-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-medium">Returns to vendor</h2>
          <ClientFilterChip active={active} tenantName={active.tenantName} />
          <div className="text-(--muted-foreground)">
            {warehouseLabel === null
              ? 'Pick a warehouse to review its returns to vendor.'
              : `${warehouseLabel} — damaged units going back to their vendor, newest first. Created here, picked on the handheld, dispatched here with the brand's challan; the units leave DAMAGED at dispatch.`}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={list.reload} disabled={warehouseId === null} className={rowButtonClass}>
            Refresh
          </button>
          {canManage && warehouseId !== null && !creating && (
            <button
              type="button"
              onClick={() => {
                setBanner(null);
                setCreatingFor(warehouseId);
              }}
              className={primaryClass}
            >
              New return to vendor
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1 text-xs" role="tablist" aria-label="Return to vendor status">
        {[null, ...VENDOR_RETURN_STATUSES].map((option) => (
          <button
            key={option ?? 'all'}
            type="button"
            role="tab"
            aria-selected={status === option}
            onClick={() => setStatus(option)}
            className={`rounded-sm border border-(--border) px-2 py-1 ${status === option ? 'bg-(--muted) font-medium' : 'hover:bg-(--muted)'}`}
          >
            {option === null ? 'All' : VENDOR_RETURN_STATUS_FILTER_LABEL[option]}
          </button>
        ))}
      </div>

      {canManage && creating && warehouseId !== null && (
        <VendorReturnCreateDialog
          key={warehouseId}
          warehouseId={warehouseId}
          warehouseLabel={warehouseLabel ?? 'this warehouse'}
          active={active}
          tenantName={tenantName}
          onCancel={() => setCreatingFor(null)}
          onCreated={(rtv) => {
            setCreatingFor(null);
            show(createdOutcome(rtv), hiddenByClientFilterNote(active, rtv.clientId, clients, tenantName));
            setExpandedFor({ warehouseId, id: rtv.id });
            // Back to page one, remounting the table (the epoch joins its key).
            list.reload();
            notifyInboundChanged();
          }}
        />
      )}

      {shownBanner !== null && (
        <div className="flex flex-col gap-1">
          <FeedbackBanner tone={shownBanner.outcome.tone} word={shownBanner.outcome.word} reason={shownBanner.outcome.reason} />
          {shownBanner.hidden !== null && <div className="text-xs text-(--muted-foreground)">{shownBanner.hidden}</div>}
        </div>
      )}

      {list.state === 'failed' ? (
        <ReadFailure word="Returns to vendor unavailable" reason={list.reason} onRetry={list.reload} />
      ) : (
        <DataTable<VendorReturnSummaryDto>
          key={`${warehouseId ?? 'none'}|${status ?? '*'}#${list.epoch}`}
          columns={columns}
          rows={rows}
          nextCursor={list.state === 'ready' ? list.data.nextCursor : null}
          onCursor={list.onCursor}
          renderExpanded={renderExpanded}
          rowNoun={{ one: 'return', many: 'returns' }}
          loading={list.state === 'loading' ? 'Loading returns to vendor…' : undefined}
          emptyMessage={
            warehouseId === null ? (
              <EmptyState kind="first-use">Create a warehouse first.</EmptyState>
            ) : status !== null ? (
              <EmptyState
                kind="filtered"
                action={
                  <button type="button" className={rowButtonClass} onClick={() => setStatus(null)}>
                    Show every status
                  </button>
                }
              >
                No {VENDOR_RETURN_STATUS_FILTER_LABEL[status].toLowerCase()} returns to vendor here.
              </EmptyState>
            ) : (
              <EmptyState kind="first-use">
                No returns to vendor yet.{canManage ? ' Create one to send damaged units back to their vendor.' : ''}
              </EmptyState>
            )
          }
        />
      )}
    </section>
  );
}

/** The expanded row: the frozen parties and lines, the stamps, the actions and the printable note. */
function VendorReturnDetail({
  id,
  canManage,
  canDispatch,
  canPrintLabels = false,
  onOutcome,
}: {
  id: string;
  canManage: boolean;
  canDispatch: boolean;
  canPrintLabels?: boolean;
  onOutcome: (outcome: Outcome) => void;
}) {
  const detail = useVendorReturn(id);
  const skus = useSkuMap();
  const precisionOf = (skuId: string): number | null => skus?.[skuId]?.uomPrecision ?? null;
  const [mode, setMode] = useState<'view' | 'dispatch' | 'cancel' | 'labels'>('view');

  if (detail.state === 'loading') return <div className="text-xs text-(--muted-foreground)">Loading the return…</div>;
  if (detail.state === 'failed') return <ReadFailure word="Return not loaded" reason={detail.reason} onRetry={detail.reload} />;
  const rtv = detail.data;
  const offerDispatch = canDispatch && canDispatchVendorReturn(rtv.status);
  const offerCancel = canManage && canCancelVendorReturn(rtv.status);
  const offerLabels = canPrintLabels && canPrintPackageLabels(rtv.status);
  const p = (skuId: string) => precisionOf(skuId);

  return (
    <div className="flex flex-col gap-3 py-2 text-xs" data-testid={`rtv-detail-${rtv.code}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-medium">{rtv.code}</span>
          <StatusChip tone={vendorReturnStatusTone(rtv.status)}>{vendorReturnStatusLabel(rtv.status)}</StatusChip>
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
            <button type="button" className={buttonClass} onClick={() => setMode('labels')} data-testid="rtv-package-labels">
              Print package labels
            </button>
          )}
          <button type="button" className={buttonClass} onClick={() => window.print()}>
            {rtv.status === 'dispatched' ? 'Print dispatch note' : rtv.status === 'cancelled' ? 'Print cancelled return' : 'Print pick list'}
          </button>
        </div>
      </div>

      {rtv.status === 'draft' && (
        <div role="status" className="rounded-sm border border-(--primary) bg-(--primary)/10 px-3 py-2 text-sm" data-testid="rtv-pick-guidance">
          {RTV_PICK_GUIDANCE}
        </div>
      )}

      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5" aria-label="Return details">
        <dt className="text-(--muted-foreground)">Vendor</dt>
        <dd>
          {rtv.vendor.name} <span className="font-mono">({rtv.vendor.code})</span> · {CONSIGNEE_ADDRESS_LABEL[rtv.consigneeAddressKind]}
        </dd>
        <dt className="text-(--muted-foreground)">Brand</dt>
        <dd>{rtv.client.legalName ?? rtv.client.name}</dd>
        <dt className="text-(--muted-foreground)">Created</dt>
        <dd>{stampLabel(rtv.created)}</dd>
        <dt className="text-(--muted-foreground)">Picked</dt>
        <dd>{rtv.picked === null ? 'Not yet — on the handheld' : stampLabel(rtv.picked)}</dd>
        {rtv.dispatch !== null && (
          <>
            <dt className="text-(--muted-foreground)">Dispatched</dt>
            <dd>
              {stampLabel(rtv.dispatch)} · {BRAND_DOCUMENT_LABEL[rtv.dispatch.brandDocument.type]}{' '}
              <span className="font-mono">{rtv.dispatch.brandDocument.number}</span> ({formatIstDate(rtv.dispatch.brandDocument.date)}) ·{' '}
              <span className="data">{formatCount(rtv.dispatch.packageCount)}</span> package{rtv.dispatch.packageCount === 1 ? '' : 's'}
              {rtv.dispatch.trackingRef === null ? '' : ` · AWB/LR ${rtv.dispatch.trackingRef}`}
            </dd>
          </>
        )}
        {rtv.cancellation !== null && (
          <>
            <dt className="text-(--muted-foreground)">Cancelled</dt>
            <dd>
              {stampLabel(rtv.cancellation)} — {rtv.cancellation.reason}
            </dd>
          </>
        )}
        {rtv.note !== null && (
          <>
            <dt className="text-(--muted-foreground)">Note</dt>
            <dd>{rtv.note}</dd>
          </>
        )}
      </dl>

      <div className="overflow-x-auto rounded-sm border border-(--border)">
        <table className="w-full text-left text-xs" aria-label={`${rtv.code} lines`}>
          <thead className="bg-(--muted)">
            <tr>
              <th className="h-8 px-2 font-medium">SKU</th>
              <th className="px-2 font-medium">Batch · expiry</th>
              <th className="px-2 font-medium">Reason</th>
              <th className="px-2 font-medium">Source</th>
              <th className="data px-2 text-right font-medium">Quantity</th>
              <th className="data px-2 text-right font-medium">Picked</th>
            </tr>
          </thead>
          <tbody>
            {rtv.lines.map((line) => (
              <tr key={line.id} className="border-t border-(--border)">
                <td className="px-2 py-1">
                  <span className="font-mono">{line.skuCode}</span> <span className="text-(--muted-foreground)">{line.skuName}</span>
                </td>
                <td className="px-2 py-1">
                  <span className="font-mono">{line.batchCode ?? '—'}</span>
                  {line.batchExpiry === null ? '' : ` · exp ${formatIstDate(istDateOf(line.batchExpiry))}`}
                </td>
                <td className="px-2 py-1">{RTV_REASON_LABEL[line.reasonCode] ?? line.reasonCode}</td>
                <td className="px-2 py-1 font-mono">
                  {line.source === null ? '—' : `${line.source.grnCode ?? 'GRN'}${line.source.poCode === null ? '' : ` · ${line.source.poCode}`}`}
                </td>
                <td className="data px-2 py-1 text-right">
                  {lineQuantityLabel(line.quantity, p(line.skuId))} {line.uom}
                </td>
                <td className="data px-2 py-1 text-right">{line.pickedQuantity === null ? '—' : lineQuantityLabel(line.pickedQuantity, p(line.skuId))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {mode === 'labels' && offerLabels && (
        <PackageLabelsDialog
          kind="rtv"
          documentId={rtv.id}
          documentCode={rtv.code}
          dispatchedCount={rtv.dispatch?.packageCount ?? null}
          onClose={() => setMode('view')}
        />
      )}

      {mode === 'dispatch' && offerDispatch && (
        <VendorReturnDispatchDialog
          rtv={rtv}
          onClose={() => setMode('view')}
          onStale={() => notifyInboundChanged()}
          onDispatched={(dispatched) => {
            setMode('view');
            onOutcome(dispatchedOutcome(dispatched));
            notifyInboundChanged();
          }}
        />
      )}

      {mode === 'cancel' && offerCancel && (
        <CancelConfirm
          rtv={rtv}
          onClose={() => setMode('view')}
          onCancelled={(cancelled) => {
            setMode('view');
            onOutcome(cancelledOutcome(cancelled));
            notifyInboundChanged();
          }}
          onRejected={(reason, stale) => {
            onOutcome({ tone: 'rejected', word: 'Not cancelled', reason });
            if (stale) {
              setMode('view');
              notifyInboundChanged();
            }
          }}
        />
      )}

      <div className="flex flex-col gap-1">
        <span className="font-medium">{rtv.status === 'dispatched' ? 'Dispatch note' : rtv.status === 'cancelled' ? 'Cancelled — prints marked as not dispatched' : 'Pick list (prints as a draft)'}</span>
        <VendorReturnNote rtv={rtv} precisionOf={precisionOf} />
      </div>
    </div>
  );
}

/**
 * Cancel with a reason. The key lives with the confirmation: minted on its
 * first press, reused by every retry of it, cleared when the reason changes
 * (it is in the hash). A picked return's units are staged on the dock — the
 * confirmation says where they go back (A16).
 */
function CancelConfirm({
  rtv,
  onClose,
  onCancelled,
  onRejected,
}: {
  rtv: VendorReturnDto;
  onClose: () => void;
  onCancelled: (rtv: VendorReturnDto) => void;
  onRejected: (reason: string, stale: boolean) => void;
}) {
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const keyRef = useRef<string | null>(null);

  async function confirm() {
    const session = readSession();
    if (session === null || inFlight.current) return;
    const parsed = parseCancelReason(reason);
    if (parsed.reason === null) {
      setProblem(parsed.problem);
      return;
    }
    const key = keyRef.current ?? ulid();
    keyRef.current = key;
    inFlight.current = true;
    setBusy(true);
    try {
      const cancelled = await fetchApiCancelVendorReturn(session.tenant.id, rtv.id, parsed.reason, key);
      keyRef.current = null;
      onCancelled(cancelled);
    } catch (error) {
      onRejected(rtvReason(error, 'cancel'), rtvRefusalReloads(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div role="group" aria-label={`Cancel ${rtv.code}`} className="flex max-w-3xl flex-col gap-2 rounded-sm border border-(--destructive) bg-(--destructive)/5 p-3">
      <div className="text-sm" data-testid="rtv-cancel-sentence">
        {cancelConfirmSentence(rtv)}
      </div>
      <input
        type="text"
        aria-label="Cancel reason"
        placeholder="Why (required)"
        maxLength={RTV_LIMITS.cancelReason}
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
