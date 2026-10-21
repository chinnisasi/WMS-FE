'use client';

import { useRef, useState, useSyncExternalStore } from 'react';

import { fetchApiGateOutGateIn, fetchApiUnloadGateIn } from '@/lib/api/client';
import type { ClientDto, GateInDetailDto, GateInDto, GateInEntryDto } from '@/lib/api/generated';
import { notifyInboundChanged } from '@/lib/asns';
import { readSession, subscribeSession } from '@/lib/auth';
import { istDateTimeLabel } from '@/lib/audit-exports';
import {
  DOCUMENT_KIND_LABEL,
  GATE_IN_ALL_CLIENTS_NOTE,
  GATE_IN_REFRESH_NOTE,
  GATE_IN_STATUS_LABEL,
  SEAL_STATUS_LABEL,
  confirmQuestion,
  gateInActions,
  gateInClientName,
  gateInReason,
  gateOutOutcome,
  actionInstant,
  istLocalNow,
  istTimeLabel,
  packagesLabel,
  parseActionDraft,
  savedOutcome,
  unloadOutcome,
  vehicleLabel,
  type GateInAction,
} from '@/lib/gate-ins';
import type { ActiveClientState } from '@/lib/use-active-client';
import { readyClients } from '@/lib/use-clients';
import { useGateInDetail, useGateIns } from '@/lib/use-gate-ins';
import { roleHasCapability } from '@/lib/users';

import { DataTable, expandedRowId, type DataTableColumn } from '@/components/data-table/data-table';
import { FeedbackBanner } from '@/components/feedback/banner';
import { GateInForm } from '@/components/inbound/gate-in-form';
import { ConfirmRow } from '@/components/settings/confirm-row';
import { AllClientsNote } from '@/components/shared/client-filter-chip';
import { lineInputClass as inputClass } from '@/components/shared/line-rows';
import { ReadFailure } from '@/components/shared/surface';

/**
 * Story 2-3a — Inbound → Gate-in: the active warehouse's inbound vehicle
 * visits, newest gated-in first, for every client (a truck can carry
 * several — `AllClientsNote`). Every staff role reads the list and the
 * expanded detail; the writes — Record, Edit, Start unload, End unload, Gate
 * out — are `gate.manage`'s (owner, ops manager, operator): an accountant is
 * offered none of them.
 *
 * Each row action is a per-confirmation `ConfirmRow` mounted keyed
 * `action|gateInId` (its time — default now, IST — and count frozen in the
 * confirmation, the key cleared on an edit, a synchronous ref guard); the open
 * confirmation, the form, the expanded row and the banner belong to ONE
 * warehouse (keyed derivation), so a switch drops them in the same render.
 * Every mutation fires `notifyInboundChanged()` (the list, the expanded
 * detail and the tab counts re-read). A device unload appears on Refresh.
 */

type Outcome = { tone: 'accepted' | 'rejected' | 'warning'; word: string; reason: string };

const actionButtonClass = 'rounded-sm border border-(--border) px-2 py-0.5 text-xs hover:bg-(--muted) disabled:opacity-60';
const primaryClass =
  'rounded-sm bg-(--primary) px-3 py-1 text-xs font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60';

const ACTION_LABEL: Readonly<Record<GateInAction, string>> = {
  start: 'Start unload',
  end: 'End unload',
  'gate-out': 'Gate out',
};

