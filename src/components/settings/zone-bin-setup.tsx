'use client';

import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';

import {
  ApiProblem,
  fetchApiCreateBin,
  fetchApiCreateZone,
  fetchApiGenerateBinGrid,
  fetchApiSetBinBlocked,
} from '@/lib/api/client';
import type { BinResponse, ZoneResponse } from '@/lib/api/generated';
import { readActiveWarehouseId, subscribeActiveWarehouse, writeActiveWarehouseId } from '@/lib/warehouses';
import { readSession, subscribeSession } from '@/lib/auth';
import { roleHasCapability } from '@/lib/users';
import { ulid } from '@/lib/ulid';
import { useTenantWarehouses } from '@/lib/use-tenant-warehouses';
import { useWarehouseZones } from '@/lib/use-warehouse-zones';
import { useZoneBins } from '@/lib/use-zone-bins';
import { notifyZonesChanged } from '@/lib/zones';

import { FeedbackBanner } from '@/components/feedback/banner';
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';

const inputClass =
  'w-full rounded-sm border border-(--input) bg-(--background) px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-(--ring)';
const labelClass = 'text-sm font-medium';
const selectClass = `${inputClass} appearance-none`;

/** Bin types are a fixed backend set (spec 1.3) — surfaced verbatim. */
const BIN_TYPES = ['shelf', 'pallet', 'floor', 'staging'] as const;

type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string } | null;

/**
 * Zones/bins setup (Story 1.3), hosted as Settings sub-cards — no new route:
 * zone create, the grid generator, manual bin create, and the zone→bins
 * table with the block toggle (the only bin edit in this story). Every submit
 * sends a fresh ULID Idempotency-Key, so a double click replays the same
 * response instead of duplicating master data.
 */
export function ZonesBinsSetup() {
  // `null` = unknown (server render) → render nothing, no hydration mismatch.
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );

  if (sessioned === null) return null;
  if (!sessioned) {
    return (
      <div className="rounded-md border border-(--border) p-3 text-sm">
        <div className="font-medium">Zones and bins</div>
        <div className="text-(--muted-foreground)">
          Sign in to set up your warehouse floor —{' '}
          <Link href="/login" className="text-(--primary) underline underline-offset-2">
            go to sign in
          </Link>
          .
        </div>
      </div>
    );
  }
  return <ZonesBinsSetupSessioned />;
}

