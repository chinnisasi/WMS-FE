import { describe, expect, test } from 'bun:test';

import { ApiProblem } from './api/client';
import type { DockAppointmentDto, DockDoorDto, DockScheduleDto, DockSummaryDto } from './api/generated';
import {
  APPOINTMENT_LINK_CODES,
  appointmentChip,
  appointmentShortWord,
  bookBody,
  cancelledByRow,
  canChangeAppointment,
  closedAppointmentSentence,
  closedDaySentence,
  dayRows,
  dockHref,
  dockParamsKey,
  dockReason,
  documentLabels,
  doorColumn,
  doorOptions,
  doorPageLabel,
  draftOfAppointment,
  durationLabel,
  durationOptions,
  emptyDockDraft,
  gateInAppointmentLabel,
  gateInAppointmentLine,
  isBookableSlot,
  isOffSchedule,
  isStaleDockRefusal,
  liveCount,
  linkableAppointments,
  linkableWindow,
  noDoorsSentence,
  nowRow,
  parseCancelReason,
  parseDockDraft,
  parseDockParams,
  parseDoorDraft,
  parseScheduleDraft,
  punctualityWords,
  rateLabel,
  scheduleSentence,
  startOptions,
  stepDate,
  summaryParts,
  summarySentence,
  vehicleMatch,
  weekCell,
  weekEntryLabel,
  weekIndex,
  windowLabel,
  windowOf,
  withAppointmentDefaults,
} from './dock-schedule';
import { emptyGateInDraft } from './gate-ins';
import { istInstantOf } from './ist';
import { UNREACHABLE_REASON } from './outbound-orders';

const WH = '0198f7a2-1b3c-7d4e-8f90-99aabbccddee';
const D3 = '0198f7a2-1b3c-7d4e-8f90-0000000000d3';
const D4 = '0198f7a2-1b3c-7d4e-8f90-0000000000d4';
const A1 = '0198f7a2-1b3c-7d4e-8f90-0000000000a1';
const PO = '0198f7a2-1b3c-7d4e-8f90-0000000000f1';
const ASN = '0198f7a2-1b3c-7d4e-8f90-0000000000f2';

/** BLR-1's defaults: 30 min slots, 09:00–18:00 Mon–Sat, grace 15. */
const SCHEDULE: DockScheduleDto = {
  warehouseId: WH,
  slotMinutes: 30,
  opensAt: '09:00',
  closesAt: '18:00',
  openDays: [1, 2, 3, 4, 5, 6],
  graceMinutes: 15,
  configured: false,
  updatedAt: null,
};

const TUESDAY = '2026-10-27';
const SATURDAY = '2026-10-31';
const SUNDAY = '2026-11-01';

function appointment(patch: Partial<DockAppointmentDto> = {}): DockAppointmentDto {
  return {
    id: A1,
    tenantId: 't',
    warehouseId: WH,
    code: 'DA-0001',
    status: 'booked',
    dockDoorId: D3,
    doorCode: 'D3',
    startsAt: istInstantOf(TUESDAY, 630), // 10:30
    endsAt: istInstantOf(TUESDAY, 690), // 11:30
    graceMinutes: 15,
    clientId: null,
    vehicleNo: null,
    transporterName: null,
    note: null,
    documents: [],
    gateInId: null,
    gateInCode: null,
    gatedInAt: null,
    linkedAt: null,
    linkedBy: null,
    bookedBy: 'u',
    cancelledAt: null,
    cancelledBy: null,
    cancelReason: null,
    punctuality: null,
    punctualityMinutes: null,
    noShow: false,
    createdAt: '2026-10-20T00:00:00.000Z',
    updatedAt: '2026-10-20T00:00:00.000Z',
    ...patch,
  };
}

function door(id: string, code: string, active = true): DockDoorDto {
  return { id, warehouseId: WH, code, name: null, active, createdBy: 'u', createdAt: '', updatedAt: '' };
}

