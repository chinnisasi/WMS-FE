'use client';

import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { readSession, subscribeSession } from '@/lib/auth';
import { notifyInboundChanged } from '@/lib/asns';
import {
  DOCK_ALL_CLIENTS_NOTE,
  DOCK_REFRESH_NOTE,
  DOCK_VIEWS,
  DOCK_VIEW_LABEL,
  appointmentChip,
  appointmentWindowLabel,
  appointmentsOn,
  closedDaySentence,
  liveCount,
  parseDockParams,
  dayRows,
  dockHref,
  documentLabels,
  isOpenDay,
  noDoorsSentence,
  stepDate,
  summaryParts,
  summarySentence,
  truncatedSentence,
  windowLabel,
  windowOf,
  type DockAppointment,
  type DockUrlState,
  type DockView,
} from '@/lib/dock-schedule';
import { gateInClientName } from '@/lib/gate-ins';
import { isRealDate, istDateOf, istDayLabel, weekOf } from '@/lib/ist';
import type { ActiveClientState } from '@/lib/use-active-client';
import { readyClients } from '@/lib/use-clients';
import { useDockWindow } from '@/lib/use-dock-schedule';
import { roleHasCapability } from '@/lib/users';

import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { FeedbackBanner } from '@/components/feedback/banner';
import { DockAppointmentDrawer, type DockDrawerTarget, type DockOutcome } from '@/components/inbound/dock-appointment-drawer';
import { DockDayGrid } from '@/components/inbound/dock-day-grid';
import { DockWeekGrid } from '@/components/inbound/dock-week-grid';
import { AllClientsNote } from '@/components/shared/client-filter-chip';
import { lineInputClass as inputClass } from '@/components/shared/line-rows';
import { LoadingStatus, SkeletonBar } from '@/components/shared/skeleton';
import { StatusChip } from '@/components/shared/status-chip';
import { ReadFailure } from '@/components/shared/surface';

/**
 * Story 2-3b (decisions 10–11) — Inbound → Dock schedule: the active
 * warehouse's dock calendar by door, for every client (a truck can carry
 * several — `AllClientsNote`). A Day grid, a Week grid and a List (the List
 * is also the view below `md`), the summary strip above them, and the
 * appointment drawer (`?open=`).
 *
 * URL state (`view`, `date`, `open`, `cancelled`) is a plain parameter set
 * beside `?tab=dock` (guide §1.8): parsed on the server and handed in as
 * `initial`; a change rewrites the URL in place (`replaceState`). Every
 * member reads; booking, rescheduling and cancelling are `dock.schedule`'s.
 * No polling — Refresh re-reads, keeping the last data ("Refreshing…").
 */

const actionButtonClass = 'rounded-sm border border-(--border) px-2 py-0.5 text-xs hover:bg-(--muted) disabled:opacity-60';
const primaryClass =
  'rounded-sm bg-(--primary) px-3 py-1 text-xs font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60';

