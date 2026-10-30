'use client';

import { useId, useRef, useState } from 'react';

import { fetchApiCreateFreightLoad, fetchApiUpdateFreightLoad } from '@/lib/api/client';
import type { FreightLoadViewDto } from '@/lib/api/generated';
import {
  EMPTY_FREIGHT_HEADER,
  FREIGHT_LIMITS,
  FREIGHT_MODE_WORD,
  VEHICLE_TYPE_WORD,
  bindFreightKey,
  createLoadBody,
  freightOrderRefusals,
  freightReason,
  headerDraftOf,
  parseFreightHeader,
  type FreightHeaderDraft,
} from '@/lib/freight';
import { FREIGHT_MODES, VEHICLE_TYPES } from '@/lib/freight-primitives';
import { isTransporterRefusal, isoToIstLocal } from '@/lib/gate-ins';
import { notifyOutboundChanged } from '@/lib/outbound';
import { ulid } from '@/lib/ulid';
import { useActiveClient } from '@/lib/use-active-client';
import { useDockDoors } from '@/lib/use-dock-schedule';
import { useTransporterOptions } from '@/lib/use-gate-ins';

import { FeedbackBanner } from '@/components/feedback/banner';
import { FreightCandidatesPicker } from '@/components/outbound/freight-candidates-picker';
import { buttonClass, inputClass, labelClass, primaryClass, ReadFailure, selectClass } from '@/components/outbound/shell';
import { DetailDrawer } from '@/components/shared/detail-drawer';

/**
 * Story 4-9a (A30) — create or edit a load's header: mode, transporter (a
 * transporter partner, or "Not listed — type the name"), the vehicle, the
 * driver, the dock door (2-3b's active doors, or typed), when the vehicle
 * reported, a note; on create, the candidates picker. One key per draft bound
 * to its body; nothing outside unmounts it while in flight.
 */