describe('URL state (decision 10)', () => {
  test('defaults, a full state, and junk that falls back per key', () => {
    expect(parseDockParams({ tab: 'dock' })).toEqual({ view: 'day', date: null, open: null, cancelled: false });
    expect(parseDockParams({ tab: 'dock', view: 'week', date: TUESDAY, open: A1.toUpperCase(), cancelled: '1' })).toEqual({
      view: 'week',
      date: TUESDAY,
      open: A1,
      cancelled: true,
    });
    expect(parseDockParams({ view: 'month', date: '2026-02-30', open: 'nope', cancelled: 'yes' })).toEqual({ view: 'day', date: null, open: null, cancelled: false });
    expect(parseDockParams({ view: ['week', 'list'] }).view).toBe('day');
  });

  test('the href leaves defaults out and round-trips; the key names every part', () => {
    expect(dockHref({ view: 'day', date: null, open: null, cancelled: false })).toBe('/inbound?tab=dock');
    const state = { view: 'week' as const, date: TUESDAY, open: A1, cancelled: true };
    const href = dockHref(state);
    expect(href).toBe(`/inbound?tab=dock&view=week&date=${TUESDAY}&open=${A1}&cancelled=1`);
    expect(parseDockParams(Object.fromEntries(new URL(href, 'http://x').searchParams))).toEqual(state);
    expect(dockParamsKey(state)).toBe(`week|${TUESDAY}|${A1}|1`);
  });

  test('the window: a day (Day and List — W10), or the Mon–Sun week; Prev/Next step a day or a week', () => {
    expect(windowOf('day', TUESDAY)).toEqual({ from: TUESDAY, to: TUESDAY });
    expect(windowOf('week', SUNDAY)).toEqual({ from: '2026-10-26', to: SUNDAY });
    expect(windowOf('list', TUESDAY)).toEqual({ from: TUESDAY, to: TUESDAY });
    expect(stepDate('list', TUESDAY, 1)).toBe('2026-10-28');
    expect(stepDate('day', TUESDAY, 1)).toBe('2026-10-28');
    expect(stepDate('week', TUESDAY, -1)).toBe('2026-10-20');
    expect(windowLabel({ from: TUESDAY, to: TUESDAY })).toBe('Tue 27 Oct');
    expect(windowLabel({ from: '2026-10-26', to: SUNDAY })).toBe('Mon 26 Oct – Sun 1 Nov');
  });
});

