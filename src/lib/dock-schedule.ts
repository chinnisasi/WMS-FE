/**
 * Story 2-3b — dock appointments: the pure half of Inbound → Dock schedule,
 * the Settings dock card and the gate-in's appointment picker. The URL state,
 * the slot grid in IST (rows, block spans, the off-schedule rule of A6), the
 * week of a date, the chip and summary words, the booking draft parser, the
 * door and schedule parsers, and the one refusal mapper (`dockReason`).
 *
 * Pure: no React, no fetch — every sentence and derivation is pinned by
 * `dock-schedule.test.ts` (a claim left in JSX is a claim nothing can pin).
 *
 * The punctuality words ("On time", "Early 40 min", "Late 25 min",
 * "Unscheduled") are byte-identical to the handheld's
 * (`wms-mobile/src/receiving/gate-in.ts`); the chip reads "Arrived — late 25
 * min" from the same words.
 */
import { ApiProblem } from '@/lib/api/client';
import type {
  DockAppointmentDocumentInputDto,
  DockAppointmentDto,
  DockDoorDto,
  DockScheduleDto,
  DockSummaryDto,
  GateInAppointmentDto,
  PutDockScheduleDto,
  RescheduleDockAppointmentDto,
} from '@/lib/api/generated';
import { ASN_NOT_OPEN_REASON } from '@/lib/asns';
import type { SearchParamsRecord } from '@/lib/drill';
import { VEHICLE_NO_RE, VEHICLE_RULE, normalizeVehicleNo, type GateInDraft } from '@/lib/gate-ins';
import {
  MINUTES_PER_DAY,
  addIsoDays,
  isRealDate,
  istClockLabel,
  istDateOf,
  istDayLabel,
  istInstantOf,
  istMinuteOfDay,
  istWeekdayOf,
  minuteLabel,
  parseMinute,
  weekOf,
  weekdayLong,
} from '@/lib/ist';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import type { StatusTone } from '@/lib/status-tone';

export type DockAppointment = DockAppointmentDto;
export type DockDoor = DockDoorDto;
export type DockSchedule = DockScheduleDto;
export type DockSummary = DockSummaryDto;
export type DockPunctuality = GateInAppointmentDto['punctuality'];

/** The backend's bounds (`dock.dto.ts`, decisions 1, 4, 6). */
export const DOCK_LIMITS = {
  doorsPerWarehouse: 100,
  doorCode: 20,
  doorName: 60,
  maxSlots: 8,
  documents: 10,
  transporterName: 80,
  note: 500,
  cancelReason: 200,
  graceMax: 120,
  windowDays: 7,
} as const;

/** `^[A-Z0-9-]{1,20}$` — the door code CHECK, after the server's trim + uppercase. */
export const DOOR_CODE_RE = /^[A-Z0-9-]{1,20}$/;

export const SLOT_LENGTHS = [15, 30, 60] as const;

/** Door columns per page of the Day grid (A18). */
export const DOOR_PAGE_SIZE = 12;

/** Entries a Week cell shows before "+N more". */
export const WEEK_CELL_ENTRIES = 4;

/** Why the Dock schedule ignores the client switcher (`AllClientsNote`). */
export const DOCK_ALL_CLIENTS_NOTE = 'Appointments show every client — a truck can carry several.';

/** The Refresh line: there is no polling. */
export const DOCK_REFRESH_NOTE = 'Gate-ins and bookings made elsewhere appear when the schedule is refreshed.';

// ── URL state (decision 10) ──────────────────────────────────────────────────

export type DockView = 'day' | 'week' | 'list';
export const DOCK_VIEWS: readonly DockView[] = ['day', 'week', 'list'];
export const DOCK_VIEW_LABEL: Readonly<Record<DockView, string>> = { day: 'Day', week: 'Week', list: 'List' };

export interface DockUrlState {
  readonly view: DockView;
  /** The IST date shown; null = today (IST), read at render. */
  readonly date: string | null;
  /** The appointment the drawer shows (`?open=`). */
  readonly open: string | null;
  /** `?cancelled=1` — list cancelled appointments too. */
  readonly cancelled: boolean;
}

export const DEFAULT_DOCK_URL_STATE: DockUrlState = { view: 'day', date: null, open: null, cancelled: false };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function single(params: SearchParamsRecord, key: string): string | null {
  const raw = params[key];
  return typeof raw === 'string' ? raw : null;
}

/**
 * The Dock schedule's URL state (a plain URL parameter set beside the tab —
 * guide §1.8, not a drill): each key parses on its own; a malformed, unknown
 * or repeated value falls back to its default, never to an error.
 */
export function parseDockParams(params: SearchParamsRecord): DockUrlState {
  const view = single(params, 'view');
  const date = single(params, 'date');
  const open = single(params, 'open');
  return {
    view: view !== null && (DOCK_VIEWS as readonly string[]).includes(view) ? (view as DockView) : 'day',
    date: date !== null && isRealDate(date) ? date : null,
    open: open !== null && UUID_RE.test(open) ? open.toLowerCase() : null,
    cancelled: single(params, 'cancelled') === '1',
  };
}

/** The remount key's share of the state (guide §1.8). */
export function dockParamsKey(state: DockUrlState): string {
  return `${state.view}|${state.date ?? 'today'}|${state.open ?? ''}|${state.cancelled ? 1 : 0}`;
}