export function FreightLoadDrawer({
  mode,
  tenantId,
  warehouseId,
  load,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  tenantId: string;
  warehouseId: string;
  load: FreightLoadViewDto | null;
  onClose: () => void;
  onSaved: (load: FreightLoadViewDto) => void;
}) {
  const formId = useId();
  const active = useActiveClient();
  const transporters = useTransporterOptions();
  const doors = useDockDoors(warehouseId);
  const [draft, setDraft] = useState<FreightHeaderDraft>(() => (load === null ? EMPTY_FREIGHT_HEADER : headerDraftOf(load, isoToIstLocal)));
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [problem, setProblem] = useState<string | null>(null);
  const [refused, setRefused] = useState<ReadonlyMap<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const keyRef = useRef<{ key: string; body: string } | null>(null);

  const edit = (patch: Partial<FreightHeaderDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setProblem(null);
  };
  const capacity = /^\d+$/.test(draft.capacityKg.trim()) ? Number(draft.capacityKg.trim()) : null;
  const activeDoors = doors.state === 'ready' ? doors.data.filter((d) => d.active) : [];

  async function submit() {
    if (inFlight.current) return;
    const parsed = parseFreightHeader(draft, Date.now());
    if (parsed.problem !== null) {
      setProblem(parsed.problem);
      return;
    }
    const body = mode === 'create' ? createLoadBody(parsed.body, [...selected].sort()) : parsed.body;
    keyRef.current = bindFreightKey(keyRef.current, body, ulid);
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    setRefused(new Map());
    try {
      const response =
        mode === 'create' || load === null
          ? await fetchApiCreateFreightLoad(tenantId, warehouseId, body, keyRef.current.key)
          : await fetchApiUpdateFreightLoad(tenantId, load.id, body, keyRef.current.key);
      keyRef.current = null;
      notifyOutboundChanged();
      onSaved(response.load);
    } catch (error) {
      const perOrder = freightOrderRefusals(error);
      if (perOrder.size > 0) setRefused(new Map([...perOrder].map(([id, r]) => [id, r.word])));
      if (isTransporterRefusal(error)) transporters.reload();
      setProblem(freightReason(error, mode === 'create' ? 'create' : 'update'));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <DetailDrawer
      title={mode === 'create' ? 'New freight load' : `Edit ${load?.code ?? 'load'}`}
      subtitle="One truck: one transporter, one vehicle, any clients’ orders."
      onClose={onClose}
      closeDisabled={busy}
      testId="freight-load-drawer"
    >
      <form
        id={formId}
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <fieldset className="flex flex-col gap-2" disabled={busy}>
          <legend className={labelClass}>Truck</legend>
          <div className="flex gap-4 text-sm">
            {FREIGHT_MODES.map((m) => (
              <label key={m} className="flex items-center gap-1">
                <input type="radio" name="mode" checked={draft.mode === m} onChange={() => edit({ mode: m })} />
                {FREIGHT_MODE_WORD[m]}
              </label>
            ))}
          </div>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Transporter</span>
            {draft.transporterKind === 'partner' ? (
              <>
                {transporters.state === 'loading' && <span className="text-xs text-(--muted-foreground)">Loading transporters…</span>}
                {transporters.state === 'failed' && <ReadFailure word="Transporters unavailable" reason={transporters.reason} onRetry={transporters.reload} />}
                {transporters.state === 'ready' && (
                  <select className={selectClass} value={draft.transporterId} onChange={(e) => edit({ transporterId: e.target.value })} aria-label="Transporter">
                    <option value="">Pick a transporter…</option>
                    {transporters.data.map((partner) => (
                      <option key={partner.id} value={partner.id}>
                        {partner.name}
                      </option>
                    ))}
                  </select>
                )}
              </>
            ) : (
              <input className={inputClass} aria-label="Transporter name" maxLength={FREIGHT_LIMITS.transporterName} value={draft.transporterName} onChange={(e) => edit({ transporterName: e.target.value })} />
            )}
          </label>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={draft.transporterKind === 'typed'}
              onChange={(e) => edit({ transporterKind: e.target.checked ? 'typed' : 'partner' })}
            />
            Not listed — type the name
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Vehicle type</span>
              <select className={selectClass} value={draft.vehicleType} onChange={(e) => edit({ vehicleType: e.target.value as FreightHeaderDraft['vehicleType'] })}>
                <option value="">—</option>
                {VEHICLE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {VEHICLE_TYPE_WORD[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Vehicle number</span>
              <input className={inputClass} value={draft.vehicleNumber} onChange={(e) => edit({ vehicleNumber: e.target.value })} placeholder="KA01AB1234" />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Container</span>
              <input className={inputClass} value={draft.containerNumber} onChange={(e) => edit({ containerNumber: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Capacity (kg)</span>
              <input className={inputClass} inputMode="numeric" value={draft.capacityKg} onChange={(e) => edit({ capacityKg: e.target.value })} />
            </label>
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-2" disabled={busy}>
          <legend className={labelClass}>Driver and dock</legend>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Driver’s name</span>
              <input className={inputClass} maxLength={FREIGHT_LIMITS.driverName} value={draft.driverName} onChange={(e) => edit({ driverName: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Driver’s phone</span>
              <input className={inputClass} inputMode="tel" value={draft.driverPhone} onChange={(e) => edit({ driverPhone: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Driving licence</span>
              <input className={inputClass} value={draft.driverLicenceNumber} onChange={(e) => edit({ driverLicenceNumber: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Dock door</span>
              <input className={inputClass} list={`${formId}-doors`} value={draft.dockDoor} onChange={(e) => edit({ dockDoor: e.target.value })} />
              <datalist id={`${formId}-doors`}>
                {activeDoors.map((door) => (
                  <option key={door.id} value={door.code}>
                    {door.name ?? door.code}
                  </option>
                ))}
              </datalist>
            </label>
            <label className="flex flex-col gap-1">
              <span className={labelClass}>Vehicle reported at (IST)</span>
              <input type="datetime-local" className={inputClass} value={draft.reportedAt} onChange={(e) => edit({ reportedAt: e.target.value })} />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Note</span>
            <textarea className={inputClass} rows={2} maxLength={FREIGHT_LIMITS.note} value={draft.note} onChange={(e) => edit({ note: e.target.value })} />
          </label>
        </fieldset>
      </form>
      {mode === 'create' && (
        <FreightCandidatesPicker
          warehouseId={warehouseId}
          initialClientId={typeof active.filter === 'string' ? active.filter : null}
          selected={selected}
          onChange={(next) => {
            setSelected(next);
            setRefused(new Map());
            setProblem(null);
          }}
          capacityKg={capacity}
          disabled={busy}
        />
      )}
      {refused.size > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs" role="alert" data-testid="freight-add-refusals">
          {[...refused].map(([orderId, word]) => (
            <li key={orderId}>
              Order …{orderId.slice(-8)}: {word}
            </li>
          ))}
        </ul>
      )}
      {problem !== null && <FeedbackBanner tone="rejected" word={mode === 'create' ? 'Load not created' : 'Load not saved'} reason={problem} />}
      <div className="flex gap-2">
        <button type="submit" form={formId} className={primaryClass} disabled={busy} data-testid="save-freight-load">
          {busy ? 'Saving…' : mode === 'create' ? (selected.size === 0 ? 'Create load' : `Create load with ${selected.size} order${selected.size === 1 ? '' : 's'}`) : 'Save'}
        </button>
        <button type="button" className={buttonClass} onClick={onClose} disabled={busy}>
          Discard
        </button>
      </div>
    </DetailDrawer>
  );
}
