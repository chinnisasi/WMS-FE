'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { ApiProblem, fetchApiCreateDockDoor, fetchApiPutDockSchedule, fetchApiUpdateDockDoor } from '@/lib/api/client';
import { notifyInboundChanged } from '@/lib/asns';
import { readSession, subscribeSession } from '@/lib/auth';
import {
  DOCK_LIMITS,
  SCHEDULE_DEFAULTS_NOTE,
  SLOT_LENGTHS,
  dockReason,
  draftOfSchedule,
  parseDoorDraft,
  parseScheduleDraft,
  scheduleSentence,
  type DockDoor,
  type DockSchedule,
  type ScheduleDraft,
} from '@/lib/dock-schedule';
import { MINUTES_PER_DAY, minuteLabel, weekdayShort } from '@/lib/ist';
import { useDockDoors, useDockScheduleSetting } from '@/lib/use-dock-schedule';
import { useTenantWarehouses } from '@/lib/use-tenant-warehouses';
import { roleHasCapability } from '@/lib/users';
import { readActiveWarehouseId, subscribeActiveWarehouse } from '@/lib/warehouses';
import { ulid } from '@/lib/ulid';

import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { FeedbackBanner } from '@/components/feedback/banner';
import { ConfirmRow } from '@/components/settings/confirm-row';
import { lineButtonClass as buttonClass, lineInputClass as inputClass } from '@/components/shared/line-rows';
import { StatusChip } from '@/components/shared/status-chip';
import { ReadFailure } from '@/components/shared/surface';
import { WarehousesFailure } from '@/components/shared/warehouses-failure';

/** The card's anchor — the Dock schedule tab's first-use link (`/settings#dock-setup`). */
export const DOCK_SETUP_ANCHOR = 'dock-setup';

/**
 * Story 2-3b (decisions 1, 3) — Settings → Warehouses → "Dock doors and
 * schedule", for the active warehouse (the sidebar switcher's pick, else the
 * first — the Zones & bins rule): the doors table (code, name, an
 * Active / Inactive chip, Edit, Deactivate / Reactivate behind an inline
 * confirmation) with Add door, and the schedule form (slot length, opens,
 * closes, the open days as seven toggles, the on-time grace), which reads
 * "Using defaults — not yet saved" while no schedule is stored.
 *
 * Every member reads; the writes are `dock.manage`'s (owner, ops manager) and
 * are absent — not disabled — for anyone else. Each write carries an
 * Idempotency-Key bound to its body (a retry of the same body replays, an
 * edit mints a fresh key) and a synchronous in-flight ref; each fires
 * `notifyInboundChanged()` so the Dock schedule tab and the gate-in's door
 * select re-read.
 */

type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string };

const primaryClass =
  'rounded-sm bg-(--primary) px-3 py-1 text-xs font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60';

/** A per-draft key bound to its body (FE guide §2.1, §2.4). */
function useBodyKey() {
  const ref = useRef<{ key: string; body: string } | null>(null);
  return {
    keyFor(body: unknown): string {
      const serialised = JSON.stringify(body);
      if (ref.current === null || ref.current.body !== serialised) ref.current = { key: ulid(), body: serialised };
      return ref.current.key;
    },
    spend() {
      ref.current = null;
    },
  };
}

export function DockSetupCard() {
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );
  if (sessioned !== true) return null;
  return <DockSetupSessioned />;
}