/** The URL of a state on the Dock schedule tab: defaults are left out. */
export function dockHref(state: DockUrlState): string {
  const query = new URLSearchParams({ tab: 'dock' });
  if (state.view !== 'day') query.set('view', state.view);
  if (state.date !== null) query.set('date', state.date);
  if (state.open !== null) query.set('open', state.open);
  if (state.cancelled) query.set('cancelled', '1');
  return `/inbound?${query.toString()}`;
}

/** The read window of a view: Day reads its day; Week and List the Mon–Sun week of the date. */
export function windowOf(view: DockView, date: string): { from: string; to: string } {
  if (view === 'day') return { from: date, to: date };
  const week = weekOf(date);
  return { from: week[0]!, to: week[6]! };
}

/** The date Prev / Next moves to: a day in Day, a week otherwise. */
export function stepDate(view: DockView, date: string, direction: -1 | 1): string {
  return addIsoDays(date, view === 'day' ? direction : 7 * direction);
}

/** "Wed 28 Oct" for a day, "Mon 26 Oct – Sun 1 Nov" for a week. */
export function windowLabel(window: { from: string; to: string }): string {
  return window.from === window.to ? istDayLabel(window.from) : `${istDayLabel(window.from)} – ${istDayLabel(window.to)}`;
}

// ── the schedule and the grid (decisions 3, 4; A6, A7) ───────────────────────

/** The opening hours as minutes of the IST day. */
export function openingMinutes(schedule: Pick<DockSchedule, 'opensAt' | 'closesAt'>): { opens: number; closes: number } {
  return { opens: parseMinute(schedule.opensAt) ?? 0, closes: parseMinute(schedule.closesAt) ?? MINUTES_PER_DAY };
}

/** Whether an IST date is an open day of the schedule. */
export function isOpenDay(schedule: Pick<DockSchedule, 'openDays'>, date: string): boolean {
  return schedule.openDays.includes(istWeekdayOf(date));
}

/** An appointment's minutes on its IST day: start and end (end may be 1440). */
export function appointmentMinutes(appointment: Pick<DockAppointment, 'startsAt' | 'endsAt'>): { start: number; end: number } {
  const start = istMinuteOfDay(appointment.startsAt);
  const length = Math.round((Date.parse(appointment.endsAt) - Date.parse(appointment.startsAt)) / 60_000);
  return { start, end: start + length };
}

/** The appointments that start on an IST date, by start then code. */
export function appointmentsOn(appointments: readonly DockAppointment[], date: string): DockAppointment[] {
  return appointments
    .filter((appointment) => istDateOf(appointment.startsAt) === date)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.code.localeCompare(b.code));
}

/**
 * The Day grid's rows: one per slot of the opening hours, EXTENDED to cover
 * any appointment of the day outside them (A6 — a schedule change never
 * hides a booking). A closed day with no booking has no rows.
 */
export function dayRows(schedule: Pick<DockSchedule, 'slotMinutes' | 'opensAt' | 'closesAt' | 'openDays'>, date: string, dayAppointments: readonly DockAppointment[]): number[] {
  const slot = schedule.slotMinutes;
  const open = isOpenDay(schedule, date);
  if (!open && dayAppointments.length === 0) return [];
  const hours = openingMinutes(schedule);
  let first = open ? hours.opens : Number.POSITIVE_INFINITY;
  let last = open ? hours.closes : Number.NEGATIVE_INFINITY;
  for (const appointment of dayAppointments) {
    const { start, end } = appointmentMinutes(appointment);
    first = Math.min(first, Math.floor(start / slot) * slot);
    last = Math.max(last, Math.ceil(end / slot) * slot);
  }
  last = Math.min(last, MINUTES_PER_DAY);
  const rows: number[] = [];
  for (let minute = first; minute < last; minute += slot) rows.push(minute);
  return rows;
}

/** Whether an appointment sits off the current schedule: off the grid, outside the hours, or on a closed day. */
export function isOffSchedule(schedule: Pick<DockSchedule, 'slotMinutes' | 'opensAt' | 'closesAt' | 'openDays'>, appointment: DockAppointment): boolean {
  const { start, end } = appointmentMinutes(appointment);
  const hours = openingMinutes(schedule);
  const slot = schedule.slotMinutes;
  return (
    !isOpenDay(schedule, istDateOf(appointment.startsAt)) ||
    start % slot !== 0 ||
    (end - start) % slot !== 0 ||
    start < hours.opens ||
    end > hours.closes
  );
}

/** One cell of a door's Day column: the appointments drawn in it, or free. */
export type DayCell =
  | { readonly kind: 'block'; readonly row: number; readonly span: number; readonly appointments: readonly DockAppointment[] }
  | { readonly kind: 'free'; readonly row: number };

/**
 * A door's column of the Day grid: each booking a block spanning its slots
 * (placed by its minutes — an off-grid one starts in the row it falls in);
 * bookings that land in a row another block covers join that block, so two
 * off-grid appointments never draw over one another.
 */
