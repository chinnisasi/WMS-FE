'use client';

import { isOpenDay, weekCell, weekEntryLabel, weekIndex, type DockAppointment, type DockDoor, type DockSchedule } from '@/lib/dock-schedule';
import { istDayLabel } from '@/lib/ist';

/**
 * Story 2-3b (decision 10) — the Week grid: one row per door, one column per
 * day Mon–Sun; a cell lists up to four entries ("10:30 DA-0012 · Late"),
 * then "+N more"; a day header (and "+N more") opens that day in Day view.
 */
export function DockWeekGrid({
  dates,
  schedule,
  doors,
  appointments,
  onOpen,
  onDay,
}: {
  dates: readonly string[];
  schedule: DockSchedule;
  doors: readonly DockDoor[];
  appointments: readonly DockAppointment[];
  onOpen: (appointmentId: string) => void;
  onDay: (date: string) => void;
}) {
  // Grouped once per render (door × day), never re-filtered per cell.
  const index = weekIndex(appointments);
  return (
    <div className="max-h-[70vh] overflow-auto rounded-sm border border-(--border)" data-testid="dock-week-grid">
      <table className="border-collapse text-xs" aria-label="Dock doors by day">
        <thead>
          <tr>
            <th scope="col" className="sticky top-0 left-0 z-20 bg-(--muted) px-2 py-1 text-left font-medium text-(--foreground)">
              Door
            </th>
            {dates.map((date) => (
              <th key={date} scope="col" className="sticky top-0 z-10 min-w-36 bg-(--muted) px-2 py-1 text-left font-medium text-(--foreground)">
                <button type="button" onClick={() => onDay(date)} className="text-(--primary) underline underline-offset-2">
                  {istDayLabel(date)}
                </button>
                {!isOpenDay(schedule, date) && <span className="text-(--muted-foreground)"> · closed</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {doors.map((door) => (
            <tr key={door.id} className="border-t border-(--border)" data-testid={`dock-week-row-${door.code}`}>
              <th scope="row" className="sticky left-0 z-10 bg-(--background) px-2 py-1 text-left align-top font-normal">
                <span className="font-mono">{door.code}</span>
                {!door.active && <span className="text-(--muted-foreground)"> · inactive</span>}
              </th>
              {dates.map((date) => {
                const cell = weekCell(index, door.id, date);
                return (
                  <td key={date} className="border-l border-(--border) px-1 py-1 align-top">
                    <ul className="flex flex-col gap-0.5">
                      {cell.entries.map((appointment) => (
                        <li key={appointment.id}>
                          <button type="button" onClick={() => onOpen(appointment.id)} className="text-left hover:underline">
                            <span className="data">{weekEntryLabel(appointment)}</span>
                          </button>
                        </li>
                      ))}
                      {cell.more > 0 && (
                        <li>
                          <button type="button" onClick={() => onDay(date)} className="text-(--primary) underline underline-offset-2">
                            +{cell.more} more
                          </button>
                        </li>
                      )}
                    </ul>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
