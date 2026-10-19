'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import {
  fetchApiCreatePartner,
  fetchApiCreatePartnerLink,
  fetchApiUpdatePartner,
  fetchApiUpdatePartnerLink,
  fetchApiUpdatePartnerStatus,
} from '@/lib/api/client';
import type { ClientDto, PartnerDto } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import { BILLING_STATE_OPTIONS } from '@/lib/clients';
import {
  EMPTY_PARTNER_FORM,
  LINK_ROLES,
  PARTNER_ROLES,
  PARTNER_ROLE_LABEL,
  createPartnerBody,
  linkClientLabel,
  linkedClientsLabel,
  notifyPartnersChanged,
  panAfterGstinEdit,
  parseLinkClientCode,
  parsePartnerForm,
  parseReason,
  partnerFormOf,
  partnerReason,
  partnerStatusLabel,
  rolesLabel,
  updatePartnerBody,
  type PartnerAddressFields,
  type PartnerFormFields,
  type PartnerLink,
  type PartnerRole,
} from '@/lib/partners';
import { roleHasCapability } from '@/lib/users';
import { ulid } from '@/lib/ulid';
import { readyClients, useClients } from '@/lib/use-clients';
import { usePartners } from '@/lib/use-partners';

import { FeedbackBanner } from '@/components/feedback/banner';
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { ReadFailure } from '@/components/outbound/shell';
import { ConfirmRow } from '@/components/settings/confirm-row';

const inputClass =
  'w-full rounded-sm border border-(--input) bg-(--background) px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-(--ring)';
const labelClass = 'text-sm font-medium';
const rowButtonClass =
  'rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted) disabled:opacity-40';
const primaryButtonClass =
  'rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-40';

type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string } | null;

/** The one open panel below the table (opening one closes any other — after asking, over an unsaved draft). */
type Panel =
  | { kind: 'create' }
  | { kind: 'edit'; partner: PartnerDto }
  | { kind: 'links'; partner: PartnerDto }
  | { kind: 'deactivate'; partner: PartnerDto }
  | { kind: 'reactivate'; partner: PartnerDto };

function samePanel(a: Panel, b: Panel): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === 'create' || (b.kind !== 'create' && a.partner.id === b.partner.id);
}

function panelName(panel: Panel): string {
  return panel.kind === 'create' ? 'the new partner' : panel.partner.code;
}

/**
 * Story 1-3 — Settings → Partners: the business partner master. One partner
 * is one GST registration, playing the roles vendor, consignee and/or
 * transporter; vendors and consignees are linked to the clients that trade
 * with them (the tenant's own company included, shown "Your company"), a
 * vendor link optionally the client's default vendor. Every staff member
 * reads the list; `vendor.manage` (owner, ops manager) adds, edits, links and
 * deactivates. Nothing is deleted — a partner or a link is switched off.
 *
 * Gating copies `sku-table.tsx`: the role is read through the session
 * subscription, so a `/me` role rewrite re-renders the affordances.
 */
export function PartnersCard() {
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );
  if (sessioned === null) return null;
  if (!sessioned) {
    return (
      <div className="rounded-md border border-(--border) p-3 text-sm">
        <div className="font-medium">Partners</div>
        <div className="text-(--muted-foreground)">Sign in to see your partners.</div>
      </div>
    );
  }
  return <PartnersCardSessioned />;
}

