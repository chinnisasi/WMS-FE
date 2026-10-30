'use client';

import { useEffect, useRef, useState } from 'react';

import {
  fetchApiAddFreightOrders,
  fetchApiCancelFreightLoad,
  fetchApiFreightLoadingSheet,
  fetchApiFreightNote,
  fetchApiRecordFreightLr,
  fetchApiRecordFreightScan,
  fetchApiRemoveFreightOrder,
  fetchApiReorderFreightStops,
  fetchApiUploadFreightSheet,
  ApiProblem,
} from '@/lib/api/client';
import type { FreightConsignmentViewDto, FreightLoadViewDto, FreightScanResponse } from '@/lib/api/generated';
import { istDateTimeLabel } from '@/lib/audit-exports';
import { cartonCode } from '@/lib/carton-code';
import { COMPLIANCE_EXCEPTION_WORD, gateChip } from '@/lib/consignment';
import type { ConsignmentGateState } from '@/lib/consignment-gate';
import { downloadBlob } from '@/lib/csv';
import {
  CONSIGNMENT_STATUS_WORD,
  DELIVERY_OUTCOME_TONE,
  DELIVERY_OUTCOME_WORD,
  FREIGHT_LIMITS,
  FREIGHT_MODE_WORD,
  FREIGHT_TERMS_WORD,
  LOAD_EXCEPTION_WORD,
  LOAD_STATUS_TONE,
  LOAD_STATUS_WORD,
  VEHICLE_TYPE_WORD,
  bindFreightKey,
  canRecordDelivery,
  cancelledOrderNote,
  capacityCell,
  deliveryLine,
  freightNoteFilename,
  freightOrderRefusals,
  freightReason,
  freightRefusalReloads,
  loadedWords,
  loadingSheetFilename,
  lrDraftOf,
  moveStop,
  packagesWords,
  parseFreightReason,
  parseLrDraft,
  plannedConsignments,
  scanOutcome,
  staleScansNote,
  NO_LOCAL_SCANS,
  applyLocalScans,
  loadedCodesOf,
  loadingOrder,
  recordLocalScan,
  type LocalScans,
  type LrDraft,
} from '@/lib/freight';
import { parsePackageScan } from '@/lib/freight-primitives';
import { FREIGHT_TERMS } from '@/lib/freight-primitives';
import { notifyOutboundChanged } from '@/lib/outbound';
import { parcelTagCode } from '@/lib/parcel-tag';
import { DOCUMENT_ACCEPT, MAX_SHEET_PAGES, prepareShippingFile } from '@/lib/shipping';
import { ulid } from '@/lib/ulid';
import { useFreightLoad } from '@/lib/use-freight';
import { useOrderCartons } from '@/lib/use-outbound-pack-dispatch';

import { FeedbackBanner } from '@/components/feedback/banner';
import { FreightCandidatesPicker } from '@/components/outbound/freight-candidates-picker';
import { FreightDeliveryDialog } from '@/components/outbound/freight-delivery-dialog';
import { FreightDispatchDialog } from '@/components/outbound/freight-dispatch-dialog';
import { FreightLoadDrawer } from '@/components/outbound/freight-load-drawer';
import { buttonClass, inputClass, labelClass, primaryClass, ReadFailure, rowButtonClass, selectClass } from '@/components/outbound/shell';
import { FileList } from '@/components/outbound/shipping-panel';
import { ConfirmRow } from '@/components/settings/confirm-row';
import { DetailDrawer } from '@/components/shared/detail-drawer';
import { StatusChip } from '@/components/shared/status-chip';

type Panel =
  | { readonly kind: 'none' }
  | { readonly kind: 'edit' }
  | { readonly kind: 'add' }
  | { readonly kind: 'stops' }
  | { readonly kind: 'dispatch' }
  | { readonly kind: 'cancel' }
  | { readonly kind: 'lr'; readonly consignmentId: string }
  | { readonly kind: 'delivery'; readonly consignmentId: string }
  | { readonly kind: 'remove'; readonly orderId: string };

const NONE: Panel = { kind: 'none' };

/** The re-read after web scans waits for loading to pause this long. */
const SCAN_REFRESH_PAUSE_MS = 2_000;

/**
 * Story 4-9a (A30) — one load in a detail drawer (`?open=<loadId>`, UI-PATTERNS
 * §3.6): the header facts, the actions (print the loading sheet — a plan
 * while open; edit, add orders, reorder stops, dispatch, cancel; upload the
 * signed sheet), a web scan field (a keyboard-wedge scan loads one package —
 * A13 `surface: web`), and the consignments with their LR, packages, docs,
 * exceptions and delivery. One inline panel at a time (§3.6: never a second
 * modal); while one is in flight nothing else may replace it.
 */