export function doorColumn(rows: readonly number[], slotMinutes: number, doorAppointments: readonly DockAppointment[]): DayCell[] {
  const blocks: { row: number; endRow: number; appointments: DockAppointment[] }[] = [];
  const sorted = [...doorAppointments].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  for (const appointment of sorted) {
    const { start, end } = appointmentMinutes(appointment);
    let row = 0;
    for (let index = 0; index < rows.length; index += 1) if (rows[index]! <= start) row = index;
    const endRow = Math.min(rows.length, Math.max(row + 1, row + Math.ceil((end - rows[row]!) / slotMinutes)));
    const current = blocks[blocks.length - 1];
    if (current !== undefined && row < current.endRow) {
      current.appointments.push(appointment);
      current.endRow = Math.max(current.endRow, endRow);
    } else {
      blocks.push({ row, endRow, appointments: [appointment] });
    }
  }
  const cells: DayCell[] = [];
  let next = 0;
  for (const block of blocks) {
    for (; next < block.row; next += 1) cells.push({ kind: 'free', row: next });
    cells.push({ kind: 'block', row: block.row, span: block.endRow - block.row, appointments: block.appointments });
    next = block.endRow;
  }
  for (; next < rows.length; next += 1) cells.push({ kind: 'free', row: next });
  return cells;
}

/**
 * Whether a free cell can be booked: an open day, inside the opening hours
 * (an extended row is not bookable), and not before the current slot
 * (decision 4 — the current slot itself is bookable).
 */
export function isBookableSlot(
  schedule: Pick<DockSchedule, 'slotMinutes' | 'opensAt' | 'closesAt' | 'openDays'>,
  date: string,
  minute: number,
  nowMs: number,
): boolean {
  if (!isOpenDay(schedule, date)) return false;
  const hours = openingMinutes(schedule);
  if (minute < hours.opens || minute + schedule.slotMinutes > hours.closes || minute % schedule.slotMinutes !== 0) return false;
  return Date.parse(istInstantOf(date, minute + schedule.slotMinutes)) > nowMs;
}

/** The row the now-line marks on today (null on another day, or outside the rows). */
export function nowRow(rows: readonly number[], slotMinutes: number, date: string, nowMs: number): number | null {
  if (istDateOf(nowMs) !== date) return null;
  const minute = istMinuteOfDay(nowMs);
  const index = rows.findIndex((row) => row <= minute && minute < row + slotMinutes);
  return index === -1 ? null : index;
}

/** "Closed on Sunday", or with bookings "Closed on Saturday — 2 appointments booked before the change" (A6). */
export function closedDaySentence(date: string, booked: number): string {
  const day = weekdayLong(istWeekdayOf(date));
  if (booked === 0) return `Closed on ${day}`;
  return `Closed on ${day} — ${booked} appointment${booked === 1 ? '' : 's'} booked before the change`;
}

/** The first-use empty state (no door). */
export function noDoorsSentence(warehouseLabel: string | null): string {
  return `No dock doors in ${warehouseLabel ?? 'this warehouse'} — add them in Settings → Warehouses`;
}

/** The Day grid's door page: "Doors 1–12 of 30". */
export function doorPageLabel(page: number, total: number): string {
  const first = page * DOOR_PAGE_SIZE + 1;
  const last = Math.min(total, (page + 1) * DOOR_PAGE_SIZE);
  return `Doors ${first}–${last} of ${total}`;
}

// ── the week ─────────────────────────────────────────────────────────────────

/** One Week cell: up to four entries, then how many more. */
export function weekCell(appointments: readonly DockAppointment[], doorId: string, date: string): { entries: DockAppointment[]; more: number } {
  const mine = appointmentsOn(appointments, date).filter((appointment) => appointment.dockDoorId === doorId);
  return { entries: mine.slice(0, WEEK_CELL_ENTRIES), more: Math.max(0, mine.length - WEEK_CELL_ENTRIES) };
}

/** A Week entry: `10:30 DA-0012 · Late`. */
export function weekEntryLabel(appointment: DockAppointment): string {
  return `${istClockLabel(appointment.startsAt)} ${appointment.code} · ${appointmentShortWord(appointment)}`;
}

// ── words ────────────────────────────────────────────────────────────────────

/** The punctuality words — byte-identical to the handheld's: "On time", "Early 40 min", "Late 25 min". */
export function punctualityWords(punctuality: DockPunctuality, minutes: number): string {
  switch (punctuality) {
    case 'on_time':
      return 'On time';
    case 'early':
      return `Early ${Math.abs(minutes)} min`;
    case 'late':
      return `Late ${Math.abs(minutes)} min`;
    default:
      return 'Arrived';
  }
}

/** A visit with no appointment — the handheld's word. */
export const UNSCHEDULED = 'Unscheduled';

export interface DockChip {
  readonly word: string;
  readonly tone: StatusTone;
  readonly glyph?: string;
}

/**
 * The appointment's chip: Booked · Arrived — on time · Arrived — early 40 min
 * · Arrived — late 25 min · No-show · Cancelled. A no-show is derived by the
 * server (`noShow`, read at its `asOf`), never by this clock.
 */
