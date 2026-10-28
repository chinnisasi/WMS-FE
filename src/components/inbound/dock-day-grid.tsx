'use client';

import { useRef, useState, type KeyboardEvent } from 'react';

import {
  DOOR_PAGE_SIZE,
  appointmentChip,
  appointmentWindowLabel,
  cancelledByRow,
  dayRows,
  doorColumn,
  doorPageLabel,
  isBookableSlot,
  isOffSchedule,
  nowRow,
  type DockAppointment,
  type DockDoor,
  type DockSchedule,
} from '@/lib/dock-schedule';
import { minuteLabel } from '@/lib/ist';

import { StatusChip } from '@/components/shared/status-chip';

/**
 * Story 2-3b (decision 10, A6, A18) — the Day grid: one column per door, one
 * row per slot of the opening hours (extended over any booking outside them,
 * which is tagged "Outside schedule"); a booking is a block spanning its
 * slots; a free future cell is a "Book D3 at 10:30" button for a
 * `dock.schedule` holder; the now-line marks the current slot on today.
 *
 * At scale: its own horizontal scroll with a sticky time column and header,
 * door columns paged twelve at a time, and ONE tab stop — a roving tabindex
 * (arrows move through every booking of a merged block too, Enter books or
 * opens) on `role="grid"` rows and cells. "Skip to list view" sits before
 * it. A cancelled appointment (Show cancelled) is a struck-through line in
 * the cell — it never takes the slot, so the Book button stays.
 */
