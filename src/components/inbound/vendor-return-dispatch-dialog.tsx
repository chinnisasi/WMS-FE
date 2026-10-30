'use client';

import { useEffect, useRef, useState } from 'react';

import { fetchApiDispatchVendorReturn } from '@/lib/api/client';
import type { VendorReturnDto } from '@/lib/api/generated';
import { readSession } from '@/lib/auth';
import {
  brandDocumentDateWindow,
  consignorStateWarning,
  emptyConsignmentDraft,
  type ConsignmentDraft,
  type ConsignmentField,
} from '@/lib/consignment-capture';
import { formatCount } from '@/lib/format-quantity';
import { lastPrintedPackageLabelCount, packageCountDiffersWarning } from '@/lib/cartons';
import { ulid } from '@/lib/ulid';
import { useTransporterOptions } from '@/lib/use-gate-ins';
import { keyForBody, parseRtvDispatch, rtvReason, rtvRefusalReloads, rtvTransporterRefusal } from '@/lib/vendor-returns';

import { Field } from '@/components/shared/field';
import { ReturnDispatchForm, type TransporterChoices } from '@/components/shared/return-dispatch-form';
import { inputClass } from '@/components/shared/surface';

/**
 * Story 2-8b — Dispatch a picked return to vendor (`dispatch.execute`): the
 * shared consignment form (`components/shared/return-dispatch-form.tsx`)
 * bound to this RTV — its consignor GSTIN pre-filled with the brand's frozen
 * GSTIN (A7) and warned when its state is not the warehouse's, its document
 * date window counted from the RTV's creation (A8). One Idempotency-Key per
 * draft, bound to the body (a retry of the same body replays, any edit mints
 * a new key, success clears it), with a synchronous in-flight ref.
 */
export function VendorReturnDispatchDialog({
  rtv,
  onClose,
  onDispatched,
  onStale,
}: {
  rtv: VendorReturnDto;
  onClose: () => void;
  onDispatched: (rtv: VendorReturnDto) => void;
  /** A refusal that means the RTV moved (cancelled, no longer picked) — the caller re-reads. */
  onStale: () => void;
}) {
  const [nowMs] = useState(() => Date.now());
  const [draft, setDraft] = useState<ConsignmentDraft>(() => emptyConsignmentDraft(rtv.client.gstin, nowMs));
  const [fieldError, setFieldError] = useState<{ field: ConsignmentField; problem: string } | null>(null);
  // Story 4-6a (A22, A25) — the declared value, required on the web; the server judges the e-way threshold from it.
  const [declaredValue, setDeclaredValue] = useState('');
  const [valueError, setValueError] = useState<string | null>(null);
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

  function onEdit(patch: Partial<ConsignmentDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setFieldError(null);
    setValueError(null);
    setProblem(null);
  }

  async function submit() {
    const session = readSession();
    if (session === null) {
      setProblem('Your session expired — sign in again.');
      return;
    }
    if (inFlight.current) return;
    const parsed = parseRtvDispatch(draft, rtv, Date.now(), declaredValue);
    if (!parsed.ok) {
      if (parsed.field === 'declaredValue') setValueError(parsed.problem);
      else setFieldError({ field: parsed.field, problem: parsed.problem });
      return;
    }
    keyRef.current = keyForBody(keyRef.current, JSON.stringify(parsed.body), ulid);
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const dispatched = await fetchApiDispatchVendorReturn(session.tenant.id, rtv.id, parsed.body, keyRef.current.key);
      keyRef.current = null;
      onDispatched(dispatched);
    } catch (error) {
      setProblem(rtvReason(error, 'dispatch'));
      if (rtvTransporterRefusal(error)) transporters.reload();
      if (rtvRefusalReloads(error)) onStale();
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
  const units = rtv.totalPickedQuantity ?? rtv.totalQuantity;
  const brand = rtv.client.legalName ?? rtv.client.name;
  const consignorHint =
    rtv.client.gstin === null
      ? `${brand} has no GSTIN on file — enter the one its challan names.`
      : `Defaults to ${brand}'s GSTIN on file (${rtv.client.gstin}) — change it when the challan names another registration.`;

  return (
    <div role="dialog" aria-modal="false" aria-label={`Dispatch ${rtv.code}`} className="flex flex-col gap-3 rounded-md border border-(--border) bg-(--card) p-4 text-sm">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold">
          Dispatch <span className="font-mono">{rtv.code}</span> to {rtv.vendor.name}
        </h3>
        <p className="text-xs text-(--muted-foreground)">
          {rtv.lines.filter((line) => (line.pickedQuantity ?? 0) > 0).length} picked line(s), <span className="data">{formatCount(units)}</span> base units. Record the brand&apos;s
          document and who carries the goods — the units leave DAMAGED when this is saved. The WMS records the brand&apos;s numbers; it issues no tax document.
        </p>
      </div>
      <ReturnDispatchForm
        ariaLabel={`Dispatch ${rtv.code} form`}
        draft={draft}
        onEdit={onEdit}
        transporters={choices}
        fieldError={fieldError}
        problem={problem}
        consignorHint={consignorHint}
        consignorWarning={consignorStateWarning(draft.consignorGstin, rtv.warehouse.gstin)}
        packageCountWarning={packageCountDiffersWarning(
          /^\d+$/.test(draft.packageCount.trim()) ? Number(draft.packageCount.trim()) : undefined,
          lastPrintedPackageLabelCount(rtv.id),
        )}
        dateWindow={brandDocumentDateWindow(rtv.created.at, nowMs)}
        busy={busy}
        submitLabel="Dispatch to vendor"
        busyLabel="Dispatching…"
        onSubmit={() => void submit()}
        onDiscard={onClose}
        extra={
          <fieldset className="grid min-w-0 gap-3 rounded-md border border-(--border) p-3 sm:grid-cols-2">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)">Value</legend>
            <Field
              label="Declared value (₹)"
              hint="The value on the brand's document, including tax — above the e-way threshold an e-way bill is required."
              error={valueError}
            >
              {(control) => (
                <input
                  {...control}
                  type="text"
                  inputMode="decimal"
                  value={declaredValue}
                  onChange={(event) => {
                    setDeclaredValue(event.target.value);
                    setValueError(null);
                    setProblem(null);
                  }}
                  className={`${inputClass} data w-40`}
                  data-testid="rtv-declared-value"
                />
              )}
            </Field>
          </fieldset>
        }
      />
    </div>
  );
}