export function appointmentChip(appointment: Pick<DockAppointment, 'status' | 'noShow' | 'punctuality' | 'punctualityMinutes'>): DockChip {
  switch (appointment.status) {
    case 'cancelled':
      return { word: 'Cancelled', tone: 'neutral' };
    case 'arrived': {
      if (appointment.punctuality === null) return { word: 'Arrived', tone: 'success', glyph: '✓' };
      const words = punctualityWords(appointment.punctuality, appointment.punctualityMinutes ?? 0);
      const word = `Arrived — ${words.charAt(0).toLowerCase()}${words.slice(1)}`;
      if (appointment.punctuality === 'late') return { word, tone: 'warning', glyph: '⚠' };
      return { word, tone: 'success', glyph: '✓' };
    }
    default:
      return appointment.noShow ? { word: 'No-show', tone: 'warning', glyph: '✕' } : { word: 'Booked', tone: 'info' };
  }
}

/** The Week entry's one word: Booked, On time, Early, Late, No-show, Cancelled. */
export function appointmentShortWord(appointment: Pick<DockAppointment, 'status' | 'noShow' | 'punctuality'>): string {
  if (appointment.status === 'cancelled') return 'Cancelled';
  if (appointment.status === 'arrived') {
    if (appointment.punctuality === 'early') return 'Early';
    if (appointment.punctuality === 'late') return 'Late';
    return appointment.punctuality === 'on_time' ? 'On time' : 'Arrived';
  }
  return appointment.noShow ? 'No-show' : 'Booked';
}

/** The window: `10:30–11:30`. */
export function appointmentWindowLabel(appointment: Pick<DockAppointment, 'startsAt' | 'endsAt'>): string {
  return `${istClockLabel(appointment.startsAt)}–${istClockLabel(appointment.endsAt)}`;
}

/** The gate-in list's Appointment cell: "DA-0012 · Late 25 min", or "Unscheduled". */
export function gateInAppointmentLabel(appointment: Pick<GateInAppointmentDto, 'code' | 'punctuality' | 'punctualityMinutes'> | null | undefined): string {
  if (appointment === null || appointment === undefined) return UNSCHEDULED;
  return `${appointment.code} · ${punctualityWords(appointment.punctuality, appointment.punctualityMinutes)}`;
}

/** The gate-in detail's line (the handheld's shape): "DA-0012 · 10:30–11:00 · D3 · Late 25 min", or "Unscheduled". */
export function gateInAppointmentLine(appointment: GateInAppointmentDto | null | undefined): string {
  if (appointment === null || appointment === undefined) return UNSCHEDULED;
  return `${appointment.code} · ${appointmentWindowLabel(appointment)} · ${appointment.doorCode} · ${punctualityWords(appointment.punctuality, appointment.punctualityMinutes)}`;
}

/** A duration: "30 min", "1 h", "1 h 30 min". */
export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** A percentage the server computed (one decimal) — "66.7 %", "0 %"; "—" at a zero denominator. */
export function rateLabel(rate: number | null): string {
  return rate === null ? '—' : `${rate} %`;
}

/**
 * The summary strip (A8): "12 scheduled · 7 arrived (5 on time, 1 early, 1
 * late) · 1 no-show · 3 pending · 1 cancelled · On time 71 % · Utilisation
 * 58 %" — every figure a word plus a number.
 */
export function summaryParts(summary: DockSummary): string[] {
  return [
    `${summary.scheduled} scheduled`,
    `${summary.arrived} arrived (${summary.onTime} on time, ${summary.early} early, ${summary.late} late)`,
    `${summary.noShow} no-show`,
    `${summary.pending} pending`,
    `${summary.cancelled} cancelled`,
    `On time ${rateLabel(summary.onTimeRate)}`,
    `Utilisation ${rateLabel(summary.utilisationRate)}`,
  ];
}

/** The strip as one sentence (its accessible text). */
export function summarySentence(summary: DockSummary): string {
  return summaryParts(summary).join(' · ');
}

/** The truncation line (the summary stays exact — A9). */
export function truncatedSentence(shown: number): string {
  return `Showing the first ${shown} appointments of this window — the summary counts all of them. Narrow to a day to see the rest.`;
}

/** A client as a document label names it (supplied by the caller: the brand's or the tenant's name). */
export type ClientNamer = (clientId: string | null) => string | null;

/**
 * The documents of an appointment as labels (A26): the code (or "PO" / "ASN"
 * without one), prefixed with the client's name where two documents of the
 * list share a code — an ASN code is unique only per client.
 */
export function documentLabels(documents: DockAppointment['documents'], clientName: ClientNamer): string[] {
  const codes = documents.map((doc) => doc.code ?? (doc.kind === 'po' ? 'PO' : 'ASN'));
  return documents.map((doc, index) => {
    const code = codes[index]!;
    const collides = codes.some((other, j) => j !== index && other === code);
    const client = collides ? clientName(doc.clientId) : null;
    return client === null ? code : `${client} ${code}`;
  });
}

// ── the gate-in's appointment picker (decision 8, A14) ──────────────────────

/** The picker's read: IST yesterday to tomorrow (A14's window — one three-day read). */
export function linkableWindow(nowMs: number): { from: string; to: string } {
  const today = istDateOf(nowMs);
  return { from: addIsoDays(today, -1), to: addIsoDays(today, 1) };
}

/** The appointments the gate desk may link: `booked` (a no-show still links — decision 8), by start. */
export function linkableAppointments(appointments: readonly DockAppointment[]): DockAppointment[] {
  return appointments
    .filter((appointment) => appointment.status === 'booked')
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.code.localeCompare(b.code));
}

