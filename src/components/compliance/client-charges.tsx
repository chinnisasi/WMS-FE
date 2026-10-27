'use client';

import { useMemo, useRef, useState, useSyncExternalStore } from 'react';

import {
  fetchApiApproveClientCharge,
  fetchApiCancelClientCharge,
  fetchApiPutClientChargePolicy,
  fetchApiRecordClientCharge,
  fetchApiRejectClientCharge,
} from '@/lib/api/client';
import type { ChargePolicyResponse, ClientChargeDto, ClientChargeWarningDto, ClientDto, WarehouseResponse } from '@/lib/api/generated';
import { ApiProblem } from '@/lib/api/client';
import { readSession, subscribeSession } from '@/lib/auth';
import {
  CHARGE_CATEGORIES,
  CHARGE_CATEGORY_LABEL,
  CHARGE_DESCRIPTION_MAX,
  CHARGE_FIELD_LABEL,
  CHARGE_NOTE_MAX,
  CHARGE_REFERENCE_MAX,
  CHARGE_STATUSES,
  CHARGE_STATUS_LABEL,
  CHARGE_STATUS_TONE,
  CHARGE_UNITS,
  OTHER_SACS,
  SAC_LABEL,
  approvalForecast,
  billMonthLabel,
  billedLater,
  chargeActions,
  chargeAmountPreview,
  chargeBillingLabel,
  chargeDateLabel,
  chargeNeedsReread,
  chargePolicyReason,
  chargeQuantityText,
  chargeRefusalReason,
  chargeWarningLabel,
  chargesEmptyMessage,
  chargesHref,
  decisionOutcome,
  earliestChargeDate,
  emptyChargeForm,
  notifyClientChargesChanged,
  parseChargeForm,
  parseChargeNote,
  parseSelfApproveLimit,
  perUnitLabel,
  recordOutcome,
  sacOf,
  selfApproveLimitLabel,
  unitOptionLabel,
  unitPlural,
  type ChargeCategory,
  type ChargeFilters,
  type ChargeForm,
  type ChargeFormField,
  type ChargeFormProblem,
  type ChargeSac,
  type ChargeStatus,
  type ChargeUnit,
} from '@/lib/client-charges';
import { notifyClientInvoicesChanged } from '@/lib/client-invoices';
import { defaultFormClientId } from '@/lib/active-client';
import { formatRupees } from '@/lib/invoices';
import { paiseToRupeeText, pricedClients } from '@/lib/rate-cards';
import { ulid } from '@/lib/ulid';
import { roleHasCapability } from '@/lib/users';
import { useActiveClient } from '@/lib/use-active-client';
import { useClientChargePolicy, useClientCharges } from '@/lib/use-client-charges';
import { useTenantWarehouses } from '@/lib/use-tenant-warehouses';
import { useUsers } from '@/lib/use-users';

import { DataTable, expandedRowId, type DataTableColumn } from '@/components/data-table/data-table';
import { FeedbackBanner } from '@/components/feedback/banner';
import { EmptyState } from '@/components/shared/empty-state';
import { StatusChip } from '@/components/shared/status-chip';
import { useTodayIst } from '@/components/shared/use-today-ist';
import { ReadFailure, Section, buttonClass, inputClass, labelClass, primaryClass, rowButtonClass, selectClass } from '@/components/outbound/shell';

/**
 * Story 5-5a — the Compliance "Ad-hoc charges" tab: the one-off work a
 * contract bills beyond metering (extra labour, relabelling, repacking,
 * re-slots, returns processing, overflow space). Every member reads the
 * list; an owner, ops manager or accountant (`billing.charge`) records a
 * charge; an owner or accountant (`billing.invoice`) approves, rejects or
 * cancels — never their own pending charge's approval (a second person). An
 * approved charge becomes its own line on that month's invoice for the
 * warehouse's GSTIN; a pending one blocks that invoice until decided.
 *
 * Pessimistic throughout: the server decides the status, the billing month
 * and the amount; the form's preview is the server's own integer arithmetic,
 * and the list is re-read after every mutation. Filters live in the URL
 * (`?tab=client-charges&clientId&warehouseId&status&month`), so the invoice
 * gap "Review N pending charges" lands here filtered.
 */
export function ClientCharges({ initial }: { initial: ChargeFilters }) {
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );
  if (sessioned === null) return null;
  if (!sessioned) {
    return (
      <Section title="Ad-hoc charges">
        <div className="text-(--muted-foreground)">Sign in to read your ad-hoc charges.</div>
      </Section>
    );
  }
  return <ClientChargesSessioned initial={initial} />;
}

type Outcome = { tone: 'accepted' | 'rejected' | 'warning'; word: string; reason: string };

function useRole() {
  return useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );
}

function useUserId() {
  return useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.id,
    () => undefined,
  );
}