export function GateInsCard({
  active,
  warehouseId,
  warehouseLabel,
}: {
  active: ActiveClientState;
  warehouseId: string | null;
  warehouseLabel: string | null;
}) {
  const list = useGateIns(warehouseId);
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
  const canManage = roleHasCapability(role, 'gate.manage');

  // Keyed derivation (guide §1.5): each belongs to the warehouse it opened in.
  const [formFor, setFormFor] = useState<{ warehouseId: string; gateInId: string | null } | null>(null);
  const form = formFor !== null && formFor.warehouseId === warehouseId ? formFor : null;
  const [expandedFor, setExpandedFor] = useState<{ warehouseId: string; gateInId: string } | null>(null);
  const expandedId = expandedFor !== null && expandedFor.warehouseId === warehouseId ? expandedFor.gateInId : null;
  const [confirmFor, setConfirmFor] = useState<{ warehouseId: string; action: GateInAction; gateInId: string } | null>(null);
  const confirm = confirmFor !== null && confirmFor.warehouseId === warehouseId ? confirmFor : null;
  const [banner, setBanner] = useState<{ warehouseId: string; outcome: Outcome } | null>(null);
  const shownBanner = banner !== null && banner.warehouseId === warehouseId ? banner.outcome : null;

  function show(outcome: Outcome) {
    if (warehouseId !== null) setBanner({ warehouseId, outcome });
  }

  function openAction(action: GateInAction, gateInId: string) {
    if (warehouseId === null) return;
    setBanner(null);
    setFormFor(null);
    setConfirmFor({ warehouseId, action, gateInId });
  }

  const rows = list.state === 'ready' ? list.data.items : [];

  const columns: DataTableColumn<GateInEntryDto>[] = [
    {
      key: 'code',
      header: 'Gate-in',
      render: (entry) => (
        <button
          type="button"
          aria-expanded={expandedId === entry.id}
          aria-controls={expandedRowId(entry.id)}
          aria-label={`${expandedId === entry.id ? 'Hide' : 'Show'} ${entry.code}`}
          onClick={() =>
            warehouseId !== null &&
            setExpandedFor(expandedId === entry.id ? null : { warehouseId, gateInId: entry.id })
          }
          className="font-mono text-xs text-(--primary) underline underline-offset-2"
        >
          {entry.code}
        </button>
      ),
    },
    {
      key: 'vehicle',
      header: 'Vehicle',
      render: (entry) => (
        <div className="flex flex-col text-xs">
          <span className={entry.vehicleNo === null ? '' : 'font-mono'}>{vehicleLabel(entry)}</span>
          {entry.containerNo !== null && <span className="font-mono text-(--muted-foreground)">{entry.containerNo}</span>}
        </div>
      ),
    },
    { key: 'transporter', header: 'Transporter', render: (entry) => entry.transporterLabel },
    {
      key: 'status',
      header: 'Status',
      render: (entry) => <span className="rounded-sm bg-(--muted) px-1.5 py-0.5 text-xs">{GATE_IN_STATUS_LABEL[entry.status]}</span>,
    },
    {
      key: 'gatedInAt',
      header: 'Gated in (IST)',
      render: (entry) => <time dateTime={entry.gatedInAt}>{istDateTimeLabel(entry.gatedInAt)}</time>,
    },
    { key: 'dock', header: 'Dock', render: (entry) => <span className="font-mono text-xs">{entry.dockDoor ?? '—'}</span> },
    {
      key: 'packages',
      header: 'Packages',
      render: (entry) => (
        <span className="data" data-testid={`gate-in-packages-${entry.code}`}>
          {packagesLabel(entry)}
        </span>
      ),
    },
    {
      key: 'flags',
      header: 'Flags',
      render: (entry) => (
        <div className="flex flex-wrap gap-1">
          {entry.sealStatus === 'broken' && (
            <span data-testid="seal-broken" className="rounded-sm border border-(--warning) px-1.5 py-0.5 text-xs text-(--warning)">
              ⚠ Seal broken
            </span>
          )}
          {entry.staleOpen && (
            <span data-testid="stale-open" className="rounded-sm border border-(--warning) px-1.5 py-0.5 text-xs text-(--warning)">
              Open &gt; 7 days
            </span>
          )}
        </div>
      ),
    },
    { key: 'receiptCount', header: 'Receipts', numeric: true },
    {
      key: 'driverPhone',
      header: 'Driver phone',
      // The list is ALWAYS masked (decision 10).
      render: (entry) => <span className="font-mono text-xs">{entry.driverPhone ?? '—'}</span>,
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: 'Actions',
            render: (entry: GateInEntryDto) => {
              const allowed = gateInActions(entry.status);
              return (
                <div className="flex flex-wrap gap-1">
                  {allowed.start && (
                    <button type="button" onClick={() => openAction('start', entry.id)} className={actionButtonClass}>
                      {ACTION_LABEL.start}
                    </button>
                  )}
                  {allowed.end && (
                    <button type="button" onClick={() => openAction('end', entry.id)} className={actionButtonClass}>
                      {ACTION_LABEL.end}
                    </button>
                  )}
                  {allowed.edit && (
                    <button
                      type="button"
                      onClick={() => {
                        if (warehouseId === null) return;
                        setBanner(null);
                        setConfirmFor(null);
                        setFormFor({ warehouseId, gateInId: entry.id });
                      }}
                      className={actionButtonClass}
                    >
                      Edit
                    </button>
                  )}
                  {allowed.gateOut && (
                    <button type="button" onClick={() => openAction('gate-out', entry.id)} className={actionButtonClass}>
                      {ACTION_LABEL['gate-out']}
                    </button>
                  )}
                </div>
              );
            },
          } satisfies DataTableColumn<GateInEntryDto>,
        ]
      : []),
  ];

  const renderExpanded = (entry: GateInEntryDto) => {
    const editingThis = canManage && form !== null && form.gateInId === entry.id;
    const confirmingThis = canManage && confirm !== null && confirm.gateInId === entry.id;
    if (!editingThis && !confirmingThis && expandedId !== entry.id) return null;
    return (
      <div className="flex flex-col gap-2 py-1">
        {confirmingThis && warehouseId !== null && (
          <GateInActionConfirm
            // Per confirmation: another action, row or warehouse is a fresh mount (a fresh key).
            key={`${confirm.action}|${entry.id}|${warehouseId}`}
            action={confirm.action}
            entry={entry}
            onDone={(outcome) => {
              setConfirmFor(null);
              show(outcome);
              notifyInboundChanged();
            }}
            onRejected={(reason) => show({ tone: 'rejected', word: `${ACTION_LABEL[confirm.action]} refused`, reason })}
            onClose={() => setConfirmFor(null)}
          />
        )}
        {editingThis && warehouseId !== null && (
          <EditGateIn
            key={`${warehouseId}|${entry.id}`}
            gateInId={entry.id}
            warehouseId={warehouseId}
            clients={clients}
            tenantName={tenantName}
            onCancel={() => setFormFor(null)}
            onSaved={(gateIn) => {
              setFormFor(null);
              show(savedOutcome(gateIn, 'edit'));
              notifyInboundChanged();
            }}
          />
        )}
        {expandedId === entry.id && <GateInDetailPanel gateInId={entry.id} clients={clients} tenantName={tenantName} />}
      </div>
    );
  };

  const recording = canManage && form !== null && form.gateInId === null;

  return (
    <section className="flex flex-col gap-3 rounded-md border border-(--border) p-3 text-sm" data-testid="gate-ins-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-medium">Gate-in</h2>
          <AllClientsNote active={active} title={GATE_IN_ALL_CLIENTS_NOTE} />
          <div className="text-(--muted-foreground)">
            {warehouseLabel === null
              ? 'Pick a warehouse to review its gate-ins.'
              : `${warehouseLabel} — every vehicle visit, newest first. ${GATE_IN_ALL_CLIENTS_NOTE}`}
          </div>
          <div className="text-xs text-(--muted-foreground)">{GATE_IN_REFRESH_NOTE}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={list.reload} disabled={warehouseId === null} className={actionButtonClass}>
            Refresh
          </button>
          {canManage && warehouseId !== null && !recording && (
            <button
              type="button"
              onClick={() => {
                setBanner(null);
                setConfirmFor(null);
                setFormFor({ warehouseId, gateInId: null });
              }}
              className={primaryClass}
            >
              Record a gate-in
            </button>
          )}
        </div>
      </div>

      {recording && warehouseId !== null && (
        <GateInForm
          key={warehouseId}
          warehouseId={warehouseId}
          clients={clients}
          tenantName={tenantName}
          onCancel={() => setFormFor(null)}
          onSaved={(gateIn) => {
            setFormFor(null);
            show(savedOutcome(gateIn, 'record'));
            // Back to page one, remounting the table (the epoch joins its key).
            list.reload();
            notifyInboundChanged();
          }}
        />
      )}

      {shownBanner !== null && <FeedbackBanner tone={shownBanner.tone} word={shownBanner.word} reason={shownBanner.reason} />}

      {list.state === 'failed' ? (
        <ReadFailure word="Gate-ins unavailable" reason={list.reason} onRetry={list.reload} />
      ) : (
        <DataTable<GateInEntryDto>
          key={`${warehouseId ?? 'none'}#${list.epoch}`}
          columns={columns}
          rows={rows}
          nextCursor={list.state === 'ready' ? list.data.nextCursor : null}
          onCursor={list.onCursor}
          renderExpanded={renderExpanded}
          emptyMessage={
            list.state === 'loading' ? 'Loading gate-ins…' : warehouseId === null ? 'Create a warehouse first.' : 'No gate-ins recorded yet.'
          }
        />
      )}
    </section>
  );
}

