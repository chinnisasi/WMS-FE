'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import {
  fetchApiCreateClient,
  fetchApiRenameClient,
  fetchApiUpdateClientStatus,
  fetchApiUpdateClientTaxDetails,
} from '@/lib/api/client';
import type { ClientDto } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import {
  BILLING_STATE_OPTIONS,
  DEPARTURE_BLOCKED_LEAD,
  clientLabel,
  clientNameProblem,
  clientReason,
  clientStatusAction,
  clientStatusActionLabel,
  clientStatusConfirmLabel,
  clientStatusLabel,
  clientStatusQuestion,
  clientStatusReasonAction,
  clientStatusRefusedWord,
  clientStatusSuccess,
  clientStatusTarget,
  clientStatusWord,
  departureBlockerLine,
  departureBlockers,
  notifyClientsChanged,
  parseClientDraft,
  parseTaxDetailsDraft,
  taxDetailLabel,
  taxDetailsFieldsOf,
  taxDetailsReason,
  taxDetailsSummary,
  type ClientStatusAction,
  type TaxDetailField,
  type TaxDetailsFields,
} from '@/lib/clients';
import { roleHasCapability } from '@/lib/users';
import { ulid } from '@/lib/ulid';
import { useClients } from '@/lib/use-clients';

import { FeedbackBanner } from '@/components/feedback/banner';
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { ReadFailure } from '@/components/outbound/shell';
import { ConfirmRow } from '@/components/settings/confirm-row';
import { ClientContactsPanel } from '@/components/settings/client-contacts';
import { ClientAddressesPanel } from '@/components/settings/client-addresses';
import { ClientReceivingPolicyPanel } from '@/components/settings/client-receiving-policy';
import { ClientAllocationPolicyPanel } from '@/components/settings/client-allocation-policy';
import { ClientWebhooksPanel } from '@/components/settings/client-webhooks';

const inputClass =
  'w-full rounded-sm border border-(--input) bg-(--background) px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-(--ring)';
const labelClass = 'text-sm font-medium';
const rowButtonClass =
  'rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted) disabled:opacity-40';

type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string } | null;

/**
 * The one open panel below the table (story 21-10 folded the rename and
 * tax-details states into it; story 1-2a adds contacts and addresses, and
 * depart beside suspend/reactivate): opening one closes any other — after
 * asking, when the open one holds an unsaved draft.
 */
type Panel =
  | { kind: 'rename'; client: ClientDto }
  | { kind: 'tax'; client: ClientDto }
  | { kind: 'contacts'; client: ClientDto }
  | { kind: 'addresses'; client: ClientDto }
  | { kind: 'receiving'; client: ClientDto }
  // Story 4-3a — the outbound allocation policy, beside the receiving policy.
  | { kind: 'allocation'; client: ClientDto }
  // Story 5-2a — the client's outbound webhooks (owner-only).
  | { kind: 'webhooks'; client: ClientDto }
  | { kind: ClientStatusAction; client: ClientDto };

/** The panel's name in the discard question. */
function panelName(panel: Panel): string {
  switch (panel.kind) {
    case 'contacts':
      return `the contact for ${panel.client.code}`;
    case 'addresses':
      return `${panel.client.code}'s addresses`;
    case 'receiving':
      return `${panel.client.code}'s receiving policy`;
    case 'allocation':
      return `${panel.client.code}'s allocation policy`;
    case 'webhooks':
      return `${panel.client.code}'s webhook endpoint`;
    default:
      return panel.client.code;
  }
}

/**
 * The clients card (story 21-2b) — the client brands this tenant holds goods
 * for. Every member reads the list (status included) and (story 1-2a) a
 * client's contacts and addresses; an owner (`clients.manage`) registers a
 * client, renames one, edits its contacts and addresses, and (story 21-10,
 * 1-2a) suspends, departs or reactivates one. Story 1-2b — every member reads
 * a client's receiving policy (`self` and departed clients included); an
 * owner edits it. The tenant's own `self` client
 * is shown as the company itself; its row offers only Contacts,
 * Addresses and Receiving — its name mirrors the tenant's and it never changes status.
 *
 * Gating copies `sku-table.tsx`: the role is read through the session
 * subscription, so a `/me` role rewrite re-renders the affordances.
 */
export function ClientsCard() {
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );
  if (sessioned === null) return null;
  if (!sessioned) {
    return (
      <div className="rounded-md border border-(--border) p-3 text-sm">
        <div className="font-medium">Clients</div>
        <div className="text-(--muted-foreground)">Sign in to see your clients.</div>
      </div>
    );
  }
  return <ClientsCardSessioned />;
}