function ClientChargesSessioned({ initial }: { initial: ChargeFilters }) {
  const role = useRole();
  const userId = useUserId();
  const canCharge = roleHasCapability(role, 'billing.charge');
  const canInvoice = roleHasCapability(role, 'billing.invoice');
  const active = useActiveClient();
  const clients = active.clients;
  const brands = useMemo(() => (clients.state === 'ready' ? pricedClients(clients.data) : []), [clients]);
  const warehousesRead = useTenantWarehouses();
  const warehouses = warehousesRead.state === 'ready' ? warehousesRead.data.items : [];
  const users = useUsers();
  const policy = useClientChargePolicy();
  const [filters, setFilters] = useState<ChargeFilters>(initial);
  const list = useClientCharges(filters);
  const [openId, setOpenId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [warnings, setWarnings] = useState<readonly ClientChargeWarningDto[]>([]);

  const clientName = (id: string): string => {
    const client = brands.find((entry) => entry.id === id);
    return client === undefined ? `${id.slice(0, 8)}…` : client.code;
  };
  const warehouseName = (id: string): string => warehouses.find((entry) => entry.id === id)?.code ?? `${id.slice(0, 8)}…`;
  const emailOf = (id: string): string => {
    if (id === userId) return 'You';
    return users?.items.find((user) => user.id === id)?.email ?? `Member ${id.slice(0, 8)}…`;
  };

  function applyFilters(next: ChargeFilters) {
    setFilters(next);
    setOpenId(null);
    // UI-PATTERNS §3.3 — the filtered list is bookmarkable; the tab stays.
    window.history.replaceState(null, '', chargesHref(next));
  }

  const columns: DataTableColumn<ClientChargeDto>[] = [
    {
      key: 'date',
      header: 'Date of work',
      render: (row) => (
        <span className="flex flex-col">
          <span>{chargeDateLabel(row.chargeDate)}</span>
          {billedLater(row) ? <span className="text-xs text-(--muted-foreground)">billed {billMonthLabel(row.billMonth)}</span> : null}
        </span>
      ),
    },
    { key: 'client', header: 'Client', render: (row) => <span className="font-mono text-xs">{clientName(row.clientId)}</span> },
    { key: 'warehouse', header: 'Warehouse', render: (row) => <span className="font-mono text-xs">{warehouseName(row.warehouseId)}</span> },
    {
      key: 'charge',
      header: 'Charge',
      render: (row) => (
        <span className="flex max-w-80 flex-col">
          <span className="font-medium">{CHARGE_CATEGORY_LABEL[row.category] ?? row.category}</span>
          <span className="truncate text-xs text-(--muted-foreground)" title={row.description}>
            {row.description}
          </span>
        </span>
      ),
    },
    { key: 'quantity', header: 'Quantity', numeric: true, render: (row) => chargeQuantityText(row.quantity, row.unit) },
    { key: 'rate', header: 'Rate', numeric: true, render: (row) => `${formatRupees(row.unitRatePaise)} ${perUnitLabel(row.unit)}` },
    { key: 'amount', header: 'Amount (excl. GST)', numeric: true, render: (row) => <span className="font-medium">{formatRupees(row.amountPaise)}</span> },
    { key: 'status', header: 'Status', render: (row) => <ChargeStatusChip status={row.status} /> },
    { key: 'billing', header: 'Billing', render: (row) => <span className="text-xs">{chargeBillingLabel(row)}</span> },
    {
      key: 'open',
      header: '',
      render: (row) => (
        <button
          type="button"
          className={rowButtonClass}
          aria-expanded={openId === row.id}
          aria-controls={expandedRowId(row.id)}
          onClick={() => setOpenId(openId === row.id ? null : row.id)}
        >
          {openId === row.id ? 'Close' : row.status === 'pending' && canInvoice && row.recordedBy !== userId ? 'Review' : 'Open'}
        </button>
      ),
    },
  ];

  const filtered = filters.clientId !== null || filters.warehouseId !== null || filters.status !== null || filters.month !== null;
  const pendingHere = list.state === 'ready' ? list.data.items.filter((row) => row.status === 'pending').length : 0;

  return (
    <Section
      title="Ad-hoc charges"
      action={
        canCharge && !recording ? (
          <button
            type="button"
            className={primaryClass}
            onClick={() => {
              setOutcome(null);
              setWarnings([]);
              setRecording(true);
            }}
          >
            Record a charge
          </button>
        ) : null
      }
    >
      <div className="text-(--muted-foreground)">
        One-off work billed beyond storage and handling — extra labour, relabelling, repacking, re-slots, returns processing, overflow space. An approved charge is its own
        line on that month’s invoice for the warehouse’s GSTIN; a charge awaiting approval holds that invoice until it is decided. Amounts exclude GST (18 %).
      </div>

      <PolicyPanel policy={policy} canInvoice={canInvoice} onOutcome={setOutcome} />

      {canCharge && recording ? (
        <RecordChargeForm
          brands={brands}
          warehouses={warehouses}
          defaultClientId={defaultFormClientId(active, brands, filters.clientId ?? '')}
          defaultWarehouseId={filters.warehouseId ?? ''}
          canInvoice={canInvoice}
          limitPaise={policy.state === 'ready' ? policy.data.selfApproveLimitPaise : null}
          onClose={() => setRecording(false)}
          onRecorded={(result) => {
            setOutcome({ tone: 'accepted', ...recordOutcome(result) });
            setWarnings(result.warnings);
            setRecording(false);
            notifyClientChargesChanged();
            notifyClientInvoicesChanged();
          }}
        />
      ) : null}

      {outcome !== null ? <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} /> : null}
      {warnings.map((warning) => (
        <FeedbackBanner key={warning.code} tone="warning" word={chargeWarningLabel(warning.code)} reason={warning.detail} />
      ))}

      <FiltersBar filters={filters} brands={brands} warehouses={warehouses} onApply={applyFilters} />

      {list.state === 'failed' ? (
        <ReadFailure word="Ad-hoc charges unavailable" reason={list.reason} onRetry={list.reload} />
      ) : (
        <>
          {pendingHere > 0 && canInvoice ? (
            <div className="text-xs" role="status">
              <span className="font-medium text-(--warning)">◷ {pendingHere} awaiting approval</span>
              <span className="text-(--muted-foreground)"> — each holds its month’s invoice until approved or rejected.</span>
            </div>
          ) : null}
          <DataTable<ClientChargeDto>
            key={JSON.stringify(filters)}
            columns={columns}
            rows={list.state === 'ready' ? list.data.items : []}
            loading={list.state === 'loading' ? 'Loading ad-hoc charges…' : undefined}
            emptyMessage={
              <EmptyState kind={filtered ? 'filtered' : 'first-use'}>
                {chargesEmptyMessage(filters, {
                  ...(filters.clientId === null ? {} : { client: clientName(filters.clientId) }),
                  ...(filters.warehouseId === null ? {} : { warehouse: warehouseName(filters.warehouseId) }),
                })}
              </EmptyState>
            }
            renderExpanded={(row) =>
              row.id === openId ? (
                <ChargeDetail
                  key={row.id}
                  charge={row}
                  viewer={{ userId, canInvoice }}
                  emailOf={emailOf}
                  onOutcome={(result) => {
                    setOutcome(result);
                    setWarnings([]);
                  }}
                />
              ) : null
            }
          />
          <div className="flex flex-wrap items-center gap-3 text-xs text-(--muted-foreground)">
            {list.state === 'ready' ? <span>Showing {list.data.items.length}</span> : null}
            {list.state === 'ready' && list.data.nextCursor !== null ? (
              <button type="button" className={buttonClass} disabled={list.loadingMore} onClick={list.loadMore}>
                {list.loadingMore ? 'Loading…' : 'Load more'}
              </button>
            ) : null}
            {filtered ? (
              <button type="button" className={rowButtonClass} onClick={() => applyFilters({ clientId: null, warehouseId: null, status: null, month: null })}>
                Clear filters
              </button>
            ) : null}
          </div>
          {list.moreError !== null ? <FeedbackBanner tone="rejected" word="More charges unavailable" reason={list.moreError} /> : null}
        </>
      )}
    </Section>
  );
}