/**
 * A row action's confirmation: the time (default now, IST — frozen when the
 * confirmation opens, never re-read on a retry) and, for an end, the packages
 * counted. The key is per confirmation and bound to this draft (an edit mints
 * a fresh one on the next press).
 */
function GateInActionConfirm({
  action,
  entry,
  onDone,
  onRejected,
  onClose,
}: {
  action: GateInAction;
  entry: GateInEntryDto;
  onDone: (outcome: Outcome) => void;
  onRejected: (reason: string) => void;
  onClose: () => void;
}) {
  const [time, setTime] = useState(() => istLocalNow());
  const [timeEdited, setTimeEdited] = useState(false);
  // The instant of the first press when the time was left at its default:
  // sent untrimmed (the input holds minutes only, and a floor recorded with
  // seconds in this same minute would otherwise read as out of order), and
  // reused on a retry of the same confirmation (same key, same body).
  const pressedAt = useRef<string | null>(null);
  const [count, setCount] = useState('');
  const parsed = parseActionDraft(action, { time, count });
  return (
    <div className="flex flex-col gap-1 rounded-sm border border-(--border) p-2 text-xs">
      <ConfirmRow<Outcome>
        question={confirmQuestion(action, entry.code)}
        confirmLabel={ACTION_LABEL[action]}
        ariaLabel={`${ACTION_LABEL[action]} ${entry.code}`}
        draft={`${time}|${action === 'end' ? count : ''}`}
        confirmDisabled={parsed.problem !== null}
        fields={
          <>
            <label className="flex items-center gap-1">
              {action === 'gate-out' ? 'Left at (IST)' : 'At (IST)'}
              <input
                type="datetime-local"
                aria-label={`${ACTION_LABEL[action]} time (IST)`}
                value={time}
                onChange={(event) => {
                  setTime(event.target.value);
                  setTimeEdited(true);
                  pressedAt.current = null;
                }}
                className={inputClass}
              />
            </label>
            {action === 'end' && (
              <label className="flex items-center gap-1">
                Packages counted
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label="Packages counted"
                  value={count}
                  onChange={(event) => setCount(event.target.value)}
                  className={`${inputClass} w-24`}
                />
              </label>
            )}
          </>
        }
        run={async (key, tenantId) => {
          if (parsed.problem !== null) throw new Error(parsed.problem);
          const occurredAt = actionInstant(timeEdited, parsed.occurredAt, pressedAt);
          if (action === 'gate-out') {
            const { gateIn } = await fetchApiGateOutGateIn(tenantId, entry.id, { gatedOutAt: occurredAt }, key);
            return gateOutOutcome(gateIn);
          }
          const answer = await fetchApiUnloadGateIn(
            tenantId,
            entry.id,
            action === 'start'
              ? { phase: 'start', occurredAt }
              : { phase: 'end', occurredAt, packagesCounted: parsed.packagesCounted ?? 0 },
            key,
          );
          return unloadOutcome(action, answer);
        }}
        reason={gateInReason}
        onDone={onDone}
        onRejected={onRejected}
        onClose={onClose}
      />
      {parsed.problem !== null && <div className="text-(--muted-foreground)">{parsed.problem}</div>}
    </div>
  );
}

