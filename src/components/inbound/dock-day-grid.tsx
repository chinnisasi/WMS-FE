'use client';

import { useRef, useState, type KeyboardEvent } from 'react';

import {
  DOOR_PAGE_SIZE,
  appointmentChip,
  appointmentWindowLabel,
  dayRows,
  doorColumn,
  doorPageLabel,
  isBookableSlot,
  isOffSchedule,
  nowRow,
  type DayCell,
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
 * (arrows move, Enter books or opens). "Skip to list view" sits before it.
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
  const columns = shown.map((door) => doorColumn(rows, slot, appointments.filter((appointment) => appointment.dockDoorId === door.id)));

  // The cell holding row `r` in column `c` (a block covers several rows).
  const cellAt = (r: number, c: number): DayCell | undefined =>
    columns[c]?.find((cell) => (cell.kind === 'free' ? cell.row === r : r >= cell.row && r < cell.row + cell.span));
  const [activeWanted, setActive] = useState<{ row: number; col: number }>({ row: 0, col: 0 });
  const active = {
    row: Math.min(activeWanted.row, Math.max(0, rows.length - 1)),
    col: Math.min(activeWanted.col, Math.max(0, shown.length - 1)),
  };
  const activeCell = cellAt(active.row, active.col);
  const activeKey = activeCell === undefined ? null : `${activeCell.row}-${active.col}`;
  const table = useRef<HTMLDivElement | null>(null);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const move = moves[event.key];
    if (move === undefined || rows.length === 0 || shown.length === 0) return;
    event.preventDefault();
    const from = cellAt(active.row, active.col);
    // Down leaves a block from its last row; up from its first.
    const baseRow = from === undefined ? active.row : move[0] > 0 ? from.row + (from.kind === 'block' ? from.span - 1 : 0) : from.row;
    const row = Math.min(rows.length - 1, Math.max(0, baseRow + move[0]));
    const col = Math.min(shown.length - 1, Math.max(0, active.col + move[1]));
    setActive({ row, col });
    const target = cellAt(row, col);
    if (target === undefined) return;
    table.current?.querySelector<HTMLElement>(`[data-cell="${target.row}-${col}"]`)?.focus();
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
        <table className="border-collapse text-xs" aria-label={`Dock doors on ${date}, by slot`}>
          <thead>
            <tr>
              <th scope="col" className="sticky top-0 left-0 z-20 bg-(--muted) px-2 py-1 text-left font-medium text-(--foreground)">
                Time (IST)
              </th>
              {shown.map((door) => (
                <th key={door.id} scope="col" className="sticky top-0 z-10 min-w-36 bg-(--muted) px-2 py-1 text-left font-medium text-(--foreground)">
                  <span className="font-mono">{door.code}</span>
                  {door.name !== null && <span className="text-(--muted-foreground)"> · {door.name}</span>}
                  {!door.active && <span className="text-(--muted-foreground)"> · inactive</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((minute, r) => (
              <tr key={minute} data-now={now === r ? 'true' : undefined} className={now === r ? 'border-t-2 border-t-(--primary)' : 'border-t border-t-(--border)'}>
                <th scope="row" className="sticky left-0 z-10 h-10 bg-(--background) px-2 text-left font-normal whitespace-nowrap">
                  <span className="data">{minuteLabel(minute)}</span>
                  {now === r && <span className="ml-1 font-medium text-(--primary)">· now</span>}
                </th>
                {shown.map((door, c) => {
                  const cell = columns[c]?.find((entry) => entry.row === r);
                  if (cell === undefined) return null; // covered by a block above
                  const key = `${cell.row}-${c}`;
                  const tabIndex = key === activeKey ? 0 : -1;
                  const focusActive = () => setActive({ row: cell.row, col: c });
                  if (cell.kind === 'block') {
                    return (
                      <td key={door.id} rowSpan={cell.span} className="border-l border-(--border) p-0.5 align-top">
                        <div className="flex h-full flex-col gap-0.5">
                          {cell.appointments.map((appointment, index) => {
                            const chip = appointmentChip(appointment);
                            const off = isOffSchedule(schedule, appointment);
                            return (
                              <button
                                key={appointment.id}
                                type="button"
                                data-cell={index === 0 ? key : undefined}
                                data-testid={`dock-block-${appointment.code}`}
                                tabIndex={index === 0 ? tabIndex : -1}
                                onFocus={focusActive}
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
                        </div>
                      </td>
                    );
                  }
                  const bookable = canSchedule && door.active && isBookableSlot(schedule, date, minute, nowMs);
                  return (
                    <td key={door.id} className="h-10 border-l border-(--border) p-0.5">
                      {bookable ? (
                        <button
                          type="button"
                          data-cell={key}
                          tabIndex={tabIndex}
                          onFocus={focusActive}
                          onClick={() => onBook({ date, start: minute, doorId: door.id })}
                          aria-label={`Book ${door.code} at ${minuteLabel(minute)}`}
                          className="h-full w-full rounded-sm text-(--muted-foreground) opacity-60 hover:bg-(--muted) hover:opacity-100 focus-visible:opacity-100"
                        >
                          <span aria-hidden>+</span>
                        </button>
                      ) : (
                        <div
                          data-cell={key}
                          tabIndex={tabIndex}
                          onFocus={focusActive}
                          aria-label={`${door.code} ${minuteLabel(minute)} — free`}
                          className="h-full w-full"
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
