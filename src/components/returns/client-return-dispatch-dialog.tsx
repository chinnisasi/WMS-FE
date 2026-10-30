'use client';

import { useEffect, useRef, useState } from 'react';

import { fetchApiDispatchClientReturn } from '@/lib/api/client';
import type { ClientReturnDto } from '@/lib/api/generated';
import { readSession } from '@/lib/auth';
import {
  RTC_DECLARED_BY_CONSIGNOR,
  RTC_SUSPENDED_WARNING,
  advisedBrandDocument,
  emptyRtcDispatchExtra,
  keyForBody,
  parseRtcDispatch,
  rtcReason,
  rtcRefusalReloads,
  rtcTransporterRefusal,
  type RtcDispatchExtra,
  type RtcExtraField,
} from '@/lib/client-returns';
import {
  brandDocumentDateWindow,
  consignorStateWarning,
  emptyConsignmentDraft,
  type ConsignmentDraft,
  type ConsignmentField,
} from '@/lib/consignment-capture';
import { formatCount } from '@/lib/format-quantity';
import { ulid } from '@/lib/ulid';
import { useTransporterOptions } from '@/lib/use-gate-ins';

import { FeedbackBanner } from '@/components/feedback/banner';
import { Field } from '@/components/shared/field';
import { ReturnDispatchForm, type TransporterChoices } from '@/components/shared/return-dispatch-form';
import { inputClass } from '@/components/shared/surface';

const legendClass = 'px-1 text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)';
const fieldsetClass = 'grid min-w-0 gap-3 rounded-md border border-(--border) p-3 sm:grid-cols-2';

/**
 * Story 4-7c (decision 10, A2, A8, A9) — Dispatch a picked return to client
 * (`dispatch.execute`): 2-8b's shared consignment form bound to this RTC,
 * with no debit note (an RTC records none — D8), and an RTC fieldset in its
 * `extra` slot: the consignee GSTIN (the brand registration receiving the
 * goods; the frozen client GSTIN by default) and the declared value
 * ("declared by the consignor", never judged). The document type follows the
 * A2 advice — a challan between the same registration, a stock-transfer
 * invoice between two states — until the viewer picks one; the advice is
 * shown, never enforced. A suspended client is warned, never blocked (A8).
 * One Idempotency-Key per draft, bound to the body.
 */