describe('the Day grid', () => {
  test('one row per slot of the opening hours: 18 for 09:00–18:00 at 30 min; AC3 — sixteen for 06:00–22:00 at 60 min', () => {
    const rows = dayRows(SCHEDULE, TUESDAY, []);
    expect(rows.length).toBe(18);
    expect(rows[0]).toBe(540);
    expect(rows[17]).toBe(1050);
    expect(dayRows({ ...SCHEDULE, slotMinutes: 60, opensAt: '06:00', closesAt: '22:00', openDays: [1, 2, 3, 4, 5, 6, 7] }, SUNDAY, []).length).toBe(16);
  });

  test('a closed day with no booking has no rows — "Closed on Sunday"', () => {
    expect(dayRows(SCHEDULE, SUNDAY, [])).toEqual([]);
    expect(closedDaySentence(SUNDAY, 0)).toBe('Closed on Sunday');
  });

  test('A6 — a Saturday booking after Saturday closes still renders: rows cover it, the banner counts it, it reads Outside schedule', () => {
    const closedSaturday = { ...SCHEDULE, openDays: [1, 2, 3, 4, 5] };
    const booked = appointment({ startsAt: istInstantOf(SATURDAY, 600), endsAt: istInstantOf(SATURDAY, 660) });
    expect(dayRows(closedSaturday, SATURDAY, [booked])).toEqual([600, 630]);
    expect(closedDaySentence(SATURDAY, 2)).toBe('Closed on Saturday — 2 appointments booked before the change');
    expect(isOffSchedule(closedSaturday, booked)).toBe(true);
  });

  test('A6 — a 10:30 booking after the change to 60-minute slots is placed in the 10:00 row by its minutes, tagged off-schedule', () => {
    const hourly = { ...SCHEDULE, slotMinutes: 60 as const };
    const booked = appointment({ endsAt: istInstantOf(TUESDAY, 660) }); // 10:30–11:00
    const rows = dayRows(hourly, TUESDAY, [booked]);
    expect(rows.length).toBe(9);
    const cells = doorColumn(rows, 60, [booked]);
    const block = cells.find((cell) => cell.kind === 'block')!;
    expect(rows[block.row]).toBe(600);
    expect(block.kind === 'block' && block.span).toBe(1);
    expect(isOffSchedule(hourly, booked)).toBe(true);
    expect(isOffSchedule(SCHEDULE, appointment())).toBe(false);
  });

  test('A6 — rows extend past the hours to cover an early booking', () => {
    const early = appointment({ startsAt: istInstantOf(TUESDAY, 480), endsAt: istInstantOf(TUESDAY, 510) }); // 08:00–08:30
    expect(dayRows(SCHEDULE, TUESDAY, [early])[0]).toBe(480);
  });

  test('AC1 — DA-0001 10:30–11:30 is one block across two slots; the free cells around it stay free', () => {
    const rows = dayRows(SCHEDULE, TUESDAY, [appointment()]);
    const cells = doorColumn(rows, 30, [appointment()]);
    const block = cells.find((cell) => cell.kind === 'block')!;
    expect(rows[block.row]).toBe(630);
    expect(block.kind === 'block' && block.span).toBe(2);
    // 18 rows: 16 free cells + one block covering two.
    expect(cells.length).toBe(17);
  });

  test('two bookings landing in one covered row join one block (never drawn over each other)', () => {
    const hourly = { ...SCHEDULE, slotMinutes: 60 as const };
    const a = appointment({ startsAt: istInstantOf(TUESDAY, 600), endsAt: istInstantOf(TUESDAY, 630) });
    const b = appointment({ id: 'b', code: 'DA-0002', startsAt: istInstantOf(TUESDAY, 630), endsAt: istInstantOf(TUESDAY, 660) });
    const cells = doorColumn(dayRows(hourly, TUESDAY, [a, b]), 60, [a, b]);
    const blocks = cells.filter((cell) => cell.kind === 'block');
    expect(blocks.length).toBe(1);
    expect(blocks[0]!.kind === 'block' && blocks[0]!.appointments.map((x) => x.code)).toEqual(['DA-0001', 'DA-0002']);
  });

  test('WE12 — a cancelled appointment never takes a cell: the slot stays free, the line rides the row; the closed-day count skips it', () => {
    const gone = appointment({ id: 'gone', code: 'DA-0009', status: 'cancelled' });
    const rows = dayRows(SCHEDULE, TUESDAY, [gone]);
    expect(doorColumn(rows, 30, [gone]).every((cell) => cell.kind === 'free')).toBe(true);
    const byRow = cancelledByRow(rows, [gone, appointment()]);
    expect([...byRow.keys()].map((row) => rows[row])).toEqual([630]);
    expect(byRow.get(rows.indexOf(630))!.map((a) => a.code)).toEqual(['DA-0009']);
    expect(liveCount([gone, appointment()])).toBe(1);
  });

  test('bookable: the current slot (now 10:40, 10:30) yes; the previous slot no; a closed day no; an extended row no', () => {
    const now = Date.parse(istInstantOf(TUESDAY, 640));
    expect(isBookableSlot(SCHEDULE, TUESDAY, 630, now)).toBe(true);
    expect(isBookableSlot(SCHEDULE, TUESDAY, 600, now)).toBe(false);
    expect(isBookableSlot(SCHEDULE, SUNDAY, 630, now)).toBe(false);
    expect(isBookableSlot(SCHEDULE, TUESDAY, 480, now)).toBe(false);
    expect(isBookableSlot(SCHEDULE, TUESDAY, 1050, now)).toBe(true);
  });

  test('the now-line is on today only', () => {
    const rows = dayRows(SCHEDULE, TUESDAY, []);
    const now = Date.parse(istInstantOf(TUESDAY, 640));
    expect(rows[nowRow(rows, 30, TUESDAY, now)!]).toBe(630);
    expect(nowRow(rows, 30, '2026-10-28', now)).toBeNull();
  });

  test('door paging and the first-use sentence', () => {
    expect(doorPageLabel(0, 30)).toBe('Doors 1–12 of 30');
    expect(doorPageLabel(2, 30)).toBe('Doors 25–30 of 30');
    expect(noDoorsSentence('BLR-1')).toBe('No dock doors in BLR-1 — add them in Settings → Warehouses');
  });
});