export function DockScheduleCard({
  active,
  warehouseId,
  warehouseLabel,
  initial,
}: {
  active: ActiveClientState;
  warehouseId: string | null;
  warehouseLabel: string | null;
  initial: DockUrlState;
}) {
  // W1 — seeded from the LIVE URL on mount (a return to the tab must not
  // replay the server-parsed state of the first load, e.g. a closed `?open=`);
  // the server parse stands in when the URL is not this tab's (tests, SSR).
  const [url, setUrl] = useState<DockUrlState>(() => {
    if (typeof window === 'undefined') return initial;
    const live = new URLSearchParams(window.location.search);
    return live.get('tab') === 'dock' ? parseDockParams(Object.fromEntries(live)) : initial;
  });
  // W7 — one ticking clock (60 s): the past cells, the now-line, the form's
  // past slots and "today" follow it.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const today = istDateOf(nowMs);
  const date = url.date ?? today;
  const range = windowOf(url.view, date);
  const read = useDockWindow(warehouseId, range, url.cancelled);
  const clients = readyClients(active.clients);
  const tenantName = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.name ?? null,
    () => null,
  );
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );
  const canSchedule = roleHasCapability(role, 'dock.schedule');
  const canManageDoors = roleHasCapability(role, 'dock.manage');

  // Keyed derivation (guide §1.5): the book drawer and the banner belong to
  // the warehouse they were opened in.
  const [bookFor, setBookFor] = useState<{ warehouseId: string; seed: Extract<DockDrawerTarget, { kind: 'book' }>['seed'] } | null>(null);
  const book = bookFor !== null && bookFor.warehouseId === warehouseId ? bookFor.seed : null;
  const [banner, setBanner] = useState<{ warehouseId: string; outcome: DockOutcome } | null>(null);
  const shownBanner = banner !== null && banner.warehouseId === warehouseId ? banner.outcome : null;

  function navigate(patch: Partial<DockUrlState>) {
    const next = { ...url, ...patch };
    setUrl(next);
    replaceUrl(dockHref(next));
  }

  // WE5 — while the drawer's write is in flight, nothing opens another target
  // (a remount would drop the write's key).
  const [drawerBusy, setDrawerBusy] = useState(false);
  // W12 — the last write's answer, shown in the drawer until its re-read catches up.
  const [written, setWritten] = useState<DockAppointment | null>(null);

  function openAppointment(appointmentId: string) {
    if (drawerBusy) return;
    setBookFor(null);
    navigate({ open: appointmentId });
  }

  function openBook(seed: { date: string; start: number | null; doorId: string | null }) {
    if (warehouseId === null || drawerBusy) return;
    setBanner(null);
    navigate({ open: null });
    setBookFor({ warehouseId, seed });
  }

  const data = read.state === 'ready' ? read.data : null;
  // W6 — the drawer keeps the last good window of this warehouse, so a failed
  // re-read or a cold load (another day or view) never unmounts it with its draft.
  const [lastGood, setLastGood] = useState<{ warehouseId: string; data: NonNullable<typeof data> } | null>(null);
  if (data !== null && warehouseId !== null && (lastGood === null || lastGood.data !== data)) setLastGood({ warehouseId, data });
  const drawerData = data ?? (lastGood !== null && lastGood.warehouseId === warehouseId ? lastGood.data : null);
  const target: DockDrawerTarget | null =
    book !== null ? { kind: 'book', seed: book } : url.open !== null ? { kind: 'open', appointmentId: url.open } : null;

  const clientName = (clientId: string | null) => gateInClientName(clients?.find((entry) => entry.id === clientId), tenantName);

  const listColumns: DataTableColumn<DockAppointment>[] = [
    {
      key: 'code',
      header: 'Appointment',
      render: (appointment) => (
        <button
          type="button"
          onClick={() => openAppointment(appointment.id)}
          className="font-mono text-xs text-(--primary) underline underline-offset-2"
        >
          {appointment.code}
        </button>
      ),
    },
    {
      key: 'window',
      header: 'Window (IST)',
      render: (appointment) => (
        <span className="data">
          {istDayLabel(istDateOf(appointment.startsAt))} {appointmentWindowLabel(appointment)}
        </span>
      ),
    },
    { key: 'door', header: 'Door', render: (appointment) => <span className="font-mono text-xs">{appointment.doorCode}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (appointment) => {
        const chip = appointmentChip(appointment);
        return (
          <StatusChip tone={chip.tone} glyph={chip.glyph}>
            {chip.word}
          </StatusChip>
        );
      },
    },
    {
      key: 'documents',
      header: 'Documents',
      priority: 2,
      render: (appointment) => documentLabels(appointment.documents, clientName).join(', ') || '—',
    },
    { key: 'vehicle', header: 'Vehicle', priority: 3, render: (appointment) => appointment.vehicleNo ?? '—' },
    { key: 'transporter', header: 'Transporter', priority: 3, render: (appointment) => appointment.transporterName ?? '—' },
    { key: 'gateIn', header: 'Gate-in', priority: 2, render: (appointment) => appointment.gateInCode ?? '—' },
  ];

  const list = (appointments: readonly DockAppointment[]) => (
    <DataTable<DockAppointment>
      columns={listColumns}
      rows={[...appointments]}
      rowNoun={{ one: 'appointment', many: 'appointments' }}
      emptyMessage={`No appointments ${url.view === 'week' ? 'in' : 'on'} ${windowLabel(range)}.`}
    />
  );

  const views = (() => {
    if (data === null) return null;
    if (data.doors.length === 0) {
      return (
        <div className="flex flex-col items-start gap-1" data-testid="dock-no-doors">
          <span>{noDoorsSentence(warehouseLabel)}</span>
          {canManageDoors && (
            <Link href="/settings#dock-setup" className="text-(--primary) underline underline-offset-2">
              Add dock doors
            </Link>
          )}
        </div>
      );
    }
    if (url.view === 'list') return list(data.appointments);
    if (url.view === 'week') {
      return (
        <>
          <div className="hidden md:block">
            <DockWeekGrid
              dates={weekOf(date)}
              schedule={data.schedule}
              doors={data.doors}
              appointments={data.appointments}
              onOpen={openAppointment}
              onDay={(day) => navigate({ view: 'day', date: day })}
            />
          </div>
          <div className="md:hidden">{list(data.appointments)}</div>
        </>
      );
    }
    const dayAppointments = appointmentsOn(data.appointments, date);
    const open = isOpenDay(data.schedule, date);
    const rows = dayRows(data.schedule, date, dayAppointments);
    return (
      <>
        {!open && (
          <div data-testid="dock-closed-day">
            {liveCount(dayAppointments) === 0 ? (
              <span className="text-(--muted-foreground)">{closedDaySentence(date, 0)}</span>
            ) : (
              <FeedbackBanner tone="warning" word={closedDaySentence(date, liveCount(dayAppointments))} reason="The bookings still stand — reschedule or cancel them if the dock will not open." />
            )}
          </div>
        )}
        {rows.length > 0 && (
          <>
            <div className="hidden md:block">
              <DockDayGrid
                key={`${warehouseId ?? 'none'}|${date}`}
                date={date}
                schedule={data.schedule}
                doors={data.doors}
                appointments={dayAppointments}
                nowMs={nowMs}
                canSchedule={canSchedule}
                onOpen={openAppointment}
                onBook={openBook}
                onSkipToList={() => navigate({ view: 'list' })}
              />
            </div>
            <div className="md:hidden">{list(dayAppointments)}</div>
          </>
        )}
      </>
    );
  })();

  return (
    <section className="flex flex-col gap-3 rounded-md border border-(--border) p-3 text-sm" data-testid="dock-schedule-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-medium">Dock schedule</h2>
          <AllClientsNote active={active} title={DOCK_ALL_CLIENTS_NOTE} />
          <div className="text-(--muted-foreground)">
            {warehouseLabel === null
              ? 'Pick a warehouse to see its dock schedule.'
              : `${warehouseLabel} — booked trucks by door. ${DOCK_ALL_CLIENTS_NOTE}`}
          </div>
          <div className="text-xs text-(--muted-foreground)">{DOCK_REFRESH_NOTE}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {read.refreshing && (
            <span role="status" className="text-xs text-(--muted-foreground)">
              Refreshing…
            </span>
          )}
          <button type="button" onClick={read.reload} disabled={warehouseId === null} className={actionButtonClass}>
            Refresh
          </button>
          {canSchedule && warehouseId !== null && data !== null && data.doors.length > 0 && (
            <button type="button" onClick={() => openBook({ date, start: null, doorId: null })} className={primaryClass}>
              Book a slot
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <div role="group" aria-label="View" className="flex gap-1">
          {DOCK_VIEWS.map((view: DockView) => (
            <button
              key={view}
              type="button"
              aria-pressed={url.view === view}
              onClick={() => navigate({ view })}
              className={`${actionButtonClass} ${url.view === view ? 'bg-(--muted) font-medium' : ''}`}
            >
              {DOCK_VIEW_LABEL[view]}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => navigate({ date: stepDate(url.view, date, -1) })} className={actionButtonClass} aria-label={url.view === 'day' ? 'Previous day' : 'Previous week'}>
          ← Prev
        </button>
        <button type="button" onClick={() => navigate({ date: null })} className={actionButtonClass}>
          Today
        </button>
        <button type="button" onClick={() => navigate({ date: stepDate(url.view, date, 1) })} className={actionButtonClass} aria-label={url.view === 'day' ? 'Next day' : 'Next week'}>
          Next →
        </button>
        <input
          type="date"
          aria-label="Date"
          value={date}
          onChange={(event) => {
            if (isRealDate(event.target.value)) navigate({ date: event.target.value });
          }}
          className={inputClass}
        />
        <span className="font-medium" data-testid="dock-window-label">
          {windowLabel(range)}
        </span>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={url.cancelled} onChange={(event) => navigate({ cancelled: event.target.checked })} />
          Show cancelled
        </label>
      </div>

      {shownBanner !== null && <FeedbackBanner tone={shownBanner.tone} word={shownBanner.word} reason={shownBanner.reason} />}

      {warehouseId === null ? (
        <div className="text-(--muted-foreground)">Create a warehouse first.</div>
      ) : read.state === 'failed' ? (
        <ReadFailure word="Dock schedule unavailable" reason={read.reason} onRetry={read.reload} />
      ) : read.state === 'loading' ? (
        <div className="flex flex-col gap-2" aria-busy="true" data-testid="dock-loading">
          <LoadingStatus label="Loading the dock schedule…" />
          {Array.from({ length: 5 }, (_, index) => (
            <SkeletonBar key={index} className="h-8 w-full" />
          ))}
        </div>
      ) : (
        data !== null && (
          <>
            <div role="group" aria-label={`Summary: ${summarySentence(data.summary)}`} data-testid="dock-summary" className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              {summaryParts(data.summary).map((part) => (
                <span key={part} className="data">
                  {part}
                </span>
              ))}
            </div>
            {data.truncated && <FeedbackBanner tone="warning" word="Long list" reason={truncatedSentence(data.appointments.length)} />}
            {views}
          </>
        )
      )}

      {target !== null && warehouseId !== null && drawerData !== null && (
        <DockAppointmentDrawer
          key={target.kind === 'open' ? `open|${target.appointmentId}` : `book|${warehouseId}`}
          target={target}
          context={{
            warehouseId,
            schedule: drawerData.schedule,
            doors: drawerData.doors,
            loaded: drawerData.appointments,
            canSchedule,
            clients,
            tenantName,
            nowMs,
          }}
          written={written}
          onBusy={setDrawerBusy}
          onClose={() => {
            setBookFor(null);
            setWritten(null);
            navigate({ open: null });
          }}
          onStale={read.reload}
          onDone={(outcome, appointment) => {
            setBanner({ warehouseId, outcome });
            setWritten(appointment);
            setBookFor(null);
            // The booked / changed appointment opens in the drawer.
            navigate({ open: appointment.id });
            notifyInboundChanged();
          }}
        />
      )}
    </section>
  );
}

/** The in-place URL write (the App Router syncs it into `useSearchParams` — no server round trip). */
function replaceUrl(href: string) {
  if (typeof window !== 'undefined') window.history.replaceState(null, '', href);
}
