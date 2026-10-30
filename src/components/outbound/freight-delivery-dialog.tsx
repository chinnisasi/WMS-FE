'use client';

import { useEffect, useRef, useState } from 'react';

import { fetchApiRecordFreightDelivery, fetchApiUploadOrderDocument } from '@/lib/api/client';
import type { FreightConsignmentViewDto } from '@/lib/api/generated';
import {
  DELIVERY_OUTCOME_WORD,
  FREIGHT_LIMITS,
  bindFreightKey,
  deliveryDraftOf,
  freightReason,
  parseDeliveryDraft,
  type DeliveryDraft,
} from '@/lib/freight';
import { DELIVERY_OUTCOMES } from '@/lib/freight-primitives';
import { isoToIstLocal } from '@/lib/gate-ins';
import { DOCUMENT_ACCEPT, prepareShippingFile, shippingReason } from '@/lib/shipping';
import { ulid } from '@/lib/ulid';

import { FeedbackBanner } from '@/components/feedback/banner';
import { buttonClass, inputClass, labelClass, primaryClass } from '@/components/outbound/shell';

/**
 * Story 4-9a (A30) — record a consignment's delivery (A17): the outcome, the
 * IST time (not before the departure), the receiver, short and damaged counts
 * (≤ the packages sent), a note, and "Attach the POD" — 4-4a's document
 * upload, kind `pod`, sent after the delivery commits (a second request: a
 * failed upload leaves the delivery recorded and says so). An amendment asks
 * for a reason; the caller offers it only with `orders.manage`.
 */