/** Edit reads the detail first (the full phone, the documents' PO / ASN codes), then mounts the form. */
function EditGateIn({
  gateInId,
  warehouseId,
  clients,
  tenantName,
  onCancel,
  onSaved,
}: {
  gateInId: string;
  warehouseId: string;
  clients: readonly ClientDto[] | null;
  tenantName: string | null;
  onCancel: () => void;
  onSaved: (gateIn: GateInDto) => void;
}) {
  // A one-shot read: the form owns the draft from here (an inbound change
  // must not remount it under the viewer's edits).
  const [frozen, setFrozen] = useState<GateInDetailDto | null>(null);
  const detail = useGateInDetail(frozen === null ? gateInId : null);
  if (frozen === null && detail.state === 'ready') setFrozen(detail.data);
  if (frozen !== null) {
    return (
      <GateInForm
        warehouseId={warehouseId}
        clients={clients}
        tenantName={tenantName}
        editing={frozen}
        onCancel={onCancel}
        onSaved={(gateIn) => onSaved(gateIn)}
      />
    );
  }
  if (detail.state === 'failed') return <ReadFailure word="Gate-in not loaded" reason={detail.reason} onRetry={detail.reload} />;
  return <div className="text-xs text-(--muted-foreground)">Loading the gate-in…</div>;
}

