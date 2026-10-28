'use client';

import { useState } from 'react';

import { fetchApiCancelDockAppointment } from '@/lib/api/client';
import type { ClientDto } from '@/lib/api/generated';
import {
  appointmentChip,
  appointmentWindowLabel,
  bookedOutcome,
  cancelledOutcome,
  rescheduledOutcome,
  canChangeAppointment,
  closedAppointmentSentence,
  dockReason,
  documentLabels,
  parseCancelReason,
  type DockAppointment,
  type DockDoor,
  type DockSchedule,
} from '@/lib/dock-schedule';
import { gateInClientName, istTimeLabel } from '@/lib/gate-ins';
import { istDateOf, istDayLabel } from '@/lib/ist';
import { useDockAppointment } from '@/lib/use-dock-schedule';

import { DockAppointmentForm, type DockFormMode } from '@/components/inbound/dock-appointment-form';
import { ConfirmRow } from '@/components/settings/confirm-row';
import { DetailDrawer } from '@/components/shared/detail-drawer';
import { lineButtonClass as buttonClass, lineInputClass as inputClass } from '@/components/shared/line-rows';
import { StatusChip } from '@/components/shared/status-chip';
import { ReadFailure } from '@/components/shared/surface';

export type DockOutcome = { tone: 'accepted' | 'rejected' | 'warning'; word: string; reason: string };

export type DockDrawerTarget =
  | { readonly kind: 'open'; readonly appointmentId: string }
  | { readonly kind: 'book'; readonly seed: { readonly date: string; readonly start: number | null; readonly doorId: string | null } };

interface DrawerContext {
  readonly warehouseId: string;
  readonly schedule: DockSchedule;
  readonly doors: readonly DockDoor[];
  readonly loaded: readonly DockAppointment[];
  readonly canSchedule: boolean;
  readonly clients: readonly ClientDto[] | null;
  readonly tenantName: string | null;
}

/**
 * Story 2-3b (decision 10) — the appointment drawer (`DetailDrawer`, opened
 * by `?open=`): the appointment and its chip, its door and window, its
 * documents, the expected vehicle and transporter, the note, the gate-in it
 * arrived on, and — for a `dock.schedule` holder while it is booked and not
 * a no-show — Reschedule (the form in the drawer) and Cancel (an inline
 * confirmation with a reason, its key per confirmation). The same drawer
 * holds the Book form, seeded from an empty cell.
 */
export function DockAppointmentDrawer({
  target,
  context,
  onClose,
  onDone,
  onStale,
}: {
  target: DockDrawerTarget;
  context: DrawerContext;
  onClose: () => void;
  /** A write landed: the banner, and (for a booking) the new appointment to open. */
  onDone: (outcome: DockOutcome, appointment: DockAppointment) => void;
  onStale: () => void;
}) {
  const [busy, setBusy] = useState(false);
  if (target.kind === 'book') {
    return (
      <DetailDrawer title="Book a dock appointment" onClose={onClose} closeDisabled={busy} testId="dock-drawer">
        <DockAppointmentForm
          mode={{ kind: 'book', seed: target.seed }}
          warehouseId={context.warehouseId}
          schedule={context.schedule}
          doors={context.doors}
          loaded={context.loaded}
          clients={context.clients}
          tenantName={context.tenantName}
          onBusy={setBusy}
          onStale={onStale}
          onCancel={onClose}
          onSaved={(appointment) => onDone(bookedOutcome(appointment), appointment)}
        />
      </DetailDrawer>
    );
  }
  return <AppointmentDetail appointmentId={target.appointmentId} context={context} busy={busy} setBusy={setBusy} onClose={onClose} onDone={onDone} onStale={onStale} />;
}