/** A picker option: "DA-0012 · Wed 28 Oct 10:30–11:00 · D3 · KA01AB1234" (· No-show when it is one). */
export function linkOptionWords(appointment: Pick<DockAppointment, 'code' | 'startsAt' | 'endsAt' | 'doorCode' | 'vehicleNo' | 'noShow'>): string {
  const parts = [
    appointment.code,
    `${istDayLabel(istDateOf(appointment.startsAt))} ${appointmentWindowLabel(appointment)}`,
    appointment.doorCode,
  ];
  if (appointment.vehicleNo !== null) parts.push(appointment.vehicleNo);
  if (appointment.noShow) parts.push('No-show');
  return parts.join(' · ');
}

/**
 * The appointment the form pre-selects: the one whose expected vehicle
 * equals the typed vehicle (normalised alike); several → the one starting
 * nearest now. Null when none matches.
 */
export function vehicleMatch(appointments: readonly DockAppointment[], typedVehicle: string, nowMs: number): DockAppointment | null {
  const vehicle = normalizeVehicleNo(typedVehicle);
  if (vehicle === null) return null;
  const matches = appointments.filter((appointment) => appointment.vehicleNo === vehicle);
  if (matches.length === 0) return null;
  return matches.reduce((best, next) =>
    Math.abs(Date.parse(next.startsAt) - nowMs) < Math.abs(Date.parse(best.startsAt) - nowMs) ? next : best,
  );
}

/**
 * The gate-in draft as the form submits it (decision 8, derived at render —
 * never written back by an effect): until the desk picks an appointment by
 * hand, the one whose expected vehicle equals the typed vehicle is selected;
 * until the door is set by hand, the chosen appointment's door fills it.
 */
export function withAppointmentDefaults(draft: GateInDraft, linkable: readonly DockAppointment[], nowMs: number): GateInDraft {
  const appointmentId = draft.appointmentPicked ? draft.appointmentId : (vehicleMatch(linkable, draft.vehicleNo, nowMs)?.id ?? '');
  const appointment = linkable.find((entry) => entry.id === appointmentId);
  const dockDoor = !draft.dockDoorEdited && appointment !== undefined ? appointment.doorCode : draft.dockDoor;
  return appointmentId === draft.appointmentId && dockDoor === draft.dockDoor ? draft : { ...draft, appointmentId, dockDoor };
}

// ── the book / reschedule draft ─────────────────────────────────────────────

export interface DockDraft {
  /** The IST date `YYYY-MM-DD`. */
  readonly date: string;
  /** The start, a minute of the IST day as text ('' = not picked). */
  readonly start: string;
  /** The length in minutes as text (whole slots; an off-grid booking keeps its own). */
  readonly duration: string;
  readonly doorId: string;
  /** `po:<id>` / `asn:<id>`, in the order picked. */
  readonly documents: readonly string[];
  readonly vehicleNo: string;
  readonly transporterName: string;
  readonly note: string;
}

/** A fresh booking draft (from an empty cell: its date, start and door). */
export function emptyDockDraft(seed: { date: string; start: number | null; doorId: string | null; slotMinutes: number }): DockDraft {
  return {
    date: seed.date,
    start: seed.start === null ? '' : String(seed.start),
    duration: String(seed.slotMinutes),
    doorId: seed.doorId ?? '',
    documents: [],
    vehicleNo: '',
    transporterName: '',
    note: '',
  };
}

/** The reschedule draft, from the appointment as stored. */
export function draftOfAppointment(appointment: DockAppointment): DockDraft {
  const { start, end } = appointmentMinutes(appointment);
  return {
    date: istDateOf(appointment.startsAt),
    start: String(start),
    duration: String(end - start),
    doorId: appointment.dockDoorId,
    documents: appointment.documents.map((doc) => `${doc.kind}:${doc.id}`),
    vehicleNo: appointment.vehicleNo ?? '',
    transporterName: appointment.transporterName ?? '',
    note: appointment.note ?? '',
  };
}

const lengthOf = (value: string) => [...value].length;

/**
 * The draft → the full body (reschedule shape; book adds the warehouse and
 * drops the nulls — `bookBody`), or ONE problem naming the field. The
 * client checks only what the server could only answer 400 to and the client
 * genuinely knows; the grid, the hours, the past and the overlap stay the
 * server's (it holds the clock and the locks).
 */