/** The expanded row: the documents (with their PO / ASN) and the receipts linked to the visit, with their client. */
function GateInDetailPanel({
  gateInId,
  clients,
  tenantName,
}: {
  gateInId: string;
  clients: readonly ClientDto[] | null;
  tenantName: string | null;
}) {
  const detail = useGateInDetail(gateInId);
  if (detail.state === 'loading') return <div className="text-xs text-(--muted-foreground)">Loading the gate-in…</div>;
  if (detail.state === 'failed') return <ReadFailure word="Gate-in details unavailable" reason={detail.reason} onRetry={detail.reload} />;
  const gateIn = detail.data;
  const clientName = (clientId: string | null) =>
    gateInClientName(clientId === null ? undefined : clients?.find((entry) => entry.id === clientId), tenantName) ?? '—';
  const documents = [...gateIn.documents].sort((a, b) => a.position - b.position);
  return (
    <div className="flex flex-col gap-2 text-xs" data-testid={`gate-in-detail-${gateIn.code}`}>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-(--muted-foreground)">
        <span>LR {gateIn.lrNumber ?? '—'}</span>
        <span>
          Driver {gateIn.driverName ?? '—'} · <span className="font-mono">{gateIn.driverPhone ?? '—'}</span>
        </span>
        <span>
          Seal {SEAL_STATUS_LABEL[gateIn.sealStatus]}
          {gateIn.sealNumber === null ? '' : ` · ${gateIn.sealNumber}`}
        </span>
        <span>Unload {istTimeLabel(gateIn.unloadStartedAt)} → {istTimeLabel(gateIn.unloadEndedAt)}</span>
        <span>Gated out {istTimeLabel(gateIn.gatedOutAt)}</span>
      </div>
      <div className="flex flex-col gap-0.5">
        <div className="font-medium">Documents</div>
        {documents.length === 0 ? (
          <div className="text-(--muted-foreground)">No documents.</div>
        ) : (
          documents.map((doc) => (
            <div key={doc.id} data-testid="gate-in-document">
              {DOCUMENT_KIND_LABEL[doc.kind]} <span className="font-mono">{doc.number}</span> · {doc.documentDate}
              {doc.ewayBillNo !== null && (
                <>
                  {' '}
                  · EWB <span className="font-mono">{doc.ewayBillNo}</span>
                </>
              )}
              {doc.poCode !== null && <> · {doc.poCode}</>}
              {doc.asnCode !== null && <> · {doc.asnCode}</>}
            </div>
          ))
        )}
      </div>
      <div className="flex flex-col gap-0.5">
        <div className="font-medium">Receipts</div>
        {gateIn.receipts.length === 0 ? (
          <div className="text-(--muted-foreground)">No receipts linked yet.</div>
        ) : (
          gateIn.receipts.map((receipt) => (
            <div key={receipt.id} data-testid="gate-in-receipt">
              <span className="font-mono">{receipt.code}</span> ·{' '}
              {receipt.document.kind === 'blind' ? 'Blind' : `${receipt.document.kind === 'po' ? 'PO' : 'ASN'} ${receipt.document.code ?? '—'}`} ·{' '}
              {clientName(receipt.clientId)}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