function AppointmentDetail({
  appointmentId,
  context,
  busy,
  setBusy,
  onClose,
  onDone,
  onStale,
}: {
  appointmentId: string;
  context: DrawerContext;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onClose: () => void;
  onDone: (outcome: DockOutcome, appointment: DockAppointment) => void;
  onStale: () => void;
}) {
  const read = useDockAppointment(appointmentId);
  const [panel, setPanel] = useState<'none' | 'reschedule' | 'cancel'>('none');
  const [reason, setReason] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);

  const appointment = read.state === 'ready' ? read.data : null;
  const title = appointment?.code ?? 'Dock appointment';
  return (
    <DetailDrawer
      title={title}
      subtitle={appointment === null ? undefined : `${appointment.doorCode} · ${istDayLabel(istDateOf(appointment.startsAt))} ${appointmentWindowLabel(appointment)} IST`}
      onClose={onClose}
      closeDisabled={busy}
      testId="dock-drawer"
    >
      {read.state === 'loading' && <div className="text-xs text-(--muted-foreground)">Loading the appointment…</div>}
      {read.state === 'failed' && <ReadFailure word="Appointment not loaded" reason={read.reason} onRetry={read.reload} />}
      {appointment !== null && (
        <AppointmentFacts appointment={appointment} clients={context.clients} tenantName={context.tenantName} refreshing={read.refreshing} />
      )}
      {refusal !== null && (
        <div role="alert" className="text-xs text-(--destructive)">
          {refusal}
        </div>
      )}
      {appointment !== null && appointment.warehouseId !== context.warehouseId && (
        <div className="text-xs text-(--muted-foreground)">This appointment belongs to another warehouse — switch to it to change the booking.</div>
      )}
      {appointment !== null && appointment.warehouseId === context.warehouseId && context.canSchedule && (
        <>
          {!canChangeAppointment(appointment) ? (
            <div className="text-xs text-(--muted-foreground)" data-testid="dock-closed-note">
              {closedAppointmentSentence(appointment)}
            </div>
          ) : panel === 'none' ? (
            <div className="flex gap-2">
              <button type="button" onClick={() => { setRefusal(null); setPanel('reschedule'); }} className={buttonClass}>
                Reschedule
              </button>
              <button type="button" onClick={() => { setRefusal(null); setReason(''); setPanel('cancel'); }} className={buttonClass}>
                Cancel appointment
              </button>
            </div>
          ) : panel === 'reschedule' ? (
            <DockAppointmentForm
              key={`${appointment.id}|${appointment.updatedAt}`}
              mode={{ kind: 'reschedule', appointment } satisfies DockFormMode}
              warehouseId={context.warehouseId}
              schedule={context.schedule}
              doors={context.doors}
              loaded={context.loaded}
              clients={context.clients}
              tenantName={context.tenantName}
              onBusy={setBusy}
              onStale={onStale}
              onCancel={() => setPanel('none')}
              onSaved={(saved) => {
                setPanel('none');
                onDone(rescheduledOutcome(saved), saved);
              }}
            />
          ) : (
            <CancelConfirm
              key={appointment.id}
              appointment={appointment}
              reason={reason}
              setReason={setReason}
              setBusy={setBusy}
              onClose={() => setPanel('none')}
              onDone={(cancelled) => {
                setPanel('none');
                onDone(cancelledOutcome(cancelled), cancelled);
              }}
              onRejected={(text) => {
                setRefusal(text);
                onStale();
              }}
            />
          )}
        </>
      )}
    </DetailDrawer>
  );
}