function ZonesBinsSetupSessioned() {
  const { tenantId, items: warehouses } = useTenantWarehouses() ?? { tenantId: null, items: [] };
  const activeId = useSyncExternalStore(
    subscribeActiveWarehouse,
    () => (tenantId === null ? null : readActiveWarehouseId(tenantId)),
    () => null,
  );
  // The warehouse being configured: the switcher's pick when it still
  // belongs to this tenant, else the first warehouse.
  const warehouseId =
    activeId !== null && warehouses.some((w) => w.id === activeId)
      ? activeId
      : (warehouses[0]?.id ?? null);
  const zones = useWarehouseZones(warehouseId);
  const [zoneId, setZoneId] = useState<string | null>(null);
  // The picked zone only counts while it belongs to the warehouse being
  // configured — a stale pick from a previous warehouse falls back to the
  // first zone of the new one (the sidebar switcher can change warehouses
  // without this component resetting state).
  const selectedZoneId =
    zoneId !== null && zones?.some((z) => z.id === zoneId) ? zoneId : (zones?.[0]?.id ?? null);
  const bins = useZoneBins(warehouseId, selectedZoneId);

  if (tenantId === null) return null;

  if (warehouseId === null) {
    return (
      <div className="rounded-md border border-(--border) p-3 text-sm">
        <div className="font-medium">Zones and bins</div>
        <div className="text-(--muted-foreground)">
          Create a warehouse first — zones and bins live inside one.
        </div>
      </div>
    );
  }

  const warehouse = warehouses.find((w) => w.id === warehouseId);

  // Story 1.5 gating: the zone→bins table is a read (open to every member);
  // the create forms and the block toggle render only for roles holding the
  // matching capability — hide surfaces, never "blocked" screens. The
  // backend per-command role read remains the authority.
  const role = readSession()?.user.role;
  const canCreateZone = roleHasCapability(role, 'zone.create');
  const canCreateBin = roleHasCapability(role, 'bin.create');
  const canBlockBin = roleHasCapability(role, 'bin.block');

  return (
    <section className="flex flex-col gap-3 rounded-md border border-(--border) p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-medium">Zones and bins</h2>
          <div className="text-(--muted-foreground)">
            {warehouse === undefined
              ? 'Warehouse floor setup'
              : `Configuring ${warehouse.code} ${warehouse.name} — bin codes are unique per warehouse.`}
          </div>
        </div>
        {warehouses.length > 1 && (
          <label className="flex items-center gap-2 text-xs">
            <span className="text-(--muted-foreground)">Warehouse</span>
            <select
              className={`${selectClass} w-auto py-1`}
              value={warehouseId}
              onChange={(e) => {
                setZoneId(null);
                writeActiveWarehouseId(tenantId, e.target.value);
              }}
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} {w.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {zones === null ? (
        <div className="text-(--muted-foreground)">Loading zones…</div>
      ) : (
        <>
          {/* Distinct key prefixes (both siblings remount on a warehouse
              switch so their internal zone/code state can never post against
              the previous warehouse's zones (404)) — identical keys would
              collide in the parent fragment. */}
          {canCreateZone && (
            <ZoneCreateForm key={`zone-${warehouseId}`} warehouseId={warehouseId} />
          )}
          {canCreateBin && (
            <BinFormsRow
              key={`bin-${warehouseId}`}
              tenantId={tenantId}
              warehouseId={warehouseId}
              zones={zones}
            />
          )}
          <ZoneBinsTable
            tenantId={tenantId}
            warehouseId={warehouseId}
            zones={zones}
            selectedZoneId={selectedZoneId}
            onSelectZone={setZoneId}
            bins={bins}
            canBlockBin={canBlockBin}
          />
        </>
      )}
    </section>
  );
}

/** Zone creation — the parent of every bin. */
function ZoneCreateForm({ warehouseId }: { warehouseId: string }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const session = readSession();
    if (session === null) return;
    setPending(true);
    setOutcome(null);
    try {
      const zone = await fetchApiCreateZone(session.tenant.id, warehouseId, { code, name }, ulid());
      setCode('');
      setName('');
      setOutcome({
        tone: 'accepted',
        word: 'Zone created',
        reason: `${zone.code} ${zone.name} is ready for bins.`,
      });
      notifyZonesChanged();
    } catch (error) {
      setOutcome({ tone: 'rejected', word: 'Not created', reason: rejectionReason(error, code) });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-sm border border-(--border) p-3">
      <div className="text-xs text-(--muted-foreground)">Create a zone — codes are unique inside the warehouse.</div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>Zone code</span>
          <input
            className={inputClass}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            maxLength={32}
            placeholder="A"
          />
        </label>
        <label className="flex flex-[2] flex-col gap-1">
          <span className={labelClass}>Name</span>
          <input
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
            placeholder="Fast movers"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="self-end rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Creating…' : 'Create zone'}
        </button>
      </div>
      {outcome !== null && <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />}
    </form>
  );
}

/** Zone picker shared by the grid generator and the manual bin form. */
function ZonePicker({
  zones,
  value,
  onChange,
  label,
}: {
  zones: readonly ZoneResponse[];
  value: string | null;
  onChange: (zoneId: string) => void;
  label: string;
}) {
  return (
    <label className="flex flex-1 flex-col gap-1">
      <span className={labelClass}>{label}</span>
      <select
        className={selectClass}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        required
      >
        {value === null && <option value="" disabled>Pick a zone…</option>}
        {zones.map((zone) => (
          <option key={zone.id} value={zone.id}>
            {zone.code} {zone.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function BinTypePicker({ value, onChange }: { value: string; onChange: (type: string) => void }) {
  return (
    <label className="flex flex-1 flex-col gap-1">
      <span className={labelClass}>Type</span>
      <select className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
        {BIN_TYPES.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The grid generator and the manual single-bin form, side by side. */
function BinFormsRow({
  tenantId,
  warehouseId,
  zones,
}: {
  tenantId: string;
  warehouseId: string;
  zones: readonly ZoneResponse[];
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <GridGeneratorForm tenantId={tenantId} warehouseId={warehouseId} zones={zones} />
      <ManualBinForm tenantId={tenantId} warehouseId={warehouseId} zones={zones} />
    </div>
  );
}

function GridGeneratorForm({
  tenantId,
  warehouseId,
  zones,
}: {
  tenantId: string;
  warehouseId: string;
  zones: readonly ZoneResponse[];
}) {
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [aisleFrom, setAisleFrom] = useState('A');
  const [aisleTo, setAisleTo] = useState('A');
  const [bays, setBays] = useState('10');
  const [levels, setLevels] = useState('4');
  const [capacity, setCapacity] = useState('120');
  const [type, setType] = useState<string>('shelf');
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const session = readSession();
    if (session === null || zoneId === null) return;
    setPending(true);
    setOutcome(null);
    try {
      const run = await fetchApiGenerateBinGrid(
        tenantId,
        warehouseId,
        zoneId,
        {
          aisleFrom,
          aisleTo,
          baysPerAisle: Number(bays),
          levelsPerBay: Number(levels),
          capacity: Number(capacity),
          type: type as 'shelf' | 'pallet' | 'floor' | 'staging',
        },
        ulid(),
      );
      setOutcome({
        tone: 'accepted',
        word: `${run.generatedCount} bins generated`,
        reason: `Codes ${run.firstCode} … ${run.lastCode} are ready for putaway.`,
      });
      notifyZonesChanged();
    } catch (error) {
      setOutcome({ tone: 'rejected', word: 'Not generated', reason: rejectionReason(error) });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-sm border border-(--border) p-3">
      <div className="text-xs text-(--muted-foreground)">
        Grid generator — aisles A–Z, bays and levels 1–99, cap 500 bins per run. Codes look like A-01-01.
      </div>
      <ZonePicker zones={zones} value={zoneId} onChange={setZoneId} label="Zone" />
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>Aisle from</span>
          <input
            className={inputClass}
            value={aisleFrom}
            onChange={(e) => setAisleFrom(e.target.value)}
            required
            maxLength={1}
            pattern="[A-Za-z]"
            title="Single aisle letter A–Z"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>Aisle to</span>
          <input
            className={inputClass}
            value={aisleTo}
            onChange={(e) => setAisleTo(e.target.value)}
            required
            maxLength={1}
            pattern="[A-Za-z]"
            title="Single aisle letter A–Z"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>Bays / aisle</span>
          <input
            className={inputClass}
            type="number"
            min={1}
            max={99}
            value={bays}
            onChange={(e) => setBays(e.target.value)}
            required
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>Levels / bay</span>
          <input
            className={inputClass}
            type="number"
            min={1}
            max={99}
            value={levels}
            onChange={(e) => setLevels(e.target.value)}
            required
          />
        </label>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>Capacity (units)</span>
          <input
            className={inputClass}
            type="number"
            min={1}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            required
          />
        </label>
        <div className="flex flex-1 flex-col justify-end">
          <BinTypePicker value={type} onChange={setType} />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="self-end rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Generating…' : 'Generate bins'}
        </button>
      </div>
      {outcome !== null && <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />}
    </form>
  );
}

function ManualBinForm({
  tenantId,
  warehouseId,
  zones,
}: {
  tenantId: string;
  warehouseId: string;
  zones: readonly ZoneResponse[];
}) {
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [capacity, setCapacity] = useState('120');
  const [type, setType] = useState<string>('shelf');
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const session = readSession();
    if (session === null || zoneId === null) return;
    setPending(true);
    setOutcome(null);
    try {
      const bin = await fetchApiCreateBin(
        tenantId,
        warehouseId,
        zoneId,
        {
          code,
          capacity: Number(capacity),
          type: type as 'shelf' | 'pallet' | 'floor' | 'staging',
        },
        ulid(),
      );
      setCode('');
      setOutcome({
        tone: 'accepted',
        word: 'Bin created',
        reason: `${bin.code} is immediately usable as a putaway/pick target.`,
      });
      notifyZonesChanged();
    } catch (error) {
      setOutcome({ tone: 'rejected', word: 'Not created', reason: rejectionReason(error, code) });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-sm border border-(--border) p-3">
      <div className="text-xs text-(--muted-foreground)">Add a single bin — it is usable immediately.</div>
      <ZonePicker zones={zones} value={zoneId} onChange={setZoneId} label="Zone" />
      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>Bin code</span>
          <input
            className={inputClass}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            maxLength={32}
            placeholder="A-01-01"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>Capacity (units)</span>
          <input
            className={inputClass}
            type="number"
            min={1}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            required
          />
        </label>
        <div className="flex flex-1 flex-col justify-end">
          <BinTypePicker value={type} onChange={setType} />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="self-end rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Creating…' : 'Create bin'}
        </button>
      </div>
      {outcome !== null && <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />}
    </form>
  );
}

const binColumns: readonly DataTableColumn<BinResponse>[] = [
  { key: 'code', header: 'Code' },
  { key: 'capacity', header: 'Capacity', numeric: true },
  { key: 'type', header: 'Type' },
];

/** The zone→bins table with the block toggle (the only bin edit in 1.3). */
function ZoneBinsTable({
  tenantId,
  warehouseId,
  zones,
  selectedZoneId,
  onSelectZone,
  bins,
  canBlockBin,
}: {
  tenantId: string;
  warehouseId: string;
  zones: readonly ZoneResponse[];
  selectedZoneId: string | null;
  onSelectZone: (zoneId: string | null) => void;
  bins: ReturnType<typeof useZoneBins>;
  /** Story 1.5: the block toggle renders only for `bin.block` roles. */
  canBlockBin: boolean;
}) {
  const [busyBinId, setBusyBinId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);

  async function toggleBlocked(bin: BinResponse) {
    const session = readSession();
    if (session === null) return;
    setBusyBinId(bin.id);
    setOutcome(null);
    try {
      const updated = await fetchApiSetBinBlocked(
        tenantId,
        warehouseId,
        bin.id,
        { blocked: !bin.blocked },
        ulid(),
      );
      setOutcome({
        tone: 'accepted',
        word: updated.blocked ? `${updated.code} blocked` : `${updated.code} unblocked`,
        reason: updated.blocked
          ? 'Broken bins are hidden from putaway/pick suggestions.'
          : 'The bin is available again.',
      });
      bins?.reload();
    } catch (error) {
      setOutcome({ tone: 'rejected', word: 'Not updated', reason: rejectionReason(error) });
    } finally {
      setBusyBinId(null);
    }
  }

  const columns: readonly DataTableColumn<BinResponse>[] = [
    ...binColumns,
    {
      key: 'blocked',
      header: 'Status',
      render: (bin) =>
        bin.blocked ? (
          <span className="rounded-full border border-(--destructive) px-2 py-0.5 text-xs text-(--destructive)">
            Blocked
          </span>
        ) : (
          <span className="rounded-full border border-(--border) bg-(--muted) px-2 py-0.5 text-xs text-(--muted-foreground)">
            Active
          </span>
        ),
    },
    ...(canBlockBin
      ? [
          {
            key: 'actions',
            header: '',
            render: (bin: BinResponse) => (
              <button
                type="button"
                disabled={busyBinId === bin.id}
                onClick={() => toggleBlocked(bin)}
                className="rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted) disabled:opacity-40"
              >
                {busyBinId === bin.id ? '…' : bin.blocked ? 'Unblock' : 'Block'}
              </button>
            ),
          } satisfies DataTableColumn<BinResponse>,
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-2">
      <ZonePicker zones={zones} value={selectedZoneId} onChange={(id) => onSelectZone(id)} label="Zone bins" />
      <DataTable<BinResponse>
        columns={columns}
        rows={bins?.items ?? []}
        nextCursor={bins?.nextCursor ?? null}
        onCursor={bins?.onCursor}
        emptyMessage="No bins in this zone yet — generate a grid or add one manually."
      />
      {outcome !== null && <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />}
    </div>
  );
}

/**
 * Clients branch on the machine-readable problem `code`, never on prose —
 * same convention as the warehouse form, extended with the new zone/bin
 * codes (spec 1.3).
 */
function rejectionReason(error: unknown, attemptedCode?: string): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'duplicate-zone-code':
        return `Zone code ${attemptedCode ?? ''} is already used in this warehouse — pick another.`;
      case 'duplicate-bin-code':
        // The grid form has no attempted code — the API names the first
        // conflicting code in the problem detail; the manual form does.
        return attemptedCode !== undefined
          ? `Bin code ${attemptedCode} is already used in this warehouse — pick another.`
          : (error.detail ?? 'A generated bin code is already used in this warehouse — narrow the grid or pick different codes.');
      case 'grid-too-large':
        return error.detail ?? 'Narrow the aisle range, bays, or levels — 500 bins per run.';
      case 'not-found':
        return 'That warehouse or zone no longer exists — refresh the page.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the entered values and try again.';
      default:
        return error.detail ?? `Request failed (${error.code}).`;
    }
  }
  return 'The API is unreachable — is wms-be running?';
}