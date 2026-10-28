'use client';

import { useRef, useState } from 'react';

import { ApiProblem, fetchApiBookDockAppointment, fetchApiRescheduleDockAppointment } from '@/lib/api/client';
import type { ClientDto } from '@/lib/api/generated';
import { readSession } from '@/lib/auth';
import {
  DOCK_LIMITS,
  bookBody,
  dockReason,
  doorOptions,
  draftOfAppointment,
  durationOptions,
  emptyDockDraft,
  parseDockDraft,
  startOptions,
  type DockAppointment,
  type DockDoor,
  type DockDraft,
  type DockSchedule,
} from '@/lib/dock-schedule';
import { VEHICLE_RULE, gateInClientName, linkOptionLabel } from '@/lib/gate-ins';
import { addIsoDays, istDateOf } from '@/lib/ist';
import { useGateInLinkSources } from '@/lib/use-gate-ins';
import { ulid } from '@/lib/ulid';

import { lineButtonClass as buttonClass, lineInputClass as inputClass } from '@/components/shared/line-rows';
import { ReadFailure } from '@/components/shared/surface';

/**
 * Story 2-3b — the book / reschedule form, inside the drawer: the date, the
 * start (the schedule's slots; past slots of today disabled), the duration
 * (1–8 slots), the door (active doors; one overlapping a LOADED booking is
 * labelled "busy" — advisory, the server's overlap read rules), the
 * documents (the warehouse's open POs and announced / partially received ASNs
 * of every client — the gate-in's `useGateInLinkSources`), the expected
 * vehicle, the transporter and a note.
 *
 * Reschedule is a full replacement; an untouched window resends the stored
 * instants (an off-grid booking keeps its own start and length, so a note
 * edit never moves it — A5).
 *
 * The Idempotency-Key is per DRAFT, bound to the body it was minted for: a
 * retry of the unchanged body replays, any edit mints a fresh one (FE guide
 * §2.1, §2.4); the client parse runs before a key is minted; a synchronous
 * in-flight ref refuses a double click, and `onBusy` holds the drawer open
 * while a write is in flight.
 */

export type DockFormMode =
  | { readonly kind: 'book'; readonly seed: { readonly date: string; readonly start: number | null; readonly doorId: string | null } }
  | { readonly kind: 'reschedule'; readonly appointment: DockAppointment };

const primaryClass =
  'rounded-sm bg-(--primary) px-3 py-1 text-xs font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60';