export function FreightLoadDetail({
  tenantId,
  warehouseId,
  loadId,
  canDispatch,
  canManage,
  onBusy,
  onClose,
}: {
  tenantId: string;
  warehouseId: string;
  loadId: string;
  canDispatch: boolean;
  canManage: boolean;
  /** Reports a write in flight to the owner, so nothing outside replaces this drawer meanwhile (guide §2.4). */
  onBusy?: (busy: boolean) => void;
  onClose: () => void;
}) {
  const read = useFreightLoad(loadId);
  const [panel, setPanel] = useState<Panel>(NONE);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    onBusy?.(busy);
  }, [busy, onBusy]);
  // The web's scans since the last read, keyed to the view they apply over (guide §1.5): a re-read drops them.
  const [scans, setScans] = useState<{ base: FreightLoadViewDto | null; local: LocalScans }>({ base: null, local: NO_LOCAL_SCANS });
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      // Leaving with a re-read still owed: the list and other readers catch up now.
      if (refreshTimer.current !== null) {
        clearTimeout(refreshTimer.current);
        notifyOutboundChanged();
      }
    },
    [],
  );
  const readView = read.state === 'ready' ? read.data : null;
  const onScanned = (response: FreightScanResponse) => {
    setScans((prev) => ({ base: readView, local: recordLocalScan(prev.base === readView ? prev.local : NO_LOCAL_SCANS, response) }));
    // One re-read once loading pauses, not one per scan.
    if (refreshTimer.current !== null) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      notifyOutboundChanged();
    }, SCAN_REFRESH_PAUSE_MS);
  };
  const [banner, setBanner] = useState<{ tone: 'accepted' | 'rejected' | 'warning'; word: string; reason: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  if (read.state !== 'ready') {
    return (
      <DetailDrawer title="Freight load" onClose={onClose} testId="freight-load-detail">
        {read.state === 'loading' ? (
          <div className="text-xs text-(--muted-foreground)">Loading the load…</div>
        ) : (
          <ReadFailure word="Load unavailable" reason={read.reason} onRetry={read.reload} />
        )}
      </DetailDrawer>
    );
  }
  const load = scans.base === read.data ? applyLocalScans(read.data, scans.local) : read.data;

  if (panel.kind === 'edit') {
    return (
      <FreightLoadDrawer
        mode="edit"
        tenantId={tenantId}
        warehouseId={warehouseId}
        load={load}
        onClose={() => setPanel(NONE)}
        onSaved={(saved) => {
          setPanel(NONE);
          setBanner({ tone: 'accepted', word: `${saved.code} saved`, reason: 'The truck’s details are updated.' });
        }}
      />
    );
  }

  const isOpen = load.status === 'open';
  const canAct = canDispatch && isOpen && !busy && panel.kind === 'none';
  const planned = plannedConsignments(load);
  const shown = load.consignments.filter((c) => c.status !== 'removed').sort((a, b) => a.stopSeq - b.stopSeq);
  const capacity = capacityCell(load.totals.grossWeightGrams, load.vehicle.capacityKg);
  const done = (outcome: { word: string; reason: string } | null) => {
    setPanel(NONE);
    if (outcome !== null) setBanner({ tone: 'accepted', ...outcome });
    notifyOutboundChanged();
  };
  const rejected = (reason: string, error?: unknown) => {
    setBanner({ tone: 'rejected', word: 'Not done', reason });
    if (error !== undefined && freightRefusalReloads(error)) void read.refresh();
  };

  return (
    <DetailDrawer
      title={`Freight load ${load.code}`}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <StatusChip tone={LOAD_STATUS_TONE[load.status]}>{LOAD_STATUS_WORD[load.status]}</StatusChip>
          <span>{FREIGHT_MODE_WORD[load.mode]}</span>
        </span>
      }
      onClose={onClose}
      closeDisabled={busy}
      testId="freight-load-detail"
    >
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-(--muted-foreground)">Transporter</dt>
        <dd>{load.transporter.name}</dd>
        <dt className="text-(--muted-foreground)">Vehicle</dt>
        <dd>
          <span className="font-mono">{load.vehicle.number ?? 'Not reported yet'}</span>
          {load.vehicle.type !== null && ` · ${VEHICLE_TYPE_WORD[load.vehicle.type]}`}
          {load.vehicle.containerNumber !== null && ` · container ${load.vehicle.containerNumber}`}
          {load.vehicle.reportedAt !== null && ` · reported ${istDateTimeLabel(load.vehicle.reportedAt)} IST`}
        </dd>
        <dt className="text-(--muted-foreground)">Driver</dt>
        <dd>
          {load.driver.name ?? '—'}
          {load.driver.phone !== null && ` · ${load.driver.phone}`}
          {load.driver.licenceNumber !== null && ` · DL ${load.driver.licenceNumber}`}
        </dd>
        <dt className="text-(--muted-foreground)">Dock</dt>
        <dd>{load.dockDoor ?? '—'}</dd>
        <dt className="text-(--muted-foreground)">Seals</dt>
        <dd className="font-mono">{load.seals.length === 0 ? '—' : load.seals.join(', ')}</dd>
        <dt className="text-(--muted-foreground)">Packages</dt>
        <dd data-testid="load-progress">
          {loadedWords(load.totals.loaded, load.totals.packages)} · {packagesWords(load.totals.packages, load.totals.pallets)}
        </dd>
        <dt className="text-(--muted-foreground)">Weight</dt>
        <dd>
          <span className="data">{capacity.text}</span>
          {!load.totals.weightKnown && ' (some packs unweighed)'}
          {(capacity.over || load.capacityExceeded) && (
            <>
              {' '}
              <StatusChip tone="warning">{load.capacityExceeded ? 'Over capacity — acknowledged' : 'Over capacity'}</StatusChip>
            </>
          )}
        </dd>
        {load.loadingStartedAt !== null && (
          <>
            <dt className="text-(--muted-foreground)">Loading started</dt>
            <dd>{istDateTimeLabel(load.loadingStartedAt)} IST</dd>
          </>
        )}
        {load.dispatchedAt !== null && (
          <>
            <dt className="text-(--muted-foreground)">Departed</dt>
            <dd>
              {istDateTimeLabel(load.dispatchedAt)} IST{load.dispatchSource === 'handheld' ? ' · on the handheld' : ''}
            </dd>
            <dt className="text-(--muted-foreground)">E-way Part B</dt>
            <dd>
              {!load.partB.required ? 'No e-way bill on this truck' : load.partB.confirmedAt !== null ? `Confirmed ${istDateTimeLabel(load.partB.confirmedAt)} IST` : <StatusChip tone="warning">Part B not confirmed</StatusChip>}
            </dd>
          </>
        )}
        {load.note !== null && (
          <>
            <dt className="text-(--muted-foreground)">Note</dt>
            <dd>{load.note}</dd>
          </>
        )}
        {load.cancel !== null && (
          <>
            <dt className="text-(--muted-foreground)">Cancelled</dt>
            <dd>
              {istDateTimeLabel(load.cancel.at)} IST — {load.cancel.reason}
            </dd>
          </>
        )}
      </dl>

      <div className="flex flex-wrap gap-2">
        <PrintButton
          label={isOpen ? 'Print loading sheet (plan)' : 'Print loading sheet'}
          disabled={load.status === 'cancelled'}
          fetch={() => fetchApiFreightLoadingSheet(tenantId, load.id)}
          filename={loadingSheetFilename(load)}
          testId="print-loading-sheet"
          onFailed={(reason) => setBanner({ tone: 'rejected', word: 'Not printed', reason })}
        />
        {canDispatch && isOpen && (
          <>
            <button type="button" className={rowButtonClass} disabled={!canAct} onClick={() => setPanel({ kind: 'edit' })}>
              Edit truck
            </button>
            <button type="button" className={rowButtonClass} disabled={!canAct || planned.length >= FREIGHT_LIMITS.consignments} onClick={() => setPanel({ kind: 'add' })} data-testid="add-freight-orders">
              Add orders
            </button>
            <button type="button" className={rowButtonClass} disabled={!canAct || planned.length < 2} onClick={() => setPanel({ kind: 'stops' })}>
              Reorder stops
            </button>
            <button type="button" className={primaryClass} disabled={!canAct || planned.length === 0} onClick={() => setPanel({ kind: 'dispatch' })} data-testid="dispatch-freight-load">
              Dispatch
            </button>
            <button type="button" className={rowButtonClass} disabled={!canAct} onClick={() => setPanel({ kind: 'cancel' })} data-testid="cancel-freight-load">
              Cancel load
            </button>
          </>
        )}
      </div>

      {banner !== null && <FeedbackBanner tone={banner.tone} word={banner.word} reason={banner.reason} />}

      {panel.kind === 'cancel' && (
        <CancelLoad
          load={load}
          onDone={() => done({ word: `${load.code} cancelled`, reason: 'Its orders are back on the dock, unchanged.' })}
          onRejected={rejected}
          onClose={() => setPanel(NONE)}
        />
      )}
      {panel.kind === 'add' && (
        <AddOrders
          tenantId={tenantId}
          warehouseId={warehouseId}
          load={load}
          onBusy={setBusy}
          onDone={(n) => done({ word: `${n} order${n === 1 ? '' : 's'} added`, reason: `On ${load.code}.` })}
          onClose={() => setPanel(NONE)}
        />
      )}
      {panel.kind === 'stops' && (
        <ReorderStops
          // Keyed on the planned set: a members change re-read reseeds the order (never a stale list).
          key={planned.map((c) => c.orderId).join(',')}
          tenantId={tenantId}
          load={load}
          onBusy={setBusy}
          onDone={() => done({ word: 'Stops saved', reason: 'The loading sheet loads the last stop first.' })}
          onClose={() => setPanel(NONE)}
          onStale={() => void read.refresh()}
        />
      )}
      {panel.kind === 'dispatch' && (
        <FreightDispatchDialog
          tenantId={tenantId}
          load={load}
          refresh={read.refresh}
          onBusy={setBusy}
          onDone={(outcome) => done(outcome)}
          onClose={() => setPanel(NONE)}
        />
      )}

      {canDispatch && isOpen && panel.kind === 'none' && <ScanField tenantId={tenantId} load={load} onScanned={onScanned} />}

      <div className="flex flex-col gap-1">
        <div className="font-medium">Consignments</div>
        {shown.length === 0 && <div className="text-xs text-(--muted-foreground)">No order is on this load — add orders to plan it.</div>}
        <ul className="flex flex-col divide-y divide-(--border) rounded-sm border border-(--border)">
          {shown.map((c) => (
            <ConsignmentRow
              key={c.id}
              tenantId={tenantId}
              load={load}
              consignment={c}
              expanded={expanded === c.id}
              onToggle={() => setExpanded((id) => (id === c.id ? null : c.id))}
              panel={panel}
              setPanel={setPanel}
              canDispatch={canDispatch}
              canManage={canManage}
              idle={!busy && panel.kind === 'none'}
              onBusy={setBusy}
              onScanned={onScanned}
              onStale={() => void read.refresh()}
              done={done}
              rejected={rejected}
            />
          ))}
        </ul>
      </div>

      {load.removed.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer">Removed from the load ({load.removed.length})</summary>
          <ul className="mt-1 flex flex-col gap-0.5">
            {load.removed.map((r) => (
              <li key={`${r.orderId}-${r.removedAt}`}>
                {r.orderLabel} — {r.reason} ({istDateTimeLabel(r.removedAt)} IST)
              </li>
            ))}
          </ul>
        </details>
      )}

      {load.status !== 'cancelled' && (
        <div className="flex flex-col gap-2">
          <div className="font-medium">Signed loading sheet</div>
          {load.sheet.length === 0 ? (
            <div className="text-xs text-(--muted-foreground)">Not uploaded yet — the driver signs the printed sheet at departure.</div>
          ) : (
            <FileList files={load.sheet} tenantId={tenantId} canRemove={canManage} onExpired={async () => void (await read.refresh())} />
          )}
          {canDispatch && load.sheet.length < MAX_SHEET_PAGES && <SheetUpload tenantId={tenantId} loadId={load.id} />}
        </div>
      )}
    </DetailDrawer>
  );
}