// ── the status chip (a word and a glyph, never colour alone) ────────────────

function ChargeStatusChip({ status }: { status: ChargeStatus }) {
  const { tone, glyph } = CHARGE_STATUS_TONE[status] ?? { tone: 'neutral', glyph: '•' };
  return (
    <StatusChip tone={tone} glyph={glyph} data-status={status} className="whitespace-nowrap">
      {CHARGE_STATUS_LABEL[status] ?? status}
    </StatusChip>
  );
}

// ── the filters ──────────────────────────────────────────────────────────────

function FiltersBar({
  filters,
  brands,
  warehouses,
  onApply,
}: {
  filters: ChargeFilters;
  brands: readonly ClientDto[];
  warehouses: readonly WarehouseResponse[];
  onApply: (filters: ChargeFilters) => void;
}) {
  return (
    <form className="flex flex-wrap items-end gap-3" aria-label="Ad-hoc charge filters" onSubmit={(event) => event.preventDefault()}>
      <label className="flex min-w-44 flex-col gap-1">
        <span className={labelClass}>Client</span>
        <select className={selectClass} aria-label="Filter by client" value={filters.clientId ?? ''} onChange={(event) => onApply({ ...filters, clientId: event.target.value === '' ? null : event.target.value })}>
          <option value="">All clients</option>
          {brands.map((client) => (
            <option key={client.id} value={client.id}>
              {client.code} — {client.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-w-40 flex-col gap-1">
        <span className={labelClass}>Warehouse</span>
        <select
          className={selectClass}
          aria-label="Filter by warehouse"
          value={filters.warehouseId ?? ''}
          onChange={(event) => onApply({ ...filters, warehouseId: event.target.value === '' ? null : event.target.value })}
        >
          <option value="">All warehouses</option>
          {warehouses.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouse.code} — {warehouse.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-w-40 flex-col gap-1">
        <span className={labelClass}>Status</span>
        <select
          className={selectClass}
          aria-label="Filter by status"
          value={filters.status ?? ''}
          onChange={(event) => onApply({ ...filters, status: event.target.value === '' ? null : (event.target.value as ChargeStatus) })}
        >
          <option value="">Every status</option>
          {CHARGE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {CHARGE_STATUS_LABEL[status]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Billing month</span>
        <input
          type="month"
          className={inputClass}
          aria-label="Filter by billing month"
          value={filters.month ?? ''}
          onChange={(event) => onApply({ ...filters, month: /^\d{4}-\d{2}$/.test(event.target.value) ? event.target.value : null })}
        />
      </label>
    </form>
  );
}

// ── the policy (A22) ─────────────────────────────────────────────────────────

function PolicyPanel({
  policy,
  canInvoice,
  onOutcome,
}: {
  policy: ReturnType<typeof useClientChargePolicy>;
  canInvoice: boolean;
  onOutcome: (outcome: Outcome) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (policy.state === 'failed') return <ReadFailure word="Self-approval limit unavailable" reason={policy.reason} onRetry={policy.reload} />;
  if (policy.state === 'loading') return <div className="text-xs text-(--muted-foreground)">Loading the self-approval limit…</div>;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-(--border) p-3 text-sm" aria-label="Self-approval limit" role="region">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">Self-approval limit · {formatRupees(policy.data.selfApproveLimitPaise)}</span>
          <span className="text-xs text-(--muted-foreground)">{selfApproveLimitLabel(policy.data)}</span>
        </div>
        {canInvoice && !editing ? (
          <button type="button" className={rowButtonClass} onClick={() => setEditing(true)}>
            Change limit
          </button>
        ) : null}
      </div>
      {!canInvoice ? <span className="text-xs text-(--muted-foreground)">Only an owner or an accountant can change it.</span> : null}
      {canInvoice && editing ? (
        <PolicyEditor
          policy={policy.data}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setEditing(false);
            onOutcome({ tone: 'accepted', word: 'Self-approval limit saved', reason: selfApproveLimitLabel(saved) });
            notifyClientChargesChanged();
          }}
          onRejected={(reason) => onOutcome({ tone: 'rejected', word: 'Limit not changed', reason })}
        />
      ) : null}
    </div>
  );
}

/** The limit editor — per-draft Idempotency-Key: minted on the first save, reused by a retry of the unchanged value, cleared on any edit. */
function PolicyEditor({
  policy,
  onClose,
  onSaved,
  onRejected,
}: {
  policy: ChargePolicyResponse;
  onClose: () => void;
  onSaved: (policy: ChargePolicyResponse) => void;
  onRejected: (reason: string) => void;
}) {
  const [text, setText] = useState(paiseToRupeeText(policy.selfApproveLimitPaise));
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const parsed = parseSelfApproveLimit(text);
    if (parsed.paise === null) {
      setProblem(parsed.problem);
      return;
    }
    const session = readSession();
    if (session === null) return;
    setProblem(null);
    inFlight.current = true;
    setBusy(true);
    keyRef.current ??= ulid();
    try {
      const saved = await fetchApiPutClientChargePolicy(session.tenant.id, parsed.paise, keyRef.current);
      keyRef.current = null;
      onSaved(saved);
    } catch (error) {
      onRejected(chargePolicyReason(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label="Change the self-approval limit" className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Limit (₹, excl. GST)</span>
        <input
          className={inputClass}
          inputMode="decimal"
          value={text}
          aria-label="Self-approval limit in rupees"
          aria-invalid={problem !== null}
          aria-describedby="charge-limit-hint"
          onChange={(event) => {
            keyRef.current = null;
            setText(event.target.value);
          }}
        />
      </label>
      <button type="submit" className={primaryClass} disabled={busy}>
        {busy ? 'Saving…' : 'Save limit'}
      </button>
      <button type="button" className={rowButtonClass} onClick={onClose}>
        Close
      </button>
      <span id="charge-limit-hint" className="w-full text-xs text-(--muted-foreground)">
        ₹0 sends every charge to a second person. A one-person business raises it to approve its own charges. Audited.
      </span>
      {problem !== null ? (
        <span role="alert" className="w-full text-xs text-(--destructive)">
          {problem}
        </span>
      ) : null}
    </form>
  );
}

// ── the record form ──────────────────────────────────────────────────────────

/**
 * Record a charge — per-draft Idempotency-Key: minted on the first submit,
 * reused by a retry of the unchanged draft, cleared on any edit. Client
 * problems sit on their fields (and in a summary above the submit row when
 * there are several); a server refusal is one banner above the submit row.
 */
function RecordChargeForm({
  brands,
  warehouses,
  defaultClientId,
  defaultWarehouseId,
  canInvoice,
  limitPaise,
  onClose,
  onRecorded,
}: {
  brands: readonly ClientDto[];
  warehouses: readonly WarehouseResponse[];
  defaultClientId: string;
  defaultWarehouseId: string;
  canInvoice: boolean;
  limitPaise: number | null;
  onClose: () => void;
  onRecorded: (result: Awaited<ReturnType<typeof fetchApiRecordClientCharge>>) => void;
}) {
  const today = useTodayIst();
  // A new charge is recorded only for an active client brand (the server answers 409 otherwise).
  const offered = brands.filter((client) => client.status === 'active');
  const [form, setForm] = useState<ChargeForm>(() =>
    emptyChargeForm(
      today,
      offered.some((client) => client.id === defaultClientId) ? defaultClientId : (offered[0]?.id ?? ''),
      warehouses.some((warehouse) => warehouse.id === defaultWarehouseId) ? defaultWarehouseId : (warehouses.length === 1 ? warehouses[0]!.id : ''),
    ),
  );
  const [problems, setProblems] = useState<readonly ChargeFormProblem[]>([]);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);

  const problemOf = (field: ChargeFormField): string | null => problems.find((entry) => entry.field === field)?.problem ?? null;
  const preview = chargeAmountPreview(form.quantity, form.rate);
  const sac = form.category === '' ? null : sacOf(form.category, form.sacCode);

  function edit(change: Partial<ChargeForm>) {
    keyRef.current = null;
    setRefusal(null);
    setForm((current) => ({ ...current, ...change }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const parsed = parseChargeForm(form, today);
    if (parsed.body === null) {
      setProblems(parsed.problems);
      return;
    }
    const session = readSession();
    if (session === null) return;
    setProblems([]);
    setRefusal(null);
    inFlight.current = true;
    setBusy(true);
    keyRef.current ??= ulid();
    try {
      const result = await fetchApiRecordClientCharge(session.tenant.id, parsed.body, keyRef.current);
      keyRef.current = null;
      onRecorded(result);
    } catch (error) {
      setRefusal(chargeRefusalReason(error, 'record'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const fieldError = (field: ChargeFormField, id: string) => {
    const problem = problemOf(field);
    return problem === null ? null : (
      <span id={`${id}-error`} className="text-xs text-(--destructive)">
        {problem}
      </span>
    );
  };
  const described = (field: ChargeFormField, id: string, hint?: string) =>
    [problemOf(field) !== null ? `${id}-error` : null, hint ?? null].filter((part): part is string => part !== null).join(' ') || undefined;

  return (
    <form onSubmit={submit} aria-label="Record an ad-hoc charge" className="flex max-w-3xl flex-col gap-4 rounded-md border border-(--border) p-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="font-medium">Record an ad-hoc charge</h3>
        <span className="text-xs text-(--muted-foreground)">
          One charge is one piece of work for one client, in one warehouse, on one day. It cannot be edited once recorded — cancel it and record it again.
        </span>
      </div>
      <fieldset disabled={busy} className="flex flex-col gap-4">
        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="mb-1 text-xs font-medium text-(--muted-foreground)">Who and where</legend>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Client</span>
            <select
              id="charge-client"
              className={selectClass}
              value={form.clientId}
              aria-invalid={problemOf('clientId') !== null}
              aria-describedby={described('clientId', 'charge-client')}
              onChange={(event) => edit({ clientId: event.target.value })}
            >
              <option value="">Pick a client…</option>
              {offered.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.code} — {client.name}
                </option>
              ))}
            </select>
            {fieldError('clientId', 'charge-client')}
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Warehouse</span>
            <select
              id="charge-warehouse"
              className={selectClass}
              value={form.warehouseId}
              aria-invalid={problemOf('warehouseId') !== null}
              aria-describedby={described('warehouseId', 'charge-warehouse')}
              onChange={(event) => edit({ warehouseId: event.target.value })}
            >
              <option value="">Pick a warehouse…</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.code} — {warehouse.name}
                </option>
              ))}
            </select>
            {fieldError('warehouseId', 'charge-warehouse')}
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Date of work (IST)</span>
            <input
              id="charge-date"
              type="date"
              className={inputClass}
              value={form.chargeDate}
              min={earliestChargeDate(today)}
              max={today}
              aria-invalid={problemOf('chargeDate') !== null}
              aria-describedby={described('chargeDate', 'charge-date')}
              onChange={(event) => edit({ chargeDate: event.target.value })}
            />
            {fieldError('chargeDate', 'charge-date')}
          </label>
        </fieldset>

        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-1 text-xs font-medium text-(--muted-foreground)">What was done</legend>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Category</span>
            <select
              id="charge-category"
              className={selectClass}
              value={form.category}
              aria-invalid={problemOf('category') !== null}
              aria-describedby={described('category', 'charge-category', 'charge-sac-hint')}
              onChange={(event) => edit({ category: event.target.value as ChargeCategory | '', sacCode: '' })}
            >
              <option value="">Pick a category…</option>
              {CHARGE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {CHARGE_CATEGORY_LABEL[category]}
                </option>
              ))}
            </select>
            {fieldError('category', 'charge-category')}
          </label>
          {form.category === 'other' ? (
            <label className="flex flex-col gap-1">
              <span className={labelClass}>SAC</span>
              <select
                id="charge-sac"
                className={selectClass}
                value={form.sacCode}
                aria-invalid={problemOf('sacCode') !== null}
                aria-describedby={described('sacCode', 'charge-sac')}
                onChange={(event) => edit({ sacCode: event.target.value as ChargeSac | '' })}
              >
                <option value="">Pick the services SAC…</option>
                {OTHER_SACS.map((code) => (
                  <option key={code} value={code}>
                    {code} — {SAC_LABEL[code]}
                  </option>
                ))}
              </select>
              {fieldError('sacCode', 'charge-sac')}
            </label>
          ) : (
            <div className="flex flex-col gap-1">
              <span className={labelClass}>SAC</span>
              <span id="charge-sac-hint" className="py-2 text-sm">
                {sac === null ? <span className="text-(--muted-foreground)">Set by the category</span> : <>
                    <span className="font-mono">{sac}</span> <span className="text-(--muted-foreground)">— {SAC_LABEL[sac]} · GST 18 %</span>
                  </>}
              </span>
            </div>
          )}
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className={labelClass}>Description</span>
            <span id="charge-description-hint" className="text-xs text-(--muted-foreground)">
              Printed on the invoice line the client receives ({CHARGE_DESCRIPTION_MAX} characters at most).
            </span>
            <input
              id="charge-description"
              className={inputClass}
              value={form.description}
              placeholder="e.g. Unloading a floor-loaded 40 ft container"
              aria-invalid={problemOf('description') !== null}
              aria-describedby={described('description', 'charge-description', 'charge-description-hint')}
              onChange={(event) => edit({ description: event.target.value })}
            />
            {fieldError('description', 'charge-description')}
          </label>
        </fieldset>

        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="mb-1 text-xs font-medium text-(--muted-foreground)">How much</legend>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Unit</span>
            <select
              id="charge-unit"
              className={selectClass}
              value={form.unit}
              aria-invalid={problemOf('unit') !== null}
              aria-describedby={described('unit', 'charge-unit')}
              onChange={(event) => edit({ unit: event.target.value as ChargeUnit | '' })}
            >
              <option value="">Pick a unit…</option>
              {CHARGE_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {unitOptionLabel(unit)}
                </option>
              ))}
            </select>
            {fieldError('unit', 'charge-unit')}
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>
              Quantity <span className="font-normal text-(--muted-foreground)">{form.unit === '' ? '' : `(${unitPlural(form.unit)})`}</span>
            </span>
            <input
              id="charge-quantity"
              className={inputClass}
              inputMode="decimal"
              value={form.quantity}
              placeholder="2.5"
              aria-invalid={problemOf('quantity') !== null}
              aria-describedby={described('quantity', 'charge-quantity')}
              onChange={(event) => edit({ quantity: event.target.value })}
            />
            {fieldError('quantity', 'charge-quantity')}
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>
              Rate <span className="font-normal text-(--muted-foreground)">₹ {form.unit === '' ? 'per unit' : perUnitLabel(form.unit)}</span>
            </span>
            <input
              id="charge-rate"
              className={inputClass}
              inputMode="decimal"
              value={form.rate}
              placeholder="350.00"
              aria-invalid={problemOf('rate') !== null}
              aria-describedby={described('rate', 'charge-rate')}
              onChange={(event) => edit({ rate: event.target.value })}
            />
            {fieldError('rate', 'charge-rate')}
          </label>
          <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-md bg-(--muted) px-3 py-2 sm:col-span-3" aria-live="polite">
            <span className="text-xs text-(--muted-foreground)">Amount (excl. GST) — quantity × rate, rounded to the paisa once</span>
            {preview === null ? (
              <span className="data text-(--muted-foreground)">—</span>
            ) : preview.paise !== null ? (
              <span className="data text-base font-semibold" data-amount-preview>
                {formatRupees(preview.paise)}
              </span>
            ) : (
              <span className="text-xs text-(--destructive)">{preview.problem}</span>
            )}
          </div>
          {problemOf('amount') !== null && preview?.paise !== null ? <span className="text-xs text-(--destructive) sm:col-span-3">{problemOf('amount')}</span> : null}
        </fieldset>

        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-1 text-xs font-medium text-(--muted-foreground)">References (optional)</legend>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Reference</span>
            <span id="charge-reference-hint" className="text-xs text-(--muted-foreground)">
              An order, GRN or ASN — printed as “Ref …”.
            </span>
            <input
              id="charge-reference"
              className={inputClass}
              value={form.reference}
              maxLength={CHARGE_REFERENCE_MAX * 2}
              aria-invalid={problemOf('reference') !== null}
              aria-describedby={described('reference', 'charge-reference', 'charge-reference-hint')}
              onChange={(event) => edit({ reference: event.target.value })}
            />
            {fieldError('reference', 'charge-reference')}
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Client authorisation</span>
            <span id="charge-auth-hint" className="text-xs text-(--muted-foreground)">
              The client’s PO, email or work order — printed as “Client auth …”.
            </span>
            <input
              id="charge-auth"
              className={inputClass}
              value={form.clientAuthorizationRef}
              maxLength={CHARGE_REFERENCE_MAX * 2}
              aria-invalid={problemOf('clientAuthorizationRef') !== null}
              aria-describedby={described('clientAuthorizationRef', 'charge-auth', 'charge-auth-hint')}
              onChange={(event) => edit({ clientAuthorizationRef: event.target.value })}
            />
            {fieldError('clientAuthorizationRef', 'charge-auth')}
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className={labelClass}>Internal note</span>
            <span id="charge-evidence-hint" className="text-xs text-(--muted-foreground)">
              Evidence for your team — never printed and never shown to the client.
            </span>
            <textarea
              id="charge-evidence"
              className={inputClass}
              rows={2}
              value={form.evidenceNote}
              maxLength={CHARGE_NOTE_MAX * 2}
              aria-invalid={problemOf('evidenceNote') !== null}
              aria-describedby={described('evidenceNote', 'charge-evidence', 'charge-evidence-hint')}
              onChange={(event) => edit({ evidenceNote: event.target.value })}
            />
            {fieldError('evidenceNote', 'charge-evidence')}
          </label>
        </fieldset>
      </fieldset>

      {problems.length > 1 ? (
        <div role="alert" className="text-xs text-(--destructive)">
          {problems.length} problems — {[...new Set(problems.map((entry) => CHARGE_FIELD_LABEL[entry.field]))].join(', ')}.
        </div>
      ) : null}
      {refusal !== null ? <FeedbackBanner tone="rejected" word="Not recorded" reason={refusal} /> : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={primaryClass} disabled={busy}>
          {busy ? 'Recording…' : 'Record charge'}
        </button>
        <button type="button" className={rowButtonClass} onClick={onClose}>
          Discard
        </button>
        <span className="text-xs text-(--muted-foreground)">{approvalForecast(canInvoice, limitPaise, preview?.paise ?? null)}</span>
      </div>
    </form>
  );
}

// ── one charge's detail and its actions ──────────────────────────────────────

type Pending = { kind: 'reject' } | { kind: 'cancel' } | null;

function ChargeDetail({
  charge,
  viewer,
  emailOf,
  onOutcome,
}: {
  charge: ClientChargeDto;
  viewer: { userId: string | undefined; canInvoice: boolean };
  emailOf: (userId: string) => string;
  onOutcome: (outcome: Outcome) => void;
}) {
  const actions = chargeActions(charge, viewer);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const inFlight = useRef(false);
  const approveKey = useRef<string | null>(null);

  function settled(verb: 'approve' | 'reject' | 'cancel', updated: ClientChargeDto) {
    onOutcome({ tone: 'accepted', ...decisionOutcome(verb, updated) });
    notifyClientChargesChanged();
    notifyClientInvoicesChanged();
  }
  function refused(verb: 'approve' | 'reject' | 'cancel', error: unknown) {
    onOutcome({ tone: 'rejected', word: verb === 'approve' ? 'Not approved' : verb === 'reject' ? 'Not rejected' : 'Not cancelled', reason: chargeRefusalReason(error, verb) });
    if (chargeNeedsReread(error)) notifyClientChargesChanged();
  }

  // Code review C11: one key per approve ATTEMPT — reused when the answer never
  // arrived (a network failure: the approval may have committed, so the retry
  // must replay it), dropped once the server answered (approved, or a problem —
  // a refused approve stores nothing, and the next click is a new decision).
  async function approve() {
    const session = readSession();
    if (session === null || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    approveKey.current ??= ulid();
    try {
      const updated = await fetchApiApproveClientCharge(session.tenant.id, charge.id, approveKey.current);
      approveKey.current = null;
      settled('approve', updated);
    } catch (error) {
      if (error instanceof ApiProblem) approveKey.current = null;
      refused('approve', error);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const approveHint = `approve-hint-${charge.id}`;
  return (
    <div className="flex flex-col gap-3 py-1 text-sm" data-charge-detail>
      <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-[max-content_1fr]">
        <dt className="text-(--muted-foreground)">Printed as</dt>
        <dd>
          {CHARGE_CATEGORY_LABEL[charge.category]} — {charge.description}
          {charge.reference === null ? '' : ` · Ref ${charge.reference}`}
          {charge.clientAuthorizationRef === null ? '' : ` · Client auth ${charge.clientAuthorizationRef}`}
        </dd>
        <dt className="text-(--muted-foreground)">SAC · GSTIN</dt>
        <dd>
          <span className="font-mono">{charge.sacCode}</span> · {charge.supplierGstin ?? 'no GSTIN'}
        </dd>
        <dt className="text-(--muted-foreground)">Billing month</dt>
        <dd>
          {billMonthLabel(charge.billMonth)}
          {billedLater(charge) ? <span className="text-(--muted-foreground)"> — its own month ({billMonthLabel(charge.chargeDate)}) was already invoiced</span> : null}
        </dd>
        <dt className="text-(--muted-foreground)">Recorded</dt>
        <dd>
          {emailOf(charge.recordedBy)} · {charge.recordedAt.slice(0, 10)}
        </dd>
        {charge.decidedBy !== null ? (
          <>
            <dt className="text-(--muted-foreground)">{charge.status === 'rejected' ? 'Rejected by' : 'Approved by'}</dt>
            <dd>
              {emailOf(charge.decidedBy)}
              {charge.decidedBy === charge.recordedBy && charge.status !== 'rejected' ? <span className="text-(--muted-foreground)"> (within the self-approval limit)</span> : null}
              {charge.decisionNote === null ? '' : ` — ${charge.decisionNote}`}
            </dd>
          </>
        ) : null}
        {charge.cancelledBy !== null ? (
          <>
            <dt className="text-(--muted-foreground)">Cancelled by</dt>
            <dd>
              {emailOf(charge.cancelledBy)}
              {charge.cancelNote === null ? '' : ` — ${charge.cancelNote}`}
            </dd>
          </>
        ) : null}
        {charge.evidenceNote !== null ? (
          <>
            <dt className="text-(--muted-foreground)">Internal note</dt>
            <dd>{charge.evidenceNote}</dd>
          </>
        ) : null}
        <dt className="text-(--muted-foreground)">Invoice</dt>
        <dd>{chargeBillingLabel(charge)}</dd>
      </dl>

      {actions.approve || actions.reject || actions.cancel ? (
        <div className="flex flex-wrap items-center gap-2">
          {actions.approve ? (
            <button
              type="button"
              className={primaryClass}
              disabled={busy || actions.approveBlocked !== null}
              aria-describedby={actions.approveBlocked !== null ? approveHint : undefined}
              onClick={approve}
            >
              {busy ? 'Approving…' : `Approve ${formatRupees(charge.amountPaise)}`}
            </button>
          ) : null}
          {actions.reject ? (
            <button type="button" className={buttonClass} disabled={busy} onClick={() => setPending({ kind: 'reject' })}>
              Reject
            </button>
          ) : null}
          {actions.cancel ? (
            <button type="button" className={buttonClass} disabled={busy} onClick={() => setPending({ kind: 'cancel' })}>
              Cancel charge
            </button>
          ) : null}
          {actions.approveBlocked !== null ? (
            <span id={approveHint} className="text-xs text-(--muted-foreground)">
              {actions.approveBlocked}
            </span>
          ) : null}
        </div>
      ) : null}
      {actions.hint !== null ? <div className="text-xs text-(--muted-foreground)">{actions.hint}</div> : null}

      {pending !== null ? (
        <ChargeNoteForm
          key={pending.kind}
          verb={pending.kind}
          charge={charge}
          onClose={() => setPending(null)}
          onDone={(updated) => {
            setPending(null);
            settled(pending.kind, updated);
          }}
          onRejected={(error) => refused(pending.kind, error)}
        />
      ) : null}
    </div>
  );
}

/** Reject or cancel with a note — per-confirmation key (mounted per confirmation, cleared on any edit). */
function ChargeNoteForm({
  verb,
  charge,
  onClose,
  onDone,
  onRejected,
}: {
  verb: 'reject' | 'cancel';
  charge: ClientChargeDto;
  onClose: () => void;
  onDone: (charge: ClientChargeDto) => void;
  onRejected: (error: unknown) => void;
}) {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const parsed = parseChargeNote(text, verb);
    if (parsed.note === null) {
      setProblem(parsed.problem);
      return;
    }
    const session = readSession();
    if (session === null) return;
    setProblem(null);
    inFlight.current = true;
    setBusy(true);
    keyRef.current ??= ulid();
    try {
      const updated =
        verb === 'reject'
          ? await fetchApiRejectClientCharge(session.tenant.id, charge.id, parsed.note, keyRef.current)
          : await fetchApiCancelClientCharge(session.tenant.id, charge.id, parsed.note, keyRef.current);
      onDone(updated);
    } catch (error) {
      onRejected(error);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const label = verb === 'reject' ? 'Why is it rejected? (required)' : 'Why is it cancelled? (required)';
  return (
    <form onSubmit={submit} aria-label={verb === 'reject' ? 'Reject charge' : 'Cancel charge'} className="flex max-w-3xl flex-col gap-2 rounded-md border border-(--border) bg-(--background) p-3">
      <span className="text-xs text-(--muted-foreground)">
        {verb === 'reject'
          ? `A rejected charge is never billed; ${formatRupees(charge.amountPaise)} stays off the invoice and the note is kept with it.`
          : charge.status === 'approved'
            ? `The ${formatRupees(charge.amountPaise)} line leaves the ${billMonthLabel(charge.billMonth)} draft on its next refresh. Record it again if it was wrong.`
            : 'A cancelled charge is never billed. Record it again if it was wrong.'}
      </span>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>{label}</span>
        <input
          className={inputClass}
          value={text}
          maxLength={CHARGE_NOTE_MAX * 2}
          aria-invalid={problem !== null}
          onChange={(event) => {
            keyRef.current = null;
            setText(event.target.value);
          }}
        />
      </label>
      {problem !== null ? (
        <span role="alert" className="text-xs text-(--destructive)">
          {problem}
        </span>
      ) : null}
      <div className="flex gap-2">
        <button type="submit" className={primaryClass} disabled={busy}>
          {busy ? (verb === 'reject' ? 'Rejecting…' : 'Cancelling…') : verb === 'reject' ? 'Reject charge' : 'Cancel charge'}
        </button>
        <button type="button" className={rowButtonClass} onClick={onClose}>
          Keep it
        </button>
      </div>
    </form>
  );
}