describe('the Week grid', () => {
  test('AC1 — "10:30 DA-0001 · Booked"; up to four entries, then +N more', () => {
    expect(weekEntryLabel(appointment())).toBe('10:30 DA-0001 · Booked');
    const six = Array.from({ length: 6 }, (_, i) =>
      appointment({ id: `a${i}`, code: `DA-000${i}`, startsAt: istInstantOf(TUESDAY, 540 + i * 30), endsAt: istInstantOf(TUESDAY, 570 + i * 30) }),
    );
    const cell = weekCell(weekIndex(six), D3, TUESDAY);
    expect(cell.entries.length).toBe(4);
    expect(cell.more).toBe(2);
    expect(weekCell(weekIndex(six), D4, TUESDAY)).toEqual({ entries: [], more: 0 });
  });
});

describe('words', () => {
  test('the punctuality words are the handheld’s, byte for byte', () => {
    expect(punctualityWords('on_time', 11)).toBe('On time');
    expect(punctualityWords('early', -40)).toBe('Early 40 min');
    expect(punctualityWords('late', 25)).toBe('Late 25 min');
    expect(gateInAppointmentLabel(null)).toBe('Unscheduled');
  });

  test('the chips: Booked · Arrived — on time · Arrived — early 40 min · Arrived — late 25 min · No-show · Cancelled — each a word, never colour alone', () => {
    expect(appointmentChip(appointment())).toEqual({ word: 'Booked', tone: 'info' });
    expect(appointmentChip(appointment({ status: 'arrived', punctuality: 'on_time', punctualityMinutes: 11 })).word).toBe('Arrived — on time');
    expect(appointmentChip(appointment({ status: 'arrived', punctuality: 'early', punctualityMinutes: -40 })).word).toBe('Arrived — early 40 min');
    const late = appointmentChip(appointment({ status: 'arrived', punctuality: 'late', punctualityMinutes: 25 }));
    expect(late).toEqual({ word: 'Arrived — late 25 min', tone: 'warning', glyph: '⚠' });
    expect(appointmentChip(appointment({ noShow: true })).word).toBe('No-show');
    expect(appointmentChip(appointment({ status: 'cancelled' })).word).toBe('Cancelled');
  });

  test('the short words of the Week entries', () => {
    expect(appointmentShortWord(appointment({ status: 'arrived', punctuality: 'late' }))).toBe('Late');
    expect(appointmentShortWord(appointment({ status: 'arrived', punctuality: 'on_time' }))).toBe('On time');
    expect(appointmentShortWord(appointment({ status: 'arrived', punctuality: 'early' }))).toBe('Early');
    expect(appointmentShortWord(appointment({ noShow: true }))).toBe('No-show');
    expect(appointmentShortWord(appointment({ status: 'cancelled' }))).toBe('Cancelled');
  });

  test('AC2 — the gate-in list reads "DA-0001 · Late 20 min"; the line names the window and the door (A12: the raw delta)', () => {
    const linked = { id: A1, code: 'DA-0001', startsAt: appointment().startsAt, endsAt: appointment().endsAt, doorCode: 'D3', punctuality: 'late' as const, punctualityMinutes: 20 };
    expect(gateInAppointmentLabel(linked)).toBe('DA-0001 · Late 20 min');
    expect(gateInAppointmentLine(linked)).toBe('DA-0001 · 10:30–11:30 · D3 · Late 20 min');
    expect(gateInAppointmentLine(null)).toBe('Unscheduled');
  });

  test('durations', () => {
    expect(durationLabel(30)).toBe('30 min');
    expect(durationLabel(60)).toBe('1 h');
    expect(durationLabel(90)).toBe('1 h 30 min');
  });

  test('the summary strip (A8): every figure a word plus a number; a zero denominator reads "—"', () => {
    // The matrix: 10 booked — 6 on time, 1 early, 1 late, 1 no-show, 1 pending; 1 cancelled → 6/9 = 66.7 %.
    const summary: DockSummaryDto = {
      scheduled: 10, pending: 1, arrived: 8, early: 1, onTime: 6, late: 1, noShow: 1, cancelled: 1,
      onTimeRate: 66.7, bookedMinutes: 600, openMinutes: 2160, utilisationRate: 27.8, byDoor: [],
    };
    expect(summaryParts(summary)).toEqual([
      '10 scheduled',
      '8 arrived (6 on time, 1 early, 1 late)',
      '1 no-show',
      '1 pending',
      '1 cancelled',
      'On time 66.7 %',
      'Utilisation 27.8 %',
    ]);
    // AC2 — one late arrival: on-time 0 %.
    expect(summarySentence({ ...summary, scheduled: 1, pending: 0, arrived: 1, early: 0, onTime: 0, late: 1, noShow: 0, cancelled: 0, onTimeRate: 0 })).toContain('1 arrived (0 on time, 0 early, 1 late) · 0 no-show');
    expect(rateLabel(0)).toBe('0 %');
    expect(rateLabel(null)).toBe('—');
  });

  test('A26 — documents by code; colliding codes (an ASN code is unique per client only) take the client name', () => {
    const docs = [
      { kind: 'po' as const, id: PO, code: 'PO-1001', clientId: 'glow', vendorName: 'Acme' },
      { kind: 'asn' as const, id: ASN, code: 'ASN-77', clientId: 'glow', vendorName: null },
      { kind: 'asn' as const, id: 'x', code: 'ASN-77', clientId: 'brew', vendorName: null },
      { kind: 'asn' as const, id: 'y', code: null, clientId: 'brew', vendorName: null },
    ];
    const name = (id: string | null) => (id === 'glow' ? 'GlowCo' : id === 'brew' ? 'BrewCo' : null);
    expect(documentLabels(docs, name)).toEqual(['PO-1001', 'GlowCo ASN-77', 'BrewCo ASN-77', 'ASN']);
  });

  test('a closed appointment says why it takes no change (decision 7)', () => {
    expect(canChangeAppointment(appointment())).toBe(true);
    expect(canChangeAppointment(appointment({ noShow: true }))).toBe(false);
    expect(closedAppointmentSentence(appointment({ status: 'arrived' }))).toContain('has arrived');
    expect(closedAppointmentSentence(appointment({ noShow: true }))).toContain('no-show — book a new appointment');
    expect(closedAppointmentSentence(appointment())).toBeNull();
  });
});