function PartnersCardSessioned() {
  const partners = usePartners();
  const clients = readyClients(useClients());
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );
  const canManage = roleHasCapability(role, 'vendor.manage');
  const [panel, setPanel] = useState<Panel | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const dirtyRef = useRef(false);
  const [pending, setPending] = useState<Panel | null>(null);
  const panelRef = useRef<Panel | null>(null);
  useEffect(() => {
    panelRef.current = panel;
  }, [panel]);

  const show = (next: Panel | null) => {
    dirtyRef.current = false;
    setPending(null);
    setPanel(next);
    setOutcome(null);
  };
  const open = (next: Panel) => {
    if (panel !== null && samePanel(panel, next)) return;
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

  const rows = partners.state === 'ready' ? partners.data.items : [];

  const columns: readonly DataTableColumn<PartnerDto>[] = [
    { key: 'code', header: 'Code', render: (partner) => <span className="font-mono">{partner.code}</span> },
    { key: 'name', header: 'Partner', render: (partner) => partner.name },
    { key: 'roles', header: 'Roles', render: (partner) => rolesLabel(partner.roles) },
    { key: 'gstin', header: 'GSTIN', render: (partner) => <span className="font-mono text-xs">{partner.gstin ?? 'Unregistered'}</span> },
    { key: 'status', header: 'Status', render: (partner) => partnerStatusLabel(partner) },
    { key: 'clients', header: 'Linked clients', render: (partner) => <span className="text-xs">{linkedClientsLabel(partner, clients)}</span> },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: '',
            render: (partner: PartnerDto) => (
              <div className="flex flex-wrap gap-1">
                {rowButton('Edit', `Edit ${partner.code}`, { kind: 'edit', partner })}
                {rowButton('Links', `Client links of ${partner.code}`, { kind: 'links', partner })}
                {partner.status === 'active'
                  ? rowButton('Deactivate', `Deactivate ${partner.code}`, { kind: 'deactivate', partner })
                  : rowButton('Reactivate', `Reactivate ${partner.code}`, { kind: 'reactivate', partner })}
              </div>
            ),
          } satisfies DataTableColumn<PartnerDto>,
        ]
      : []),
  ];

  return (
    <section aria-label="Partners" className="flex flex-col gap-3 rounded-md border border-(--border) p-3 text-sm">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-medium">Partners</h2>
        <div className="text-(--muted-foreground)">
          The companies you trade with — vendors, consignees and transporters. One partner is one GST
          registration. Link vendors and consignees to the clients that use them: a purchase order&apos;s
          vendor must be an active vendor of its client.
        </div>
      </div>

      {partners.state === 'failed' ? (
        <ReadFailure word="Partners unavailable" reason={partners.reason} onRetry={partners.reload} />
      ) : (
        <DataTable<PartnerDto>
          key={partners.epoch}
          columns={columns}
          rows={rows}
          nextCursor={partners.state === 'ready' ? partners.data.nextCursor : null}
          onCursor={partners.onCursor}
          emptyMessage={partners.state === 'loading' ? 'Loading partners…' : 'No partners yet.'}
        />
      )}

      {canManage && panel === null ? (
        <div>
          <button type="button" onClick={() => open({ kind: 'create' })} className={rowButtonClass}>
            Add partner
          </button>
        </div>
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

      {canManage && (panel?.kind === 'create' || panel?.kind === 'edit') ? (
        <PartnerForm
          key={panel.kind === 'create' ? 'create' : panel.partner.id}
          partner={panel.kind === 'edit' ? panel.partner : null}
          onClose={() => show(null)}
          onDirtyChange={onDirtyChange}
          onSaved={(partner, changed) => {
            show(null);
            setOutcome(
              changed
                ? { tone: 'accepted', word: `${partner.code} ${panel.kind === 'create' ? 'added' : 'saved'}`, reason: panel.kind === 'create' ? 'Link it to the clients that trade with it under Links.' : 'Open purchase orders keep the details they were created with.' }
                : { tone: 'accepted', word: 'Nothing changed', reason: `${partner.code} is as entered.` },
            );
            if (changed) notifyPartnersChanged();
          }}
          onRejected={(reason) => setOutcome({ tone: 'rejected', word: panel.kind === 'create' ? 'Not added' : 'Not saved', reason })}
        />
      ) : null}

      {canManage && panel?.kind === 'links' ? (
        <PartnerLinksPanel
          key={panel.partner.id}
          partner={panel.partner}
          clients={clients}
          onClose={() => show(null)}
          onDirtyChange={onDirtyChange}
          onChanged={(updated, word, reason) => {
            // Keep the partner the server returned: the list reloads from its
            // first page, so a partner from a later page would show stale links.
            setPanel({ kind: 'links', partner: updated });
            setOutcome({ tone: 'accepted', word, reason });
            notifyPartnersChanged();
          }}
          onRejected={(word, reason) => setOutcome({ tone: 'rejected', word, reason })}
        />
      ) : null}

      {canManage && panel?.kind === 'deactivate' ? (
        <DeactivatePanel
          key={panel.partner.id}
          partner={panel.partner}
          onClose={() => show(null)}
          onDirtyChange={onDirtyChange}
          onDone={(partner) => {
            show(null);
            setOutcome({ tone: 'accepted', word: `${partner.code} deactivated`, reason: 'It is kept off new purchase orders and links; open purchase orders keep receiving. Its default-vendor flags were cleared.' });
            notifyPartnersChanged();
          }}
          onRejected={(reason) => setOutcome({ tone: 'rejected', word: 'Not deactivated', reason })}
        />
      ) : null}

      {canManage && panel?.kind === 'reactivate' ? (
        <ConfirmRow<PartnerDto>
          key={`reactivate-${panel.partner.id}`}
          question={`Reactivate ${panel.partner.name}? It can go on new purchase orders again; no default vendor comes back.`}
          confirmLabel={`Reactivate ${panel.partner.code}`}
          ariaLabel="Confirm reactivate"
          run={(key, tenantId) => fetchApiUpdatePartnerStatus(tenantId, panel.partner.id, { status: 'active' }, key)}
          reason={(error) => partnerReason(error, 'reactivated')}
          onClose={() => show(null)}
          onDone={(partner) => {
            if (panelRef.current?.kind === 'reactivate' && panelRef.current.partner.id === partner.id) {
              setPanel(null);
              setOutcome({ tone: 'accepted', word: `${partner.code} reactivated`, reason: 'Set it as a default vendor again under Links if it should be one.' });
            }
            notifyPartnersChanged();
          }}
          onRejected={(reason) => setOutcome({ tone: 'rejected', word: 'Not reactivated', reason })}
        />
      ) : null}

      {outcome !== null ? <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} /> : null}
    </section>
  );
}

