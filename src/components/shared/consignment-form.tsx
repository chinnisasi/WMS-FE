'use client';

import { useRef, useState } from 'react';

import type { RecordConsignmentDto } from '@/lib/api/generated';
import { brandDocumentDateWindow, EWAY_THRESHOLD_HINT } from '@/lib/consignment-capture';
import {
  CONSIGNMENT_RECORD_LIMITS,
  EWAY_EXEMPTION_LABEL,
  EWAY_EXEMPTION_REASONS,
  ORDER_BRAND_DOCUMENT_LABEL,
  ORDER_BRAND_DOCUMENT_TYPES,
  parseConsignmentDraft,
  type ConsignmentRecordDraft,
  type ConsignmentRecordField,
  type EwayMode,
} from '@/lib/consignment';
import { ulid } from '@/lib/ulid';

import { FeedbackBanner } from '@/components/feedback/banner';
import { Field } from '@/components/shared/field';
import { buttonClass, inputClass, labelClass, primaryClass, selectClass } from '@/components/shared/surface';

const fieldsetClass = 'grid min-w-0 gap-3 rounded-md border border-(--border) p-3 sm:grid-cols-2';
const legendClass = 'px-1 text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)';

/**
 * Story 4-6a (A24, A26) — the brand's tax document and e-way bill, recorded
 * per client order. ONE form for the staff panel and the client portal (it
 * imports no operator hook, so the portal may mount it): the document, the
 * declared value, the consignor GSTIN, and the e-way bill — its number, an
 * exemption, or "not yet". The parse mirrors the server's shape rules
 * (`parseConsignmentDraft`) and sends nothing it would only answer 400 to.
 *
 * One Idempotency-Key per draft, bound to the body (a retry of the same body
 * replays; any edit mints a new key; success unmounts the form), with a
 * synchronous in-flight ref (a double click sends one POST). A refusal keeps
 * the draft and its key, worded by the caller's `reasonOf` (by code).
 */
