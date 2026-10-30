'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';

import { fetchApiDisposeReturn } from '@/lib/api/client';
import type { AwaitingDispositionDto, BinResponse, ReturnDispositionResultDto, SkuResponse } from '@/lib/api/generated';
import { clientFilterKey } from '@/lib/active-client';
import { istDateTimeLabel } from '@/lib/audit-exports';
import { readSession, subscribeSession } from '@/lib/auth';
import { clientCell, showClients } from '@/lib/clients';
import { limitSelectionToOneClient, rtcCreatedOutcome, rtcSelectable } from '@/lib/client-returns';
import {
  DISPOSITION_OUTCOME_HINT,
  DISPOSITION_OUTCOME_LABEL,
  DISPOSITION_OUTCOMES,
  DISPOSITION_REASON_LABEL,
  DISPOSITION_REASON_OPTIONS,
  MAX_DISPOSITION_NOTE_LENGTH,
  RETURN_CONDITION_LABEL,
  RETURNS_CHANGED_EVENT,
  awaitingCaptureText,
  dispositionActionLabel,
  dispositionHistoryText,
  dispositionOutcome,
  dispositionQuantity,
  dispositionReason,
  dispositionRefusalReloads,
  disposedWhole,
  emptyDispositionDraft,
  notifyReturnsDisposed,
  parseDisposition,
  quarantineUnavailable,
  restockTargetBins,
  returnAgeLabel,
  returnAgeNeedsAttention,
  scrapConfirmText,
  type AwaitingReturnLine,
  type DispositionDraft,
  type DispositionOutcome,
  type DispositionReasonCode,
  type ReturnCondition,
} from '@/lib/returns';
import { parseQuantityInput } from '@/lib/format-quantity';
import { useActiveClient } from '@/lib/use-active-client';
import { useWarehouseBins } from '@/lib/use-inventory';
import { useOutboundSkus } from '@/lib/use-outbound-orders';
import { useAwaitingReturns } from '@/lib/use-returns';
import type { UserRole } from '@/lib/users';
import { ulid } from '@/lib/ulid';
import type { ResourceState } from '@/lib/resource-state';

import { DataTable, expandedRowId, type DataTableColumn } from '@/components/data-table/data-table';
import { FeedbackBanner } from '@/components/feedback/banner';
import { ClientFilterChip } from '@/components/shared/client-filter-chip';
import { buttonClass, inputClass, primaryClass, ReadFailure, rowButtonClass, Section, selectClass } from '@/components/shared/surface';
import { ClientReturnCreateDialog } from '@/components/returns/client-return-create-dialog';

/** The destructive confirm (Scrap) — the destructive token, never a new hue. */
const destructiveClass =
  'rounded-md bg-(--destructive) px-3 py-2 text-sm font-medium text-(--destructive-foreground) hover:opacity-90 disabled:opacity-60';

/** Word-first condition chip: green outline for resaleable, amber for a damaged grade, neutral otherwise. */
const CONDITION_TONE: Readonly<Record<ReturnCondition, string>> = {
  resaleable: 'border-(--accent) bg-(--accent)/10',
  opened: 'border-(--border) bg-(--muted)',
  damaged: 'border-(--warning) bg-(--warning)/10',
  'missing-parts': 'border-(--warning) bg-(--warning)/10',
};

type QueueRow = AwaitingReturnLine & { readonly id: string };
type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string };

/**
 * Story 4-7a — the Returns page's "Awaiting disposition" tab: every received
 * return-receipt line of the warehouse that still has units in the Returns
 * bin, OLDEST first (the longest wait is the first row), with its RMA and
 * receipt, SKU, grade, captures, received / open / on-hold figures, how long
 * it has waited and what was decided on it before (A14). Every role reads it;
 * `returns.manage` gets Decide on each row — an inline panel under the row:
 * Restock (to a storage bin), Quarantine (a QC hold — not for a serial unit
 * or a returned case) or Scrap (with a reason, and an inline confirmation).
 * The Idempotency-Key is per draft: reused on a retry of the unchanged
 * draft, dropped on any edit and on success. A success shows the server's
 * answer, returns the queue to page one and fires the disposition event
 * (the RMA detail's epoch, A7). Refreshes on `RETURNS_CHANGED_EVENT`; no
 * polling.
 *
 * Story 4-7c (decision 14, A12) — `returns.manage` also selects lines (one
 * client's — the queue is one warehouse's; a returned case is not offered)
 * and **Return to client (n)** opens the create dialog with them preselected.
 */
