'use client';

import { useRef, useState } from 'react';

import { fetchApiDispatchFreightLoad } from '@/lib/api/client';
import type { FreightLoadViewDto } from '@/lib/api/generated';
import { gateChip } from '@/lib/consignment';
import type { ConsignmentGateState } from '@/lib/consignment-gate';
import {
  FREIGHT_LIMITS,
  FREIGHT_TERMS_WORD,
  VEHICLE_TYPE_WORD,
  addSeal,
  bindFreightKey,
  dispatchOutcome,
  emptyDispatchDraft,
  freightOrderRefusals,
  freightReason,
  loadedWords,
  loadingState,
  membersChanged,
  parseDispatchDraft,
  plannedConsignments,
  rebaseDispatchDraft,
  type DispatchDraft,
  type DispatchRowDraft,
  type FreightOrderRefusal,
} from '@/lib/freight';
import { FREIGHT_TERMS, VEHICLE_TYPES } from '@/lib/freight-primitives';
import { ulid } from '@/lib/ulid';

import { FeedbackBanner } from '@/components/feedback/banner';
import { buttonClass, inputClass, labelClass, primaryClass, rowButtonClass, selectClass } from '@/components/outbound/shell';
import { StatusChip } from '@/components/shared/status-chip';

/**
 * Story 4-9a (A30) — the departure on the web (A14, all or nothing): the
 * vehicle, the driver, the seals (≤ 5, scan or type), the departure time
 * (default now, up to 7 days back), the Part B confirmation when any order
 * carries an e-way bill, the capacity acknowledgement, and per consignment
 * Send / Leave on the dock with its loaded count, its LR and, when partly
 * loaded, an explicit "Send with n unscanned". A `freight-orders-refused`
 * answer marks each row by its code and keeps the draft;
 * `freight-members-changed` re-reads the list and keeps the vehicle fields.
 * One key per draft bound to its body.
 */