function CancelConfirm({
  appointment,
  reason,
  setReason,
  setBusy,
  onClose,
  onDone,
  onRejected,
}: {
  appointment: DockAppointment;
  reason: string;
  setReason: (reason: string) => void;
  setBusy: (busy: boolean) => void;
  onClose: () => void;
  onDone: (appointment: DockAppointment) => void;
  onRejected: (reason: string) => void;
}) {
  const parsed = parseCancelReason(reason);
  return (
    <div
      className="flex flex-col gap-1 rounded-sm border border-(--border) p-2 text-xs"
      onKeyDown={(event) => {
        // The inline confirmation is the topmost layer: Esc closes it first.
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <ConfirmRow<DockAppointment>
        question={`Cancel ${appointment.code}? The slot frees for another booking.`}
        confirmLabel="Cancel appointment"
        keepLabel="Keep it"
        ariaLabel={`Cancel ${appointment.code}`}
        draft={reason.trim()}
        confirmDisabled={parsed.problem !== null}
        fields={
          <input
            type="text"
            aria-label="Why is it cancelled?"
            placeholder="Why? (e.g. Vendor postponed)"
            maxLength={200}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className={`${inputClass} min-w-56`}
          />
        }
        run={async (key, tenantId) => {
          if (parsed.reason === null) throw new Error(parsed.problem);
          setBusy(true);
          try {
            return (await fetchApiCancelDockAppointment(tenantId, appointment.id, { reason: parsed.reason }, key)).appointment;
          } finally {
            setBusy(false);
          }
        }}
        reason={dockReason}
        onDone={onDone}
        onRejected={onRejected}
        onClose={onClose}
      />
      {parsed.problem !== null && reason !== '' && <div className="text-(--muted-foreground)">{parsed.problem}</div>}
    </div>
  );
}

function AppointmentFacts({
  appointment,
  clients,
  tenantName,
  refreshing,
}: {
  appointment: DockAppointment;
  clients: readonly ClientDto[] | null;
  tenantName: string | null;
  refreshing: boolean;
}) {
  const chip = appointmentChip(appointment);
  const clientName = (clientId: string | null) => gateInClientName(clients?.find((entry) => entry.id === clientId), tenantName);
  const labels = documentLabels(appointment.documents, clientName);
  return (
    <div className="flex flex-col gap-2 text-xs" data-testid={`dock-detail-${appointment.code}`}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip tone={chip.tone} glyph={chip.glyph} data-testid="dock-detail-chip">
          {chip.word}
        </StatusChip>
        {refreshing && <span className="text-(--muted-foreground)">Refreshing…</span>}
      </div>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
        <dt className="text-(--muted-foreground)">Door</dt>
        <dd className="font-mono">{appointment.doorCode}</dd>
        <dt className="text-(--muted-foreground)">Window</dt>
        <dd>
          {istDayLabel(istDateOf(appointment.startsAt))} <span className="data">{appointmentWindowLabel(appointment)}</span> IST · grace {appointment.graceMinutes} min
        </dd>
        <dt className="text-(--muted-foreground)">Documents</dt>
        <dd>{labels.length === 0 ? 'None' : labels.join(', ')}</dd>
        <dt className="text-(--muted-foreground)">Client</dt>
        <dd>{appointment.clientId === null ? (appointment.documents.length === 0 ? '—' : 'Several clients') : (clientName(appointment.clientId) ?? '—')}</dd>
        <dt className="text-(--muted-foreground)">Vehicle</dt>
        <dd className="font-mono">{appointment.vehicleNo ?? '—'}</dd>
        <dt className="text-(--muted-foreground)">Transporter</dt>
        <dd>{appointment.transporterName ?? '—'}</dd>
        {appointment.note !== null && (
          <>
            <dt className="text-(--muted-foreground)">Note</dt>
            <dd className="whitespace-pre-wrap">{appointment.note}</dd>
          </>
        )}
        <dt className="text-(--muted-foreground)">Gate-in</dt>
        <dd data-testid="dock-detail-gate-in">
          {appointment.gateInCode === null ? 'Not arrived' : `${appointment.gateInCode} · gated in ${istTimeLabel(appointment.gatedInAt)}`}
        </dd>
        {appointment.status === 'cancelled' && (
          <>
            <dt className="text-(--muted-foreground)">Cancelled</dt>
            <dd>
              {istTimeLabel(appointment.cancelledAt)} — {appointment.cancelReason ?? '—'}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}