export function AwaitingDispositions({
  tenantId,
  warehouseId,
  warehouseLabel,
  canManage,
}: {
  tenantId: string;
  warehouseId: string;
  warehouseLabel: string | null;
  canManage: boolean;
}) {
  const active = useActiveClient();
  const queue = useAwaitingReturns(warehouseId, active.filter);
  const skus = useOutboundSkus();
  const skuMap = skus.state === 'ready' ? skus.data : null;
  // Bins only for a role that can restock — nothing else on this tab reads them.
  const bins = useWarehouseBins(canManage ? warehouseId : null);
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );
  const clients = active.clients.state === 'ready' ? active.clients.data : null;
  // Read once at mount: a render-time Date.now() is impure (the house lint).
  const [now] = useState(() => Date.now());
  const [openId, setOpenId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // DataTable holds its Prev/Next cursor internally: a change returns the
  // queue to page one by remounting it.
  const [pageEpoch, setPageEpoch] = useState(0);
  const trigger = useRef<HTMLButtonElement | null>(null);
  // Story 4-7c — the selection for a return to client, and the lines the open dialog was started with.
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [returning, setReturning] = useState<readonly AwaitingDispositionDto[] | null>(null);

  const { onCursor } = queue;
  useEffect(() => {
    const onChange = () => {
      onCursor(null);
      setPageEpoch((epoch) => epoch + 1);
    };
    window.addEventListener(RETURNS_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(RETURNS_CHANGED_EVENT, onChange);
  }, [onCursor]);

  const rows: QueueRow[] = queue.state === 'ready' ? queue.data.items.map((line) => ({ ...line, id: line.receiptLineId })) : [];
  // A panel whose row left the page (decided elsewhere, paged away, refreshed
  // off) is closed — never kept hidden to reappear with a stale draft and
  // key. A guarded set-state during render, not an effect.
  if (openId !== null && queue.state === 'ready' && !rows.some((row) => row.id === openId)) {
    setOpenId(null);
  }

  // A12 — one client per return: once a line is selected, only that client's lines can join it.
  const selectedClient = rows.find((row) => selected.has(row.id))?.clientId ?? null;

  const skuOf = (line: AwaitingReturnLine): SkuResponse | null => skuMap?.[line.skuId] ?? null;
  const precisionOf = (line: AwaitingReturnLine): number | null => skuOf(line)?.uomPrecision ?? null;
  const qty = (line: AwaitingReturnLine, value: number) => dispositionQuantity(value, line.uom, precisionOf(line));

  const columns: readonly DataTableColumn<QueueRow>[] = [
    {
      key: 'return',
      header: 'Return',
      render: (row) => (
        <div className="flex flex-col">
          <span className="font-mono text-xs">{row.rmaCode}</span>
          <span className="text-xs text-(--muted-foreground)">
            <span className="font-mono">{row.receiptCode}</span>
            {row.orderReference !== null && <> · {row.orderReference}</>}
          </span>
        </div>
      ),
    },
    {
      key: 'sku',
      header: 'SKU',
      render: (row) => (
        <div className="flex flex-col">
          <span className="font-mono text-xs">{row.skuCode}</span>
          <span className="max-w-56 truncate text-xs text-(--muted-foreground)" title={row.skuName}>
            {row.skuName}
          </span>
        </div>
      ),
    },
    ...(showClients(clients)
      ? [
          {
            key: 'client',
            header: 'Client',
            render: (row: QueueRow) => <span className="text-xs">{clientCell(row.clientId, clients ?? [], active.tenantName)}</span>,
          } satisfies DataTableColumn<QueueRow>,
        ]
      : []),
    {
      key: 'condition',
      header: 'Received as',
      render: (row) => (
        <div className="flex flex-col items-start gap-0.5">
          <span className={`rounded-full border px-2 py-0.5 text-xs text-(--foreground) ${CONDITION_TONE[row.condition] ?? ''}`}>
            {RETURN_CONDITION_LABEL[row.condition] ?? row.condition}
          </span>
          {row.note !== null && (
            <span className="max-w-48 truncate text-xs text-(--muted-foreground)" title={row.note}>
              “{row.note}”
            </span>
          )}
        </div>
      ),
    },
    { key: 'capture', header: 'Batch · serial', render: (row) => <span className="font-mono text-xs">{awaitingCaptureText(row)}</span> },
    { key: 'received', header: 'Received', numeric: true, render: (row) => qty(row, row.receivedQty) },
    { key: 'open', header: 'Open', numeric: true, render: (row) => <span className="font-medium">{qty(row, row.openQty)}</span> },
    {
      key: 'onHold',
      header: 'On hold',
      numeric: true,
      render: (row) => (row.onHoldQty > 0 ? qty(row, row.onHoldQty) : <span className="text-(--muted-foreground)">—</span>),
    },
    {
      key: 'age',
      header: 'Waiting',
      render: (row) => {
        const label = returnAgeLabel(row.receivedAt, now);
        const title = `Received ${istDateTimeLabel(row.receivedAt)} IST`;
        return returnAgeNeedsAttention(row.receivedAt, now) ? (
          <span title={title} className="inline-flex items-center gap-1 rounded-full border border-(--warning) bg-(--warning)/10 px-2 py-0.5 text-xs text-(--foreground)">
            <span aria-hidden>⚠</span>
            {label}
          </span>
        ) : (
          <time dateTime={row.receivedAt} title={title} className="text-xs">
            {label}
          </time>
        );
      },
    },
    {
      key: 'history',
      header: 'History',
      render: (row) => {
        const text = dispositionHistoryText(row);
        return text === null ? <span className="text-(--muted-foreground)">—</span> : <span className="text-xs">{text}</span>;
      },
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: '',
            render: (row: QueueRow) => (
              <div className="flex justify-end">
                <button
                  type="button"
                  aria-expanded={openId === row.id}
                  aria-controls={openId === row.id ? expandedRowId(row.id) : undefined}
                  aria-label={`${openId === row.id ? 'Close' : 'Decide'} ${row.skuCode} on ${row.rmaCode}`}
                  onClick={(event) => {
                    trigger.current = event.currentTarget;
                    setOutcome(null);
                    setOpenId((id) => (id === row.id ? null : row.id));
                  }}
                  className={rowButtonClass}
                >
                  {openId === row.id ? 'Close' : 'Decide'}
                </button>
              </div>
            ),
          } satisfies DataTableColumn<QueueRow>,
        ]
      : []),
  ];

  const scopeWords = warehouseLabel === null ? 'this warehouse' : warehouseLabel;
  const emptyMessage =
    queue.state === 'loading'
      ? 'Loading returns awaiting a decision…'
      : active.state === 'client'
        ? `Nothing awaits a decision for ${active.client.code} in ${scopeWords} — every returned unit is restocked, quarantined or scrapped.`
        : `Nothing awaits a decision in ${scopeWords} — every returned unit is restocked, quarantined or scrapped.`;

  return (
    <Section title="Awaiting disposition">
      <div className="max-w-3xl text-(--muted-foreground)">
        {`${warehouseLabel === null ? 'Returned units' : `${warehouseLabel} — returned units`} still in the Returns bin, longest wait first. `}
        {canManage
          ? 'Decide each one: restock it to a storage bin, quarantine it for QC, or scrap it — or select lines of one client and send them back to it (Return to client).'
          : 'An owner or operations manager decides each one: restock, quarantine or scrap.'}
      </div>
      <ClientFilterChip active={active} tenantName={active.tenantName} />
      {outcome !== null && <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />}
      {canManage && returning !== null && returning.length > 0 && (
        <ClientReturnCreateDialog
          warehouseId={warehouseId}
          warehouseLabel={warehouseLabel ?? 'this warehouse'}
          clientId={returning[0]!.clientId}
          preselected={returning}
          clients={clients}
          tenantName={active.tenantName}
          precisionOf={(skuId) => skuMap?.[skuId]?.uomPrecision ?? null}
          onCancel={() => setReturning(null)}
          onCreated={(rtc) => {
            setReturning(null);
            setSelected(new Set());
            const created = rtcCreatedOutcome(rtc);
            setOutcome({ tone: 'accepted', word: created.word, reason: `${created.reason} Find it under the To client tab.` });
            // The claimed lines leave the queue (their open quantity fell); an open RMA's split moves.
            notifyReturnsDisposed();
          }}
        />
      )}
      {queue.state === 'failed' ? (
        <ReadFailure word="Returns awaiting a decision unavailable" reason={queue.reason} onRetry={queue.reload} />
      ) : (
        <DataTable<QueueRow>
          key={`${pageEpoch}|${clientFilterKey(active.filter)}`}
          columns={columns}
          rows={rows}
          nextCursor={queue.state === 'ready' ? queue.data.nextCursor : null}
          onCursor={queue.onCursor}
          emptyMessage={emptyMessage}
          selection={
            canManage
              ? {
                  selected,
                  onChange: (next) => setSelected(limitSelectionToOneClient(rows, selected, next)),
                  canSelect: (row) => rtcSelectable(row) && (selectedClient === null || row.clientId === selectedClient),
                  rowLabel: (row) => `Select ${row.skuCode} on ${row.rmaCode}`,
                  noun: { one: 'line', many: 'lines' },
                  busy: returning !== null,
                  actions: (
                    <button
                      type="button"
                      className={`${primaryClass} py-1`}
                      onClick={() => {
                        setOutcome(null);
                        setReturning(rows.filter((row) => selected.has(row.id)));
                      }}
                    >
                      Return to client ({rows.filter((row) => selected.has(row.id)).length})
                    </button>
                  ),
                }
              : undefined
          }
          renderExpanded={(row) =>
            canManage && row.id === openId ? (
              <DispositionPanel
                key={row.id}
                tenantId={tenantId}
                warehouseId={warehouseId}
                line={row}
                sku={skuOf(row)}
                bins={bins}
                role={role}
                onCancel={() => {
                  setOpenId(null);
                  trigger.current?.focus();
                }}
                onDone={(result, binLabel) => {
                  setOpenId(null);
                  setOutcome({ tone: 'accepted', ...dispositionOutcome(result, row, binLabel, precisionOf(row)) });
                  // The queue, the authorizations list and an open RMA detail re-read (A7).
                  notifyReturnsDisposed();
                }}
                onLineMoved={(reason) => {
                  // The line moved on: the refusal is said above the queue (the
                  // panel closes — its draft was for figures that no longer hold).
                  setOpenId(null);
                  setOutcome({ tone: 'rejected', word: 'Not recorded', reason });
                  // Back to page one with a fresh cursor stack (the RETURNS_CHANGED reset).
                  onCursor(null);
                  setPageEpoch((epoch) => epoch + 1);
                  queue.reload();
                }}
              />
            ) : null
          }
        />
      )}
    </Section>
  );
}