describe('the gate-in picker (decision 8, A14)', () => {
  test('the window is IST yesterday to tomorrow; only booked appointments link (a no-show still does)', () => {
    // Centred on the VISIT's IST date (the server's A14 window), whatever the clock says.
    expect(linkableWindow(Date.parse(istInstantOf(TUESDAY, 1)))).toEqual({ from: '2026-10-26', to: '2026-10-28' });
    expect(linkableWindow(Date.parse(istInstantOf(TUESDAY, 1439)))).toEqual({ from: '2026-10-26', to: '2026-10-28' });
    const list = linkableAppointments([
      appointment({ id: 'c', status: 'cancelled' }),
      appointment({ id: 'n', noShow: true }),
      appointment({ id: 'r', status: 'arrived' }),
    ]);
    expect(list.map((a) => a.id)).toEqual(['n']);
  });

  test('the vehicle pre-selects: normalised alike; several → the nearest start', () => {
    const near = appointment({ id: 'near', vehicleNo: 'KA01AB1234' });
    const far = appointment({ id: 'far', vehicleNo: 'KA01AB1234', startsAt: istInstantOf('2026-10-28', 630) });
    const now = Date.parse(istInstantOf(TUESDAY, 640));
    expect(vehicleMatch([far, near], 'ka-01 ab.1234', now)?.id).toBe('near');
    expect(vehicleMatch([near], 'MH12', now)).toBeNull();
    expect(vehicleMatch([near], '', now)).toBeNull();
  });

  test('withAppointmentDefaults: the match fills the appointment and its door — until the desk picks or types by hand', () => {
    const linkable = [appointment({ vehicleNo: 'KA01AB1234' })];
    const now = Date.parse(istInstantOf(TUESDAY, 640));
    const base = { ...emptyGateInDraft(now), vehicleNo: 'KA01AB1234' };
    expect(withAppointmentDefaults(base, linkable, now)).toMatchObject({ appointmentId: A1, dockDoor: 'D3' });
    // Picked "No appointment" by hand: nothing is guessed.
    expect(withAppointmentDefaults({ ...base, appointmentPicked: true, appointmentId: '' }, linkable, now)).toMatchObject({ appointmentId: '', dockDoor: '' });
    // A door typed by hand stays.
    expect(withAppointmentDefaults({ ...base, dockDoor: 'YARD', dockDoorEdited: true }, linkable, now).dockDoor).toBe('YARD');
    // No match: the draft as it is.
    const none = { ...base, vehicleNo: 'MH12XY9999' };
    expect(withAppointmentDefaults(none, linkable, now)).toBe(none);
  });
});