export function parseDockDraft(
  draft: DockDraft,
): { body: Required<RescheduleDockAppointmentDto>; problem: null } | { body: null; problem: string } {
  const refuse = (problem: string) => ({ body: null, problem });
  if (draft.doorId === '') return refuse('Pick the dock door.');
  if (!isRealDate(draft.date)) return refuse('Pick the date.');
  if (!/^[0-9]+$/.test(draft.start) || Number(draft.start) >= MINUTES_PER_DAY) return refuse('Pick the start time.');
  if (!/^[0-9]+$/.test(draft.duration) || Number(draft.duration) <= 0) return refuse('Pick how long the truck needs the door.');
  const start = Number(draft.start);
  const end = start + Number(draft.duration);
  if (end > MINUTES_PER_DAY) return refuse('The appointment ends after midnight — pick an earlier start or a shorter duration.');
  if (draft.documents.length > DOCK_LIMITS.documents) return refuse(`An appointment carries at most ${DOCK_LIMITS.documents} documents.`);
  const documents: DockAppointmentDocumentInputDto[] = [];
  for (const link of new Set(draft.documents)) {
    if (link.startsWith('po:')) documents.push({ poId: link.slice(3) });
    else if (link.startsWith('asn:')) documents.push({ asnId: link.slice(4) });
  }
  const vehicleNo = normalizeVehicleNo(draft.vehicleNo);
  if (vehicleNo !== null && !VEHICLE_NO_RE.test(vehicleNo)) return refuse(`The expected vehicle is ${VEHICLE_RULE}.`);
  const transporter = draft.transporterName.trim();
  if (lengthOf(transporter) > DOCK_LIMITS.transporterName) return refuse(`The transporter is at most ${DOCK_LIMITS.transporterName} characters.`);
  const note = draft.note.trim();
  if (lengthOf(note) > DOCK_LIMITS.note) return refuse(`The note is at most ${DOCK_LIMITS.note} characters.`);
  return {
    body: {
      dockDoorId: draft.doorId,
      startsAt: istInstantOf(draft.date, start),
      endsAt: istInstantOf(draft.date, end),
      documents,
      vehicleNo,
      transporterName: transporter === '' ? null : transporter,
      note: note === '' ? null : note,
    },
    problem: null,
  };
}

/** The book body: the warehouse, and blank optionals dropped (never sent as null — guide §7). */
export function bookBody(body: Required<RescheduleDockAppointmentDto>, warehouseId: string) {
  const { vehicleNo, transporterName, note, ...rest } = body;
  return {
    warehouseId,
    ...rest,
    ...(vehicleNo === null ? {} : { vehicleNo }),
    ...(transporterName === null ? {} : { transporterName }),
    ...(note === null ? {} : { note }),
  };
}

export interface SlotOption {
  readonly minute: number;
  readonly label: string;
  readonly disabled: boolean;
}

/**
 * The start options of a date: the schedule's slots (past slots of today
 * disabled — the current slot stays open), plus the appointment's own start
 * when it is off the grid (`keep`, so a note edit never moves it — A5).
 */
export function startOptions(
  schedule: Pick<DockSchedule, 'slotMinutes' | 'opensAt' | 'closesAt'>,
  date: string,
  nowMs: number,
  keep: number | null = null,
): SlotOption[] {
  const { opens, closes } = openingMinutes(schedule);
  const slot = schedule.slotMinutes;
  const options: SlotOption[] = [];
  for (let minute = opens; minute + slot <= closes; minute += slot) {
    const past = Date.parse(istInstantOf(date, minute + slot)) <= nowMs;
    options.push({ minute, label: minuteLabel(minute), disabled: past && minute !== keep });
  }
  if (keep !== null && !options.some((option) => option.minute === keep)) {
    options.push({ minute: keep, label: `${minuteLabel(keep)} (as booked)`, disabled: false });
    options.sort((a, b) => a.minute - b.minute);
  }
  return options;
}

/** The duration options: 1–8 slots ("30 min", "1 h 30 min"), plus the booking's own length when it is not one. */
export function durationOptions(slotMinutes: number, keep: number | null = null): { minutes: number; label: string }[] {
  const options = Array.from({ length: DOCK_LIMITS.maxSlots }, (_, index) => {
    const minutes = slotMinutes * (index + 1);
    return { minutes, label: durationLabel(minutes) };
  });
  if (keep !== null && !options.some((option) => option.minutes === keep)) {
    options.push({ minutes: keep, label: `${durationLabel(keep)} (as booked)` });
    options.sort((a, b) => a.minutes - b.minutes);
  }
  return options;
}

/**
 * The door options: the active doors, each labelled "busy" when a LOADED
 * booking overlaps the drafted window (advisory — the server's overlap read
 * is the ruling), plus the appointment's own door when it is inactive.
 */
export function doorOptions(
  doors: readonly DockDoor[],
  appointments: readonly DockAppointment[],
  window: { startsAt: string; endsAt: string } | null,
  self: { id: string; doorId: string } | null = null,
): { id: string; label: string; busy: boolean }[] {
  const shown = doors.filter((door) => door.active || door.id === self?.doorId);
  return shown.map((door) => {
    const busy =
      window !== null &&
      appointments.some(
        (appointment) =>
          appointment.dockDoorId === door.id &&
          appointment.status !== 'cancelled' &&
          appointment.id !== self?.id &&
          appointment.startsAt < window.endsAt &&
          appointment.endsAt > window.startsAt,
      );
    const name = door.name === null ? door.code : `${door.code} — ${door.name}`;
    const label = `${name}${door.active ? '' : ' (inactive)'}${busy ? ' — busy' : ''}`;
    return { id: door.id, label, busy };
  });
}

/** Whether an appointment still takes a reschedule or a cancel (decision 7): booked and not a no-show. */
export function canChangeAppointment(appointment: Pick<DockAppointment, 'status' | 'noShow'>): boolean {
  return appointment.status === 'booked' && !appointment.noShow;
}

/** Why it does not (shown in the drawer instead of the buttons). */
export function closedAppointmentSentence(appointment: Pick<DockAppointment, 'status' | 'noShow' | 'code'>): string | null {
  if (appointment.status === 'arrived') return `${appointment.code} has arrived — it can no longer be moved or cancelled.`;
  if (appointment.status === 'cancelled') return `${appointment.code} is cancelled.`;
  if (appointment.noShow) return `${appointment.code} is a no-show — book a new appointment instead. A late truck can still be matched at the gate.`;
  return null;
}