/**
 * One line's decision, under its row. Mounted keyed by the line, so a new
 * line is a new draft and a new key.
 */
function DispositionPanel({
  tenantId,
  warehouseId,
  line,
  sku,
  bins,
  role,
  onCancel,
  onDone,
  onLineMoved,
}: {
  tenantId: string;
  warehouseId: string;
  line: AwaitingReturnLine;
  sku: SkuResponse | null;
  bins: ResourceState<readonly BinResponse[]> & { reload: () => void };
  role: UserRole | undefined;
  onCancel: () => void;
  onDone: (result: ReturnDispositionResultDto, binLabel: string | null) => void;
  onLineMoved: (reason: string) => void;
}) {
  const precision = sku?.uomPrecision ?? null;
  const [draft, setDraft] = useState<DispositionDraft>(() => emptyDispositionDraft(line, precision));
  const [problem, setProblem] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  // Per draft: minted on the first send, reused by a retry of the unchanged
  // draft (a send whose answer was lost replays instead of recording twice),
  // dropped on any edit (every field is in the server's hash) and on success.
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);
  const ids = useId();

  const whole = disposedWhole(line);
  const noQuarantine = quarantineUnavailable(line);
  const targets = bins.state === 'ready' ? restockTargetBins(bins.data, sku, line.clientId, role) : [];
  const binLabel = (id: string) => (bins.state === 'ready' ? (bins.data.find((bin) => bin.id === id)?.code ?? null) : null);
  const typed = whole ? line.openQty : parseQuantityInput(draft.qty.trim());
  const quantityText = typed === null || typed <= 0 ? null : dispositionQuantity(typed, line.uom, precision);
  const reasonWord = draft.reasonCode === '' ? '' : draft.reasonCode === 'other' ? 'Other' : DISPOSITION_REASON_LABEL[draft.reasonCode];

  function edit(patch: Partial<DispositionDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    keyRef.current = null;
    setProblem(null);
    setRefusal(null);
    setConfirming(false);
  }

  async function submit() {
    if (inFlight.current) return;
    const parsed = parseDisposition(draft, line, warehouseId, precision);
    if (parsed.body === null) {
      setProblem(parsed.problem);
      return;
    }
    // A write-off asks once more, inline — never a modal.
    if (draft.outcome === 'scrap' && !confirming) {
      setConfirming(true);
      return;
    }
    // The synchronous ref stops a double-click sending twice.
    inFlight.current = true;
    keyRef.current ??= ulid();
    setBusy(true);
    setRefusal(null);
    try {
      const result = await fetchApiDisposeReturn(tenantId, parsed.body, keyRef.current);
      keyRef.current = null;
      onDone(result, draft.outcome === 'restock' ? binLabel(draft.toBinId) : null);
    } catch (error) {
      const reason = dispositionReason(error, line.uom);
      setConfirming(false);
      // The line itself moved on (decided elsewhere, gone): re-read the queue; a new attempt is a new intent.
      if (dispositionRefusalReloads(error)) {
        keyRef.current = null;
        onLineMoved(reason);
      } else {
        setRefusal(reason);
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const outcomeName = `${ids}-outcome`;
  return (
    <div role="group" aria-label={`Decide ${line.skuCode} on ${line.rmaCode}`} className="flex max-w-3xl flex-col gap-3 py-2">
      <fieldset disabled={busy} className="flex flex-col gap-3">
        <fieldset className="flex flex-col gap-1.5">
          <legend className="pb-1 text-xs font-medium">What happens to {quantityText === null ? 'these units' : quantityText}?</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {DISPOSITION_OUTCOMES.map((option: DispositionOutcome) => {
              const disabledReason = option === 'quarantine' ? noQuarantine : null;
              const checked = draft.outcome === option;
              return (
                <label
                  key={option}
                  className={`flex cursor-pointer flex-col gap-0.5 rounded-md border p-2.5 text-xs ${
                    checked ? 'border-(--primary) bg-(--primary)/5' : 'border-(--border) hover:bg-(--muted)'
                  } ${disabledReason !== null ? 'cursor-not-allowed opacity-60' : ''}`}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="radio"
                      name={outcomeName}
                      value={option}
                      checked={checked}
                      disabled={disabledReason !== null}
                      aria-describedby={`${ids}-${option}-hint`}
                      onChange={() => edit({ outcome: option })}
                    />
                    {DISPOSITION_OUTCOME_LABEL[option]}
                  </span>
                  <span id={`${ids}-${option}-hint`} className="text-(--muted-foreground)">
                    {disabledReason ?? DISPOSITION_OUTCOME_HINT[option]}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {draft.outcome !== '' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={`${ids}-qty`} className="text-xs font-medium">
                Quantity
              </label>
              {whole ? (
                <div id={`${ids}-qty`} className="text-sm">
                  {dispositionQuantity(line.openQty, line.uom, precision)}
                  <span className="text-xs text-(--muted-foreground)">
                    {' '}
                    — {line.serialNumber !== null ? 'a serial unit' : 'a returned case'} is decided whole
                  </span>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <input
                      id={`${ids}-qty`}
                      aria-label="Quantity"
                      inputMode="decimal"
                      value={draft.qty}
                      onChange={(e) => edit({ qty: e.target.value })}
                      aria-describedby={`${ids}-qty-hint`}
                      className={`${inputClass} w-32 py-1`}
                    />
                    <span className="text-xs text-(--muted-foreground)">{line.uom}</span>
                  </div>
                  <span id={`${ids}-qty-hint`} className="text-xs text-(--muted-foreground)">
                    of {dispositionQuantity(line.openQty, line.uom, precision)} open — split a line across outcomes by deciding part of it
                  </span>
                </>
              )}
            </div>

            {draft.outcome === 'restock' ? (
              <div className="flex flex-col gap-1">
                <label htmlFor={`${ids}-bin`} className="text-xs font-medium">
                  Storage bin
                </label>
                {bins.state === 'failed' ? (
                  <ReadFailure word="Bins unavailable" reason={bins.reason} onRetry={bins.reload} />
                ) : (
                  <select
                    id={`${ids}-bin`}
                    aria-label="Storage bin"
                    value={draft.toBinId}
                    disabled={bins.state !== 'ready' || targets.length === 0}
                    onChange={(e) => edit({ toBinId: e.target.value })}
                    className={`${selectClass} py-1`}
                  >
                    <option value="">
                      {bins.state !== 'ready' ? 'Loading bins…' : targets.length === 0 ? 'No storage bin can take it' : 'Pick a bin'}
                    </option>
                    {targets.map((bin) => (
                      <option key={bin.id} value={bin.id}>
                        {bin.code}
                        {bin.storageClass !== 'ambient' ? ` · ${bin.storageClass}` : ''}
                        {bin.dedicatedClientId !== null ? ' · dedicated' : ''}
                      </option>
                    ))}
                  </select>
                )}
                <span className="text-xs text-(--muted-foreground)">
                  {bins.state === 'ready' && targets.length === 0
                    ? 'No active storage bin suits this SKU and client — add or unblock one under Settings → Warehouses.'
                    : 'Storage bins that suit this SKU and client. The warehouse checks room and segregation when you restock.'}
                </span>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <label htmlFor={`${ids}-reason`} className="text-xs font-medium">
                    Reason
                  </label>
                  <select
                    id={`${ids}-reason`}
                    aria-label="Reason"
                    value={draft.reasonCode}
                    onChange={(e) => edit({ reasonCode: e.target.value as DispositionReasonCode | '' })}
                    className={`${selectClass} py-1`}
                  >
                    <option value="">Pick a reason</option>
                    {DISPOSITION_REASON_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor={`${ids}-note`} className="text-xs font-medium">
                    Note <span className="font-normal text-(--muted-foreground)">{draft.reasonCode === 'other' ? '(required)' : '(optional)'}</span>
                  </label>
                  <input
                    id={`${ids}-note`}
                    aria-label="Note"
                    maxLength={MAX_DISPOSITION_NOTE_LENGTH}
                    value={draft.note}
                    onChange={(e) => edit({ note: e.target.value })}
                    className={`${inputClass} py-1`}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </fieldset>

      {problem !== null && (
        <div role="alert" className="text-xs text-(--destructive)">
          {problem}
        </div>
      )}
      {refusal !== null && <FeedbackBanner tone="rejected" word="Not recorded" reason={refusal} />}

      {confirming && draft.outcome === 'scrap' ? (
        <div role="group" aria-label="Confirm scrap" className="flex flex-col gap-2 rounded-sm border border-(--destructive) bg-(--destructive)/10 p-3">
          <div className="text-sm">{scrapConfirmText(line, quantityText ?? 'these units', reasonWord)}</div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void submit()} className={destructiveClass}>
              {busy ? 'Scrapping…' : 'Confirm scrap'}
            </button>
            <button type="button" disabled={busy} onClick={() => setConfirming(false)} className={buttonClass}>
              Back
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => void submit()} className={primaryClass}>
            {busy ? 'Recording…' : dispositionActionLabel(draft.outcome, quantityText)}
          </button>
          <button type="button" disabled={busy} onClick={onCancel} className={buttonClass}>
            Discard
          </button>
        </div>
      )}
    </div>
  );
}
