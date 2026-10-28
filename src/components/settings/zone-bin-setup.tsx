'use client';

import Link from 'next/link';
import { useRef, useState, useSyncExternalStore } from 'react';

import {
  ApiProblem,
  fetchApiCreateBin,
  fetchApiCreateZone,
  fetchApiGenerateBinGrid,
  fetchApiListBins,
  fetchApiMergeBin,
  fetchApiRetireBin,
  fetchApiSetBinBlocked,
} from '@/lib/api/client';
import type { BinResponse, ClientDto, GenerateBinsDto, PatchBinDto, ZoneResponse } from '@/lib/api/generated';
import { readActiveWarehouseId, subscribeActiveWarehouse, writeActiveWarehouseId } from '@/lib/warehouses';
import { readSession, subscribeSession } from '@/lib/auth';
import { binClassReason, STORAGE_CLASSES } from '@/lib/sku-admin';
import {
  BIN_CLIENTS_UNAVAILABLE,
  binClientCell,
  binClientOptions,
  binClientPatch,
  binClientReason,
  binClientSavedWord,
  dedicatedClientBody,
  mergeTargetLabel,
  type BinClientOption,
} from '@/lib/bin-clients';
import { CLIENT_DEPARTED_REASON } from '@/lib/client-departed';
import { showClients } from '@/lib/clients';
import { useClients } from '@/lib/use-clients';
import { roleHasCapability } from '@/lib/users';
import { ulid } from '@/lib/ulid';
import { fetchAllPages } from '@/lib/fetch-all-pages';
import { useTenantWarehouses } from '@/lib/use-tenant-warehouses';
import { useWarehouseZones } from '@/lib/use-warehouse-zones';
import { useZoneBins } from '@/lib/use-zone-bins';
import { useZoneBinsByStatus } from '@/lib/use-zone-bins-by-status';
import {
  BIN_STATUS_FILTER_LABEL,
  binBlockByline,
  binBlockOutcome,
  binBlockedLabel,
  type BinStatusFilter,
} from '@/lib/bin-block';
import { notifyZonesChanged } from '@/lib/zones';

import { FeedbackBanner } from '@/components/feedback/banner';
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { Section } from '@/components/shared/surface';
import { WarehousesFailure, WarehousesRefreshNote } from '@/components/shared/warehouses-failure';
import { BinLabelsDialog, type BinLabelsTarget } from '@/components/settings/BinLabelsDialog';
import { MAX_LABELS_PER_PRINT, binPrintBlock } from '@/lib/bin-labels';
import { StatusChip } from '@/components/shared/status-chip';
import { BinBlockDialog } from '@/components/settings/bin-block-dialog';

const inputClass =
  'w-full rounded-sm border border-(--input) bg-(--background) px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-(--ring)';
const labelClass = 'text-sm font-medium';
const selectClass = `${inputClass} appearance-none`;

/** Bin types are the fixed backend location-type vocabulary (story 12-4) —
 * surfaced verbatim, the original four first. Tank and silo are BULK ASSETS:
 * single-SKU, weight-defined stores that an operator directs into place. */
const BIN_TYPES = ['shelf', 'pallet', 'floor', 'staging', 'floor-stack', 'yard', 'tank', 'silo'] as const;
type BinType = (typeof BIN_TYPES)[number];
/** The generated grid body's type — the server contract already excludes the
 * bulk assets, so the grid picker's options and cast derive from IT (the
 * backend narrows the DTO; the FE mirrors). */
type GridBinType = GenerateBinsDto['type'];
const BULK_ASSET_TYPES: readonly BinType[] = ['tank', 'silo'];
/** The grid generator only mints conventional storage — the backend refuses
 * to grid a bulk asset, so the picker never offers one. */
const GRID_TYPES = BIN_TYPES.filter((type): type is GridBinType => !BULK_ASSET_TYPES.includes(type));
const isBulkAssetType = (type: string): boolean => BULK_ASSET_TYPES.includes(type as BinType);
/** Same cap as the backend's `MAX_BIN_WEIGHT_GRAMS` (bin-capacity.ts). */
const MAX_BIN_WEIGHT_GRAMS = 100_000_000;

type Outcome = { tone: 'accepted' | 'rejected'; word: string; reason: string } | null;