/** One consignment: its facts, its row actions (LR, delivery, freight note, remove) and its packages when expanded. */
function ConsignmentRow({
  tenantId,
  load,
  consignment: c,
  expanded,
  onToggle,
  panel,
  setPanel,
  canDispatch,
  canManage,
  idle,
  onBusy,
  onScanned,
  onStale,
  done,
  rejected,
}: {
  tenantId: string;
  load: FreightLoadViewDto;
  consignment: FreightConsignmentViewDto;
  expanded: boolean;
  onToggle: () => void;
  panel: Panel;
  setPanel: (panel: Panel) => void;
  canDispatch: boolean;
  canManage: boolean;
  idle: boolean;
  onBusy: (busy: boolean) => void;
  onScanned: (response: FreightScanResponse) => void;
  onStale: () => void;
  done: (outcome: { word: string; reason: string } | null) => void;
  rejected: (reason: string, error?: unknown) => void;
}) {
  const chip = c.status === 'planned' ? gateChip(c.gate?.state as ConsignmentGateState | undefined) : null;
  const stale = staleScansNote(c.packages);
  const cancelled = cancelledOrderNote(c);
  const planned = c.status === 'planned' && load.status === 'open';
  return (
    <li className="flex flex-col gap-1 px-2 py-1.5 text-xs" data-testid={`consignment-${c.orderLabel}`}>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex items-center gap-1 underline-offset-2 hover:underline">
          <span aria-hidden className="text-(--muted-foreground)">
            {expanded ? '▾' : '▸'}
          </span>
          <span className="font-mono">{String(c.stopSeq).padStart(2, '0')}</span>
          <span className="font-medium">{c.orderLabel}</span>
        </button>
        <span>{c.clientCode}</span>
        <span className="text-(--muted-foreground)">{[c.consignee.name, c.consignee.city, c.consignee.pincode].filter((v) => v !== null && v !== '').join(', ')}</span>
        {c.status === 'dispatched' && <StatusChip tone="success">{CONSIGNMENT_STATUS_WORD.dispatched}</StatusChip>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span data-testid="consignment-progress">{c.packages.packed ? loadedWords(c.packages.loaded, c.packages.total) : 'Not packed yet'}</span>
        {c.packages.packed && <span className="text-(--muted-foreground)">{packagesWords(c.packages.total, c.packages.pallets)}</span>}
        <span>
          LR {c.lr.number === null ? '—' : <span className="font-mono">{c.lr.number}</span>}
          {c.lr.date !== null && ` · ${c.lr.date}`}
          {c.lr.terms !== null && ` · ${FREIGHT_TERMS_WORD[c.lr.terms]}`}
        </span>
        {chip !== null && <StatusChip tone={chip.tone}>{chip.word}</StatusChip>}
        {c.eway.number !== null && <span>EWB {c.eway.number}</span>}
        {c.loadException !== null && <StatusChip tone="warning">{LOAD_EXCEPTION_WORD[c.loadException]}</StatusChip>}
        {c.complianceException !== null && <StatusChip tone="danger">{COMPLIANCE_EXCEPTION_WORD[c.complianceException]}</StatusChip>}
        {c.delivery !== null && <StatusChip tone={DELIVERY_OUTCOME_TONE[c.delivery.outcome]}>{DELIVERY_OUTCOME_WORD[c.delivery.outcome]}</StatusChip>}
      </div>
      {stale !== null && <div className="text-(--warning)">{stale}</div>}
      {cancelled !== null && <div className="text-(--warning)">{cancelled}</div>}
      {c.delivery !== null && <div data-testid="consignment-delivery">{deliveryLine(c.delivery)}</div>}
      <div className="flex flex-wrap gap-2">
        {canDispatch && c.status !== 'removed' && load.status !== 'cancelled' && (
          <button type="button" className={rowButtonClass} disabled={!idle} onClick={() => setPanel({ kind: 'lr', consignmentId: c.id })}>
            {c.lr.number === null ? 'Record LR' : 'Change LR'}
          </button>
        )}
        {canRecordDelivery(c, canDispatch, canManage) && (
          <button type="button" className={rowButtonClass} disabled={!idle} onClick={() => setPanel({ kind: 'delivery', consignmentId: c.id })} data-testid={`record-delivery-${c.orderLabel}`}>
            {c.delivery === null ? 'Record delivery' : 'Amend delivery'}
          </button>
        )}
        {c.status === 'dispatched' && (
          <PrintButton
            label="Print freight note"
            fetch={() => fetchApiFreightNote(tenantId, c.id)}
            filename={freightNoteFilename(c.consignmentRef)}
            testId={`print-note-${c.orderLabel}`}
            onFailed={(reason) => rejected(reason)}
          />
        )}
        {canDispatch && planned && (
          <button type="button" className={rowButtonClass} disabled={!idle} onClick={() => setPanel({ kind: 'remove', orderId: c.orderId })}>
            Remove
          </button>
        )}
      </div>
      {panel.kind === 'lr' && panel.consignmentId === c.id && (
        <LrForm tenantId={tenantId} consignment={c} onBusy={onBusy} onStale={onStale} onDone={() => done({ word: 'LR saved', reason: `${c.orderLabel}.` })} onClose={() => setPanel(NONE)} />
      )}
      {panel.kind === 'delivery' && panel.consignmentId === c.id && (
        <FreightDeliveryDialog
          tenantId={tenantId}
          consignment={c}
          onBusy={onBusy}
          onDone={(outcome) => done(outcome)}
          onClose={() => setPanel(NONE)}
        />
      )}
      {panel.kind === 'remove' && panel.orderId === c.orderId && (
        <RemoveOrder load={load} consignment={c} onDone={() => done({ word: `${c.orderLabel} removed`, reason: 'It is back on the dock — hand it over, dispatch it or plan it again.' })} onRejected={rejected} onClose={() => setPanel(NONE)} />
      )}
      {expanded && <PackageList tenantId={tenantId} load={load} consignment={c} canLoad={canDispatch && planned && idle} onBusy={onBusy} onScanned={onScanned} />}
    </li>
  );
}

/** The expanded row (A30): each package of the live pack with its loaded state, Load, and Unload with a reason. */
function PackageList({
  tenantId,
  load,
  consignment,
  canLoad,
  onBusy,
  onScanned,
}: {
  tenantId: string;
  load: FreightLoadViewDto;
  consignment: FreightConsignmentViewDto;
  canLoad: boolean;
  onBusy: (busy: boolean) => void;
  onScanned: (response: FreightScanResponse) => void;
}) {
  const cartons = useOrderCartons(tenantId, consignment.packages.packed ? consignment.orderId : null);
  if (!consignment.packages.packed) return <div className="text-(--muted-foreground)">Not packed yet — pack it, print its labels, then load.</div>;
  if (cartons.state === 'loading') return <div className="text-(--muted-foreground)">Loading the packages…</div>;
  if (cartons.state === 'failed') return <ReadFailure word="Packages unavailable" reason={cartons.reason} onRetry={cartons.reload} />;
  const pack = cartons.data?.pack ?? null;
  const loadedCodes = loadedCodesOf(consignment);
  // A virtual pack (4-5a A9) is one package: the bare parcel tag resolves to `.{packSeq}.1`.
  const codes =
    pack === null || pack.cartons.length === 0
      ? [{ code: pack === null ? `${parcelTagCode(consignment.orderId)}` : cartonCode(consignment.orderId, pack.packSeq, 1), label: 'Package 1 of 1' }]
      : pack.cartons.map((carton) => ({
          code: carton.code,
          label: `${carton.type === 'pallet' ? 'Pallet' : 'Carton'} ${carton.seq} of ${pack.cartons.length}${carton.innerCount != null ? ` — STC ${carton.innerCount} cartons` : ''}`,
        }));
  return (
    <ul className="ml-4 flex flex-col gap-1" data-testid="freight-packages">
      {codes.map((entry) => (
        <PackageTick
          key={entry.code}
          tenantId={tenantId}
          loadId={load.id}
          code={entry.code}
          label={entry.label}
          loaded={loadedCodes === null ? null : loadedCodes.has(entry.code)}
          canLoad={canLoad}
          onBusy={onBusy}
          onScanned={onScanned}
        />
      ))}
    </ul>
  );
}

function PackageTick({
  tenantId,
  loadId,
  code,
  label,
  loaded,
  canLoad,
  onBusy,
  onScanned,
}: {
  tenantId: string;
  loadId: string;
  code: string;
  label: string;
  /** From the view's `loadedCodes`; null when an older API does not say. */
  loaded: boolean | null;
  canLoad: boolean;
  onBusy: (busy: boolean) => void;
  onScanned: (response: FreightScanResponse) => void;
}) {
  const [unloading, setUnloading] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ tone: 'accepted' | 'rejected' | 'warning'; text: string } | null>(null);
  const inFlight = useRef(false);
  const keyRef = useRef<{ key: string; body: string } | null>(null);

  async function send(action: 'load' | 'unload') {
    if (inFlight.current) return;
    let body: { packageCode: string; action: 'load' | 'unload'; reason?: string } = { packageCode: code, action };
    if (action === 'unload') {
      const parsed = parseFreightReason(reason);
      if (parsed.problem !== null) {
        setAnswer({ tone: 'rejected', text: parsed.problem });
        return;
      }
      body = { ...body, reason: parsed.reason };
    }
    keyRef.current = bindFreightKey(keyRef.current, body, ulid);
    inFlight.current = true;
    setBusy(true);
    onBusy(true);
    try {
      const response = await fetchApiRecordFreightScan(tenantId, loadId, body, keyRef.current.key);
      keyRef.current = null;
      const outcome = scanOutcome(response, null);
      setAnswer({ tone: outcome.tone, text: `${outcome.word} — ${outcome.reason}` });
      setUnloading(false);
      setReason('');
      onScanned(response);
    } catch (error) {
      setAnswer({ tone: 'rejected', text: freightReason(error, 'scan') });
    } finally {
      inFlight.current = false;
      setBusy(false);
      onBusy(false);
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-2" data-testid={`package-${code}`}>
      <span className="font-mono">{code}</span>
      <span className="text-(--muted-foreground)">{label}</span>
      {loaded !== null && <StatusChip tone={loaded ? 'success' : 'neutral'}>{loaded ? 'Loaded' : 'Not loaded'}</StatusChip>}
      {canLoad && (
        <>
          {loaded !== true && (
            <button type="button" className={rowButtonClass} disabled={busy} onClick={() => void send('load')} data-testid={`load-${code}`}>
              Load
            </button>
          )}
          {loaded !== false &&
            (!unloading ? (
              <button type="button" className={rowButtonClass} disabled={busy} onClick={() => setUnloading(true)}>
                Unload…
              </button>
            ) : (
              <span className="flex items-center gap-1">
                <input aria-label={`Why unload ${code}`} className={`${inputClass} py-1`} maxLength={FREIGHT_LIMITS.reason} value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />
                <button type="button" className={rowButtonClass} disabled={busy} onClick={() => void send('unload')}>
                  Unload
                </button>
                <button type="button" className={rowButtonClass} disabled={busy} onClick={() => setUnloading(false)}>
                  Keep
                </button>
              </span>
            ))}
        </>
      )}
      {answer !== null && (
        <span role={answer.tone === 'rejected' ? 'alert' : 'status'} className={answer.tone === 'rejected' ? 'text-(--destructive)' : answer.tone === 'warning' ? 'text-(--warning)' : ''}>
          {answer.text}
        </span>
      )}
    </li>
  );
}

/**
 * The web scan field (A13, `surface: web`): a keyboard-wedge scan loads one
 * package. Codes are queued — a scan arriving while one is in flight is kept
 * and sent next, never dropped or joined to the next text — and the field
 * clears and keeps focus after every Enter (guide §2.7). Each code is judged
 * locally first (`parsePackageScan`): an unreadable code or the bare parcel
 * tag of a multi-package order is refused here with no request. One key per
 * scan (each scan is its own intent; the server's already-loaded no-op makes
 * a duplicate harmless).
 */
function ScanField({ tenantId, load, onScanned }: { tenantId: string; load: FreightLoadViewDto; onScanned: (response: FreightScanResponse) => void }) {
  const [value, setValue] = useState('');
  const [answer, setAnswer] = useState<{ tone: 'accepted' | 'rejected' | 'warning'; word: string; reason: string } | null>(null);
  const queue = useRef<string[]>([]);
  const draining = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const planned = plannedConsignments(load);
  const labels = new Map(load.consignments.map((c) => [c.orderId, c.orderLabel]));
  const byTag = new Map(planned.map((c) => [parcelTagCode(c.orderId), c]));

  async function one(raw: string) {
    const code = raw.trim().toUpperCase();
    const parsed = parsePackageScan(code, (tag) => {
      const c = byTag.get(tag);
      return c === undefined ? undefined : { packSeq: 1, packageCount: c.packages.total };
    });
    if (parsed.kind === 'invalid') {
      setAnswer({ tone: 'rejected', word: `${code} not loaded`, reason: 'This is not a package label. Scan the carton or pallet label.' });
      return;
    }
    if (parsed.kind === 'ambiguous') {
      const c = byTag.get(parsed.parcelTag);
      setAnswer({
        tone: 'rejected',
        word: `${code} not loaded`,
        reason: `This is ${c?.orderLabel ?? 'the order'}’s parcel tag and it has ${parsed.packageCount} packages. Scan each carton or pallet label.`,
      });
      return;
    }
    // A full package code goes canonical; a bare tag goes as scanned (the server resolves its live pack).
    const packageCode = parsed.kind === 'package' && parsed.parcelTag !== code ? parsed.code : code;
    try {
      const response = await fetchApiRecordFreightScan(tenantId, load.id, { packageCode, action: 'load' }, ulid());
      setAnswer(scanOutcome(response, labels.get(response.scan.orderId) ?? null));
      onScanned(response);
    } catch (error) {
      setAnswer({ tone: 'rejected', word: `${code} not loaded`, reason: freightReason(error, 'scan') });
    }
  }

  async function submit() {
    const code = value.trim();
    setValue('');
    inputRef.current?.focus();
    if (code === '') return;
    queue.current.push(code);
    if (draining.current) return;
    draining.current = true;
    try {
      while (queue.current.length > 0) await one(queue.current.shift()!);
    } finally {
      draining.current = false;
      inputRef.current?.focus();
    }
  }

  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Scan a package onto the truck</span>
        <input
          ref={inputRef}
          className={inputClass}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Scan a carton or pallet label"
          autoComplete="off"
          data-testid="freight-scan"
        />
      </label>
      {answer !== null && <FeedbackBanner tone={answer.tone} word={answer.word} reason={answer.reason} />}
    </form>
  );
}