export function ConsignmentForm({
  initial,
  createdAt,
  reasonRequired,
  canExempt,
  exemptDisabledNote,
  consignorHint,
  submitLabel,
  submit,
  reasonOf,
  onDiscard,
  testId = 'consignment-form',
}: {
  initial: ConsignmentRecordDraft;
  /** The order's creation instant: the document date's 30-day window counts back from it. */
  createdAt: string;
  /** The order has left: an amendment says why (A9 guard 10). */
  reasonRequired: boolean;
  /** A46 — staff need `orders.manage` for an exemption; the portal may always send one. */
  canExempt: boolean;
  exemptDisabledNote?: string;
  consignorHint: string;
  submitLabel: string;
  /** Sends the body under the key; throws the refusal. */
  submit: (body: RecordConsignmentDto, key: string) => Promise<void>;
  reasonOf: (error: unknown) => string;
  onDiscard: () => void;
  testId?: string;
}) {
  const [nowMs] = useState(() => Date.now());
  const [draft, setDraft] = useState<ConsignmentRecordDraft>(initial);
  const [fieldError, setFieldError] = useState<{ field: ConsignmentRecordField; problem: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const keyRef = useRef<{ key: string; body: string } | null>(null);
  const dateWindow = brandDocumentDateWindow(createdAt, nowMs);

  function edit(patch: Partial<ConsignmentRecordDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setFieldError(null);
    setProblem(null);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const parsed = parseConsignmentDraft(draft, { createdAt, nowMs: Date.now(), reasonRequired });
    if (!parsed.ok) {
      setFieldError({ field: parsed.field, problem: parsed.problem });
      return;
    }
    const bodyText = JSON.stringify(parsed.body);
    if (keyRef.current === null || keyRef.current.body !== bodyText) keyRef.current = { key: ulid(), body: bodyText };
    inFlight.current = true;
    setBusy(true);
    setProblem(null);
    try {
      await submit(parsed.body, keyRef.current.key);
      keyRef.current = null;
    } catch (error) {
      setProblem(reasonOf(error));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const errorOf = (field: ConsignmentRecordField) => (fieldError !== null && fieldError.field === field ? fieldError.problem : null);
  const modes: readonly { mode: EwayMode; label: string; disabled: boolean }[] = [
    { mode: 'bill', label: 'E-way bill number', disabled: false },
    { mode: 'exempt', label: 'Exempt — no e-way bill needed', disabled: !canExempt },
    { mode: 'none', label: 'Not yet, or not needed (the WMS judges the value)', disabled: false },
  ];

  return (
    <form onSubmit={onSubmit} className="flex max-w-3xl flex-col gap-3 text-sm" aria-label="Tax documents form" data-testid={testId} noValidate>
      <fieldset className={fieldsetClass} disabled={busy}>
        <legend className={legendClass}>The brand’s document</legend>
        <Field label="Document">
          {(control) => (
            <select
              {...control}
              className={selectClass}
              value={draft.documentType}
              onChange={(e) => edit({ documentType: e.target.value as ConsignmentRecordDraft['documentType'] })}
              data-testid="consignment-document-type"
            >
              {ORDER_BRAND_DOCUMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {ORDER_BRAND_DOCUMENT_LABEL[type]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Number" error={errorOf('documentNumber')}>
          {(control) => (
            <input
              {...control}
              className={`${inputClass} font-mono`}
              maxLength={CONSIGNMENT_RECORD_LIMITS.documentNumber}
              value={draft.documentNumber}
              onChange={(e) => edit({ documentNumber: e.target.value })}
              data-testid="consignment-document-number"
            />
          )}
        </Field>
        <Field label="Date" error={errorOf('documentDate')}>
          {(control) => (
            <input
              {...control}
              type="date"
              className={inputClass}
              min={dateWindow.earliest}
              max={dateWindow.latest}
              value={draft.documentDate}
              onChange={(e) => edit({ documentDate: e.target.value })}
              data-testid="consignment-document-date"
            />
          )}
        </Field>
        <Field label="Declared value (₹)" hint="The value on the document, including tax (exempt goods excluded)." error={errorOf('declaredValue')}>
          {(control) => (
            <input
              {...control}
              type="text"
              inputMode="decimal"
              className={`${inputClass} data`}
              value={draft.declaredValue}
              onChange={(e) => edit({ declaredValue: e.target.value })}
              data-testid="consignment-declared-value"
            />
          )}
        </Field>
        <Field label="Consignor GSTIN" hint={consignorHint} error={errorOf('consignorGstin')} className="flex flex-col gap-1 sm:col-span-2">
          {(control) => (
            <input
              {...control}
              type="text"
              maxLength={15}
              className={`${inputClass} font-mono uppercase`}
              value={draft.consignorGstin}
              onChange={(e) => edit({ consignorGstin: e.target.value })}
              data-testid="consignment-consignor"
            />
          )}
        </Field>
      </fieldset>

      <fieldset className={fieldsetClass} disabled={busy}>
        <legend className={legendClass}>E-way bill</legend>
        <p className="text-xs text-(--muted-foreground) sm:col-span-2">{EWAY_THRESHOLD_HINT}.</p>
        <div role="radiogroup" aria-label="E-way bill" className="flex flex-col gap-1 sm:col-span-2">
          {modes.map((option) => (
            <label key={option.mode} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="ewayMode"
                value={option.mode}
                checked={draft.ewayMode === option.mode}
                disabled={option.disabled}
                onChange={() => edit({ ewayMode: option.mode })}
                data-testid={`consignment-eway-${option.mode}`}
              />
              <span>{option.label}</span>
            </label>
          ))}
          {!canExempt && exemptDisabledNote !== undefined && <span className="text-xs text-(--muted-foreground)">{exemptDisabledNote}</span>}
        </div>
        {draft.ewayMode === 'bill' && (
          <>
            <Field label="E-way bill number" hint="12 digits — leave blank while the brand has not generated it." error={errorOf('ewayBillNumber')}>
              {(control) => (
                <input
                  {...control}
                  inputMode="numeric"
                  className={`${inputClass} font-mono`}
                  value={draft.ewayBillNumber}
                  onChange={(e) => edit({ ewayBillNumber: e.target.value })}
                  data-testid="consignment-eway-number"
                />
              )}
            </Field>
            <Field label="E-way bill date" error={errorOf('ewayBillDate')}>
              {(control) => (
                <input
                  {...control}
                  type="date"
                  className={inputClass}
                  value={draft.ewayBillDate}
                  onChange={(e) => edit({ ewayBillDate: e.target.value })}
                  data-testid="consignment-eway-date"
                />
              )}
            </Field>
            <Field label="Valid until" hint="The last day the bill is valid (Part B filled)." error={errorOf('ewayValidUntil')}>
              {(control) => (
                <input
                  {...control}
                  type="date"
                  className={inputClass}
                  value={draft.ewayValidUntil}
                  onChange={(e) => edit({ ewayValidUntil: e.target.value })}
                  data-testid="consignment-eway-until"
                />
              )}
            </Field>
          </>
        )}
        {draft.ewayMode === 'exempt' && (
          <>
            <Field label="Why no e-way bill" error={errorOf('exemptionReason')}>
              {(control) => (
                <select
                  {...control}
                  className={selectClass}
                  value={draft.exemptionReason}
                  onChange={(e) => edit({ exemptionReason: e.target.value as ConsignmentRecordDraft['exemptionReason'] })}
                  data-testid="consignment-exemption-reason"
                >
                  <option value="">Choose…</option>
                  {EWAY_EXEMPTION_REASONS.map((reason) => (
                    <option key={reason} value={reason}>
                      {EWAY_EXEMPTION_LABEL[reason]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={draft.exemptionReason === 'other' ? 'Note' : 'Note (optional)'} error={errorOf('exemptionNote')}>
              {(control) => (
                <input
                  {...control}
                  className={inputClass}
                  maxLength={CONSIGNMENT_RECORD_LIMITS.exemptionNote}
                  value={draft.exemptionNote}
                  onChange={(e) => edit({ exemptionNote: e.target.value })}
                  data-testid="consignment-exemption-note"
                />
              )}
            </Field>
          </>
        )}
      </fieldset>

      <fieldset disabled={busy} className="flex flex-col gap-1">
        <Field
          label={reasonRequired ? 'Why it is amended (required — the order has left)' : 'Reason (optional)'}
          error={errorOf('reason')}
        >
          {(control) => (
            <input
              {...control}
              className={inputClass}
              maxLength={CONSIGNMENT_RECORD_LIMITS.reason}
              value={draft.reason}
              onChange={(e) => edit({ reason: e.target.value })}
              data-testid="consignment-reason"
            />
          )}
        </Field>
      </fieldset>

      {problem !== null && <FeedbackBanner tone="rejected" word="Not recorded" reason={problem} />}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className={primaryClass} disabled={busy} data-testid="consignment-submit">
          {busy ? 'Recording…' : submitLabel}
        </button>
        <button type="button" className={buttonClass} disabled={busy} onClick={onDiscard}>
          Discard
        </button>
        <span className={`${labelClass} text-xs font-normal text-(--muted-foreground)`}>The WMS records the brand’s numbers; it issues no tax document.</span>
      </div>
    </form>
  );
}
