'use client';

import { useRef, useState, useSyncExternalStore } from 'react';

import { fetchApiAddLicence, fetchApiEditLicence, fetchApiWithdrawLicence } from '@/lib/api/client';
import type { ClientDto, LicenceDto, LicenceListItemDto, WarehouseResponse } from '@/lib/api/generated';
import { readSession, subscribeSession } from '@/lib/auth';
import {
  ALL_COVERED_COPY,
  LICENCE_KINDS,
  LICENCE_KIND_LABEL,
  LICENCE_NOTE_MAX,
  emptyLicenceDraft,
  expiryBadge,
  gapSentence,
  licenceDateCell,
  licenceDraftOf,
  licenceReason,
  notifyLicencesChanged,
  parseLicenceDraft,
  parseLicenceEdit,
  validUntilLabel,
  type LicenceDraft,
  type LicenceKind,
} from '@/lib/licences';
import { formatIstDate } from '@/lib/rate-cards';
import { ulid } from '@/lib/ulid';
import { useClients } from '@/lib/use-clients';
import { useLicences } from '@/lib/use-licences';
import { useTenantWarehouses } from '@/lib/use-tenant-warehouses';
import { roleHasCapability } from '@/lib/users';

import { FeedbackBanner } from '@/components/feedback/banner';
import { ConfirmRow } from '@/components/settings/confirm-row';
import { ReadFailure, Section, inputClass, labelClass, primaryClass, rowButtonClass, selectClass } from '@/components/shared/surface';

type Mode = { kind: 'list' } | { kind: 'add' } | { kind: 'edit'; licence: LicenceDto } | { kind: 'withdraw'; licence: LicenceDto };
type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string } | null;

const BADGE_CLASS: Readonly<Record<'ok' | 'warning' | 'muted', string>> = {
  ok: 'border-(--border)',
  warning: 'border-(--warning) text-(--warning)',
  muted: 'border-(--border) text-(--muted-foreground)',
};

/**
 * Story 1-6c — Compliance → Licences: the coverage gaps first (worded from
 * each gap's `coveredBy`), then every licence with the server's expiry badge
 * for its own IST date. Every staff session reads both; an owner
 * (`licences.manage`) adds, edits and withdraws. The browser clock is never
 * read — the badge, the days left and "today" are the server's.
 */
export function Licences() {
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );
  if (sessioned === null) return null;
  if (!sessioned) {
    return (
      <Section title="Licences">
        <div className="text-(--muted-foreground)">Sign in to read the licences.</div>
      </Section>
    );
  }
  return <LicencesSessioned canManage={roleHasCapability(role, 'licences.manage')} />;
}