describe('the book / reschedule draft', () => {
  test('a booking body: IST instants, documents, normalised vehicle; book drops the blank optionals and adds the warehouse', () => {
    const draft = { ...emptyDockDraft({ date: '2026-10-28', start: 630, doorId: D3, slotMinutes: 30 }), duration: '60', documents: [`po:${PO}`, `asn:${ASN}`], vehicleNo: 'ka 01 ab 1234' };
    const parsed = parseDockDraft(draft);
    expect(parsed.problem).toBeNull();
    expect(parsed.body).toEqual({
      dockDoorId: D3,
      startsAt: '2026-10-28T05:00:00.000Z',
      endsAt: '2026-10-28T06:00:00.000Z',
      documents: [{ poId: PO }, { asnId: ASN }],
      vehicleNo: 'KA01AB1234',
      transporterName: null,
      note: null,
    });
    expect(bookBody(parsed.body!, WH)).toEqual({
      warehouseId: WH,
      dockDoorId: D3,
      startsAt: '2026-10-28T05:00:00.000Z',
      endsAt: '2026-10-28T06:00:00.000Z',
      documents: [{ poId: PO }, { asnId: ASN }],
      vehicleNo: 'KA01AB1234',
    });
  });

  test('each problem is named, and nothing is sent', () => {
    const ok = emptyDockDraft({ date: '2026-10-28', start: 630, doorId: D3, slotMinutes: 30 });
    expect(parseDockDraft({ ...ok, doorId: '' }).problem).toBe('Pick the dock door.');
    expect(parseDockDraft({ ...ok, start: '' }).problem).toBe('Pick the start time.');
    expect(parseDockDraft({ ...ok, date: '2026-02-30' }).problem).toBe('Pick the date.');
    expect(parseDockDraft({ ...ok, vehicleNo: 'KA1' }).problem).toContain('expected vehicle');
    expect(parseDockDraft({ ...ok, note: 'x'.repeat(501) }).problem).toContain('at most 500');
    expect(parseDockDraft({ ...ok, start: '1410', duration: '60' }).problem).toContain('after midnight');
    // A7 — 23:30–24:00 is a body (the server decides whether the dock closes at 24:00).
    expect(parseDockDraft({ ...ok, start: '1410', duration: '30' }).body?.endsAt).toBe('2026-10-28T18:30:00.000Z');
    expect(parseDockDraft({ ...ok, documents: Array.from({ length: 11 }, (_, i) => `po:${i}`) }).problem).toContain('at most 10');
  });

  test('A5 — a reschedule draft keeps the stored instants (an off-grid booking is not moved by a note edit)', () => {
    const offGrid = appointment({ startsAt: istInstantOf(TUESDAY, 630), endsAt: istInstantOf(TUESDAY, 660), note: 'call first', documents: [{ kind: 'po', id: PO, code: 'PO-1001', clientId: null, vendorName: null }] });
    const draft = { ...draftOfAppointment(offGrid), note: 'call on arrival' };
    const body = parseDockDraft(draft).body!;
    expect(body.startsAt).toBe(offGrid.startsAt);
    expect(body.endsAt).toBe(offGrid.endsAt);
    expect(body.documents).toEqual([{ poId: PO }]);
    expect(body.note).toBe('call on arrival');
  });

  test('start options: past slots of today disabled, the current slot open; the booking’s own off-grid start kept', () => {
    const now = Date.parse(istInstantOf(TUESDAY, 640));
    const options = startOptions(SCHEDULE, TUESDAY, now);
    expect(options.length).toBe(18);
    expect(options.find((o) => o.minute === 600)!.disabled).toBe(true);
    expect(options.find((o) => o.minute === 630)!.disabled).toBe(false);
    const hourly = startOptions({ ...SCHEDULE, slotMinutes: 60 }, TUESDAY, now, 630);
    expect(hourly.find((o) => o.minute === 630)).toEqual({ minute: 630, label: '10:30 (as booked)', disabled: false });
  });

  test('WE1 / WE3 — no slots for a cleared date or a closed day; a reschedule keeps its own start on a now-closed day', () => {
    const now = Date.parse(istInstantOf(TUESDAY, 640));
    expect(startOptions(SCHEDULE, '', now)).toEqual([]);
    expect(startOptions(SCHEDULE, '2026-02-30', now)).toEqual([]);
    expect(startOptions(SCHEDULE, SUNDAY, now)).toEqual([]);
    expect(startOptions(SCHEDULE, SUNDAY, now, 630)).toEqual([{ minute: 630, label: '10:30 (as booked)', disabled: false }]);
  });

  test('duration options: 1–8 slots, plus the booking’s own length', () => {
    expect(durationOptions(30).map((o) => o.label)).toEqual(['30 min', '1 h', '1 h 30 min', '2 h', '2 h 30 min', '3 h', '3 h 30 min', '4 h']);
    expect(durationOptions(60, 30)[0]).toEqual({ minutes: 30, label: '30 min (as booked)' });
  });

  test('door options: active doors, "busy" when a loaded booking overlaps (advisory), the own booking never counts', () => {
    const doors = [door(D3, 'D3'), door(D4, 'D4'), door('d5', 'D5', false)];
    const loaded = [appointment()];
    const options = doorOptions(doors, loaded, { startsAt: istInstantOf(TUESDAY, 660), endsAt: istInstantOf(TUESDAY, 690) });
    expect(options.map((o) => o.label)).toEqual(['D3 — busy', 'D4']);
    // Adjacent is not busy.
    expect(doorOptions(doors, loaded, { startsAt: istInstantOf(TUESDAY, 690), endsAt: istInstantOf(TUESDAY, 720) })[0]!.busy).toBe(false);
    expect(doorOptions(doors, loaded, { startsAt: istInstantOf(TUESDAY, 660), endsAt: istInstantOf(TUESDAY, 690) }, { id: A1, doorId: D3 })[0]!.busy).toBe(false);
    // The booking's own inactive door stays listed.
    expect(doorOptions(doors, [], null, { id: A1, doorId: 'd5' }).map((o) => o.label)).toContain('D5 (inactive)');
  });

  test('the cancel reason: 1–200 characters, trimmed', () => {
    expect(parseCancelReason('  Vendor postponed ')).toEqual({ reason: 'Vendor postponed', problem: null });
    expect(parseCancelReason('  ').problem).toBe('Say why it is cancelled.');
    expect(parseCancelReason('x'.repeat(201)).problem).toContain('200');
  });
});