export function FreightDeliveryDialog({
  tenantId,
  consignment,
  onBusy,
  onDone,
  onClose,
}: {
  tenantId: string;
  consignment: FreightConsignmentViewDto;
  onBusy: (busy: boolean) => void;
  onDone: (outcome: { word: string; reason: string }) => void;
  onClose: () => void;
}) {
  const amending = consignment.delivery !== null;
  const [draft, setDraft] = useState<DeliveryDraft>(() => deliveryDraftOf(consignment.delivery, isoToIstLocal));
  const [pod, setPod] = useState<{ file: File; key: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [recorded, setRecorded] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const keyRef = useRef<{ key: string; body: string } | null>(null);
  const mounted = useRef(true);
  const pickSeq = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const edit = (patch: Partial<DeliveryDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setProblem(null);
  };

  async function pick(file: File | null) {
    const mine = ++pickSeq.current;
    setProblem(null);
    if (file === null) {
      setPod(null);
      return;
    }
    const result = await prepareShippingFile(file);
    if (!mounted.current || mine !== pickSeq.current) return;
    if (!result.ok) {
      setPod(null);
      setProblem(result.problem);
      return;
    }
    setPod({ file: result.file, key: ulid() });
  }

  async function uploadPod(): Promise<boolean> {
    if (pod === null) return true;
    try {
      await fetchApiUploadOrderDocument(tenantId, consignment.orderId, pod.file, 'pod', pod.key);
      return true;
    } catch (error) {
      if (mounted.current) setProblem(`The delivery is recorded, but the POD was not attached — ${shippingReason(error, 'document')} Retry the upload.`);
      return false;
    }
  }

  async function submit() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    onBusy(true);
    setProblem(null);
    try {
      if (!recorded) {
        const parsed = parseDeliveryDraft(draft, { packageCount: consignment.packages.total, dispatchedAt: consignment.dispatchedAt, amending }, Date.now());
        if (parsed.problem !== null) {
          setProblem(parsed.problem);
          return;
        }
        keyRef.current = bindFreightKey(keyRef.current, parsed.body, ulid);
        try {
          await fetchApiRecordFreightDelivery(tenantId, consignment.id, parsed.body, keyRef.current.key);
        } catch (error) {
          setProblem(freightReason(error, 'delivery'));
          return;
        }
        keyRef.current = null;
        setRecorded(true);
      }
      // The POD goes second, after the delivery committed (A17).
      if (!(await uploadPod())) return;
      const word = draft.outcome === '' ? 'Delivery recorded' : `${DELIVERY_OUTCOME_WORD[draft.outcome]} — recorded`;
      onDone({ word, reason: `${consignment.orderLabel}${pod === null ? '' : ' — the POD is attached and emailed to opted-in contacts'}.` });
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
      onBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-2 rounded-sm border border-(--border) p-2"
      aria-label={`Delivery of ${consignment.orderLabel}`}
      data-testid="freight-delivery-dialog"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <fieldset disabled={busy || recorded} className="flex flex-col gap-2">
        <legend className={labelClass}>{amending ? 'Amend the delivery' : 'Record the delivery'}</legend>
        <div className="flex flex-wrap gap-3 text-xs">
          {DELIVERY_OUTCOMES.map((o) => (
            <label key={o} className="flex items-center gap-1">
              <input
                type="radio"
                name={`outcome-${consignment.id}`}
                checked={draft.outcome === o}
                // A clean delivery has no counts: the hidden fields are cleared, never sent stale.
                onChange={() => edit(o === 'delivered' ? { outcome: o, short: '', damaged: '' } : { outcome: o })}
              />
              {DELIVERY_OUTCOME_WORD[o]}
            </label>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Delivered at (IST)</span>
            <input type="datetime-local" className={inputClass} value={draft.deliveredAt} onChange={(e) => edit({ deliveredAt: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Received by</span>
            <input className={inputClass} maxLength={FREIGHT_LIMITS.receiverName} value={draft.receiverName} onChange={(e) => edit({ receiverName: e.target.value })} />
          </label>
          {draft.outcome !== 'delivered' && (
            <>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Short (of {consignment.packages.total})</span>
                <input className={inputClass} inputMode="numeric" value={draft.short} onChange={(e) => edit({ short: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelClass}>Damaged (of {consignment.packages.total})</span>
                <input className={inputClass} inputMode="numeric" value={draft.damaged} onChange={(e) => edit({ damaged: e.target.value })} />
              </label>
            </>
          )}
        </div>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>Note{draft.outcome === 'delivered' ? ' (optional)' : ''}</span>
          <textarea className={inputClass} rows={2} maxLength={FREIGHT_LIMITS.note} value={draft.note} onChange={(e) => edit({ note: e.target.value })} />
        </label>
        {amending && (
          <label className="flex flex-col gap-1">
            <span className={labelClass}>Why amend it</span>
            <input className={inputClass} maxLength={FREIGHT_LIMITS.reason} value={draft.reason} onChange={(e) => edit({ reason: e.target.value })} />
          </label>
        )}
      </fieldset>
      <label className="flex flex-col gap-1">
        <span className={labelClass}>Attach the POD (the signed freight note or the transporter’s POD — optional)</span>
        <input type="file" accept={DOCUMENT_ACCEPT} disabled={busy} onChange={(e) => void pick(e.target.files?.[0] ?? null)} />
      </label>
      {problem !== null && <FeedbackBanner tone="rejected" word={recorded ? 'POD not attached' : 'Delivery not recorded'} reason={problem} />}
      <div className="flex gap-2">
        <button type="submit" className={primaryClass} disabled={busy} data-testid="confirm-delivery">
          {busy ? 'Saving…' : recorded ? 'Retry the POD upload' : amending ? 'Amend delivery' : 'Record delivery'}
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={busy}
          onClick={() =>
            // The delivery committed though the POD did not: closing still refreshes the load.
            recorded ? onDone({ word: 'Delivery recorded', reason: `${consignment.orderLabel} — the POD is not attached; upload it from the order’s Shipping panel.` }) : onClose()
          }
        >
          {recorded ? 'Close' : 'Discard'}
        </button>
      </div>
    </form>
  );
}
