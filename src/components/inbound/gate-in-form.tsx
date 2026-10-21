'use client';

import { useRef, useState } from 'react';

import { ApiProblem, fetchApiAmendGateIn, fetchApiCreateGateIn } from '@/lib/api/client';
import type { ClientDto, GateInDetailDto, GateInDto } from '@/lib/api/generated';
import { readSession } from '@/lib/auth';
import {
  DOCUMENT_KINDS,
  DOCUMENT_KIND_LABEL,
  EMPTY_DRAFT_DOCUMENT,
  GATE_IN_LIMITS,
  SEAL_STATUSES,
  SEAL_STATUS_LABEL,
  VEHICLE_RULE,
  amendGateInBody,
  createGateInBody,
  draftOfGateIn,
  emptyGateInDraft,
  gateInClientName,
  gateInReason,
  isTransporterRefusal,
  linkOptionLabel,
  parseGateInDraft,
  savedLinkOption,
  type GateInDraft,
  type GateInDraftDocument,
  type GateInLinkOption,
} from '@/lib/gate-ins';
import { useGateInLinkSources, useTransporterOptions } from '@/lib/use-gate-ins';
import { ulid } from '@/lib/ulid';

import { ReadFailure } from '@/components/shared/surface';
import { lineButtonClass as buttonClass, lineInputClass as inputClass } from '@/components/shared/line-rows';

/**
 * Story 2-3a — the Record / Edit gate-in form (modelled on `po-create-form`):
 * the vehicle (or a hand delivery) and its container, the transporter (an
 * active `transporter` partner, or "Not listed — type the name"), the LR and
 * the driver, the seal, the packages declared, the dock door, the gated-in
 * time (a `datetime-local` read as IST) and 0–20 supplier documents, each
 * optionally covering one of the warehouse's open POs or ASNs (any client).
 *
 * The Idempotency-Key is per DRAFT (minted on the first submit, reused on a
 * retry, cleared on any edit), with an in-flight ref. The parent mounts it
 * keyed by the warehouse (and the gate-in, for an edit), so a switch drops the
 * draft and its key. `noValidate`: the parser is the only gate, with ONE
 * form-level problem naming the field or the document row.
 *
 * Edit is a full replacement: every field is sent (blank → null); the time
 * rides only while `gated_in` or when changed (`amendGateInBody`) — and the
 * input is locked once the unload started (decision 14).
 */

const primaryClass =
  'rounded-sm bg-(--primary) px-3 py-1 text-xs font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60';