describe('Settings — doors and the schedule', () => {
  test('a door code is trimmed and upper-cased; a bad one is named', () => {
    expect(parseDoorDraft({ code: 'd-3 ', name: '  ' })).toEqual({ code: 'D-3', name: null, problem: null });
    expect(parseDoorDraft({ code: 'D 3', name: '' }).problem).toContain('1–20 letters');
    expect(parseDoorDraft({ code: 'D3', name: 'x'.repeat(61) }).problem).toContain('60');
  });

  test('the schedule rules (decision 3), each naming its field', () => {
    const ok = { slotMinutes: '60', opensAt: '06:00', closesAt: '22:00', openDays: [7, 1, 2, 3, 4, 5, 6], graceMinutes: '15' };
    expect(parseScheduleDraft(ok).body).toEqual({ slotMinutes: 60, opensAt: '06:00', closesAt: '22:00', openDays: [1, 2, 3, 4, 5, 6, 7], graceMinutes: 15 });
    expect(parseScheduleDraft({ ...ok, slotMinutes: '45' }).problem).toContain('slot length');
    expect(parseScheduleDraft({ ...ok, opensAt: '09:00', closesAt: '08:00' }).problem).toBe('Closes at is after Opens at.');
    expect(parseScheduleDraft({ ...ok, slotMinutes: '30', opensAt: '09:15' }).problem).toBe('Opens at is on the 30-minute slot grid.');
    expect(parseScheduleDraft({ ...ok, openDays: [] }).problem).toBe('Pick at least one open day.');
    expect(parseScheduleDraft({ ...ok, graceMinutes: '121' }).problem).toContain('0 to 120');
    expect(parseScheduleDraft({ ...ok, closesAt: '24:00' }).body?.closesAt).toBe('24:00');
  });

  test('the schedule in words', () => {
    expect(scheduleSentence(SCHEDULE)).toBe('30 min slots · 09:00–18:00 · Mon–Sat · grace 15 min');
    expect(scheduleSentence({ ...SCHEDULE, openDays: [1, 2, 3, 4, 5, 6, 7] })).toContain('every day');
    expect(scheduleSentence({ ...SCHEDULE, openDays: [1, 3] })).toContain('Mon, Wed');
  });
});