/**
 * Zones/bins setup (Stories 1.3 + 3.6), hosted as Settings sub-cards — no new
 * route: zone create, the grid generator, manual bin create, and the zone→bins
 * table with the block toggle (story 1.3) plus the merge and retire
 * administration actions (story 3.6, `bin.retire` roles). Every submit sends
 * a fresh ULID Idempotency-Key, so a double click replays the same response
 * instead of duplicating master data.
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
  const warehouseRead = useTenantWarehouses();
  // Loading reads as before (no tenant yet); a failed read renders below.
  const { tenantId, items: warehouses } =
    warehouseRead.state === 'ready' ? warehouseRead.data : { tenantId: null, items: [] };
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
  // Story 1-5b — every client (departed included), never the 1.5a switcher's
  // pick (decision 13): bin admin is master data. `clientList` is non-null
  // only for a MULTI-client tenant; a single-client tenant sees nothing new.
  const clientsRead = useClients();
  const clientList =
    clientsRead.state === 'ready' && showClients(clientsRead.data) ? clientsRead.data : null;

  if (warehouseRead.state === 'failed') {
    return (
      <Section title="Zones and bins">
        <WarehousesFailure state={warehouseRead} />
      </Section>
    );
  }

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
  // matching capability — hide surfaces, never "blocked" screens. Story 3.6:
  // merge + retire gate on the new `bin.retire` (Owner + Ops Manager only).
  // The backend per-command role read remains the authority.
  const role = readSession()?.user.role;
  const canCreateZone = roleHasCapability(role, 'zone.create');
  const canCreateBin = roleHasCapability(role, 'bin.create');
  const canBlockBin = roleHasCapability(role, 'bin.block');
  const canRetireBin = roleHasCapability(role, 'bin.retire');
  // Story 2-10a — printing bin labels (owner, ops manager, operator).
  const canPrintLabels = roleHasCapability(role, 'labels.execute');

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

      {warehouseRead.state === 'ready' && warehouseRead.data.refreshFailed !== null && (
        <WarehousesRefreshNote reason={warehouseRead.data.refreshFailed} onRetry={warehouseRead.reload} />
      )}
      {clientsRead.state === 'failed' && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-(--muted-foreground)">
          <span>{BIN_CLIENTS_UNAVAILABLE}</span>
          <button
            type="button"
            onClick={() => clientsRead.reload()}
            className="rounded-sm border border-(--border) px-2 py-1 hover:bg-(--muted)"
          >
            Retry
          </button>
        </div>
      )}
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
              clients={clientList}
            />
          )}
          <ZoneBinsTable
            // Story 3-3b — a warehouse switch remounts the table, so a block
            // dialog (and every other open panel) never outlives its warehouse.
            key={`bins-${warehouseId}`}
            tenantId={tenantId}
            warehouseId={warehouseId}
            zones={zones}
            selectedZoneId={selectedZoneId}
            onSelectZone={setZoneId}
            bins={bins}
            canBlockBin={canBlockBin}
            canRetireBin={canRetireBin}
            canPrintLabels={canPrintLabels}
            warehouseCode={warehouse?.code ?? ''}
            clients={clientList}
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

function BinTypePicker({
  value,
  onChange,
  options = BIN_TYPES,
}: {
  value: string;
  onChange: (type: string) => void;
  /** Defaults to the full vocabulary; the grid form passes the subset the
   * backend accepts (bulk assets are never gridded). */
  options?: readonly string[];
}) {
  return (
    <label className="flex flex-1 flex-col gap-1">
      <span className={labelClass}>Type</span>
      <select className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((type) => (
          <option key={type} value={type}>
            {type}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Story 1-5b — the dedicated-client select (create, grid and the Edit-client panel). */
function BinClientPicker({
  value,
  onChange,
  options,
  label = 'Client',
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly BinClientOption[];
  label?: string;
}) {
  return (
    <label className="flex flex-1 flex-col gap-1">
      <span className={labelClass}>{label}</span>
      <select className={selectClass} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
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
  clients,
}: {
  tenantId: string;
  warehouseId: string;
  zones: readonly ZoneResponse[];
  /** Story 1-5b — the clients of a multi-client tenant, else null (no client field). */
  clients: readonly ClientDto[] | null;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <GridGeneratorForm tenantId={tenantId} warehouseId={warehouseId} zones={zones} clients={clients} />
      <ManualBinForm tenantId={tenantId} warehouseId={warehouseId} zones={zones} clients={clients} />
    </div>
  );
}

function GridGeneratorForm({
  tenantId,
  warehouseId,
  zones,
  clients,
}: {
  tenantId: string;
  warehouseId: string;
  zones: readonly ZoneResponse[];
  clients: readonly ClientDto[] | null;
}) {
  // Story 1-5b — '' = Shared (the default); the grid can dedicate a whole run.
  const [clientChoice, setClientChoice] = useState('');
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
          type: type as GridBinType,
          ...(clients === null ? {} : dedicatedClientBody(clientChoice)),
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
      setOutcome({
        tone: 'rejected',
        word: 'Not generated',
        reason: rejectionReason(error, undefined, clients !== null && clientChoice !== ''),
      });
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
          <BinTypePicker value={type} onChange={setType} options={GRID_TYPES} />
        </div>
        {clients !== null && (
          <BinClientPicker value={clientChoice} onChange={setClientChoice} options={binClientOptions(clients)} />
        )}
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
  clients,
}: {
  tenantId: string;
  warehouseId: string;
  zones: readonly ZoneResponse[];
  clients: readonly ClientDto[] | null;
}) {
  // Story 1-5b — '' = Shared (the default).
  const [clientChoice, setClientChoice] = useState('');
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [capacity, setCapacity] = useState('120');
  const [type, setType] = useState<string>('shelf');
  // Story 12-4: a bulk asset (tank, silo) is a weight-defined store — the
  // backend refuses to create one without a max weight, so the form asks
  // for it whenever a bulk type is picked.
  const [maxWeightGrams, setMaxWeightGrams] = useState('');
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
          type: type as BinType,
          ...(isBulkAssetType(type) ? { maxWeightGrams: Number(maxWeightGrams) } : {}),
          ...(clients === null ? {} : dedicatedClientBody(clientChoice)),
        },
        ulid(),
      );
      setCode('');
      setMaxWeightGrams('');
      setOutcome({
        tone: 'accepted',
        word: 'Bin created',
        reason: `${bin.code} is immediately usable as a putaway/pick target.`,
      });
      notifyZonesChanged();
    } catch (error) {
      setOutcome({
        tone: 'rejected',
        word: 'Not created',
        reason: rejectionReason(error, code, clients !== null && clientChoice !== ''),
      });
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
        {clients !== null && (
          <BinClientPicker value={clientChoice} onChange={setClientChoice} options={binClientOptions(clients)} />
        )}
        {isBulkAssetType(type) && (
          <label className="flex flex-1 flex-col gap-1">
            <span className={labelClass}>Max weight (grams)</span>
            <input
              className={inputClass}
              type="number"
              min={1}
              max={MAX_BIN_WEIGHT_GRAMS}
              value={maxWeightGrams}
              onChange={(e) => setMaxWeightGrams(e.target.value)}
              required
              title="A bulk asset holds exactly one SKU and is bounded by weight, not units."
            />
          </label>
        )}
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
  // Story 12-7 — the bin's storage class (FR-40) becomes a column; the
  // Edit-class affordance below is its write path (the structure arm).
  { key: 'storage', header: 'Storage', render: (bin) => bin.storageClass ?? '—' },
];

/** The zone→bins table with the block toggle (1.3), merge/retire (3.6) and
 * the Edit-class affordance (story 12-7). */
function ZoneBinsTable({
  tenantId,
  warehouseId,
  zones,
  selectedZoneId,
  onSelectZone,
  bins,
  canBlockBin,
  canRetireBin,
  canPrintLabels,
  warehouseCode,
  clients,
}: {
  tenantId: string;
  warehouseId: string;
  zones: readonly ZoneResponse[];
  selectedZoneId: string | null;
  onSelectZone: (zoneId: string | null) => void;
  bins: ReturnType<typeof useZoneBins>;
  /** Story 1.5: Block / Unblock render only for `bin.block` roles (3-3b: each opens its dialog). */
  canBlockBin: boolean;
  /** Story 3.6: merge/retire render only for `bin.retire` roles. */
  canRetireBin: boolean;
  /** Story 2-10a: the label checkboxes and print buttons render only for `labels.execute` roles. */
  canPrintLabels: boolean;
  /** Story 2-10a: the warehouse code, for the label file's name. */
  warehouseCode: string;
  /** Story 1-5b — the clients of a multi-client tenant, else null (no column, no panel). */
  clients: readonly ClientDto[] | null;
}) {
  const [busyBinId, setBusyBinId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);
  // Story 12-7 gating — the Edit-class affordance reads the role SUBSCRIBED
  // (the sku-table.tsx pattern, not this Settings card's bare readSession()
  // above): a /me bootstrap role rewrite re-renders the affordance. The
  // backend per-command role read remains the authority.
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );
  // The BE gates the structure arm on `bin.create` itself (story 11-5's
  // OpenAPI 403 arm) — the FE mirrors the server's decision.
  const canEditClass = roleHasCapability(role, 'bin.create');
  // The Edit-class flow: the picked bin (null = closed), its picker state,
  // and a fetch-free inline editor — the PATCH carries `{ storageClass }`
  // ONLY (the structure arm; dimensions/maxWeight are not this story's).
  const [classEditingBin, setClassEditingBin] = useState<BinResponse | null>(null);
  const [classDraft, setClassDraft] = useState<string>(STORAGE_CLASSES[0]);
  // A pre-render double-click fires both handlers before the disabled state
  // renders — this synchronous re-entry guard makes the second click a
  // no-op instead of a NEW command whose fresh Idempotency-Key would append
  // a second audit row for one intent (the inbound-cards pattern, checked
  // in both arms).
  const classEditInFlight = useRef<Set<string>>(new Set());
  // Story 1-5b — the Edit-client panel (the Edit-class pattern): the picked
  // bin (null = closed), its draft ('' = Shared) and the same synchronous
  // re-entry guard.
  const [clientEditingBin, setClientEditingBin] = useState<BinResponse | null>(null);
  const [clientDraft, setClientDraft] = useState('');
  const clientEditInFlight = useRef<Set<string>>(new Set());
  // The merge flow: the picked source bin (null = closed). The target picker
  // offers the WAREHOUSE's live bins (any zone), excluding system bins,
  // already-retired bins, and the source itself.
  const [mergeSource, setMergeSource] = useState<BinResponse | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null);
  const [mergeTargets, setMergeTargets] = useState<readonly BinResponse[] | null>(null);
  // The picker's fetch sequence — a rapid second pick supersedes the first
  // fetch, so a stale response must never win the race into state.
  const mergeFetchSeq = useRef(0);
  // Story 3-3b — the Block / Unblock dialog, scoped to the zone it was
  // opened in (a zone switch reads as closed — derived, no effect).
  const [blockPanel, setBlockPanel] = useState<{ zoneId: string | null; mode: 'block' | 'unblock'; bin: BinResponse } | null>(null);
  const blockTarget = blockPanel !== null && blockPanel.zoneId === selectedZoneId ? blockPanel : null;
  // Story 3-3b — the Status filter (All / Active / Blocked). `all` is the
  // paged list; Active and Blocked walk the WHOLE zone (the server has no
  // status filter, and a page-only filter would hide a blocked bin on a
  // later page).
  const [statusFilter, setStatusFilter] = useState<BinStatusFilter>('all');
  const byStatus = useZoneBinsByStatus(warehouseId, selectedZoneId, statusFilter);
  // Story 2-10a — the label selection, scoped to the zone it was made in: a
  // zone switch reads as an empty selection (derived, no effect), while
  // paging inside the zone keeps it. `printTarget` opens the print panel.
  const [labelSelection, setLabelSelection] = useState<{ zoneId: string | null; ids: ReadonlySet<string> }>({
    zoneId: null,
    ids: new Set(),
  });
  const pageRows: readonly BinResponse[] =
    statusFilter === 'all' ? (bins?.items ?? []) : byStatus.state === 'ready' ? byStatus.data.items : [];
  // A ticked bin the refreshed page now shows unprintable (retired, merged
  // away, a code a barcode cannot carry) drops out of the selection; the next
  // tick or untick stores the pruned set.
  const blockedOnPage = new Set(pageRows.filter((bin) => binPrintBlock(bin) !== null).map((bin) => bin.id));
  const selectedIds: ReadonlySet<string> =
    labelSelection.zoneId === selectedZoneId
      ? new Set([...labelSelection.ids].filter((id) => !blockedOnPage.has(id)))
      : new Set<string>();
  const overLimit = selectedIds.size > MAX_LABELS_PER_PRINT;
  const [printPanel, setPrintPanel] = useState<{ zoneId: string | null; target: BinLabelsTarget } | null>(null);
  // The panel belongs to the zone it was opened in — a zone switch closes it.
  const printTarget = printPanel !== null && printPanel.zoneId === selectedZoneId ? printPanel.target : null;
  const setPrintTarget = (target: BinLabelsTarget | null) =>
    setPrintPanel(target === null ? null : { zoneId: selectedZoneId, target });
  const printableOnPage = pageRows.filter((bin) => binPrintBlock(bin) === null);
  const pageAllSelected = printableOnPage.length > 0 && printableOnPage.every((bin) => selectedIds.has(bin.id));
  const selectedZone = zones.find((zone) => zone.id === selectedZoneId);

  function setSelected(next: Set<string>) {
    setLabelSelection({ zoneId: selectedZoneId, ids: next });
    setPrintTarget(null);
  }

  function toggleLabel(binId: string) {
    const next = new Set(selectedIds);
    if (next.has(binId)) next.delete(binId);
    else next.add(binId);
    setSelected(next);
  }

  /** The page checkbox: ticks (or unticks) only THIS page's printable rows. */
  function togglePage() {
    const next = new Set(selectedIds);
    for (const bin of printableOnPage) {
      if (pageAllSelected) next.delete(bin.id);
      else next.add(bin.id);
    }
    setSelected(next);
  }

  /** Story 12-7 — the Edit-class PATCH: the structure arm carries
   * `{ storageClass }` ONLY. A stranding change is refused 409
   * `storage-class-conflict` naming the conflicting stock verbatim — the
   * refusal renders through the lib mapper, and the editor stays open so
   * the viewer can pick another class (or cancel). */
  async function applyClassEdit() {
    const session = readSession();
    if (session === null || classEditingBin === null) return;
    if (classEditInFlight.current.has(classEditingBin.id)) return;
    classEditInFlight.current.add(classEditingBin.id);
    setBusyBinId(classEditingBin.id);
    setOutcome(null);
    try {
      const updated = await fetchApiSetBinBlocked(
        tenantId,
        warehouseId,
        classEditingBin.id,
        { storageClass: classDraft as PatchBinDto['storageClass'] },
        ulid(),
      );
      setOutcome({
        tone: 'accepted',
        word: `${updated.code} storage class set to ${updated.storageClass}`,
        reason: 'The class gates putaway suggestions immediately; stock already inside stays put.',
      });
      setClassEditingBin(null);
      bins?.reload();
      byStatus.reload();
    } catch (error) {
      setOutcome({ tone: 'rejected', word: 'Not updated', reason: binClassReason(error) });
    } finally {
      classEditInFlight.current.delete(classEditingBin.id);
      setBusyBinId(null);
    }
  }

  /** Story 1-5b — the Edit-client PATCH: `{ dedicatedClientId }` only
   * (null = Shared). An unchanged pick sends NOTHING and closes the panel —
   * so a bin kept on its (departed) current client never re-dedicates. A
   * refusal renders through the lib mapper and the panel stays open. */
  async function applyClientEdit() {
    const session = readSession();
    if (session === null || clientEditingBin === null || clients === null) return;
    const body = binClientPatch(clientEditingBin.dedicatedClientId, clientDraft);
    if (body === null) {
      setClientEditingBin(null);
      return;
    }
    if (clientEditInFlight.current.has(clientEditingBin.id)) return;
    clientEditInFlight.current.add(clientEditingBin.id);
    setBusyBinId(clientEditingBin.id);
    setOutcome(null);
    try {
      const updated = await fetchApiSetBinBlocked(tenantId, warehouseId, clientEditingBin.id, body, ulid());
      setOutcome({
        tone: 'accepted',
        word: binClientSavedWord(updated.code, updated.dedicatedClientId, clients),
        reason: 'A dedicated bin refuses any other client\'s stock in putaway, merge and transfers; its own client\'s goods are suggested here first.',
      });
      setClientEditingBin(null);
      bins?.reload();
      byStatus.reload();
    } catch (error) {
      setOutcome({ tone: 'rejected', word: 'Not updated', reason: binClientReason(error) });
    } finally {
      clientEditInFlight.current.delete(clientEditingBin.id);
      setBusyBinId(null);
    }
  }

  /** Story 3-3b — a block / unblock settled: the banner from the RESPONSE, then every bins reader re-reads. */
  function blockDone(mode: 'block' | 'unblock', updated: BinResponse) {
    const outcome = binBlockOutcome(mode, updated);
    setOutcome({ tone: 'accepted', word: outcome.word, reason: outcome.reason });
    setBlockPanel(null);
    bins?.reload();
    byStatus.reload();
  }

  /** Story 3-3b — 409 already-blocked / not-blocked: someone else moved the bin on; close and re-read. */
  function blockStale(reason: string) {
    setOutcome({ tone: 'rejected', word: 'Not changed', reason });
    setBlockPanel(null);
    bins?.reload();
    byStatus.reload();
  }

  /** Story 3.6 — the one-way retire; only an EMPTY bin is accepted by the API. */
  async function retireBin(bin: BinResponse) {
    const session = readSession();
    if (session === null) return;
    setBusyBinId(bin.id);
    setOutcome(null);
    try {
      const retired = await fetchApiRetireBin(tenantId, warehouseId, bin.id, ulid());
      setOutcome({
        tone: 'accepted',
        word: `${retired.code} retired`,
        reason: 'Retirement is terminal: the code stays reserved, the bin leaves every suggestion and device snapshot.',
      });
      bins?.reload();
      byStatus.reload();
      notifyZonesChanged();
    } catch (error) {
      // `bin-not-empty` names the offending (sku, batch, qty) rows verbatim.
      setOutcome({ tone: 'rejected', word: 'Not retired', reason: rejectionReason(error) });
    } finally {
      setBusyBinId(null);
    }
  }

  async function confirmMerge() {
    const session = readSession();
    if (session === null || mergeSource === null || mergeTargetId === null) return;
    setBusyBinId(mergeSource.id);
    setOutcome(null);
    try {
      const merged = await fetchApiMergeBin(
        tenantId,
        warehouseId,
        mergeSource.id,
        { targetBinId: mergeTargetId },
        ulid(),
      );
      setOutcome({
        tone: 'accepted',
        word: `${merged.source.code} merged into ${merged.target.code}`,
        reason: `${merged.moved.units} units across ${merged.moved.skus} SKUs moved; the source is retired and its code stays reserved.`,
      });
      setMergeSource(null);
      setMergeTargetId(null);
      setMergeTargets(null);
      bins?.reload();
      byStatus.reload();
      notifyZonesChanged();
    } catch (error) {
      setOutcome({ tone: 'rejected', word: 'Not merged', reason: rejectionReason(error) });
      // The merge refused — the picker stays open so the viewer can pick
      // another target (or cancel) without re-navigating.
    } finally {
      setBusyBinId(null);
    }
  }

  function openMergePicker(bin: BinResponse) {
    setMergeSource(bin);
    setMergeTargetId(null);
    setMergeTargets(null);
    const seq = ++mergeFetchSeq.current;
    (async () => {
      try {
        const zoneBins = await Promise.all(
          zones.map((zone) =>
            fetchAllPages((cursor) => fetchApiListBins(tenantId, warehouseId, zone.id, cursor)),
          ),
        );
        // A newer pick superseded this fetch — its response must not win.
        if (seq !== mergeFetchSeq.current) return;
        setMergeTargets(
          zoneBins
            .flat()
            .filter(
              (candidate) =>
                candidate.retiredAt === null && !candidate.systemOwned && candidate.id !== bin.id,
            ),
        );
      } catch {
        if (seq !== mergeFetchSeq.current) return;
        setMergeTargets([]);
        setOutcome({
          tone: 'rejected',
          word: 'Not merged',
          reason: 'Could not load the warehouse bins — retry the merge.',
        });
      }
    })();
  }

  // The file is named after the warehouse code: no code yet, no print controls.
  const showLabels = canPrintLabels && warehouseCode !== '';
  const canOperate = canBlockBin || canRetireBin || canEditClass;
  const labelColumn: DataTableColumn<BinResponse> = {
    key: 'label',
    header: '',
    render: (bin) => {
      const block = binPrintBlock(bin);
      return (
        <input
          type="checkbox"
          aria-label={`Print a label for ${bin.code}`}
          title={block ?? `Print a label for ${bin.code}`}
          disabled={block !== null}
          checked={block === null && selectedIds.has(bin.id)}
          onChange={() => toggleLabel(bin.id)}
        />
      );
    },
  };
  const columns: readonly DataTableColumn<BinResponse>[] = [
    ...(showLabels ? [labelColumn] : []),
    ...binColumns,
    // Story 1-5b — the dedicated client, resolved over ALL clients.
    ...(clients === null
      ? []
      : [
          {
            key: 'client',
            header: 'Client',
            render: (bin: BinResponse) => binClientCell(bin.dedicatedClientId, clients),
          } satisfies DataTableColumn<BinResponse>,
        ]),
    {
      key: 'blocked',
      header: 'Status',
      render: (bin) =>
        bin.retiredAt !== null ? (
          <StatusChip tone="neutral">Retired</StatusChip>
        ) : bin.blocked ? (
          // Story 3-3b — "Blocked — damaged", with the note, who and when beneath.
          <span className="flex flex-col items-start gap-0.5">
            <StatusChip tone="danger">{binBlockedLabel(bin)}</StatusChip>
            {binBlockByline(bin) !== null && (
              <span className="text-xs text-(--muted-foreground)" data-testid="bin-block-byline">
                {binBlockByline(bin)}
              </span>
            )}
          </span>
        ) : (
          <StatusChip tone="neutral">{bin.systemOwned ? 'System' : 'Active'}</StatusChip>
        ),
    },
    ...(canOperate
      ? [
          {
            key: 'actions',
            header: '',
            render: (bin: BinResponse) => {
              // Story 3.6: system bins and retired bins are operationally
              // gone — every administration action is inert on them (the
              // backend refuses anyway; the UI mirrors the matrix).
              const inert = bin.systemOwned || bin.retiredAt !== null;
              return (
                <div className="flex justify-end gap-1">
                  {canBlockBin && (
                    <button
                      type="button"
                      // One block dialog at a time: another row's verb would unmount it mid-request.
                      disabled={inert || busyBinId === bin.id || blockPanel !== null}
                      onClick={() => {
                        setBlockPanel({ zoneId: selectedZoneId, mode: bin.blocked ? 'unblock' : 'block', bin });
                        setOutcome(null);
                      }}
                      className="rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted) disabled:opacity-40"
                    >
                      {busyBinId === bin.id ? '…' : bin.blocked ? 'Unblock' : 'Block'}
                    </button>
                  )}
                  {canRetireBin && (
                    <>
                      <button
                        type="button"
                        disabled={inert || busyBinId === bin.id}
                        onClick={() => openMergePicker(bin)}
                        className="rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted) disabled:opacity-40"
                      >
                        Merge
                      </button>
                      <button
                        type="button"
                        disabled={inert || busyBinId === bin.id}
                        onClick={() => retireBin(bin)}
                        className="rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted) disabled:opacity-40"
                      >
                        Retire
                      </button>
                    </>
                  )}
                  {/* Story 12-7 — the class admin's bin write path. Live,
                      non-system bins only (the same `inert` rule as the
                      sibling actions; the backend refuses anyway). */}
                  {canEditClass && (
                    <button
                      type="button"
                      disabled={inert || busyBinId === bin.id}
                      onClick={() => {
                        setClassEditingBin(bin);
                        setClassDraft(bin.storageClass);
                        setOutcome(null);
                      }}
                      className="rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted) disabled:opacity-40"
                    >
                      Edit class
                    </button>
                  )}
                  {/* Story 1-5b — the dedicated client's write path; the
                      same gate and `inert` rule as Edit class. */}
                  {canEditClass && clients !== null && (
                    <button
                      type="button"
                      disabled={inert || busyBinId === bin.id}
                      onClick={() => {
                        setClientEditingBin(bin);
                        setClientDraft(bin.dedicatedClientId ?? '');
                        setOutcome(null);
                      }}
                      className="rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted) disabled:opacity-40"
                    >
                      Edit client
                    </button>
                  )}
                </div>
              );
            },
          } satisfies DataTableColumn<BinResponse>,
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-3 sm:flex-row">
        <ZonePicker
          zones={zones}
          value={selectedZoneId}
          onChange={(id) => {
            // A block dialog belongs to its zone — a switch closes it, so it never reappears on the way back.
            setBlockPanel(null);
            onSelectZone(id);
          }}
          label="Zone bins"
        />
        {/* Story 3-3b — the Status filter; Active and Blocked cover the whole zone. */}
        <label className="flex flex-col gap-1 sm:w-48">
          <span className={labelClass}>Status</span>
          <select
            aria-label="Bin status filter"
            className={selectClass}
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as BinStatusFilter);
              // Back to page one of the paged list, so All never resumes on a stale page.
              bins?.onCursor(null);
            }}
          >
            {(Object.keys(BIN_STATUS_FILTER_LABEL) as BinStatusFilter[]).map((value) => (
              <option key={value} value={value}>
                {BIN_STATUS_FILTER_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {canBlockBin && blockTarget !== null && (
        <BinBlockDialog
          key={`${blockTarget.mode}-${blockTarget.bin.id}`}
          mode={blockTarget.mode}
          tenantId={tenantId}
          warehouseId={warehouseId}
          bin={blockTarget.bin}
          onClose={() => setBlockPanel(null)}
          onDone={(updated) => blockDone(blockTarget.mode, updated)}
          onStale={blockStale}
        />
      )}
      {showLabels && selectedZoneId !== null && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              aria-label="Tick every printable bin on this page"
              disabled={printableOnPage.length === 0}
              checked={pageAllSelected}
              onChange={() => togglePage()}
            />
            <span className="text-(--muted-foreground)">This page</span>
          </label>
          <button
            type="button"
            disabled={selectedIds.size === 0 || overLimit}
            onClick={() => {
              setPrintTarget({ kind: 'bins', binIds: [...selectedIds] });
              setOutcome(null);
            }}
            className="rounded-sm border border-(--border) px-2 py-1 hover:bg-(--muted) disabled:opacity-40"
          >
            Print labels ({selectedIds.size})
          </button>
          {overLimit && (
            <span role="note" className="text-(--destructive)">
              One print takes at most {MAX_LABELS_PER_PRINT} labels — untick some bins.
            </span>
          )}
          {/* Enabled for any zone: printable bins may sit on a later page;
              the server answers a truly empty zone with no-bins-to-print. */}
          <button
            type="button"
            onClick={() => {
              setPrintTarget({ kind: 'zone', zoneId: selectedZoneId, zoneCode: selectedZone?.code ?? '' });
              setOutcome(null);
            }}
            className="rounded-sm border border-(--border) px-2 py-1 hover:bg-(--muted) disabled:opacity-40"
          >
            Print zone labels
          </button>
        </div>
      )}
      {showLabels && printTarget !== null && (
        <BinLabelsDialog
          key={printTarget.kind === 'zone' ? `zone-${printTarget.zoneId}` : `bins-${printTarget.binIds.join(',')}`}
          tenantId={tenantId}
          warehouseId={warehouseId}
          warehouseCode={warehouseCode}
          target={printTarget}
          onClose={() => setPrintTarget(null)}
          onPrinted={(summary) => {
            setPrintTarget(null);
            setOutcome({ tone: 'accepted', word: 'Labels ready', reason: summary });
          }}
        />
      )}
      {classEditingBin !== null && (
        <div className="flex flex-col gap-2 rounded-sm border border-(--border) bg-(--muted) p-3">
          <div className="text-xs text-(--muted-foreground)">
            Editing the storage class of <span className="font-mono">{classEditingBin.code}</span> —
            the class gates what putaway will suggest here. A change that would strand stock
            already inside is refused and names it.
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <select
              className={selectClass}
              value={classDraft}
              onChange={(e) => setClassDraft(e.target.value)}
            >
              {STORAGE_CLASSES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={busyBinId === classEditingBin.id}
              onClick={() => applyClassEdit()}
              className="self-end rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60"
            >
              {busyBinId === classEditingBin.id ? 'Saving…' : 'Save class'}
            </button>
            <button
              type="button"
              onClick={() => setClassEditingBin(null)}
              className="self-end rounded-sm border border-(--border) px-3 py-2 text-sm hover:bg-(--muted)"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {clientEditingBin !== null && clients !== null && (
        <div className="flex flex-col gap-2 rounded-sm border border-(--border) bg-(--muted) p-3">
          <div className="text-xs text-(--muted-foreground)">
            Dedicating <span className="font-mono">{clientEditingBin.code}</span> to a client — a
            dedicated bin refuses every other client&apos;s stock. A bin still holding another
            client&apos;s stock or QC holds is refused, naming them.
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <BinClientPicker
              label="Dedicated to"
              value={clientDraft}
              onChange={setClientDraft}
              options={binClientOptions(clients, clientEditingBin.dedicatedClientId ?? null)}
            />
            <button
              type="button"
              disabled={busyBinId === clientEditingBin.id}
              onClick={() => applyClientEdit()}
              className="self-end rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60"
            >
              {busyBinId === clientEditingBin.id ? 'Saving…' : 'Save client'}
            </button>
            <button
              type="button"
              onClick={() => setClientEditingBin(null)}
              className="self-end rounded-sm border border-(--border) px-3 py-2 text-sm hover:bg-(--muted)"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {mergeSource !== null && (
        <div className="flex flex-col gap-2 rounded-sm border border-(--border) bg-(--muted) p-3">
          <div className="text-xs text-(--muted-foreground)">
            Merging {mergeSource.code} — all of its stock moves into the target and the source
            retires in the same commit. Pick a target bin (live storage bins only).
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <select
              className={selectClass}
              value={mergeTargetId ?? ''}
              onChange={(e) => setMergeTargetId(e.target.value)}
            >
              <option value="" disabled>
                {mergeTargets === null ? 'Loading bins…' : 'Pick a target bin…'}
              </option>
              {(mergeTargets ?? [])
                .filter((bin) => !bin.blocked)
                .map((bin) => (
                  <option key={bin.id} value={bin.id}>
                    {mergeTargetLabel(bin, clients)}
                  </option>
                ))}
            </select>
            <button
              type="button"
              disabled={mergeTargetId === null || busyBinId === mergeSource.id}
              onClick={() => confirmMerge()}
              className="self-end rounded-md bg-(--primary) px-3 py-2 text-sm font-medium text-(--primary-foreground) hover:opacity-90 disabled:opacity-60"
            >
              {busyBinId === mergeSource.id ? 'Merging…' : 'Merge'}
            </button>
            <button
              type="button"
              onClick={() => {
                setMergeSource(null);
                setMergeTargetId(null);
                setMergeTargets(null);
              }}
              className="self-end rounded-sm border border-(--border) px-3 py-2 text-sm hover:bg-(--muted)"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {statusFilter !== 'all' && byStatus.state === 'failed' && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <FeedbackBanner tone="rejected" word="Bins not loaded" reason={byStatus.reason} />
          <button
            type="button"
            onClick={() => byStatus.reload()}
            className="rounded-sm border border-(--border) px-2 py-1 hover:bg-(--muted)"
          >
            Retry
          </button>
        </div>
      )}
      {statusFilter !== 'all' && byStatus.state === 'ready' && byStatus.data.truncated && (
        <div role="note" className="text-xs text-(--muted-foreground)">
          This zone has more bins than one filtered read covers — the list may be missing some. Use All to page through every bin.
        </div>
      )}
      {statusFilter !== 'all' && byStatus.state === 'loading' && <div className="text-(--muted-foreground)">Loading bins…</div>}
      {/* A failed filtered read shows its banner only — an empty table would claim "No blocked bins". */}
      {(statusFilter === 'all' || byStatus.state === 'ready') && (
        <DataTable<BinResponse>
          key={statusFilter}
          columns={columns}
          rows={pageRows}
          nextCursor={statusFilter === 'all' ? (bins?.nextCursor ?? null) : null}
          onCursor={statusFilter === 'all' ? bins?.onCursor : undefined}
          emptyMessage={
            statusFilter === 'blocked'
              ? 'No blocked bins in this zone.'
              : statusFilter === 'active'
                ? 'No active bins in this zone.'
                : 'No bins in this zone yet — generate a grid or add one manually.'
          }
        />
      )}
      {outcome !== null && <FeedbackBanner tone={outcome.tone} word={outcome.word} reason={outcome.reason} />}
    </div>
  );
}

/**
 * Clients branch on the machine-readable problem `code`, never on prose —
 * same convention as the warehouse form, extended with the new zone/bin
 * codes (spec 1.3).
 */
function rejectionReason(error: unknown, attemptedCode?: string, withClient = false): string {
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
      case 'reserved-location-code':
        // Story 13-2 — RETURNS belongs to the system returns zone/bin; story
        // 2-4a — DAMAGED to the system damaged zone/bin.
        return 'RETURNS and DAMAGED are reserved for the system returns and damaged locations — choose another code.';
      case 'grid-too-large':
        return error.detail ?? 'Narrow the aisle range, bays, or levels — 500 bins per run.';
      case 'not-found':
        // Story 1-5b: a create/grid naming a client can also miss on it.
        return withClient
          ? 'That warehouse, zone or client no longer exists — refresh the page.'
          : 'That warehouse or zone no longer exists — refresh the page.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Check the entered values and try again.';
      // Story 3.6 — bin administration codes (the backend's detail names the
      // bin / the offending (sku, batch, qty) rows verbatim).
      case 'bin-not-empty':
        return error.detail ?? 'The bin still holds stock — move it out before retiring.';
      case 'bin-retired':
        // The backend's detail names the retired bin (target vs source vs
        // placement) — surface it like the sibling codes do.
        return error.detail ?? 'That bin is retired — retirement is terminal.';
      case 'bin-merge-hold-open':
        return error.detail ?? 'Release the QC hold before merging.';
      // Story 12-4 — a bulk asset (tank, silo) holds exactly ONE SKU; the
      // backend's detail names the bin, its type and the clashing SKUs.
      case 'bin-occupancy-conflict':
        return error.detail ?? 'A bulk asset holds exactly one SKU — the target tank or silo already holds another.';
      // Stories 12-2, 1-6b — the target holds goods the moved stock must be
      // kept apart from (hazard classes, dangerous goods, food, allergens,
      // scheduled drugs); the backend's detail names both SKUs, the facts
      // that fired, the bin and the rule.
      case 'bin-segregation-conflict':
        return error.detail ?? 'The target bin holds goods the moved stock must be kept apart from — choose another bin.';
      case 'bin-full':
        return error.detail ?? 'The target bin is full — pick one with room.';
      case 'bin-blocked':
        return error.detail ?? 'The target bin is blocked — unblock it first.';
      // Story 1-5b — dedicated client bins: the server's detail names the
      // bin, its client and the other client's SKU (merge), or the SKUs a
      // dedication would strand.
      case 'bin-client-mismatch':
        return error.detail ?? 'That bin is dedicated to another client — choose another bin.';
      case 'bin-client-conflict':
        return error.detail ?? "The bin holds another client's stock or QC holds — move them first.";
      case 'client-departed':
        return CLIENT_DEPARTED_REASON;
      default:
        return error.detail ?? `Request failed (${error.code}).`;
    }
  }
  return 'The API is unreachable — is wms-be running?';
}