function DockSetupSessioned() {
  const warehouseRead = useTenantWarehouses();
  const { tenantId, items: warehouses } = warehouseRead.state === 'ready' ? warehouseRead.data : { tenantId: null, items: [] };
  const activeId = useSyncExternalStore(
    subscribeActiveWarehouse,
    () => (tenantId === null ? null : readActiveWarehouseId(tenantId)),
    () => null,
  );
  const warehouseId = activeId !== null && warehouses.some((w) => w.id === activeId) ? activeId : (warehouses[0]?.id ?? null);
  const warehouse = warehouses.find((w) => w.id === warehouseId);
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );
  const canManage = roleHasCapability(role, 'dock.manage');
  const doors = useDockDoors(warehouseId);
  const schedule = useDockScheduleSetting(warehouseId);
  // Keyed derivation: the banner belongs to the warehouse it was raised in.
  const [banner, setBanner] = useState<{ warehouseId: string; outcome: Outcome } | null>(null);
  const shown = banner !== null && banner.warehouseId === warehouseId ? banner.outcome : null;
  const show = (outcome: Outcome) => warehouseId !== null && setBanner({ warehouseId, outcome });

  // W2 — `/settings#dock-setup` (the Dock schedule's first-use link): the card
  // renders after the session and its reads, so the browser's own jump
  // misses it — scroll once the reads settle (the audit-exports pattern).
  const anchor = useRef<HTMLElement | null>(null);
  const scrollPending = useRef(false);
  useEffect(() => {
    if (window.location.hash === `#${DOCK_SETUP_ANCHOR}`) scrollPending.current = true;
  }, []);
  const settled = doors.state !== 'loading' && schedule.state !== 'loading';
  useEffect(() => {
    if (!scrollPending.current || !settled) return;
    scrollPending.current = false;
    anchor.current?.scrollIntoView?.({ block: 'start' });
  }, [settled]);

  const header = (
    <div className="flex flex-col gap-0.5">
      <h2 className="font-medium">Dock doors and schedule</h2>
      {warehouse !== undefined && (
        <div className="text-(--muted-foreground)">
          {`${warehouse.code} ${warehouse.name}`.trim()} — the doors trucks are booked to, and when the dock is open (IST).
        </div>
      )}
    </div>
  );

  // W3 — a failed or loading warehouses read says so; it never leaves the card out.
  if (warehouseRead.state !== 'ready' || warehouseId === null) {
    return (
      <section id={DOCK_SETUP_ANCHOR} ref={anchor} className="flex flex-col gap-3 rounded-md border border-(--border) p-3 text-sm" data-testid="dock-setup-card">
        {header}
        {warehouseRead.state === 'failed' ? (
          <WarehousesFailure state={warehouseRead} />
        ) : warehouseRead.state === 'loading' ? (
          <div className="text-xs text-(--muted-foreground)">Loading the warehouses…</div>
        ) : (
          <div className="text-(--muted-foreground)">Create a warehouse first — dock doors live inside one.</div>
        )}
      </section>
    );
  }

  return (
    <section id={DOCK_SETUP_ANCHOR} ref={anchor} className="flex flex-col gap-3 rounded-md border border-(--border) p-3 text-sm" data-testid="dock-setup-card">
      {header}
      {shown !== null && <FeedbackBanner tone={shown.tone} word={shown.word} reason={shown.reason} />}

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-medium">Dock doors</h3>
        {doors.state === 'failed' ? (
          <ReadFailure word="Dock doors unavailable" reason={doors.reason} onRetry={doors.reload} />
        ) : (
          <DoorsTable
            key={`doors|${warehouseId}`}
            warehouseId={warehouseId}
            doors={doors.state === 'ready' ? doors.data : []}
            loading={doors.state === 'loading'}
            canManage={canManage}
            onOutcome={show}
          />
        )}
        {canManage && doors.state === 'ready' && doors.data.length < DOCK_LIMITS.doorsPerWarehouse && (
          <AddDoorForm key={`add|${warehouseId}`} warehouseId={warehouseId} onOutcome={show} />
        )}
        {canManage && doors.state === 'ready' && doors.data.length >= DOCK_LIMITS.doorsPerWarehouse && (
          <div className="text-xs text-(--muted-foreground)" data-testid="dock-door-limit">
            {DOCK_LIMITS.doorsPerWarehouse} doors — the most a warehouse can have. Deactivate or rename one instead.
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-medium">Schedule</h3>
        {schedule.state === 'failed' && <ReadFailure word="Dock schedule unavailable" reason={schedule.reason} onRetry={schedule.reload} />}
        {schedule.state === 'loading' && <div className="text-xs text-(--muted-foreground)">Loading the schedule…</div>}
        {schedule.state === 'ready' && (
          <ScheduleForm
            key={`${warehouseId}|${schedule.data.updatedAt ?? 'defaults'}`}
            warehouseId={warehouseId}
            schedule={schedule.data}
            canManage={canManage}
            onOutcome={show}
          />
        )}
      </div>
    </section>
  );
}

function DoorsTable({
  warehouseId,
  doors,
  loading,
  canManage,
  onOutcome,
}: {
  warehouseId: string;
  doors: readonly DockDoor[];
  loading: boolean;
  canManage: boolean;
  onOutcome: (outcome: Outcome) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);

  const columns: DataTableColumn<DockDoor>[] = [
    { key: 'code', header: 'Door', render: (door) => <span className="font-mono text-xs">{door.code}</span> },
    { key: 'name', header: 'Name', render: (door) => door.name ?? '—' },
    {
      key: 'status',
      header: 'Status',
      render: (door) => (
        <StatusChip tone={door.active ? 'success' : 'neutral'} data-testid={`dock-door-status-${door.code}`}>
          {door.active ? 'Active' : 'Inactive'}
        </StatusChip>
      ),
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: 'Actions',
            render: (door: DockDoor) => (
              <div className="flex flex-wrap gap-1">
                <button type="button" onClick={() => { setConfirm(null); setEditing(door.id); }} className={buttonClass}>
                  Edit
                </button>
                <button type="button" onClick={() => { setEditing(null); setConfirm(door.id); }} className={buttonClass}>
                  {door.active ? 'Deactivate' : 'Reactivate'}
                </button>
              </div>
            ),
          } satisfies DataTableColumn<DockDoor>,
        ]
      : []),
  ];

  return (
    <DataTable<DockDoor>
      columns={columns}
      rows={[...doors]}
      loading={loading ? 'Loading the dock doors…' : undefined}
      rowNoun={{ one: 'door', many: 'doors' }}
      emptyMessage={canManage ? 'No dock doors yet — add the first one.' : 'No dock doors yet.'}
      renderExpanded={(door) => {
        if (!canManage) return null;
        if (editing === door.id) {
          return (
            <EditDoorForm
              key={door.id}
              warehouseId={warehouseId}
              door={door}
              onClose={() => setEditing(null)}
              onOutcome={(outcome) => {
                if (outcome.tone === 'accepted') setEditing(null);
                onOutcome(outcome);
              }}
            />
          );
        }
        if (confirm === door.id) {
          const next = !door.active;
          return (
            <ConfirmRow<DockDoor>
              key={`${next ? 'reactivate' : 'deactivate'}-${door.id}`}
              question={next ? `Reactivate ${door.code}? It can be booked again.` : `Deactivate ${door.code}? It can no longer be booked; past bookings keep it.`}
              confirmLabel={next ? 'Reactivate' : 'Deactivate'}
              ariaLabel={`${next ? 'Reactivate' : 'Deactivate'} ${door.code}`}
              run={async (key, tenantId) =>
                (await fetchApiUpdateDockDoor(tenantId, warehouseId, door.id, { code: door.code, name: door.name, active: next }, key)).dockDoor
              }
              reason={dockReason}
              onDone={(saved) => {
                setConfirm(null);
                onOutcome({ tone: 'accepted', word: `${saved.code} ${saved.active ? 'reactivated' : 'deactivated'}`, reason: saved.active ? 'It can be booked again.' : 'It can no longer be booked.' });
                notifyInboundChanged();
              }}
              onRejected={(reason) => {
                setConfirm(null);
                onOutcome({ tone: 'rejected', word: `${door.code} not changed`, reason });
              }}
              onClose={() => setConfirm(null)}
            />
          );
        }
        return null;
      }}
    />
  );
}