/** The cancel reason, trimmed: 1–200 characters. */
export function parseCancelReason(reason: string): { reason: string; problem: null } | { reason: null; problem: string } {
  const trimmed = reason.trim();
  if (trimmed === '') return { reason: null, problem: 'Say why it is cancelled.' };
  if (lengthOf(trimmed) > DOCK_LIMITS.cancelReason) return { reason: null, problem: `The reason is at most ${DOCK_LIMITS.cancelReason} characters.` };
  return { reason: trimmed, problem: null };
}

/** The banners after a write (from the RESPONSE). */
export function bookedOutcome(appointment: DockAppointment): { tone: 'accepted'; word: string; reason: string } {
  return {
    tone: 'accepted',
    word: `${appointment.code} booked`,
    reason: `${appointment.doorCode}, ${istDayLabel(istDateOf(appointment.startsAt))} ${appointmentWindowLabel(appointment)} IST.`,
  };
}

export function rescheduledOutcome(appointment: DockAppointment): { tone: 'accepted'; word: string; reason: string } {
  return {
    tone: 'accepted',
    word: `${appointment.code} saved`,
    reason: `${appointment.doorCode}, ${istDayLabel(istDateOf(appointment.startsAt))} ${appointmentWindowLabel(appointment)} IST.`,
  };
}

export function cancelledOutcome(appointment: DockAppointment): { tone: 'accepted'; word: string; reason: string } {
  return { tone: 'accepted', word: `${appointment.code} cancelled`, reason: `The slot on ${appointment.doorCode} is free again.` };
}

// ── Settings: the doors and the schedule ────────────────────────────────────

/** The door form → `{code, name}` (the server trims and uppercases; the client mirrors it to say so early). */
export function parseDoorDraft(draft: { code: string; name: string }): { code: string; name: string | null; problem: null } | { problem: string } {
  const code = draft.code.trim().toUpperCase();
  if (!DOOR_CODE_RE.test(code)) return { problem: 'The door code is 1–20 letters, digits or hyphens (D3, DOCK-1).' };
  const name = draft.name.trim();
  if (lengthOf(name) > DOCK_LIMITS.doorName) return { problem: `The door name is at most ${DOCK_LIMITS.doorName} characters.` };
  return { code, name: name === '' ? null : name, problem: null };
}

export interface ScheduleDraft {
  readonly slotMinutes: string;
  readonly opensAt: string;
  readonly closesAt: string;
  readonly openDays: readonly number[];
  readonly graceMinutes: string;
}

export function draftOfSchedule(schedule: DockSchedule): ScheduleDraft {
  return {
    slotMinutes: String(schedule.slotMinutes),
    opensAt: schedule.opensAt,
    closesAt: schedule.closesAt,
    openDays: [...schedule.openDays].sort((a, b) => a - b),
    graceMinutes: String(schedule.graceMinutes),
  };
}

/** The schedule form → the PUT body, or the problem naming the field (decision 3's rules). */
export function parseScheduleDraft(draft: ScheduleDraft): { body: PutDockScheduleDto; problem: null } | { body: null; problem: string } {
  const refuse = (problem: string) => ({ body: null, problem });
  const slot = Number(draft.slotMinutes);
  if (!(SLOT_LENGTHS as readonly number[]).includes(slot)) return refuse('The slot length is 15, 30 or 60 minutes.');
  const opens = parseMinute(draft.opensAt);
  const closes = parseMinute(draft.closesAt);
  if (opens === null || opens >= MINUTES_PER_DAY) return refuse('Opens at is a time (HH:MM, IST).');
  if (closes === null) return refuse('Closes at is a time (HH:MM, IST) — 24:00 closes at midnight.');
  if (closes <= opens) return refuse('Closes at is after Opens at.');
  if (opens % slot !== 0) return refuse(`Opens at is on the ${slot}-minute slot grid.`);
  if (closes % slot !== 0) return refuse(`Closes at is on the ${slot}-minute slot grid.`);
  if (draft.openDays.length === 0) return refuse('Pick at least one open day.');
  const grace = draft.graceMinutes.trim();
  if (!/^[0-9]+$/.test(grace) || Number(grace) > DOCK_LIMITS.graceMax) return refuse(`The grace is a whole number of minutes from 0 to ${DOCK_LIMITS.graceMax}.`);
  return {
    body: {
      slotMinutes: slot as PutDockScheduleDto['slotMinutes'],
      opensAt: minuteLabel(opens),
      closesAt: minuteLabel(closes),
      openDays: [...new Set(draft.openDays)].sort((a, b) => a - b),
      graceMinutes: Number(grace),
    },
    problem: null,
  };
}