function ClientsCardSessioned() {
  const clients = useClients();
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );
  const tenantName = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.name ?? null,
    () => null,
  );
  const canManage = roleHasCapability(role, 'clients.manage');
  // Story 21-5 — the tax details are `billing.invoice`'s (owner + accountant):
  // whoever clears an invoice's recipient gaps fixes them here.
  const canInvoice = roleHasCapability(role, 'billing.invoice');
  const [panel, setPanel] = useState<Panel | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  // Story 1-2a — an unsaved draft in the open panel, and the panel asked for
  // over it (the discard question shows while it is set).
  const dirtyRef = useRef(false);
  const [pending, setPending] = useState<Panel | null>(null);
  // The panel as it is NOW — a status response that lands after the owner
  // opened another panel must neither close nor overwrite it.
  const panelRef = useRef<Panel | null>(null);
  useEffect(() => {
    panelRef.current = panel;
  }, [panel]);
  const stillOpen = (kind: Panel['kind'], clientId: string) =>
    panelRef.current?.kind === kind && panelRef.current.client.id === clientId;
  const show = (next: Panel | null) => {
    dirtyRef.current = false;
    setPending(null);
    setPanel(next);
    setOutcome(null);
  };
  const open = (next: Panel) => {
    // The panel already open (same kind, same client): a no-op — re-showing
    // it would clear the dirty flag while its draft stays on screen.
    if (panel !== null && panel.kind === next.kind && panel.client.id === next.client.id) return;
    if (panel !== null && dirtyRef.current) {
      setPending(next);
      return;
    }
    show(next);
  };
  const onDirtyChange = (dirty: boolean) => {
    dirtyRef.current = dirty;
  };

  const rowButton = (label: string, ariaLabel: string, next: Panel) => (
    <button key={label} type="button" aria-label={ariaLabel} onClick={() => open(next)} className={rowButtonClass}>
      {label}
    </button>
  );

  const columns: readonly DataTableColumn<ClientDto>[] = [
    { key: 'code', header: 'Code', render: (client) => <span className="font-mono">{client.code}</span> },
    { key: 'name', header: 'Client', render: (client) => clientLabel(client, tenantName) },
    { key: 'status', header: 'Status', render: (client) => clientStatusLabel(client.status) },
    // Story 21-5 — every member reads a brand's tax details (what its invoices print).
    { key: 'tax', header: 'Tax details', render: (client) => <span className="text-xs">{taxDetailsSummary(client)}</span> },
    {
      key: 'actions',
      header: '',
      render: (client: ClientDto) => {
        const statusActions = canManage ? clientStatusAction(client) : [];
        // Row actions WRAP at narrow widths (flex-wrap) rather than overflow.
        return (
          <div className="flex flex-wrap gap-1">
            {statusActions.includes('reactivate')
              ? rowButton('Reactivate', `Reactivate ${client.code}`, { kind: 'reactivate', client })
              : null}
            {canManage && !client.systemOwned ? rowButton('Rename', `Rename ${client.code}`, { kind: 'rename', client }) : null}
            {canInvoice && !client.systemOwned ? rowButton('Tax details', `Tax details of ${client.code}`, { kind: 'tax', client }) : null}
            {rowButton('Contacts', `Contacts of ${client.code}`, { kind: 'contacts', client })}
            {rowButton('Addresses', `Addresses of ${client.code}`, { kind: 'addresses', client })}
            {rowButton('Receiving', `Receiving policy of ${client.code}`, { kind: 'receiving', client })}
            {rowButton('Allocation', `Allocation policy of ${client.code}`, { kind: 'allocation', client })}
            {/* Story 5-2a — owner-only, never on the warehouse's own client. */}
            {canManage && !client.systemOwned ? rowButton('Webhooks', `Webhooks of ${client.code}`, { kind: 'webhooks', client }) : null}
            {statusActions.includes('suspend') ? rowButton('Suspend', `Suspend ${client.code}`, { kind: 'suspend', client }) : null}
            {statusActions.includes('depart') ? rowButton('Depart', `Depart ${client.code}`, { kind: 'depart', client }) : null}
          </div>
        );
      },
    } satisfies DataTableColumn<ClientDto>,
  ];

  const statusPanel = panel !== null && (panel.kind === 'suspend' || panel.kind === 'reactivate' || panel.kind === 'depart') ? panel : null;

  return (
    <section aria-label="Clients" className="flex flex-col gap-3 rounded-md border border-(--border) p-3 text-sm">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-medium">Clients</h2>
        <div className="text-(--muted-foreground)">
          The brands whose goods you hold. Each SKU belongs to one client, and orders and purchase
          orders take their client from their SKUs. Your own company is always a client.
        </div>
      </div>

      {clients.state === 'failed' ? (
        <ReadFailure word="Clients unavailable" reason={clients.reason} onRetry={clients.reload} />
      ) : (
        <DataTable<ClientDto>
          columns={columns}
          rows={clients.state === 'ready' ? clients.data : []}
          emptyMessage="No clients yet."
          // Story UI-2 (C14) — a cold load is a skeleton, never an empty-row sentence.
          loading={clients.state === 'loading' ? 'Loading clients…' : undefined}
        />
      )}

      {canManage ? (
        <CreateClientForm
          onCreated={(client) => {
            setOutcome({
              tone: 'accepted',
              word: `${client.code} created`,
              reason: 'Import SKUs for it from the catalog import below.',
            });
            notifyClientsChanged();
          }}
          onRejected={(reason) => setOutcome({ tone: 'rejected', word: 'Not created', reason })}
        />
      ) : null}

      {pending !== null && panel !== null ? (
        <div role="group" aria-label="Discard unsaved changes" className="flex flex-wrap items-center gap-2">
          <span>Discard the unsaved changes to {panelName(panel)}?</span>
          <button type="button" onClick={() => show(pending)} className={rowButtonClass}>
            Discard
          </button>
          <button type="button" onClick={() => setPending(null)} className={rowButtonClass}>
            Keep editing
          </button>
        </div>
      ) : null}

      {canManage && panel?.kind === 'rename' ? (
        <RenameClientForm
          key={panel.client.id}
          client={panel.client}
          onClose={() => show(null)}
          onRenamed={(client) => {
            show(null);
            setOutcome({ tone: 'accepted', word: `${client.code} renamed`, reason: `It now reads “${client.name}”.` });
            notifyClientsChanged();
          }}
          onRejected={(reason) => setOutcome({ tone: 'rejected', word: 'Not renamed', reason })}
        />
      ) : null}

      {canInvoice && panel?.kind === 'tax' ? (
        <TaxDetailsForm
          key={panel.client.id}
          client={panel.client}
          onClose={() => show(null)}
          onSaved={(client, changed) => {
            show(null);
            setOutcome(
              changed
                ? { tone: 'accepted', word: `${client.code} tax details saved`, reason: 'Refresh a draft invoice to pick them up — an issued invoice keeps what it printed.' }
                : { tone: 'accepted', word: 'Nothing changed', reason: `${client.code}'s tax details are as entered.` },
            );
            if (changed) notifyClientsChanged();
          }}
          onRejected={(reason) => setOutcome({ tone: 'rejected', word: 'Tax details not saved', reason })}
        />
      ) : null}

      {panel?.kind === 'contacts' ? (
        <ClientContactsPanel
          key={panel.client.id}
          client={panel.client}
          canManage={canManage}
          onClose={() => show(null)}
          onDirtyChange={onDirtyChange}
        />
      ) : null}

      {panel?.kind === 'addresses' ? (
        <ClientAddressesPanel
          key={panel.client.id}
          client={panel.client}
          canManage={canManage}
          onClose={() => show(null)}
          onSaved={() => notifyClientsChanged()}
          onDirtyChange={onDirtyChange}
        />
      ) : null}

      {panel?.kind === 'allocation' ? (
        <ClientAllocationPolicyPanel
          key={panel.client.id}
          client={panel.client}
          canManage={canManage}
          onClose={() => show(null)}
          onSaved={() => notifyClientsChanged()}
          onDirtyChange={onDirtyChange}
        />
      ) : null}

      {canManage && panel?.kind === 'webhooks' ? (
        <ClientWebhooksPanel key={panel.client.id} client={panel.client} onClose={() => show(null)} onDirtyChange={onDirtyChange} />
      ) : null}

      {panel?.kind === 'receiving' ? (
        <ClientReceivingPolicyPanel
          key={panel.client.id}
          client={panel.client}
          canManage={canManage}
          onClose={() => show(null)}
          onSaved={() => notifyClientsChanged()}
          onDirtyChange={onDirtyChange}
        />
      ) : null}

      {canManage && statusPanel !== null ? (
        // Keyed by action AND client: Reactivate right after Suspend mounts a
        // fresh confirmation, so it mints a fresh Idempotency-Key.
        <ConfirmRow<ClientDto>
          key={`${statusPanel.kind}-${statusPanel.client.id}`}
          question={clientStatusQuestion(statusPanel.kind, statusPanel.client.name, statusPanel.client.status)}
          confirmLabel={clientStatusConfirmLabel(statusPanel.kind, statusPanel.client.code)}
          ariaLabel={`Confirm ${clientStatusActionLabel(statusPanel.kind).toLowerCase()}`}
          run={(key, tenantId) => fetchApiUpdateClientStatus(tenantId, statusPanel.client.id, clientStatusTarget(statusPanel.kind), key)}
          reason={(error) => clientReason(error, clientStatusReasonAction(statusPanel.kind))}
          // Story 1-2a — a refused departure lists every blocker under the
          // confirmation, which stays open for a retry once they are cleared.
          detail={
            statusPanel.kind === 'depart'
              ? (error) => {
                  const blockers = departureBlockers(error);
                  if (blockers === null) return null;
                  return (
                    <div className="flex flex-col gap-1 rounded-md border border-(--destructive) px-3 py-2">
                      <span className="font-medium">{DEPARTURE_BLOCKED_LEAD}</span>
                      <ul aria-label={`What keeps ${statusPanel.client.code} from departing`} className="list-disc pl-5">
                        {blockers.map((blocker) => (
                          <li key={blocker.kind}>{departureBlockerLine(blocker)}</li>
                        ))}
                      </ul>
                    </div>
                  );
                }
              : undefined
          }
          onClose={() => show(null)}
          onDone={(client) => {
            const { kind } = statusPanel;
            if (stillOpen(kind, client.id)) {
              setPanel((p) => (p?.kind === kind && p.client.id === client.id ? null : p));
              setOutcome({ tone: 'accepted', word: clientStatusWord(client), reason: clientStatusSuccess(client) });
            }
            notifyClientsChanged();
          }}
          onRejected={(reason) => {
            if (!stillOpen(statusPanel.kind, statusPanel.client.id)) return;
            setOutcome({ tone: 'rejected', word: clientStatusRefusedWord(statusPanel.kind), reason });
          }}
        />
      ) : null}

      {outcome !== null ? <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} /> : null}
    </section>
  );
}