export function FreightDispatchDialog({
  tenantId,
  load,
  refresh,
  onBusy,
  onDone,
  onClose,
}: {
  tenantId: string;
  load: FreightLoadViewDto;
  refresh: () => Promise<FreightLoadViewDto | null>;
  onBusy: (busy: boolean) => void;
  onDone: (outcome: { word: string; reason: string }) => void;
  onClose: () => void;
}) {
  // The draft is over the load as it was when opened, rebased on a members change (never silently re-read under the user).
  const [base, setBase] = useState<FreightLoadViewDto>(load);
  const [draft, setDraft] = useState<DispatchDraft>(() => emptyDispatchDraft(load));
  const [sealInput, setSealInput] = useState('');
  const [sealProblem, setSealProblem] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [refused, setRefused] = useState<ReadonlyMap<string, FreightOrderRefusal>>(new Map());
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const keyRef = useRef<{ key: string; body: string } | null>(null);

  const edit = (patch: Partial<DispatchDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setProblem(null);
  };
  const editRow = (orderId: string, patch: Partial<DispatchRowDraft>) => {
    setDraft((d) => ({ ...d, rows: { ...d.rows, [orderId]: { ...d.rows[orderId]!, ...patch } } }));
    setRefused((r) => {
      if (!r.has(orderId)) return r;
      const next = new Map(r);
      next.delete(orderId);
      return next;
    });
    setProblem(null);
  };

  function pushSeal() {
    const next = addSeal(draft.seals, sealInput);
    setSealProblem(next.problem);
    if (next.problem === null) {
      edit({ seals: next.seals });
      setSealInput('');
    }
  }

  async function submit() {
    if (inFlight.current) return;
    const parsed = parseDispatchDraft(draft, base, Date.now());
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
      const response = await fetchApiDispatchFreightLoad(tenantId, base.id, parsed.body, keyRef.current.key);
      keyRef.current = null;
      onDone(dispatchOutcome(response));
    } catch (error) {
      setRefused(freightOrderRefusals(error));
      setProblem(freightReason(error, 'dispatch'));
      if (membersChanged(error)) {
        const fresh = await refresh();
        if (fresh !== null) {
          setBase(fresh);
          setDraft((d) => rebaseDispatchDraft(d, fresh));
        }
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
      onBusy(false);
    }
  }

  const planned = plannedConsignments(base);
  const ewayOrders = planned.filter((c) => c.eway.number !== null);

  return (
    <form
      className="flex flex-col gap-3 rounded-sm border border-(--border) p-2"
      aria-label={`Dispatch ${base.code}`}
      data-testid="freight-dispatch-dialog"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset disabled={busy} className="flex flex-col gap-2">
        <legend className={labelClass}>The truck leaves</legend>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Vehicle number</span>
            <input className={inputClass} value={draft.vehicleNumber} onChange={(e) => edit({ vehicleNumber: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Vehicle type</span>
            <select className={selectClass} value={draft.vehicleType} onChange={(e) => edit({ vehicleType: e.target.value as DispatchDraft['vehicleType'] })}>
              <option value="">—</option>
              {VEHICLE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {VEHICLE_TYPE_WORD[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Container</span>
            <input className={inputClass} value={draft.containerNumber} onChange={(e) => edit({ containerNumber: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Driver’s name</span>
            <input className={inputClass} maxLength={FREIGHT_LIMITS.driverName} value={draft.driverName} onChange={(e) => edit({ driverName: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Driver’s phone</span>
            <input className={inputClass} value={draft.driverPhone} onChange={(e) => edit({ driverPhone: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Driving licence</span>
            <input className={inputClass} value={draft.driverLicenceNumber} onChange={(e) => edit({ driverLicenceNumber: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Departed at (IST — blank for now)</span>
            <input type="datetime-local" className={inputClass} value={draft.departedAt} onChange={(e) => edit({ departedAt: e.target.value })} />
          </label>
        </div>
        <div className="flex flex-col gap-1">
          <span className={labelClass}>Seals (up to {FREIGHT_LIMITS.seals})</span>
          <div className="flex flex-wrap items-center gap-1">
            {draft.seals.map((seal) => (
              <span key={seal} className="flex items-center gap-1 rounded-sm border border-(--border) px-1.5 py-0.5 font-mono text-xs">
                {seal}
                <button type="button" aria-label={`Remove seal ${seal}`} onClick={() => edit({ seals: draft.seals.filter((s) => s !== seal) })}>
                  ×
                </button>
              </span>
            ))}
            <input
              aria-label="Seal number"
              className={`${inputClass} w-40 py-1`}
              value={sealInput}
              placeholder="Scan or type a seal"
              onChange={(e) => setSealInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  pushSeal();
                }
              }}
            />
            <button type="button" className={rowButtonClass} onClick={pushSeal}>
              Add seal
            </button>
          </div>
          {sealProblem !== null && <span className="text-xs text-(--destructive)">{sealProblem}</span>}
        </div>
        {base.partB.required && (
          <label className="flex items-start gap-2 text-xs" data-testid="part-b">
            <input type="checkbox" checked={draft.ewayPartBConfirmed} onChange={(e) => edit({ ewayPartBConfirmed: e.target.checked })} />
            <span>
              I updated Part B of these e-way bills with this vehicle on the e-way portal:{' '}
              {ewayOrders.length === 0 ? 'the orders’ e-way bills' : ewayOrders.map((c) => `${c.orderLabel} EWB ${c.eway.number}`).join(', ')}.
            </span>
          </label>
        )}
        {base.totals.overCapacity && (
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" checked={draft.overCapacityAcknowledged} onChange={(e) => edit({ overCapacityAcknowledged: e.target.checked })} />
            <span>The truck is over its stated capacity — send it anyway (recorded on the sheet).</span>
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Note</span>
          <input className={inputClass} maxLength={FREIGHT_LIMITS.note} value={draft.note} onChange={(e) => edit({ note: e.target.value })} />
        </label>
      </fieldset>
      <fieldset disabled={busy} className="flex flex-col gap-1">
        <legend className={labelClass}>Orders</legend>
        <ul className="flex flex-col divide-y divide-(--border) rounded-sm border border-(--border)">
          {planned.map((c) => {
            const row = draft.rows[c.orderId];
            if (row === undefined) return null;
            const state = loadingState(c.packages);
            const chip = gateChip(c.gate?.state as ConsignmentGateState | undefined);
            const refusal = refused.get(c.orderId);
            return (
              <li key={c.orderId} className="flex flex-col gap-1 px-2 py-1.5 text-xs" data-testid={`dispatch-row-${c.orderLabel}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.orderLabel}</span>
                  <span>{c.clientCode}</span>
                  <span>{c.packages.packed ? loadedWords(c.packages.loaded, c.packages.total) : 'Not packed'}</span>
                  {chip !== null && c.gate?.blocking === true && <StatusChip tone={chip.tone}>{chip.word}</StatusChip>}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1">
                    <input type="radio" name={`decision-${c.orderId}`} checked={row.decision === 'dispatch'} onChange={() => editRow(c.orderId, { decision: 'dispatch' })} />
                    Send
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="radio" name={`decision-${c.orderId}`} checked={row.decision === 'leave'} onChange={() => editRow(c.orderId, { decision: 'leave' })} />
                    Leave on the dock
                  </label>
                  {row.decision === null && <span className="text-(--warning)">Choose one</span>}
                </div>
                {row.decision === 'dispatch' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <input aria-label={`LR of ${c.orderLabel}`} className={`${inputClass} w-36 py-1`} placeholder="LR number" value={row.lrNumber} onChange={(e) => editRow(c.orderId, { lrNumber: e.target.value })} />
                    <input aria-label={`LR date of ${c.orderLabel}`} type="date" className={`${inputClass} w-36 py-1`} value={row.lrDate} onChange={(e) => editRow(c.orderId, { lrDate: e.target.value })} />
                    <select aria-label={`Freight terms of ${c.orderLabel}`} className={`${selectClass} w-32 py-1`} value={row.freightTerms} onChange={(e) => editRow(c.orderId, { freightTerms: e.target.value as DispatchRowDraft['freightTerms'] })}>
                      <option value="">Terms —</option>
                      {FREIGHT_TERMS.map((t) => (
                        <option key={t} value={t}>
                          {FREIGHT_TERMS_WORD[t]}
                        </option>
                      ))}
                    </select>
                    {c.packages.packed && state !== 'full' && (
                      <label className="flex items-center gap-1 text-(--warning)">
                        <input type="checkbox" checked={row.unscannedAcknowledged} onChange={(e) => editRow(c.orderId, { unscannedAcknowledged: e.target.checked })} />
                        Send with {c.packages.total - c.packages.loaded} package{c.packages.total - c.packages.loaded === 1 ? '' : 's'} unscanned
                      </label>
                    )}
                  </div>
                )}
                {refusal !== undefined && (
                  <span role="alert" className="text-(--destructive)" data-testid="dispatch-row-refusal">
                    {refusal.word}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </fieldset>
      {problem !== null && <FeedbackBanner tone="rejected" word="Not dispatched" reason={problem} />}
      <div className="flex gap-2">
        <button type="submit" className={primaryClass} disabled={busy} data-testid="confirm-dispatch">
          {busy ? 'Dispatching…' : `Dispatch ${base.code}`}
        </button>
        <button type="button" className={buttonClass} disabled={busy} onClick={onClose}>
          Discard
        </button>
      </div>
    </form>
  );
}