export function ClientReturnDispatchDialog({
  rtc,
  clientStatus,
  onClose,
  onDispatched,
  onStale,
}: {
  rtc: ClientReturnDto;
  /** The client's live status, when the clients list is loaded (A8 warns on `suspended`). */
  clientStatus: string | null;
  onClose: () => void;
  onDispatched: (rtc: ClientReturnDto) => void;
  /** A refusal that means the RTC moved (cancelled, no longer picked) — the caller re-reads. */
  onStale: () => void;
}) {
  const [nowMs] = useState(() => Date.now());
  const [draft, setDraft] = useState<ConsignmentDraft>(() => emptyConsignmentDraft(rtc.client.gstin, nowMs));
  const [extra, setExtra] = useState<RtcDispatchExtra>(() => emptyRtcDispatchExtra(rtc.client.gstin));
  const [typeTouched, setTypeTouched] = useState(false);
  const [fieldError, setFieldError] = useState<{ field: ConsignmentField; problem: string } | null>(null);
  const [extraError, setExtraError] = useState<{ field: RtcExtraField; problem: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const keyRef = useRef<{ key: string; body: string } | null>(null);
  const transporters = useTransporterOptions();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !inFlight.current) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const advice = advisedBrandDocument(draft.consignorGstin, extra.consigneeGstin);
  // A2 — the advised type stands until the viewer picks one.
  const effective: ConsignmentDraft = typeTouched ? draft : { ...draft, documentType: advice.type };

  function onEdit(patch: Partial<ConsignmentDraft>) {
    if (patch.documentType !== undefined) setTypeTouched(true);
    setDraft((current) => ({ ...current, ...patch }));
    setFieldError(null);
    setExtraError(null);
    setProblem(null);
  }

  function onExtra(patch: Partial<RtcDispatchExtra>) {
    setExtra((current) => ({ ...current, ...patch }));
    setFieldError(null);
    setExtraError(null);
    setProblem(null);
  }

  async function submit() {
    const session = readSession();
    if (session === null) {
      setProblem('Your session expired — sign in again.');
      return;
    }
    if (inFlight.current) return;
    const parsed = parseRtcDispatch(effective, extra, rtc, Date.now());
    if (!parsed.ok) {
      if (parsed.extra !== undefined) setExtraError({ field: parsed.extra, problem: parsed.problem });
      else setFieldError({ field: parsed.field, problem: parsed.problem });
      return;
    }
    keyRef.current = keyForBody(keyRef.current, JSON.stringify(parsed.body), ulid);
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const dispatched = await fetchApiDispatchClientReturn(session.tenant.id, rtc.id, parsed.body, keyRef.current.key);
      keyRef.current = null;
      onDispatched(dispatched);
    } catch (error) {
      setProblem(rtcReason(error, 'dispatch'));
      if (rtcTransporterRefusal(error)) transporters.reload();
      if (rtcRefusalReloads(error)) onStale();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const choices: TransporterChoices =
    transporters.state === 'ready'
      ? { state: 'ready', options: transporters.data }
      : transporters.state === 'failed'
        ? { state: 'failed', reason: transporters.reason, onRetry: transporters.reload }
        : { state: 'loading' };
  const units = rtc.totalPickedQuantity ?? rtc.totalQuantity;
  const brand = rtc.client.legalName ?? rtc.client.name;
  const consignorHint =
    rtc.client.gstin === null
      ? `${brand} has no GSTIN on file — enter the one its challan names.`
      : `Defaults to ${brand}'s GSTIN on file (${rtc.client.gstin}) — change it when the challan names another registration.`;
  const extraErrorOf = (field: RtcExtraField) => (extraError !== null && extraError.field === field ? extraError.problem : null);

  return (
    <div role="dialog" aria-modal="false" aria-label={`Dispatch ${rtc.code}`} className="flex flex-col gap-3 rounded-md border border-(--border) bg-(--card) p-4 text-sm">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold">
          Dispatch <span className="font-mono">{rtc.code}</span> back to {brand}
        </h3>
        <p className="text-xs text-(--muted-foreground)">
          {rtc.lines.filter((line) => (line.pickedQuantity ?? 0) > 0).length} picked line(s), <span className="data">{formatCount(units)}</span> base units. Record the brand&apos;s
          document and who carries the goods — the units leave the Returns and Damaged areas when this is saved. The WMS records the brand&apos;s numbers; it issues no tax
          document.
        </p>
      </div>
      {clientStatus === 'suspended' && (
        <div data-testid="rtc-suspended-warning">
          <FeedbackBanner tone="warning" word="Client suspended" reason={RTC_SUSPENDED_WARNING} />
        </div>
      )}
      <ReturnDispatchForm
        ariaLabel={`Dispatch ${rtc.code} form`}
        draft={effective}
        onEdit={onEdit}
        transporters={choices}
        fieldError={fieldError}
        problem={problem}
        consignorHint={consignorHint}
        consignorWarning={consignorStateWarning(draft.consignorGstin, rtc.warehouse.gstin)}
        dateWindow={brandDocumentDateWindow(rtc.created.at, nowMs)}
        busy={busy}
        submitLabel="Dispatch to client"
        busyLabel="Dispatching…"
        onSubmit={() => void submit()}
        onDiscard={onClose}
        showDebitNote={false}
        extra={
          <fieldset className={fieldsetClass}>
            <legend className={legendClass}>Consignee and value</legend>
            <p className="text-xs text-(--muted-foreground) sm:col-span-2" data-testid="rtc-document-advice">
              {advice.advice}. Advice only — the brand decides its document.
            </p>
            <Field
              label="Consignee GSTIN"
              hint={
                rtc.client.gstin === null
                  ? `${brand} has no GSTIN on file — enter the registration receiving the goods, or leave it blank (the note prints "Unregistered").`
                  : `The brand registration receiving the goods — defaults to ${rtc.client.gstin}.`
              }
              error={extraErrorOf('consigneeGstin')}
            >
              {(control) => (
                <input
                  {...control}
                  type="text"
                  maxLength={15}
                  value={extra.consigneeGstin}
                  onChange={(event) => onExtra({ consigneeGstin: event.target.value })}
                  className={`${inputClass} font-mono uppercase`}
                />
              )}
            </Field>
            <Field label="Declared value (₹, optional)" hint={`The consignor's value of the goods — printed "${RTC_DECLARED_BY_CONSIGNOR}", never checked.`} error={extraErrorOf('declaredValue')}>
              {(control) => (
                <input
                  {...control}
                  type="text"
                  inputMode="decimal"
                  value={extra.declaredValue}
                  onChange={(event) => onExtra({ declaredValue: event.target.value })}
                  className={`${inputClass} data w-40`}
                />
              )}
            </Field>
          </fieldset>
        }
      />
    </div>
  );
}