/**
 * Register a client — per-draft Idempotency-Key: minted on first submit,
 * reused across retries of the unchanged draft, cleared on any edit and on
 * success (a create that timed out after the server committed must replay,
 * never raise a second client).
 */
function CreateClientForm({
  onCreated,
  onRejected,
}: {
  onCreated: (client: ClientDto) => void;
  onRejected: (reason: string) => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<string | null>(null);
  // A pre-render double-click fires both handlers before `disabled`
  // renders — a synchronous ref, not state, is the re-entry guard.
  const inFlight = useRef(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const parsed = parseClientDraft(code, name);
    if (parsed.body === null) {
      setProblem(parsed.problem);
      return;
    }
    const session = readSession();
    if (session === null) return;
    inFlight.current = true;
    setProblem(null);
    setBusy(true);
    keyRef.current ??= ulid();
    try {
      const client = await fetchApiCreateClient(session.tenant.id, parsed.body, keyRef.current);
      keyRef.current = null;
      setCode('');
      setName('');
      onCreated(client);
    } catch (error) {
      onRejected(clientReason(error, 'created'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const edit = (apply: () => void) => {
    keyRef.current = null;
    apply();
  };

  return (
    <form onSubmit={submit} aria-label="New client" className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Code</span>
        <input
          className={inputClass}
          value={code}
          maxLength={32}
          required
          onChange={(event) => edit(() => setCode(event.target.value))}
          placeholder="ACME"
        />
      </label>
      <label className="flex min-w-48 flex-1 flex-col gap-1">
        <span className={labelClass}>Name</span>
        <input
          className={inputClass}
          value={name}
          required
          onChange={(event) => edit(() => setName(event.target.value))}
          placeholder="Acme Foods"
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-40"
      >
        {busy ? 'Adding…' : 'Add client'}
      </button>
      {problem !== null ? (
        <div role="alert" className="w-full text-xs text-(--destructive)">
          {problem}
        </div>
      ) : null}
    </form>
  );
}

function RenameClientForm({
  client,
  onClose,
  onRenamed,
  onRejected,
}: {
  client: ClientDto;
  onClose: () => void;
  onRenamed: (client: ClientDto) => void;
  onRejected: (reason: string) => void;
}) {
  const [name, setName] = useState(client.name);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const nameProblem = clientNameProblem(name);
    if (nameProblem !== null) {
      setProblem(nameProblem);
      return;
    }
    const trimmed = name.trim();
    const session = readSession();
    if (session === null) return;
    inFlight.current = true;
    setProblem(null);
    setBusy(true);
    keyRef.current ??= ulid();
    try {
      const renamed = await fetchApiRenameClient(session.tenant.id, client.id, trimmed, keyRef.current);
      keyRef.current = null;
      onRenamed(renamed);
    } catch (error) {
      onRejected(clientReason(error, 'renamed'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label={`Rename ${client.code}`} className="flex flex-wrap items-end gap-2">
      <label className="flex min-w-48 flex-1 flex-col gap-1">
        <span className={labelClass}>New name for {client.code}</span>
        <input
          className={inputClass}
          value={name}
          required
          onChange={(event) => {
            keyRef.current = null;
            setName(event.target.value);
          }}
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-40"
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
      <button type="button" onClick={onClose} className={rowButtonClass}>
        Cancel
      </button>
      {problem !== null ? (
        <div role="alert" className="w-full text-xs text-(--destructive)">
          {problem}
        </div>
      ) : null}
    </form>
  );
}

/**
 * Story 21-5 — a client brand's tax details: the legal name, GSTIN and
 * billing address its services tax invoices name it by. Only the CHANGED
 * fields are sent (an emptied field clears). Per-draft Idempotency-Key:
 * reused across retries of the unchanged form, cleared on any edit and on
 * success.
 */
function TaxDetailsForm({
  client,
  onClose,
  onSaved,
  onRejected,
}: {
  client: ClientDto;
  onClose: () => void;
  onSaved: (client: ClientDto, changed: boolean) => void;
  onRejected: (reason: string) => void;
}) {
  const [fields, setFields] = useState<TaxDetailsFields>(() => taxDetailsFieldsOf(client));
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const parsed = parseTaxDetailsDraft(fields, client.taxDetails);
    if (parsed.body === null) {
      setProblem(parsed.problem);
      return;
    }
    setProblem(null);
    if (Object.keys(parsed.body).length === 0) {
      onSaved(client, false);
      return;
    }
    const session = readSession();
    if (session === null) return;
    inFlight.current = true;
    setBusy(true);
    keyRef.current ??= ulid();
    try {
      const saved = await fetchApiUpdateClientTaxDetails(session.tenant.id, client.id, parsed.body, keyRef.current);
      keyRef.current = null;
      onSaved(saved, true);
    } catch (error) {
      onRejected(taxDetailsReason(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const edit = (field: TaxDetailField, value: string) => {
    keyRef.current = null;
    setFields((current) => ({ ...current, [field]: value }));
  };
  const text = (field: TaxDetailField, placeholder: string) => (
    <label className="flex min-w-48 flex-1 flex-col gap-1">
      <span className={labelClass}>{taxDetailLabel(field)}</span>
      <input
        className={inputClass}
        value={fields[field]}
        aria-label={taxDetailLabel(field)}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(event) => edit(field, event.target.value)}
      />
    </label>
  );

  return (
    <form onSubmit={submit} aria-label={`Tax details of ${client.code}`} className="flex flex-col gap-2 rounded-md border border-(--border) p-3">
      <div className="text-(--muted-foreground)">
        What {client.code}&apos;s services tax invoices name it by. A registered client is billed in its GSTIN&apos;s state; leave the GSTIN blank for an
        unregistered one. Clear a field to remove it.
      </div>
      <div className="flex flex-wrap gap-2">
        {text('legalName', 'Acme Foods Private Limited')}
        {text('gstin', '27AAACA1234A1Z5')}
      </div>
      <div className="flex flex-wrap gap-2">
        {text('billingLine1', '12 MG Road')}
        {text('billingLine2', 'Floor 3')}
      </div>
      <div className="flex flex-wrap gap-2">
        {text('billingCity', 'Pune')}
        <label className="flex min-w-48 flex-1 flex-col gap-1">
          <span className={labelClass}>{taxDetailLabel('billingStateCode')}</span>
          <select
            className={inputClass}
            value={fields.billingStateCode}
            aria-label={taxDetailLabel('billingStateCode')}
            onChange={(event) => edit('billingStateCode', event.target.value)}
          >
            <option value="">—</option>
            {BILLING_STATE_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {text('billingPincode', '411001')}
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Save tax details'}
        </button>
        <button type="button" onClick={onClose} className={rowButtonClass}>
          Cancel
        </button>
      </div>
      {problem !== null ? (
        <div role="alert" className="text-xs text-(--destructive)">
          {problem}
        </div>
      ) : null}
    </form>
  );
}