/** The schedule as a sentence: "30 min slots · 09:00–18:00 · Mon–Sat · grace 15 min". */
export function scheduleSentence(schedule: Pick<DockSchedule, 'slotMinutes' | 'opensAt' | 'closesAt' | 'openDays' | 'graceMinutes'>): string {
  const days = [...schedule.openDays].sort((a, b) => a - b);
  const contiguous = days.every((day, index) => index === 0 || day === days[index - 1]! + 1);
  const dayWords =
    days.length === 7
      ? 'every day'
      : contiguous && days.length > 2
        ? `${weekdayShortOf(days[0]!)}–${weekdayShortOf(days[days.length - 1]!)}`
        : days.map(weekdayShortOf).join(', ');
  return `${schedule.slotMinutes} min slots · ${schedule.opensAt}–${schedule.closesAt} · ${dayWords} · grace ${schedule.graceMinutes} min`;
}

function weekdayShortOf(day: number): string {
  return weekdayLong(day).slice(0, 3);
}

/** The schedule card's note while no row is stored. */
export const SCHEDULE_DEFAULTS_NOTE = 'Using defaults — not yet saved';

// ── refusals ────────────────────────────────────────────────────────────────

function clashSentence(error: ApiProblem): string {
  const clash = error.extensions['clash'];
  if (typeof clash === 'object' && clash !== null) {
    const { code, startsAt, endsAt } = clash as { code?: unknown; startsAt?: unknown; endsAt?: unknown };
    if (typeof code === 'string' && typeof startsAt === 'string' && typeof endsAt === 'string') {
      return `That door is taken — ${code} is booked ${istClockLabel(startsAt)}–${istClockLabel(endsAt)} on ${istDayLabel(istDateOf(startsAt))}. Pick another door or time.`;
    }
  }
  return error.detail ?? 'That door is taken at that time — pick another door or time.';
}

function doorBusySentence(error: ApiProblem): string {
  const count = error.extensions['appointmentCount'];
  const first = error.extensions['firstAppointmentCode'];
  if (typeof count === 'number' && typeof first === 'string') {
    return `The door has ${count} booked appointment${count === 1 ? '' : 's'} still to come (first ${first}) — reschedule or cancel ${count === 1 ? 'it' : 'them'} before deactivating the door.`;
  }
  return error.detail ?? 'The door has booked appointments still to come — reschedule or cancel them first.';
}

/** Whether a refusal says the calendar moved (the caller re-reads the window). */
export function isStaleDockRefusal(error: unknown): boolean {
  return (
    error instanceof ApiProblem &&
    ['dock-slot-taken', 'appointment-closed', 'appointment-no-show', 'conflict', 'not-found', 'dock-door-inactive', 'po-not-open', 'asn-not-open'].includes(error.code)
  );
}

/**
 * Every dock refusal — book, reschedule, cancel, the doors, the schedule, and
 * the gate-in's appointment link — branching on the problem `code`, never on
 * prose. The shared arms read the house copy.
 */
export function dockReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'validation-failed':
        // The detail names the field.
        return error.detail ?? 'Check the appointment and try again.';
      case 'slot-misaligned':
        return 'The start or the length is off the slot grid — pick a slot from the list.';
      case 'slot-in-past':
        return 'That slot has passed — pick the current slot or a later one.';
      case 'slot-too-far':
        return 'Appointments are booked at most 90 days ahead — pick an earlier date.';
      case 'dock-closed':
        return 'The dock is closed then — pick an open day inside the opening hours (Settings → Warehouses).';
      case 'dock-slot-taken':
        return clashSentence(error);
      case 'dock-door-warehouse-mismatch':
        return 'That door belongs to another warehouse — pick one of this warehouse’s doors.';
      case 'dock-door-inactive':
        return 'That door is inactive — pick another, or reactivate it in Settings → Warehouses.';
      case 'dock-door-limit':
        return `A warehouse has at most ${DOCK_LIMITS.doorsPerWarehouse} dock doors.`;
      case 'dock-door-code-taken':
        return 'That door code is already used in this warehouse (active or inactive) — pick another, or reactivate that door.';
      case 'dock-door-has-appointments':
        return doorBusySentence(error);
      case 'document-warehouse-mismatch':
        return 'A PO or ASN belongs to another warehouse — pick one of this warehouse’s.';
      case 'po-not-open':
        return 'A PO is no longer open (received, closed or cancelled) — refresh and pick another.';
      case 'asn-not-open':
        return ASN_NOT_OPEN_REASON;
      case 'appointment-closed':
        return 'That appointment has arrived, is cancelled or is another gate-in’s — refresh the list.';
      case 'appointment-no-show':
        return 'That appointment is a no-show — book a new one instead.';
      case 'appointment-warehouse-mismatch':
        return 'That appointment belongs to another warehouse — pick one of this warehouse’s.';
      case 'appointment-not-due':
        return 'Only an appointment of yesterday, today or tomorrow can be linked at the gate.';
      case 'conflict':
        return error.detail ?? 'The same submission is still in flight — retry to read the settled result.';
      case 'not-found':
        return error.detail ?? 'It no longer exists — refresh the schedule.';
      case 'role-denied':
        return 'Your role cannot change the dock schedule.';
      case 'permission-denied':
        return 'Your session belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed with different details — refresh and try again.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      default:
        return error.detail ?? `The dock schedule was not changed (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/** The appointment-link codes the gate-in form maps with `dockReason` (the rest stay `gateInReason`'s). */
export const APPOINTMENT_LINK_CODES: ReadonlySet<string> = new Set([
  'appointment-closed',
  'appointment-warehouse-mismatch',
  'appointment-not-due',
  'appointment-no-show',
]);