function LicencesSessioned({ canManage }: { canManage: boolean }) {
  const licences = useLicences();
  const clients = useClients();
  const warehouses = useTenantWarehouses();
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [outcome, setOutcome] = useState<Outcome>(null);

  const clientList: readonly ClientDto[] = clients.state === 'ready' ? clients.data : [];
  const siteList: readonly WarehouseResponse[] = warehouses.state === 'ready' ? warehouses.data.items : [];
  const clientLabel = (id: string) => clientList.find((client) => client.id === id)?.code ?? `Client ${id.slice(-8)}`;
  const siteLabel = (id: string) => siteList.find((site) => site.id === id)?.code ?? `Site ${id.slice(-8)}`;

  const done = (next: Outcome) => {
    setMode({ kind: 'list' });
    setOutcome(next);
    notifyLicencesChanged();
  };

  if (licences.state === 'loading') {
    return (
      <Section title="Licences">
        <div className="text-(--muted-foreground)">Loading licences…</div>
      </Section>
    );
  }
  if (licences.state === 'failed') {
    return (
      <Section title="Licences">
        <ReadFailure word="Licences not loaded" reason={licences.reason} onRetry={licences.reload} />
      </Section>
    );
  }
  const { asOfDate, items, gaps } = licences.data;

  return (
    <div className="flex flex-col gap-4">
      <Section title="Coverage gaps">
        <div className="text-(--muted-foreground)">
          Wherever drug or food goods are — on hand, or on an open purchase order or ASN — each needs a client licence and a site
          licence, valid on {formatIstDate(asOfDate)} (IST).
        </div>
        {gaps.length === 0 ? (
          <div role="status">{ALL_COVERED_COPY}</div>
        ) : (
          <ul aria-label="Coverage gaps" className="flex flex-col gap-1">
            {gaps.map((gap) => (
              <li key={`${gap.holder}-${gap.clientId ?? ''}-${gap.warehouseId}-${gap.need}`} className="text-(--warning)">
                {gapSentence(gap, { client: clientLabel, site: siteLabel })}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Licences"
        action={
          canManage && mode.kind === 'list' ? (
            <button type="button" className={rowButtonClass} onClick={() => { setOutcome(null); setMode({ kind: 'add' }); }}>
              Add licence
            </button>
          ) : undefined
        }
      >
        {items.length === 0 ? (
          <div className="text-(--muted-foreground)">No licences recorded yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-(--border)">
                  <th className="py-1 pr-3 font-medium">Holder</th>
                  <th className="py-1 pr-3 font-medium">Site</th>
                  <th className="py-1 pr-3 font-medium">Kind</th>
                  <th className="py-1 pr-3 font-medium">Number</th>
                  <th className="py-1 pr-3 font-medium">Valid from</th>
                  <th className="py-1 pr-3 font-medium">Valid until</th>
                  <th className="py-1 pr-3 font-medium">Status</th>
                  <th className="py-1 pr-3 font-medium">Note</th>
                  {canManage ? <th className="py-1 font-medium"><span className="sr-only">Actions</span></th> : null}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <LicenceRow
                    key={item.id}
                    item={item}
                    holder={item.clientId === null ? 'Site' : clientLabel(item.clientId)}
                    site={item.warehouseId === null ? 'All sites' : siteLabel(item.warehouseId)}
                    showActions={canManage}
                    actionsEnabled={mode.kind === 'list'}
                    onEdit={() => { setOutcome(null); setMode({ kind: 'edit', licence: item }); }}
                    onWithdraw={() => { setOutcome(null); setMode({ kind: 'withdraw', licence: item }); }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {canManage && mode.kind === 'add' ? (
          <LicenceForm
            key="add"
            mode="add"
            initial={emptyLicenceDraft()}
            clients={clientList.filter((client) => !client.systemOwned && client.status !== 'departed')}
            sites={siteList}
            onCancel={() => setMode({ kind: 'list' })}
            onSaved={(licence) => done({ tone: 'accepted', word: 'Licence added', reason: `${LICENCE_KIND_LABEL[licence.kind]} ${licence.number} is recorded.` })}
            onRejected={(reason) => setOutcome({ tone: 'rejected', word: 'Licence not added', reason })}
          />
        ) : null}

        {canManage && mode.kind === 'edit' ? (
          <LicenceForm
            key={`edit-${mode.licence.id}`}
            mode="edit"
            licenceId={mode.licence.id}
            initial={licenceDraftOf(mode.licence)}
            clients={clientList}
            sites={siteList}
            onCancel={() => setMode({ kind: 'list' })}
            onSaved={(licence) => done({ tone: 'accepted', word: 'Licence saved', reason: `${LICENCE_KIND_LABEL[licence.kind]} ${licence.number} is up to date.` })}
            onRejected={(reason) => setOutcome({ tone: 'rejected', word: 'Licence not saved', reason })}
          />
        ) : null}

        {canManage && mode.kind === 'withdraw' ? (
          <ConfirmRow<LicenceDto>
            key={`withdraw-${mode.licence.id}`}
            question={`Withdraw ${LICENCE_KIND_LABEL[mode.licence.kind]} ${mode.licence.number}? It stays on record, and its number is free again.`}
            confirmLabel="Withdraw licence"
            ariaLabel="Confirm withdraw licence"
            run={(key, tenantId) => fetchApiWithdrawLicence(tenantId, mode.licence.id, key)}
            reason={(error) => licenceReason(error, 'withdraw')}
            onClose={() => setMode({ kind: 'list' })}
            onDone={(licence) => done({ tone: 'accepted', word: 'Licence withdrawn', reason: `${LICENCE_KIND_LABEL[licence.kind]} ${licence.number} is withdrawn.` })}
            onRejected={(reason) => setOutcome({ tone: 'rejected', word: 'Licence not withdrawn', reason })}
          />
        ) : null}

        {outcome !== null ? <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} /> : null}
      </Section>
    </div>
  );
}

function LicenceRow({
  item,
  holder,
  site,
  showActions,
  actionsEnabled,
  onEdit,
  onWithdraw,
}: {
  item: LicenceListItemDto;
  holder: string;
  site: string;
  /** The owner's column (`licences.manage`) — absent for every other role, not merely disabled. */
  showActions: boolean;
  /** False while a form or a confirmation is open. */
  actionsEnabled: boolean;
  onEdit: () => void;
  onWithdraw: () => void;
}) {
  const badge = expiryBadge(item);
  const active = item.status === 'active';
  return (
    <tr className="border-b border-(--border) last:border-b-0" data-licence={item.id}>
      <td className="py-1 pr-3">{holder}</td>
      <td className="py-1 pr-3">{site}</td>
      <td className="py-1 pr-3">{LICENCE_KIND_LABEL[item.kind]}</td>
      <td className="py-1 pr-3 data">{item.number}</td>
      <td className="py-1 pr-3 data">{licenceDateCell(item.validFrom)}</td>
      <td className="py-1 pr-3 data" title={validUntilLabel(item.kind)}>
        {licenceDateCell(item.validUntil)}
      </td>
      <td className="py-1 pr-3">
        <span className={`rounded-sm border px-1 text-xs ${BADGE_CLASS[badge.tone]}`}>{badge.text}</span>
      </td>
      <td className="py-1 pr-3 text-(--muted-foreground)">{item.note ?? ''}</td>
      {showActions ? (
        <td className="py-1">
          {/* A withdrawn licence offers nothing: the server would refuse it (409 licence-withdrawn). */}
          {active ? (
            <div className="flex gap-1">
              <button type="button" className={rowButtonClass} disabled={!actionsEnabled} aria-label={`Edit ${item.number}`} onClick={onEdit}>
                Edit
              </button>
              <button
                type="button"
                className={rowButtonClass}
                disabled={!actionsEnabled}
                aria-label={`Withdraw ${item.number}`}
                onClick={onWithdraw}
              >
                Withdraw
              </button>
            </div>
          ) : null}
        </td>
      ) : null}
    </tr>
  );
}

/**
 * The add / edit form. Per-draft Idempotency-Key (`keyRef.current ??=
 * ulid()`, the `client-contacts.tsx` shape): reused across retries of the
 * unchanged draft, cleared on any edit and on success. On edit the holder,
 * site and kind are fixed (shown, not editable) — a correction is a
 * withdraw plus a new add.
 */
function LicenceForm({
  mode,
  licenceId,
  initial,
  clients,
  sites,
  onCancel,
  onSaved,
  onRejected,
}: {
  mode: 'add' | 'edit';
  licenceId?: string;
  initial: LicenceDraft;
  clients: readonly ClientDto[];
  sites: readonly WarehouseResponse[];
  onCancel: () => void;
  onSaved: (licence: LicenceDto) => void;
  onRejected: (reason: string) => void;
}) {
  const [draft, setDraft] = useState<LicenceDraft>(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);
  const fixed = mode === 'edit';

  const edit = (next: LicenceDraft) => {
    keyRef.current = null;
    setDraft(next);
  };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const session = readSession();
    if (session === null) return;
    const tenantId = session.tenant.id;
    let send: (key: string) => Promise<LicenceDto>;
    if (fixed && licenceId !== undefined) {
      const parsed = parseLicenceEdit(draft);
      if (parsed.body === null) {
        setProblem(parsed.problem);
        return;
      }
      const body = parsed.body;
      send = (key) => fetchApiEditLicence(tenantId, licenceId, body, key);
    } else {
      const parsed = parseLicenceDraft(draft);
      if (parsed.body === null) {
        setProblem(parsed.problem);
        return;
      }
      const body = parsed.body;
      send = (key) => fetchApiAddLicence(tenantId, body, key);
    }
    inFlight.current = true;
    setProblem(null);
    setBusy(true);
    keyRef.current ??= ulid();
    try {
      const licence = await send(keyRef.current);
      keyRef.current = null;
      onSaved(licence);
    } catch (error) {
      onRejected(licenceReason(error, fixed ? 'edit' : 'add'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label={fixed ? 'Edit licence' : 'Add licence'} className="flex flex-col gap-2 border-t border-(--border) pt-3">
      <fieldset disabled={fixed} className="flex flex-wrap gap-3">
        <legend className={labelClass}>Holder</legend>
        <label className="flex items-center gap-1">
          <input type="radio" name="holder" checked={draft.holder === 'client'} onChange={() => edit({ ...draft, holder: 'client' })} />
          A client
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" name="holder" checked={draft.holder === 'site'} onChange={() => edit({ ...draft, holder: 'site', clientId: '' })} />
          A site (your own)
        </label>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        {draft.holder === 'client' ? (
          <label className="flex min-w-48 flex-1 flex-col gap-1">
            <span className={labelClass}>Client</span>
            <select className={selectClass} value={draft.clientId} disabled={fixed} onChange={(event) => edit({ ...draft, clientId: event.target.value })}>
              <option value="">Choose a client</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.code} — {client.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="flex min-w-48 flex-1 flex-col gap-1">
          <span className={labelClass}>{draft.holder === 'client' ? 'Site (optional — none for a head-office licence)' : 'Site'}</span>
          <select className={selectClass} value={draft.warehouseId} disabled={fixed} onChange={(event) => edit({ ...draft, warehouseId: event.target.value })}>
            <option value="">{draft.holder === 'client' ? 'All sites' : 'Choose a site'}</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.code} — {site.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-48 flex-1 flex-col gap-1">
          <span className={labelClass}>Kind</span>
          <select className={selectClass} value={draft.kind} disabled={fixed} onChange={(event) => edit({ ...draft, kind: event.target.value as LicenceKind })}>
            {LICENCE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {LICENCE_KIND_LABEL[kind]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="flex min-w-48 flex-1 flex-col gap-1">
          <span className={labelClass}>Number</span>
          <input className={inputClass} value={draft.number} required maxLength={100} onChange={(event) => edit({ ...draft, number: event.target.value })} />
        </label>
        <label className="flex min-w-36 flex-col gap-1">
          <span className={labelClass}>Valid from</span>
          <input type="date" className={inputClass} value={draft.validFrom} onChange={(event) => edit({ ...draft, validFrom: event.target.value })} />
        </label>
        <label className="flex min-w-36 flex-col gap-1">
          <span className={labelClass}>{validUntilLabel(draft.kind)}</span>
          <input type="date" className={inputClass} value={draft.validUntil} onChange={(event) => edit({ ...draft, validUntil: event.target.value })} />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Note</span>
        <input className={inputClass} value={draft.note} maxLength={LICENCE_NOTE_MAX * 2} onChange={(event) => edit({ ...draft, note: event.target.value })} />
      </label>
      {problem !== null ? (
        <div role="alert" className="text-sm text-(--warning)">
          {problem}
        </div>
      ) : null}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={primaryClass}>
          {fixed ? 'Save licence' : 'Add licence'}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className={rowButtonClass}>
          Cancel
        </button>
      </div>
    </form>
  );
}