export function DockAppointmentForm({
  mode,
  warehouseId,
  schedule,
  doors,
  loaded,
  clients,
  tenantName,
  onSaved,
  onCancel,
  onBusy,
  onStale,
}: {
  mode: DockFormMode;
  warehouseId: string;
  schedule: DockSchedule;
  doors: readonly DockDoor[];
  /** The loaded window's appointments (the "busy" advisory). */
  loaded: readonly DockAppointment[];
  clients: readonly ClientDto[] | null;
  tenantName: string | null;
  onSaved: (appointment: DockAppointment) => void;
  onCancel: () => void;
  onBusy: (busy: boolean) => void;
  /** A refusal that says the calendar moved — the caller re-reads it. */
  onStale: () => void;
}) {
  const original = mode.kind === 'reschedule' ? mode.appointment : null;
  const [draft, setDraft] = useState<DockDraft>(() =>
    mode.kind === 'reschedule' ? draftOfAppointment(mode.appointment) : emptyDockDraft({ ...mode.seed, slotMinutes: schedule.slotMinutes }),
  );
  const [nowMs] = useState(() => Date.now());
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const keyRef = useRef<{ key: string; body: string } | null>(null);
  const inFlight = useRef(false);
  const links = useGateInLinkSources(warehouseId);

  function edit(patch: Partial<DockDraft>) {
    setProblem(null);
    setDraft((current) => ({ ...current, ...patch }));
  }

  const originalDraft = original === null ? null : draftOfAppointment(original);
  // The booking's own start and length stay choosable on its own date (A5).
  const keepStart = originalDraft !== null && originalDraft.date === draft.date ? Number(originalDraft.start) : null;
  const keepDuration = originalDraft === null ? null : Number(originalDraft.duration);
  const starts = startOptions(schedule, draft.date, nowMs, keepStart);
  const durations = durationOptions(schedule.slotMinutes, keepDuration);
  const parsed = parseDockDraft(draft);
  const drafted = parsed.body === null ? null : { startsAt: parsed.body.startsAt, endsAt: parsed.body.endsAt };
  const doorChoices = doorOptions(doors, loaded, drafted, original === null ? null : { id: original.id, doorId: original.dockDoorId });

  const clientName = (clientId: string | null | undefined) =>
    gateInClientName(clients?.find((entry) => entry.id === clientId), tenantName);
  const openDocuments =
    links.state === 'ready'
      ? [
          ...links.data.pos.map((po) => ({ value: `po:${po.id}`, label: linkOptionLabel(po.code, po.vendorSnapshot?.name ?? null, clientName(po.clientId)) })),
          ...links.data.asns.map((asn) => ({ value: `asn:${asn.id}`, label: linkOptionLabel(asn.code, null, clientName(asn.clientId)) })),
        ]
      : [];
  // A stored document no longer open still shows (checked), from the appointment's own codes.
  const savedDocuments = (original?.documents ?? [])
    .map((doc) => ({ value: `${doc.kind}:${doc.id}`, label: `${linkOptionLabel(doc.code ?? doc.kind.toUpperCase(), doc.vendorName, clientName(doc.clientId))} (not open)` }))
    .filter((saved) => !openDocuments.some((open) => open.value === saved.value));
  const documentChoices = [...openDocuments, ...savedDocuments];

  async function submit() {
    const session = readSession();
    if (session === null || inFlight.current) return;
    if (parsed.body === null) {
      setProblem(parsed.problem);
      return;
    }
    const serialised = JSON.stringify(parsed.body);
    if (keyRef.current === null || keyRef.current.body !== serialised) keyRef.current = { key: ulid(), body: serialised };
    inFlight.current = true;
    setBusy(true);
    onBusy(true);
    setProblem(null);
    try {
      const { appointment } =
        original === null
          ? await fetchApiBookDockAppointment(session.tenant.id, bookBody(parsed.body, warehouseId), keyRef.current.key)
          : await fetchApiRescheduleDockAppointment(session.tenant.id, original.id, parsed.body, keyRef.current.key);
      keyRef.current = null;
      onSaved(appointment);
    } catch (error) {
      setProblem(dockReason(error));
      if (error instanceof ApiProblem) {
        if (['po-not-open', 'asn-not-open', 'document-warehouse-mismatch', 'not-found'].includes(error.code)) links.reload();
        if (['dock-slot-taken', 'dock-door-inactive', 'conflict', 'appointment-closed', 'appointment-no-show'].includes(error.code)) onStale();
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
      onBusy(false);
    }
  }

  const today = istDateOf(nowMs);
  const label = original === null ? 'Book a dock appointment' : `Reschedule ${original.code}`;
  return (
    <form
      aria-label={label}
      noValidate
      className="flex flex-col gap-2 rounded-sm border border-(--border) p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="text-xs font-medium">{label}</div>
      <fieldset disabled={busy} className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1 text-xs">
            Date
            <input
              type="date"
              aria-label="Date"
              min={original === null ? today : undefined}
              max={addIsoDays(today, 90)}
              value={draft.date}
              onChange={(event) => edit({ date: event.target.value })}
              className={inputClass}
            />
          </label>
          <label className="flex items-center gap-1 text-xs">
            Start (IST)
            <select aria-label="Start (IST)" value={draft.start} onChange={(event) => edit({ start: event.target.value })} className={inputClass}>
              <option value="">Pick…</option>
              {starts.map((option) => (
                <option key={option.minute} value={String(option.minute)} disabled={option.disabled}>
                  {option.label}
                  {option.disabled ? ' (past)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs">
            Duration
            <select aria-label="Duration" value={draft.duration} onChange={(event) => edit({ duration: event.target.value })} className={inputClass}>
              {durations.map((option) => (
                <option key={option.minutes} value={String(option.minutes)}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1 text-xs">
            Door
            <select aria-label="Dock door" value={draft.doorId} onChange={(event) => edit({ doorId: event.target.value })} className={inputClass}>
              <option value="">Pick the door…</option>
              {doorChoices.map((door) => (
                <option key={door.id} value={door.id}>
                  {door.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {doorChoices.some((door) => door.id === draft.doorId && door.busy) && (
          <div className="text-xs text-(--muted-foreground)">That door looks busy then — the booking will be refused if it overlaps.</div>
        )}

        <fieldset className="m-0 flex min-w-0 flex-col gap-1 border-0 p-0">
          <legend className="text-xs font-medium">
            Documents ({draft.documents.length} of {DOCK_LIMITS.documents})
          </legend>
          {links.state === 'loading' && <span className="text-xs text-(--muted-foreground)">Loading open POs and ASNs…</span>}
          {links.state === 'failed' && <ReadFailure word="Open POs and ASNs unavailable" reason={links.reason} onRetry={links.reload} />}
          {links.state === 'ready' && documentChoices.length === 0 && (
            <span className="text-xs text-(--muted-foreground)">No open POs or ASNs in this warehouse — the appointment can carry none.</span>
          )}
          {documentChoices.length > 0 && (
            <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded-sm border border-(--border) p-2">
              {documentChoices.map((option) => {
                const checked = draft.documents.includes(option.value);
                return (
                  <label key={option.value} className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!checked && draft.documents.length >= DOCK_LIMITS.documents}
                      onChange={(event) =>
                        edit({
                          documents: event.target.checked
                            ? [...draft.documents, option.value]
                            : draft.documents.filter((value) => value !== option.value),
                        })
                      }
                    />
                    {option.label}
                  </label>
                );
              })}
            </div>
          )}
        </fieldset>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            aria-label="Expected vehicle"
            placeholder="Expected vehicle (optional)"
            title={VEHICLE_RULE}
            value={draft.vehicleNo}
            onChange={(event) => edit({ vehicleNo: event.target.value })}
            className={`${inputClass} w-44`}
          />
          <input
            type="text"
            aria-label="Transporter"
            placeholder="Transporter (optional)"
            maxLength={DOCK_LIMITS.transporterName}
            value={draft.transporterName}
            onChange={(event) => edit({ transporterName: event.target.value })}
            className={`${inputClass} w-48`}
          />
        </div>
        <textarea
          aria-label="Note"
          placeholder="Note (optional) — never sent to vendors or transporters"
          maxLength={DOCK_LIMITS.note}
          value={draft.note}
          onChange={(event) => edit({ note: event.target.value })}
          rows={2}
          className={inputClass}
        />
      </fieldset>
      {problem !== null && (
        <div role="alert" className="text-xs text-(--destructive)">
          {problem}
        </div>
      )}
      <div className="flex justify-start gap-2">
        <button type="submit" disabled={busy} className={primaryClass}>
          {busy ? 'Saving…' : original === null ? 'Book appointment' : 'Save changes'}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className={buttonClass}>
          Discard
        </button>
      </div>
    </form>
  );
}