/** A registered-shape address group (line 1, line 2, city, GST state, pincode). */
function AddressFieldset({
  legend,
  fields,
  onChange,
}: {
  legend: string;
  fields: PartnerAddressFields;
  onChange: (next: PartnerAddressFields) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2 rounded-sm border border-(--border) p-2">
      <legend className="px-1 text-xs font-medium">{legend} (leave blank for none)</legend>
      <div className="flex flex-wrap gap-2">
        <label className="flex min-w-48 flex-1 flex-col gap-1">
          <span className="text-xs">Line 1</span>
          <input className={inputClass} value={fields.line1} onChange={(e) => onChange({ ...fields, line1: e.target.value })} />
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1">
          <span className="text-xs">Line 2</span>
          <input className={inputClass} value={fields.line2} onChange={(e) => onChange({ ...fields, line2: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs">City</span>
          <input className={inputClass} value={fields.city} onChange={(e) => onChange({ ...fields, city: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs">State</span>
          <select className={inputClass} value={fields.stateCode} onChange={(e) => onChange({ ...fields, stateCode: e.target.value })}>
            <option value="">—</option>
            {BILLING_STATE_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs">Pincode</span>
          <input className={inputClass} value={fields.pincode} inputMode="numeric" onChange={(e) => onChange({ ...fields, pincode: e.target.value })} />
        </label>
      </div>
    </fieldset>
  );
}

/**
 * Add or edit a partner. Per-draft Idempotency-Key (ref form): minted on the
 * first submit, reused across retries of the unchanged draft, cleared on any
 * edit and on success. An edit sends only what changed (tri-state: a cleared
 * field is `null`); an edit that changes nothing sends nothing.
 */
function PartnerForm({
  partner,
  onClose,
  onDirtyChange,
  onSaved,
  onRejected,
}: {
  partner: PartnerDto | null;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onSaved: (partner: PartnerDto, changed: boolean) => void;
  onRejected: (reason: string) => void;
}) {
  const [fields, setFields] = useState<PartnerFormFields>(partner === null ? EMPTY_PARTNER_FORM : partnerFormOf(partner));
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);

  const edit = (next: PartnerFormFields) => {
    keyRef.current = null;
    onDirtyChange(true);
    setFields(next);
  };
  const toggleRole = (role: PartnerRole) =>
    edit({ ...fields, roles: fields.roles.includes(role) ? fields.roles.filter((r) => r !== role) : [...fields.roles, role] });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const parsed = parsePartnerForm(fields);
    if (parsed.partner === null) {
      setProblem(parsed.problem);
      return;
    }
    const session = readSession();
    if (session === null) return;
    if (partner !== null) {
      const body = updatePartnerBody(parsed.partner, partner);
      if (Object.keys(body).length === 0) {
        onDirtyChange(false);
        onSaved(partner, false);
        return;
      }
    }
    inFlight.current = true;
    setProblem(null);
    setBusy(true);
    keyRef.current ??= ulid();
    try {
      const saved =
        partner === null
          ? await fetchApiCreatePartner(session.tenant.id, createPartnerBody(parsed.partner), keyRef.current)
          : await fetchApiUpdatePartner(session.tenant.id, partner.id, updatePartnerBody(parsed.partner, partner), keyRef.current);
      keyRef.current = null;
      onDirtyChange(false);
      onSaved(saved, true);
    } catch (error) {
      onRejected(partnerReason(error, partner === null ? 'created' : 'saved'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const text = (key: 'code' | 'name' | 'legalName' | 'pan' | 'contactName' | 'contactPhone' | 'contactEmail', label: string, extra?: { maxLength?: number; required?: boolean; mono?: boolean }) => (
    <label className="flex min-w-40 flex-1 flex-col gap-1">
      <span className={labelClass}>{label}</span>
      <input
        className={`${inputClass}${extra?.mono === true ? ' font-mono' : ''}`}
        value={fields[key]}
        maxLength={extra?.maxLength}
        required={extra?.required}
        onChange={(e) => edit({ ...fields, [key]: e.target.value })}
      />
    </label>
  );

  return (
    <form onSubmit={submit} aria-label={partner === null ? 'New partner' : `Edit ${partner.code}`} className="flex flex-col gap-3 rounded-md border border-(--border) p-3">
      <div className="font-medium">{partner === null ? 'New partner' : `Edit ${partner.code}`}</div>
      <div className="flex flex-wrap gap-2">
        {text('code', 'Code', { maxLength: 64, required: true, mono: true })}
        {text('name', 'Name', { maxLength: 200, required: true })}
        {text('legalName', 'Legal name', { maxLength: 200 })}
      </div>
      <fieldset className="flex flex-wrap gap-3">
        <legend className={labelClass}>Roles</legend>
        {PARTNER_ROLES.map((role) => (
          <label key={role} className="flex items-center gap-1">
            <input type="checkbox" checked={fields.roles.includes(role)} onChange={() => toggleRole(role)} />
            <span>{PARTNER_ROLE_LABEL[role]}</span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <label className="flex min-w-40 flex-1 flex-col gap-1">
          <span className={labelClass}>GSTIN</span>
          <input
            className={`${inputClass} font-mono`}
            value={fields.gstin}
            onChange={(e) => edit({ ...fields, gstin: e.target.value, pan: panAfterGstinEdit(fields.gstin, e.target.value, fields.pan) })}
          />
          <span className="text-xs text-(--muted-foreground)">Blank for an unregistered supplier. One partner is one GST registration.</span>
        </label>
        <label className="flex min-w-40 flex-1 flex-col gap-1">
          <span className={labelClass}>PAN</span>
          <input className={`${inputClass} font-mono`} value={fields.pan} maxLength={10} onChange={(e) => edit({ ...fields, pan: e.target.value })} />
          <span className="text-xs text-(--muted-foreground)">Taken from the GSTIN when left blank.</span>
        </label>
      </div>
      <AddressFieldset legend="Registered address" fields={fields.registeredAddress} onChange={(next) => edit({ ...fields, registeredAddress: next })} />
      <AddressFieldset legend="Dispatch address" fields={fields.dispatchAddress} onChange={(next) => edit({ ...fields, dispatchAddress: next })} />
      <div className="flex flex-wrap gap-2">
        {text('contactName', 'Contact name', { maxLength: 120 })}
        {text('contactPhone', 'Contact phone', { maxLength: 20 })}
        {text('contactEmail', 'Contact email', { maxLength: 254 })}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={primaryButtonClass}>
          {busy ? 'Saving…' : partner === null ? 'Add partner' : 'Save'}
        </button>
        <button type="button" disabled={busy} onClick={onClose} className={rowButtonClass}>
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

/**
 * Deactivate with an optional reason — per-confirmation Idempotency-Key,
 * cleared when the reason is edited (it is in the request hash).
 */
function DeactivatePanel({
  partner,
  onClose,
  onDirtyChange,
  onDone,
  onRejected,
}: {
  partner: PartnerDto;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onDone: (partner: PartnerDto) => void;
  onRejected: (reason: string) => void;
}) {
  const [reasonText, setReasonText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);

  async function confirm() {
    if (inFlight.current) return;
    const parsed = parseReason(reasonText);
    if (parsed.problem !== null) {
      setProblem(parsed.problem);
      return;
    }
    const session = readSession();
    if (session === null) return;
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    keyRef.current ??= ulid();
    try {
      const saved = await fetchApiUpdatePartnerStatus(
        session.tenant.id,
        partner.id,
        { status: 'inactive', ...(parsed.reason === null ? {} : { reason: parsed.reason }) },
        keyRef.current,
      );
      onDirtyChange(false);
      onDone(saved);
    } catch (error) {
      onRejected(partnerReason(error, 'deactivated'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div role="group" aria-label="Confirm deactivate" className="flex flex-wrap items-end gap-2">
      <span className="w-full">
        Deactivate {partner.name}? It is kept off new purchase orders and links, and its default-vendor flags are cleared. Open purchase orders keep receiving.
      </span>
      <label className="flex min-w-48 flex-1 flex-col gap-1">
        <span className="text-xs">Reason (optional)</span>
        <input
          className={inputClass}
          value={reasonText}
          maxLength={200}
          onChange={(e) => {
            keyRef.current = null;
            onDirtyChange(true);
            setReasonText(e.target.value);
          }}
        />
      </label>
      <button type="button" disabled={busy} onClick={confirm} className={primaryButtonClass}>
        Deactivate {partner.code}
      </button>
      <button type="button" disabled={busy} onClick={onClose} className={rowButtonClass}>
        Keep
      </button>
      {problem !== null ? (
        <div role="alert" className="w-full text-xs text-(--destructive)">
          {problem}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A partner's client links: each link's client, role, the client's own code,
 * the default-vendor flag and whether it is on, with its row actions, plus the
 * add-link form. Row actions are per click with a synchronous re-entry
 * guard; the add form's key is per draft.
 */
function PartnerLinksPanel({
  partner,
  clients,
  onClose,
  onDirtyChange,
  onChanged,
  onRejected,
}: {
  partner: PartnerDto;
  clients: readonly ClientDto[] | null;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onChanged: (partner: PartnerDto, word: string, reason: string) => void;
  onRejected: (word: string, reason: string) => void;
}) {
  const linkRoles = LINK_ROLES.filter((role) => partner.roles.includes(role));
  const [clientId, setClientId] = useState('');
  const [role, setRole] = useState<PartnerLink['role'] | ''>(linkRoles[0] ?? '');
  const [clientCode, setClientCode] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);
  const rowInFlight = useRef<Set<string>>(new Set());
  const [rowBusy, setRowBusy] = useState<ReadonlySet<string>>(new Set());
  const [codeEdit, setCodeEdit] = useState<{ linkId: string; text: string } | null>(null);

  const editAdd = (apply: () => void) => {
    keyRef.current = null;
    onDirtyChange(true);
    apply();
  };

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    setProblem(null);
    if (clientId === '' || role === '') {
      setProblem('Pick a client and a role.');
      return;
    }
    const code = parseLinkClientCode(clientCode);
    if (code.problem !== null) {
      setProblem(code.problem);
      return;
    }
    const session = readSession();
    if (session === null) return;
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    keyRef.current ??= ulid();
    try {
      const updated = await fetchApiCreatePartnerLink(
        session.tenant.id,
        partner.id,
        {
          clientId,
          role,
          ...(code.clientCode === null ? {} : { clientCode: code.clientCode }),
          ...(role === 'vendor' && isDefault ? { isDefault: true } : {}),
        },
        keyRef.current,
      );
      keyRef.current = null;
      onDirtyChange(false);
      const label = linkClientLabel(clientId, clients);
      setClientId('');
      setClientCode('');
      setIsDefault(false);
      onChanged(updated, `${partner.code} linked to ${label}`, `As a ${PARTNER_ROLE_LABEL[role].toLowerCase()}${role === 'vendor' && isDefault ? ', the client’s default vendor' : ''}.`);
    } catch (error) {
      onRejected('Not linked', partnerReason(error, 'linked'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function patchLink(link: PartnerLink, body: { active?: boolean; isDefault?: boolean; clientCode?: string | null }, word: string) {
    if (rowInFlight.current.has(link.id)) return;
    const session = readSession();
    if (session === null) return;
    rowInFlight.current.add(link.id);
    setRowBusy(new Set(rowInFlight.current));
    setProblem(null);
    try {
      const updated = await fetchApiUpdatePartnerLink(session.tenant.id, partner.id, link.id, body, ulid());
      setCodeEdit(null);
      onChanged(updated, word, `${linkClientLabel(link.clientId, clients)} · ${PARTNER_ROLE_LABEL[link.role]}`);
    } catch (error) {
      onRejected('Link not changed', partnerReason(error, 'linked'));
    } finally {
      rowInFlight.current.delete(link.id);
      setRowBusy(new Set(rowInFlight.current));
    }
  }

  return (
    <div role="group" aria-label={`Client links of ${partner.code}`} className="flex flex-col gap-3 rounded-md border border-(--border) p-3">
      <div className="font-medium">Client links of {partner.code}</div>
      {partner.links.length === 0 ? (
        <div className="text-(--muted-foreground)">Not linked to any client yet.</div>
      ) : (
        <ul className="flex flex-col gap-2" aria-label="Links">
          {partner.links.map((link) => {
            const busyRow = rowBusy.has(link.id);
            const editing = codeEdit !== null && codeEdit.linkId === link.id;
            return (
              <li key={link.id} data-link={link.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{linkClientLabel(link.clientId, clients)}</span>
                <span>{PARTNER_ROLE_LABEL[link.role]}</span>
                <span className="font-mono text-xs">{link.clientCode ?? 'no client code'}</span>
                <span>{link.active ? 'On' : 'Off'}</span>
                {link.isDefault ? <span className="text-xs font-medium">Default vendor</span> : null}
                {editing ? (
                  <>
                    <input
                      aria-label="Client's code"
                      className={`${inputClass} w-40`}
                      value={codeEdit.text}
                      maxLength={64}
                      onChange={(e) => {
                        setProblem(null);
                        setCodeEdit({ linkId: link.id, text: e.target.value });
                      }}
                    />
                    <button
                      type="button"
                      disabled={busyRow}
                      className={rowButtonClass}
                      onClick={() => {
                        const parsed = parseLinkClientCode(codeEdit.text);
                        if (parsed.problem !== null) {
                          setProblem(parsed.problem);
                          return;
                        }
                        void patchLink(link, { clientCode: parsed.clientCode }, 'Client code saved');
                      }}
                    >
                      Save code
                    </button>
                    <button
                      type="button"
                      className={rowButtonClass}
                      onClick={() => {
                        setProblem(null);
                        setCodeEdit(null);
                      }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button type="button" disabled={busyRow} className={rowButtonClass} onClick={() => {
                      setProblem(null);
                      setCodeEdit({ linkId: link.id, text: link.clientCode ?? '' });
                    }}
                  >
                    Edit code
                  </button>
                )}
                {link.active && link.role === 'vendor' && partner.status === 'active' ? (
                  link.isDefault ? (
                    <button type="button" disabled={busyRow} className={rowButtonClass} onClick={() => void patchLink(link, { isDefault: false }, 'Default vendor cleared')}>
                      Clear default
                    </button>
                  ) : (
                    <button type="button" disabled={busyRow} className={rowButtonClass} onClick={() => void patchLink(link, { isDefault: true }, 'Default vendor set')}>
                      Make default
                    </button>
                  )
                ) : null}
                {link.active ? (
                  <button type="button" disabled={busyRow} className={rowButtonClass} onClick={() => void patchLink(link, { active: false }, 'Link switched off')}>
                    Switch off
                  </button>
                ) : partner.status === 'active' ? (
                  <button type="button" disabled={busyRow} className={rowButtonClass} onClick={() => void patchLink(link, { active: true }, 'Link switched on')}>
                    Switch on
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {partner.status !== 'active' ? (
        <div className="text-(--muted-foreground)">This partner is inactive — reactivate it to add or switch on links.</div>
      ) : linkRoles.length === 0 ? (
        <div className="text-(--muted-foreground)">A transporter is shared by every client — it is never linked.</div>
      ) : (
        <form onSubmit={add} aria-label={`Link ${partner.code} to a client`} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs">Client</span>
            <select className={inputClass} value={clientId} onChange={(e) => editAdd(() => setClientId(e.target.value))}>
              <option value="">Choose a client</option>
              {(clients ?? [])
                .filter((client) => client.status !== 'departed')
                .map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.systemOwned ? 'Your company' : `${client.code} — ${client.name}`}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs">Role</span>
            <select className={inputClass} value={role} onChange={(e) => editAdd(() => setRole(e.target.value as PartnerLink['role']))}>
              {linkRoles.map((r) => (
                <option key={r} value={r}>
                  {PARTNER_ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs">Client&apos;s code (optional)</span>
            <input className={inputClass} value={clientCode} maxLength={64} onChange={(e) => editAdd(() => setClientCode(e.target.value))} />
          </label>
          {role === 'vendor' ? (
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={isDefault} onChange={(e) => editAdd(() => setIsDefault(e.target.checked))} />
              <span className="text-xs">Client&apos;s default vendor</span>
            </label>
          ) : null}
          <button type="submit" disabled={busy} className={primaryButtonClass}>
            {busy ? 'Linking…' : 'Link'}
          </button>
        </form>
      )}
      {problem !== null ? (
        <div role="alert" className="text-xs text-(--destructive)">
          {problem}
        </div>
      ) : null}
      <div>
        <button type="button" onClick={onClose} className={rowButtonClass}>
          Close
        </button>
      </div>
    </div>
  );
}