export function DockDayGrid({
  date,
  schedule,
  doors,
  appointments,
  nowMs,
  canSchedule,
  onOpen,
  onBook,
  onSkipToList,
}: {
  date: string;
  schedule: DockSchedule;
  doors: readonly DockDoor[];
  /** The appointments starting on `date`. */
  appointments: readonly DockAppointment[];
  /** The read's `asOf` — the clock the past and the now-line follow. */
  nowMs: number;
  canSchedule: boolean;
  onOpen: (appointmentId: string) => void;
  onBook: (seed: { date: string; start: number; doorId: string }) => void;
  onSkipToList: () => void;
}) {
  const [pageWanted, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(doors.length / DOOR_PAGE_SIZE));
  const page = Math.min(pageWanted, pages - 1);
  const shown = doors.slice(page * DOOR_PAGE_SIZE, (page + 1) * DOOR_PAGE_SIZE);
  const rows = dayRows(schedule, date, appointments);
  const slot = schedule.slotMinutes;
  const now = nowRow(rows, slot, date, nowMs);
  const doorAppointments = shown.map((door) => appointments.filter((appointment) => appointment.dockDoorId === door.id));
  const columns = doorAppointments.map((list) => doorColumn(rows, slot, list));
  const cancelled = doorAppointments.map((list) => cancelledByRow(rows, list));

  /**
   * The roving model: each column is an ordered list of focus targets — every
   * booking of a (merged) block, every cancelled line, and each free cell's
   * Book button or blank cell. Up / Down walk a column's list; Left / Right
   * land on the first target of the cell covering the same row next door.
   */
  type Target = { readonly row: number; readonly span: number };
  const targets: Target[][] = columns.map((cells, c) =>
    cells.flatMap((cell) => {
      const span = cell.kind === 'block' ? cell.span : 1;
      const lines = Array.from({ length: span }, (_, offset) => cancelled[c]!.get(cell.row + offset) ?? []).flat();
      const count = cell.kind === 'block' ? cell.appointments.length + lines.length : lines.length + 1;
      return Array.from({ length: count }, () => ({ row: cell.row, span }));
    }),
  );
  const [activeWanted, setActive] = useState<{ col: number; index: number }>({ col: 0, index: 0 });
  const activeCol = Math.min(activeWanted.col, Math.max(0, shown.length - 1));
  const activeIndex = Math.min(activeWanted.index, Math.max(0, (targets[activeCol]?.length ?? 1) - 1));
  const activeKey = `${activeCol}:${activeIndex}`;
  const table = useRef<HTMLDivElement | null>(null);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) || shown.length === 0) return;
    const column = targets[activeCol] ?? [];
    if (column.length === 0) return;
    event.preventDefault();
    let col = activeCol;
    let index = activeIndex;
    if (event.key === 'ArrowUp') index = Math.max(0, index - 1);
    else if (event.key === 'ArrowDown') index = Math.min(column.length - 1, index + 1);
    else {
      col = Math.min(shown.length - 1, Math.max(0, activeCol + (event.key === 'ArrowRight' ? 1 : -1)));
      const row = column[activeIndex]!.row;
      const found = (targets[col] ?? []).findIndex((target) => row >= target.row && row < target.row + target.span);
      index = Math.max(0, found);
    }
    setActive({ col, index });
    table.current?.querySelector<HTMLElement>(`[data-cell="${col}:${index}"]`)?.focus();
  }

  return (
    <div className="flex flex-col gap-2" data-testid="dock-day-grid">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button type="button" onClick={onSkipToList} className="text-(--primary) underline underline-offset-2">
          Skip to list view
        </button>
        {pages > 1 && (
          <>
            <span data-testid="dock-door-page">{doorPageLabel(page, doors.length)}</span>
            <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className="rounded-sm border border-(--border) px-2 py-0.5 disabled:opacity-40">
              Prev doors
            </button>
            <button
              type="button"
              disabled={page >= pages - 1}
              onClick={() => setPage(page + 1)}
              className="rounded-sm border border-(--border) px-2 py-0.5 disabled:opacity-40"
            >
              Next doors
            </button>
          </>
        )}
      </div>
      <div ref={table} className="max-h-[70vh] overflow-auto rounded-sm border border-(--border)" onKeyDown={onKeyDown}>
        <table role="grid" className="border-collapse text-xs" aria-label={`Dock doors on ${date}, by slot`}>
          <thead>
            <tr role="row">
              <th scope="col" role="columnheader" className="sticky top-0 left-0 z-20 bg-(--muted) px-2 py-1 text-left font-medium text-(--foreground)">
                Time (IST)
              </th>
              {shown.map((door) => (
                <th key={door.id} scope="col" role="columnheader" className="sticky top-0 z-10 min-w-36 bg-(--muted) px-2 py-1 text-left font-medium text-(--foreground)">
                  <span className="font-mono">{door.code}</span>
                  {door.name !== null && <span className="text-(--muted-foreground)"> · {door.name}</span>}
                  {!door.active && <span className="text-(--muted-foreground)"> · inactive</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(() => {
              // Each column's next target index, advanced as its cells render top to bottom.
              const cursor = shown.map(() => 0);
              const props = (c: number) => {
                const index = cursor[c]!;
                cursor[c] = index + 1;
                const key = `${c}:${index}`;
                return { 'data-cell': key, tabIndex: key === activeKey ? 0 : -1, onFocus: () => setActive({ col: c, index }) };
              };
              const cancelledLine = (appointment: DockAppointment, c: number) => (
                <button
                  key={appointment.id}
                  type="button"
                  {...props(c)}
                  data-testid={`dock-cancelled-${appointment.code}`}
                  onClick={() => onOpen(appointment.id)}
                  aria-label={`${appointment.code}, ${appointmentWindowLabel(appointment)}, Cancelled`}
                  className="w-full truncate rounded-sm border border-dashed border-(--border) px-1 text-left text-(--muted-foreground) line-through"
                >
                  {appointment.code} · Cancelled
                </button>
              );
              return rows.map((minute, r) => (
                <tr
                  key={minute}
                  role="row"
                  data-now={now === r ? 'true' : undefined}
                  className={now === r ? 'border-t-2 border-t-(--primary)' : 'border-t border-t-(--border)'}
                >
                  <th scope="row" role="rowheader" className="sticky left-0 z-10 h-10 bg-(--background) px-2 text-left font-normal whitespace-nowrap">
                    <span className="data">{minuteLabel(minute)}</span>
                    {now === r && <span className="ml-1 font-medium text-(--primary)">· now</span>}
                  </th>
                  {shown.map((door, c) => {
                    const cell = columns[c]?.find((entry) => entry.row === r);
                    if (cell === undefined) return null; // covered by a block above
                    const span = cell.kind === 'block' ? cell.span : 1;
                    const lines = Array.from({ length: span }, (_, offset) => cancelled[c]!.get(cell.row + offset) ?? []).flat();
                    if (cell.kind === 'block') {
                      return (
                        <td key={door.id} role="gridcell" rowSpan={cell.span} className="border-l border-(--border) p-0.5 align-top">
                          <div className="flex h-full flex-col gap-0.5">
                            {cell.appointments.map((appointment) => {
                              const chip = appointmentChip(appointment);
                              const off = isOffSchedule(schedule, appointment);
                              return (
                                <button
                                  key={appointment.id}
                                  type="button"
                                  {...props(c)}
                                  data-testid={`dock-block-${appointment.code}`}
                                  onClick={() => onOpen(appointment.id)}
                                  aria-label={`${appointment.code}, ${door.code} ${appointmentWindowLabel(appointment)}, ${chip.word}${off ? ', outside schedule' : ''}`}
                                  className="flex flex-col items-start gap-0.5 rounded-sm border border-(--primary) bg-(--primary)/10 px-1.5 py-1 text-left hover:bg-(--primary)/20"
                                >
                                  <span className="font-mono font-medium">{appointment.code}</span>
                                  <span className="data">{appointmentWindowLabel(appointment)}</span>
                                  <StatusChip tone={chip.tone} glyph={chip.glyph}>
                                    {chip.word}
                                  </StatusChip>
                                  {off && <span className="text-(--muted-foreground)">Outside schedule</span>}
                                </button>
                              );
                            })}
                            {lines.map((appointment) => cancelledLine(appointment, c))}
                          </div>
                        </td>
                      );
                    }
                    const bookable = canSchedule && door.active && isBookableSlot(schedule, date, minute, nowMs);
                    return (
                      <td key={door.id} role="gridcell" className="h-10 border-l border-(--border) p-0.5">
                        <div className="flex h-full flex-col gap-0.5">
                          {lines.map((appointment) => cancelledLine(appointment, c))}
                          {bookable ? (
                            <button
                              type="button"
                              {...props(c)}
                              onClick={() => onBook({ date, start: minute, doorId: door.id })}
                              aria-label={`Book ${door.code} at ${minuteLabel(minute)}`}
                              className="min-h-6 w-full flex-1 rounded-sm text-(--muted-foreground) opacity-60 hover:bg-(--muted) hover:opacity-100 focus-visible:opacity-100"
                            >
                              <span aria-hidden>+</span>
                            </button>
                          ) : (
                            <div {...props(c)} aria-label={`${door.code} ${minuteLabel(minute)} — free`} className="min-h-6 w-full flex-1" />
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ));
            })()}
          </tbody>
        </table>
      </div>
    </div>
  );
}