function AddDoorForm({ warehouseId, onOutcome }: { warehouseId: string; onOutcome: (outcome: Outcome) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const key = useBodyKey();

  async function submit() {
    const session = readSession();
    if (session === null || inFlight.current) return;
    const parsed = parseDoorDraft({ code, name });
    if (parsed.problem !== null) {
      setProblem(parsed.problem);
      return;
    }
    const body = parsed.name === null ? { code: parsed.code } : { code: parsed.code, name: parsed.name };
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const { dockDoor } = await fetchApiCreateDockDoor(session.tenant.id, warehouseId, body, key.keyFor(body));
      key.spend();
      setCode('');
      setName('');
      onOutcome({ tone: 'accepted', word: `${dockDoor.code} added`, reason: 'The door can be booked from Inbound → Dock schedule.' });
      notifyInboundChanged();
    } catch (error) {
      setProblem(dockReason(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form
      aria-label="Add a dock door"
      noValidate
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset disabled={busy} className="m-0 flex flex-wrap items-center gap-2 border-0 p-0">
        <input
          type="text"
          aria-label="Door code"
          placeholder="Code (D3)"
          maxLength={DOCK_LIMITS.doorCode + 2}
          value={code}
          onChange={(event) => {
            setProblem(null);
            setCode(event.target.value);
          }}
          className={`${inputClass} w-28`}
        />
        <input
          type="text"
          aria-label="Door name"
          placeholder="Name (optional)"
          maxLength={DOCK_LIMITS.doorName}
          value={name}
          onChange={(event) => {
            setProblem(null);
            setName(event.target.value);
          }}
          className={`${inputClass} w-48`}
        />
        <button type="submit" className={primaryClass}>
          {busy ? 'Adding…' : 'Add door'}
        </button>
      </fieldset>
      {problem !== null && (
        <div role="alert" className="w-full text-xs text-(--destructive)">
          {problem}
        </div>
      )}
    </form>
  );
}

function EditDoorForm({
  warehouseId,
  door,
  onClose,
  onOutcome,
}: {
  warehouseId: string;
  door: DockDoor;
  onClose: () => void;
  onOutcome: (outcome: Outcome) => void;
}) {
  const [code, setCode] = useState(door.code);
  const [name, setName] = useState(door.name ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const key = useBodyKey();

  async function submit() {
    const session = readSession();
    if (session === null || inFlight.current) return;
    const parsed = parseDoorDraft({ code, name });
    if (parsed.problem !== null) {
      setProblem(parsed.problem);
      return;
    }
    const body = { code: parsed.code, name: parsed.name, active: door.active };
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const { dockDoor } = await fetchApiUpdateDockDoor(session.tenant.id, warehouseId, door.id, body, key.keyFor(body));
      key.spend();
      onOutcome({ tone: 'accepted', word: `${dockDoor.code} saved`, reason: 'Past gate-ins keep the door code they recorded.' });
      notifyInboundChanged();
    } catch (error) {
      setProblem(dockReason(error));
      if (error instanceof ApiProblem && error.code === 'not-found') notifyInboundChanged();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form
      aria-label={`Edit ${door.code}`}
      noValidate
      className="flex flex-wrap items-center gap-2 py-1"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset disabled={busy} className="m-0 flex flex-wrap items-center gap-2 border-0 p-0">
        <input type="text" aria-label="Door code" maxLength={DOCK_LIMITS.doorCode + 2} value={code} onChange={(event) => { setProblem(null); setCode(event.target.value); }} className={`${inputClass} w-28`} />
        <input type="text" aria-label="Door name" maxLength={DOCK_LIMITS.doorName} value={name} onChange={(event) => { setProblem(null); setName(event.target.value); }} className={`${inputClass} w-48`} />
        <button type="submit" className={primaryClass}>
          {busy ? 'Saving…' : 'Save door'}
        </button>
        <button type="button" onClick={onClose} className={buttonClass}>
          Discard
        </button>
      </fieldset>
      {problem !== null && (
        <div role="alert" className="w-full text-xs text-(--destructive)">
          {problem}
        </div>
      )}
    </form>
  );
}

/** Every quarter hour (the finest slot); closes may be 24:00. */
const OPENS_CHOICES = Array.from({ length: MINUTES_PER_DAY / 15 }, (_, index) => minuteLabel(index * 15));
const CLOSES_CHOICES = Array.from({ length: MINUTES_PER_DAY / 15 }, (_, index) => minuteLabel((index + 1) * 15));

function ScheduleForm({
  warehouseId,
  schedule,
  canManage,
  onOutcome,
}: {
  warehouseId: string;
  schedule: DockSchedule;
  canManage: boolean;
  onOutcome: (outcome: Outcome) => void;
}) {
  const [draft, setDraft] = useState<ScheduleDraft>(() => draftOfSchedule(schedule));
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const key = useBodyKey();

  const edit = (patch: Partial<ScheduleDraft>) => {
    setProblem(null);
    setDraft((current) => ({ ...current, ...patch }));
  };

  if (!canManage) {
    return (
      <div className="flex flex-col gap-0.5 text-xs" data-testid="dock-schedule-readonly">
        <span>{scheduleSentence(schedule)}</span>
        {!schedule.configured && <span className="text-(--muted-foreground)">{SCHEDULE_DEFAULTS_NOTE}</span>}
      </div>
    );
  }

  async function submit() {
    const session = readSession();
    if (session === null || inFlight.current) return;
    const parsed = parseScheduleDraft(draft);
    if (parsed.body === null) {
      setProblem(parsed.problem);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const saved = await fetchApiPutDockSchedule(session.tenant.id, warehouseId, parsed.body, key.keyFor(parsed.body));
      key.spend();
      onOutcome({ tone: 'accepted', word: 'Dock schedule saved', reason: `${scheduleSentence(saved.schedule)}. Existing appointments keep their slots.` });
      notifyInboundChanged();
    } catch (error) {
      setProblem(dockReason(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <form
      aria-label="Dock schedule"
      noValidate
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {!schedule.configured && (
        <div className="text-xs text-(--muted-foreground)" data-testid="dock-schedule-defaults">
          {SCHEDULE_DEFAULTS_NOTE}
        </div>
      )}
      <fieldset disabled={busy} className="m-0 flex flex-col gap-2 border-0 p-0">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1">
            Slot length
            <select aria-label="Slot length" value={draft.slotMinutes} onChange={(event) => edit({ slotMinutes: event.target.value })} className={inputClass}>
              {SLOT_LENGTHS.map((length) => (
                <option key={length} value={String(length)}>
                  {length} min
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            Opens (IST)
            <select aria-label="Opens at" value={draft.opensAt} onChange={(event) => edit({ opensAt: event.target.value })} className={inputClass}>
              {OPENS_CHOICES.map((choice) => (
                <option key={choice} value={choice}>
                  {choice}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            Closes (IST)
            <select aria-label="Closes at" value={draft.closesAt} onChange={(event) => edit({ closesAt: event.target.value })} className={inputClass}>
              {CLOSES_CHOICES.map((choice) => (
                <option key={choice} value={choice}>
                  {choice}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            On-time grace (min)
            <input
              type="text"
              inputMode="numeric"
              aria-label="On-time grace (minutes)"
              value={draft.graceMinutes}
              onChange={(event) => edit({ graceMinutes: event.target.value })}
              className={`${inputClass} w-16`}
            />
          </label>
        </div>
        <div role="group" aria-label="Open days" className="flex flex-wrap gap-1 text-xs">
          {[1, 2, 3, 4, 5, 6, 7].map((day) => {
            const on = draft.openDays.includes(day);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={on}
                onClick={() => edit({ openDays: on ? draft.openDays.filter((d) => d !== day) : [...draft.openDays, day].sort((a, b) => a - b) })}
                className={`${buttonClass} ${on ? 'bg-(--muted) font-medium' : ''}`}
              >
                {on ? '✓ ' : ''}
                {weekdayShort(day)}
              </button>
            );
          })}
        </div>
      </fieldset>
      {problem !== null && (
        <div role="alert" className="text-xs text-(--destructive)">
          {problem}
        </div>
      )}
      <div>
        <button type="submit" disabled={busy} className={primaryClass}>
          {busy ? 'Saving…' : 'Save schedule'}
        </button>
      </div>
    </form>
  );
}