describe('dockReason — every code', () => {
  const problem = (code: string, extensions: Record<string, unknown> = {}, detail?: string) => new ApiProblem(code, 409, detail, 'Title', extensions);

  test('the clash names the appointment and its window (AC1)', () => {
    const clash = { id: A1, code: 'DA-0001', startsAt: istInstantOf(TUESDAY, 630), endsAt: istInstantOf(TUESDAY, 690) };
    expect(dockReason(problem('dock-slot-taken', { clash }))).toBe('That door is taken — DA-0001 is booked 10:30–11:30 on Tue 27 Oct. Pick another door or time.');
    expect(dockReason(problem('dock-slot-taken', {}, 'server words'))).toBe('server words');
  });

  test('a busy door names the count and the first code', () => {
    expect(dockReason(problem('dock-door-has-appointments', { appointmentCount: 1, firstAppointmentCode: 'DA-0001' }))).toBe(
      'The door has 1 booked appointment still to come (first DA-0001) — reschedule or cancel it before deactivating the door.',
    );
  });

  test('every dock code has its own sentence (never the bare code); the shared arms read the house copy', () => {
    for (const code of [
      'slot-misaligned', 'slot-in-past', 'slot-too-far', 'dock-closed', 'dock-door-warehouse-mismatch', 'dock-door-inactive',
      'dock-door-limit', 'dock-door-code-taken', 'document-warehouse-mismatch', 'po-not-open', 'asn-not-open', 'appointment-closed',
      'appointment-no-show', 'appointment-warehouse-mismatch', 'appointment-not-due', 'role-denied', 'permission-denied',
      'idempotency-key-reuse', 'unauthenticated',
    ]) {
      const sentence = dockReason(problem(code));
      expect(sentence).not.toContain(code);
      expect(sentence.length).toBeGreaterThan(10);
    }
    expect(dockReason(problem('asn-not-open'))).toBe('This ASN is no longer open (received, closed or cancelled) — refresh the list.');
    expect(dockReason(problem('appointment-not-due'))).toBe('Only an appointment of yesterday, today or tomorrow can be linked at the gate.');
    expect(dockReason(problem('validation-failed', {}, 'startsAt must be an ISO instant'))).toBe('startsAt must be an ISO instant');
    expect(dockReason(problem('something-new'))).toBe('The dock schedule was not changed (something-new).');
    expect(dockReason(new TypeError('Failed to fetch'))).toBe(UNREACHABLE_REASON);
  });

  test('W11 — the refusals that say the calendar moved (the form re-reads on these)', () => {
    for (const code of ['dock-slot-taken', 'appointment-closed', 'appointment-no-show', 'conflict', 'not-found', 'dock-door-inactive', 'po-not-open', 'asn-not-open']) {
      expect(isStaleDockRefusal(problem(code))).toBe(true);
    }
    expect(isStaleDockRefusal(problem('slot-in-past'))).toBe(false);
    expect(isStaleDockRefusal(new TypeError('Failed to fetch'))).toBe(false);
  });

  test('the gate-in maps exactly the appointment-link codes with dockReason', () => {
    expect([...APPOINTMENT_LINK_CODES].sort()).toEqual(['appointment-closed', 'appointment-no-show', 'appointment-not-due', 'appointment-warehouse-mismatch']);
  });
});