export function GateInForm({
  warehouseId,
  clients,
  tenantName,
  editing = null,
  onCancel,
  onSaved,
}: {
  warehouseId: string;
  /** The tenant's clients (the link options name theirs); null while loading. */
  clients: readonly ClientDto[] | null;
  tenantName: string | null;
  /** The gate-in being edited (its detail — the full phone, the documents' codes); null records a new one. */
  editing?: GateInDetailDto | null;
  onCancel: () => void;
  onSaved: (gateIn: GateInDto, mode: 'record' | 'edit') => void;
}) {
  const mode = editing === null ? 'record' : 'edit';
  const [draft, setDraft] = useState<GateInDraft>(() => (editing === null ? emptyGateInDraft() : draftOfGateIn(editing)));
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Per DRAFT: a write that timed out after the server committed must replay
  // on a retry, never record a second gate-in.
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false);

  const transporters = useTransporterOptions();
  const links = useGateInLinkSources(warehouseId);
  // Decision 14 — the time is editable only while the truck waits at the gate.
  const timeLocked = editing !== null && editing.status !== 'gated_in';
  // Decision 16 — the seal and the declared count lock once the unload ended.
  const securityLocked = editing !== null && editing.unloadEndedAt !== null;

  function edit(patch: Partial<GateInDraft>) {
    keyRef.current = null;
    setProblem(null);
    setDraft((current) => ({ ...current, ...patch }));
  }

  function editDocument(index: number, patch: Partial<GateInDraftDocument>) {
    edit({ documents: draft.documents.map((doc, i) => (i === index ? { ...doc, ...patch } : doc)) });
  }

  async function submit() {
    const session = readSession();
    if (session === null || inFlight.current) return;
    const parsed = parseGateInDraft(draft);
    if (parsed.header === null) {
      setProblem(parsed.problem);
      return;
    }
    const key = keyRef.current ?? ulid();
    keyRef.current = key;
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const { gateIn } =
        editing === null
          ? await fetchApiCreateGateIn(session.tenant.id, createGateInBody(parsed.header, warehouseId, draft.gatedInAtEdited), key)
          : await fetchApiAmendGateIn(session.tenant.id, editing.id, amendGateInBody(parsed.header, editing, draft.gatedInAt), key);
      keyRef.current = null;
      onSaved(gateIn, mode);
    } catch (error) {
      // The draft is kept as typed; a stale option is re-read.
      setProblem(gateInReason(error));
      if (isTransporterRefusal(error)) transporters.reload();
      if (error instanceof ApiProblem && (error.code === 'document-warehouse-mismatch' || error.code === 'not-found')) links.reload();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  // The link options: open POs and announced / partially received ASNs, every
  // client — plus each saved link that is no longer among them (kept as is).
  const clientName = (clientId: string | null | undefined) =>
    gateInClientName(clients?.find((entry) => entry.id === clientId), tenantName);
  const openOptions: GateInLinkOption[] =
    links.state === 'ready'
      ? [
          ...links.data.pos.map((po) => ({ value: `po:${po.id}`, label: linkOptionLabel(po.code, po.vendorSnapshot?.name ?? null, clientName(po.clientId)) })),
          ...links.data.asns.map((asn) => ({ value: `asn:${asn.id}`, label: linkOptionLabel(asn.code, null, clientName(asn.clientId)) })),
        ]
      : [];
  const savedOptions: GateInLinkOption[] = (editing?.documents ?? [])
    .map(savedLinkOption)
    .filter((option): option is GateInLinkOption => option !== null && !openOptions.some((open) => open.value === option.value));

  // A saved transporter partner no longer offered (deactivated) stays choosable:
  // an amend re-asserts the transporter only when it changes (D33).
  const savedPartner =
    editing !== null && editing.transporterPartnerId !== null && transporters.state === 'ready' && !transporters.data.some((p) => p.id === editing.transporterPartnerId)
      ? { id: editing.transporterPartnerId, label: `${editing.transporterLabel} (no longer listed)` }
      : null;
  const typed = draft.transporterMode === 'typed';

  return (
    <form
      aria-label={mode === 'record' ? 'Record a gate-in' : `Edit ${editing?.code ?? 'gate-in'}`}
      noValidate
      className="flex flex-col gap-2 rounded-sm border border-(--border) p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="text-xs font-medium">{mode === 'record' ? 'Record a gate-in' : `Edit ${editing?.code}`}</div>
      {/* Nothing is editable while a write is in flight: an edit would clear
          the key, and a retry after a dropped-but-committed write must replay. */}
      <fieldset disabled={busy} className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              aria-label="Hand delivery"
              checked={draft.handDelivery}
              onChange={(event) => edit({ handDelivery: event.target.checked })}
            />
            Hand delivery (no vehicle)
          </label>
          <input
            type="text"
            aria-label="Vehicle number"
            placeholder={draft.handDelivery ? 'Vehicle number (optional)' : 'Vehicle number'}
            title={VEHICLE_RULE}
            value={draft.vehicleNo}
            onChange={(event) => edit({ vehicleNo: event.target.value })}
            className={`${inputClass} w-36`}
          />
          <input
            type="text"
            aria-label="Container number"
            placeholder="Container (optional)"
            value={draft.containerNo}
            onChange={(event) => edit({ containerNo: event.target.value })}
            className={`${inputClass} w-36`}
          />
        </div>
        <div className="text-xs text-(--muted-foreground)">Vehicle: {VEHICLE_RULE}.</div>

        <div className="flex flex-wrap items-center gap-2">
          {!typed && transporters.state === 'loading' && <span className="text-xs text-(--muted-foreground)">Loading transporters…</span>}
          {!typed && transporters.state === 'failed' && (
            <ReadFailure word="Transporters unavailable" reason={transporters.reason} onRetry={transporters.reload} />
          )}
          {!typed && transporters.state === 'ready' && transporters.data.length === 0 && savedPartner === null && (
            <span className="text-xs text-(--muted-foreground)">No transporters in the master — type the name</span>
          )}
          {!typed && transporters.state === 'ready' && (transporters.data.length > 0 || savedPartner !== null) && (
            <select
              aria-label="Transporter"
              value={draft.transporterPartnerId}
              onChange={(event) => edit({ transporterPartnerId: event.target.value })}
              className={inputClass}
            >
              <option value="">Pick the transporter…</option>
              {transporters.data.map((partner) => (
                <option key={partner.id} value={partner.id}>
                  {partner.code} — {partner.name}
                </option>
              ))}
              {savedPartner !== null && <option value={savedPartner.id}>{savedPartner.label}</option>}
            </select>
          )}
          {typed && (
            <input
              type="text"
              aria-label="Transporter name"
              placeholder="Transporter name"
              maxLength={GATE_IN_LIMITS.transporterName}
              value={draft.transporterName}
              onChange={(event) => edit({ transporterName: event.target.value })}
              className={`${inputClass} min-w-40`}
            />
          )}
          <label className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              aria-label="Not listed — type the name"
              checked={typed}
              onChange={(event) => edit({ transporterMode: event.target.checked ? 'typed' : 'partner' })}
            />
            Not listed — type the name
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            aria-label="LR number"
            placeholder="LR number"
            maxLength={GATE_IN_LIMITS.lrNumber}
            value={draft.lrNumber}
            onChange={(event) => edit({ lrNumber: event.target.value })}
            className={`${inputClass} w-32`}
          />
          <input
            type="text"
            aria-label="Driver name"
            placeholder="Driver name"
            maxLength={GATE_IN_LIMITS.driverName}
            value={draft.driverName}
            onChange={(event) => edit({ driverName: event.target.value })}
            className={`${inputClass} w-40`}
          />
          <input
            type="tel"
            aria-label="Driver phone"
            placeholder="Driver phone"
            value={draft.driverPhone}
            onChange={(event) => edit({ driverPhone: event.target.value })}
            className={`${inputClass} w-36`}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Seal"
            value={draft.sealStatus}
            disabled={securityLocked}
            onChange={(event) => edit({ sealStatus: event.target.value as GateInDraft['sealStatus'] })}
            className={inputClass}
          >
            {SEAL_STATUSES.map((status) => (
              <option key={status} value={status}>
                Seal: {SEAL_STATUS_LABEL[status]}
              </option>
            ))}
          </select>
          {draft.sealStatus !== 'none' && (
            <input
              type="text"
              aria-label="Seal number"
              placeholder="Seal number(s), comma-separated"
              maxLength={GATE_IN_LIMITS.sealNumber}
              value={draft.sealNumber}
              disabled={securityLocked}
              onChange={(event) => edit({ sealNumber: event.target.value })}
              className={`${inputClass} min-w-48`}
            />
          )}
          <input
            type="text"
            inputMode="numeric"
            aria-label="Packages declared"
            placeholder="Packages declared"
            value={draft.packagesDeclared}
            disabled={securityLocked}
            onChange={(event) => edit({ packagesDeclared: event.target.value })}
            className={`${inputClass} w-36`}
          />
          {securityLocked && <span className="text-xs text-(--muted-foreground)">Seal and packages declared locked — the unload has ended.</span>}
          <input
            type="text"
            aria-label="Dock door"
            placeholder="Dock door"
            maxLength={GATE_IN_LIMITS.dockDoor}
            value={draft.dockDoor}
            onChange={(event) => edit({ dockDoor: event.target.value })}
            className={`${inputClass} w-24`}
          />
          <label className="flex items-center gap-1 text-xs text-(--muted-foreground)">
            Gated in (IST)
            <input
              type="datetime-local"
              aria-label="Gated in at (IST)"
              value={draft.gatedInAt}
              disabled={timeLocked}
              onChange={(event) => edit({ gatedInAt: event.target.value, gatedInAtEdited: true })}
              className={inputClass}
            />
          </label>
          {timeLocked && <span className="text-xs text-(--muted-foreground)">Locked — the unload has started.</span>}
        </div>

        <div className="flex flex-col gap-1">
          <div className="text-xs font-medium">Documents</div>
          {links.state === 'loading' && <span className="text-xs text-(--muted-foreground)">Loading open POs and ASNs…</span>}
          {links.state === 'failed' && <ReadFailure word="Open POs and ASNs unavailable" reason={links.reason} onRetry={links.reload} />}
          {draft.documents.length === 0 && <span className="text-xs text-(--muted-foreground)">No documents.</span>}
          {draft.documents.map((doc, index) => {
            const row = index + 1;
            return (
              <div key={index} className="flex flex-wrap items-center gap-2">
                <select
                  aria-label={`Document ${row} kind`}
                  value={doc.kind}
                  onChange={(event) => editDocument(index, { kind: event.target.value as GateInDraftDocument['kind'] })}
                  className={inputClass}
                >
                  {DOCUMENT_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {DOCUMENT_KIND_LABEL[kind]}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  aria-label={`Document ${row} number`}
                  placeholder="Number"
                  maxLength={GATE_IN_LIMITS.documentNumber}
                  value={doc.number}
                  onChange={(event) => editDocument(index, { number: event.target.value })}
                  className={`${inputClass} w-32`}
                />
                <input
                  type="date"
                  aria-label={`Document ${row} date`}
                  value={doc.documentDate}
                  onChange={(event) => editDocument(index, { documentDate: event.target.value })}
                  className={inputClass}
                />
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label={`Document ${row} e-way bill`}
                  placeholder="E-way bill (12 digits)"
                  value={doc.ewayBillNo}
                  onChange={(event) => editDocument(index, { ewayBillNo: event.target.value })}
                  className={`${inputClass} w-40`}
                />
                <select
                  aria-label={`Document ${row} PO or ASN`}
                  value={doc.link}
                  onChange={(event) => editDocument(index, { link: event.target.value })}
                  className={inputClass}
                >
                  <option value="">No PO or ASN</option>
                  {openOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                  {savedOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => edit({ documents: draft.documents.filter((_, i) => i !== index) })}
                  className={buttonClass}
                >
                  Remove
                </button>
              </div>
            );
          })}
          <div>
            <button
              type="button"
              disabled={draft.documents.length >= GATE_IN_LIMITS.documents}
              onClick={() => edit({ documents: [...draft.documents, EMPTY_DRAFT_DOCUMENT] })}
              className={buttonClass}
            >
              Add document
            </button>
          </div>
        </div>
      </fieldset>
      {problem !== null && (
        <div role="alert" className="text-xs text-(--destructive)">
          {problem}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" disabled={busy} onClick={onCancel} className={buttonClass}>
          Discard
        </button>
        <button type="submit" disabled={busy} className={primaryClass}>
          {mode === 'record' ? 'Record gate-in' : 'Save'}
        </button>
      </div>
    </form>
  );
}