function PrintButton({
  label,
  fetch,
  filename,
  testId,
  disabled = false,
  onFailed,
}: {
  label: string;
  fetch: () => Promise<Blob>;
  filename: string;
  testId: string;
  disabled?: boolean;
  onFailed: (reason: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  return (
    <button
      type="button"
      className={rowButtonClass}
      disabled={disabled || busy}
      data-testid={testId}
      onClick={async () => {
        if (inFlight.current) return;
        inFlight.current = true;
        setBusy(true);
        try {
          downloadBlob(filename, await fetch());
        } catch (error) {
          onFailed(freightReason(error, 'print'));
        } finally {
          inFlight.current = false;
          setBusy(false);
        }
      }}
    >
      {busy ? 'Preparing…' : label}
    </button>
  );
}

function CancelLoad({
  load,
  onDone,
  onRejected,
  onClose,
}: {
  load: FreightLoadViewDto;
  onDone: () => void;
  onRejected: (reason: string, error?: unknown) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const parsed = parseFreightReason(reason);
  return (
    <ConfirmRow
      question={`Cancel ${load.code}? Its orders go back to the dock, unchanged.`}
      confirmLabel="Cancel load"
      keepLabel="Keep load"
      ariaLabel={`Cancel ${load.code}`}
      fields={<input aria-label="Why cancel the load" className={`${inputClass} py-1`} maxLength={FREIGHT_LIMITS.reason} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />}
      draft={reason}
      confirmDisabled={parsed.problem !== null}
      run={(key, tenantId) => fetchApiCancelFreightLoad(tenantId, load.id, parsed.reason ?? '', key)}
      reason={(error) => freightReason(error, 'cancel')}
      onDone={onDone}
      onRejected={onRejected}
      onClose={onClose}
    />
  );
}

function RemoveOrder({
  load,
  consignment,
  onDone,
  onRejected,
  onClose,
}: {
  load: FreightLoadViewDto;
  consignment: FreightConsignmentViewDto;
  onDone: () => void;
  onRejected: (reason: string, error?: unknown) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const parsed = parseFreightReason(reason);
  return (
    <ConfirmRow
      question={`Take ${consignment.orderLabel} off ${load.code}? Its loaded packages are unloaded.`}
      confirmLabel="Remove"
      ariaLabel={`Remove ${consignment.orderLabel}`}
      fields={<input aria-label="Why remove it" className={`${inputClass} py-1`} maxLength={FREIGHT_LIMITS.reason} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" />}
      draft={reason}
      confirmDisabled={parsed.problem !== null}
      run={(key, tenantId) => fetchApiRemoveFreightOrder(tenantId, load.id, consignment.orderId, parsed.reason ?? '', key)}
      reason={(error) => freightReason(error, 'remove')}
      onDone={onDone}
      onRejected={onRejected}
      onClose={onClose}
    />
  );
}

/** Add orders (A10): the candidates picker, all or nothing; a refusal marks each order and keeps the selection. */
function AddOrders({
  tenantId,
  warehouseId,
  load,
  onBusy,
  onDone,
  onClose,
}: {
  tenantId: string;
  warehouseId: string;
  load: FreightLoadViewDto;
  onBusy: (busy: boolean) => void;
  onDone: (count: number) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [labels, setLabels] = useState<ReadonlyMap<string, string>>(new Map());
  const [problem, setProblem] = useState<string | null>(null);
  const [refused, setRefused] = useState<ReadonlyMap<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const keyRef = useRef<{ key: string; body: string } | null>(null);
  const live = load.consignments.filter((c) => c.status === 'planned').length;

  async function submit() {
    if (inFlight.current || selected.size === 0) return;
    const orderIds = [...selected].sort();
    keyRef.current = bindFreightKey(keyRef.current, orderIds, ulid);
    inFlight.current = true;
    setBusy(true);
    onBusy(true);
    setProblem(null);
    try {
      await fetchApiAddFreightOrders(tenantId, load.id, orderIds, keyRef.current.key);
      keyRef.current = null;
      onDone(orderIds.length);
    } catch (error) {
      setRefused(new Map([...freightOrderRefusals(error)].map(([id, r]) => [id, r.word])));
      setProblem(freightReason(error, 'add'));
    } finally {
      inFlight.current = false;
      setBusy(false);
      onBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-sm border border-(--border) p-2">
      <FreightCandidatesPicker
        warehouseId={warehouseId}
        initialClientId={null}
        selected={selected}
        onChange={(next, nextLabels) => {
          setSelected(next);
          setLabels(nextLabels);
          setRefused(new Map());
          setProblem(null);
        }}
        refused={refused}
        capacityKg={load.vehicle.capacityKg}
        disabled={busy}
        maxSelectable={FREIGHT_LIMITS.consignments - live}
      />
      {refused.size > 0 && (
        <ul className="text-xs" role="alert">
          {[...refused].map(([orderId, word]) => (
            <li key={orderId}>
              {labels.get(orderId) ?? `Order …${orderId.slice(-8)}`}: {word}
            </li>
          ))}
        </ul>
      )}
      {problem !== null && <FeedbackBanner tone="rejected" word="Orders not added" reason={problem} />}
      <div className="flex gap-2">
        <button type="button" className={primaryClass} disabled={busy || selected.size === 0} onClick={() => void submit()} data-testid="confirm-add-orders">
          {busy ? 'Adding…' : `Add ${selected.size} order${selected.size === 1 ? '' : 's'}`}
        </button>
        <button type="button" className={buttonClass} disabled={busy} onClick={onClose}>
          Discard
        </button>
      </div>
    </div>
  );
}

/** Reorder stops (A12): up/down per row, saved as one call; the loading order is the reverse. */
function ReorderStops({
  tenantId,
  load,
  onBusy,
  onDone,
  onClose,
  onStale,
}: {
  tenantId: string;
  load: FreightLoadViewDto;
  onBusy: (busy: boolean) => void;
  onDone: () => void;
  onClose: () => void;
  onStale: () => void;
}) {
  const [order, setOrder] = useState(() => plannedConsignments(load).map((c) => ({ orderId: c.orderId, label: c.orderLabel, client: c.clientCode, city: c.consignee.city })));
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const keyRef = useRef<{ key: string; body: string } | null>(null);

  async function save() {
    if (inFlight.current) return;
    const orderIds = order.map((o) => o.orderId);
    keyRef.current = bindFreightKey(keyRef.current, orderIds, ulid);
    inFlight.current = true;
    setBusy(true);
    onBusy(true);
    setProblem(null);
    try {
      await fetchApiReorderFreightStops(tenantId, load.id, orderIds, keyRef.current.key);
      keyRef.current = null;
      onDone();
    } catch (error) {
      setProblem(freightReason(error, 'stops'));
      if (freightRefusalReloads(error)) onStale();
    } finally {
      inFlight.current = false;
      setBusy(false);
      onBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-sm border border-(--border) p-2 text-xs">
      <div className="text-(--muted-foreground)">Delivery order — stop 1 is the first drop.</div>
      <ol className="flex flex-col gap-1">
        {order.map((o, index) => (
          <li key={o.orderId} className="flex items-center gap-2">
            <span className="font-mono">{String(index + 1).padStart(2, '0')}</span>
            <span className="font-medium">{o.label}</span>
            <span>{o.client}</span>
            <span className="text-(--muted-foreground)">{o.city ?? ''}</span>
            <button type="button" className={rowButtonClass} disabled={busy || index === 0} onClick={() => setOrder(moveStop(order, index, -1))} aria-label={`Move ${o.label} up`}>
              ↑
            </button>
            <button type="button" className={rowButtonClass} disabled={busy || index === order.length - 1} onClick={() => setOrder(moveStop(order, index, 1))} aria-label={`Move ${o.label} down`}>
              ↓
            </button>
          </li>
        ))}
      </ol>
      <div className="text-(--muted-foreground)" data-testid="loading-order">
        Load from the bottom up — last stop first: {loadingOrder(order.map((o, index) => ({ ...o, stopSeq: index + 1 }))).map((o) => o.label).join(', ')}
      </div>
      {problem !== null && <FeedbackBanner tone="rejected" word="Stops not saved" reason={problem} />}
      <div className="flex gap-2">
        <button type="button" className={primaryClass} disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save stops'}
        </button>
        <button type="button" className={buttonClass} disabled={busy} onClick={onClose}>
          Discard
        </button>
      </div>
    </div>
  );
}

/** Record or change the LR (A16): a reason after departure; one key per draft bound to its body. */
function LrForm({
  tenantId,
  consignment,
  onBusy,
  onStale,
  onDone,
  onClose,
}: {
  tenantId: string;
  consignment: FreightConsignmentViewDto;
  onBusy: (busy: boolean) => void;
  /** The world moved (the truck left meanwhile): re-read, so `dispatched` — and the reason field — follow the fresh consignment. */
  onStale: () => void;
  onDone: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<LrDraft>(() => lrDraftOf(consignment));
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const keyRef = useRef<{ key: string; body: string } | null>(null);
  const dispatched = consignment.status === 'dispatched';

  async function submit() {
    if (inFlight.current) return;
    const parsed = parseLrDraft(draft, consignment, Date.now());
    if (parsed.problem !== null) {
      setProblem(parsed.problem);
      return;
    }
    keyRef.current = bindFreightKey(keyRef.current, parsed.body, ulid);
    inFlight.current = true;
    setBusy(true);
    onBusy(true);
    setProblem(null);
    try {
      await fetchApiRecordFreightLr(tenantId, consignment.id, parsed.body, keyRef.current.key);
      keyRef.current = null;
      onDone();
    } catch (error) {
      setProblem(freightReason(error, 'lr'));
      if (freightRefusalReloads(error) || (error instanceof ApiProblem && error.code === 'validation-failed')) onStale();
    } finally {
      inFlight.current = false;
      setBusy(false);
      onBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-2 rounded-sm border border-(--border) p-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      aria-label={`LR of ${consignment.orderLabel}`}
    >
      <fieldset disabled={busy} className="grid grid-cols-3 gap-2">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>LR number</span>
          <input className={inputClass} value={draft.lrNumber} onChange={(e) => setDraft({ ...draft, lrNumber: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>LR date</span>
          <input type="date" className={inputClass} value={draft.lrDate} onChange={(e) => setDraft({ ...draft, lrDate: e.target.value })} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Freight terms</span>
          <select className={selectClass} value={draft.freightTerms} onChange={(e) => setDraft({ ...draft, freightTerms: e.target.value as LrDraft['freightTerms'] })}>
            <option value="">—</option>
            {FREIGHT_TERMS.map((t) => (
              <option key={t} value={t}>
                {FREIGHT_TERMS_WORD[t]}
              </option>
            ))}
          </select>
        </label>
        {dispatched && (
          <label className="col-span-3 flex flex-col gap-1">
            <span className={labelClass}>Why change it after departure</span>
            <input className={inputClass} maxLength={FREIGHT_LIMITS.reason} value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} />
          </label>
        )}
      </fieldset>
      {problem !== null && <FeedbackBanner tone="rejected" word="LR not saved" reason={problem} />}
      <div className="flex gap-2">
        <button type="submit" className={primaryClass} disabled={busy}>
          {busy ? 'Saving…' : 'Save LR'}
        </button>
        <button type="button" className={buttonClass} disabled={busy} onClick={onClose}>
          Discard
        </button>
      </div>
    </form>
  );
}

/** A18 — one page of the signed loading sheet; the key belongs to the prepared file (guide §2.3). */
function SheetUpload({ tenantId, loadId }: { tenantId: string; loadId: string }) {
  const [prepared, setPrepared] = useState<{ file: File; key: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mounted = useRef(true);
  const pickSeq = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function onPick(picked: File | null) {
    const mine = ++pickSeq.current;
    setProblem(null);
    setOutcome(null);
    if (picked === null) {
      setPrepared(null);
      return;
    }
    const result = await prepareShippingFile(picked);
    if (!mounted.current || mine !== pickSeq.current) return;
    if (!result.ok) {
      setPrepared(null);
      setProblem(result.problem);
      return;
    }
    setPrepared({ file: result.file, key: ulid() });
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    if (prepared === null) {
      setProblem('Choose the photo or scan of the signed loading sheet.');
      return;
    }
    inFlight.current = true;
    setPending(true);
    setProblem(null);
    try {
      await fetchApiUploadFreightSheet(tenantId, loadId, prepared.file, prepared.key);
      notifyOutboundChanged();
      if (!mounted.current) return;
      setOutcome('Sheet page attached — it stays with the warehouse (a loading sheet is never sent to a client).');
      setPrepared(null);
      if (inputRef.current !== null) inputRef.current.value = '';
    } catch (caught) {
      if (mounted.current) setProblem(freightReason(caught, 'sheet'));
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2" data-testid="freight-sheet-upload">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Signed sheet page (photo or PDF, ≤ 10 MB)</span>
          <input ref={inputRef} type="file" accept={DOCUMENT_ACCEPT} onChange={(e) => void onPick(e.target.files?.[0] ?? null)} />
        </label>
        <button type="submit" disabled={pending} className={buttonClass}>
          {pending ? 'Uploading…' : 'Upload signed sheet'}
        </button>
      </div>
      {outcome !== null && <FeedbackBanner tone="accepted" word="Attached" reason={outcome} />}
      {problem !== null && <FeedbackBanner tone="rejected" word="Not attached" reason={problem} />}
    </form>
  );
}
