'use client';

import type { ReactNode } from 'react';

import { FeedbackBanner } from '@/components/feedback/banner';
import { Field } from '@/components/shared/field';
import { SubmitButton } from '@/components/shared/submit-button';
import { buttonClass, inputClass, selectClass } from '@/components/shared/surface';
import {
  BRAND_DOCUMENT_LABEL,
  BRAND_DOCUMENT_TYPES,
  CARRIER_IDENTITY_RULE,
  CONSIGNMENT_LIMITS,
  EWAY_THRESHOLD_HINT,
  VEHICLE_RULE,
  type BrandDocumentType,
  type ConsignmentDraft,
  type ConsignmentField,
  type TransporterOption,
} from '@/lib/consignment-capture';
import { formatIstDate } from '@/lib/rate-cards';

/**
 * Story 2-8b (4-7c reuses it) — the dispatch capture of a goods-out document
 * the WMS records but does not issue: the brand's challan or invoice, the
 * consignor GSTIN the challan names, the e-way bill (with the threshold
 * rule stated, never judged), who carries the goods (a transporter partner,
 * or a typed carrier name, and/or the vehicle), the AWB / LR and the
 * packages.
 *
 * Kind-neutral and hook-free: the caller owns the draft, its key, the
 * transporters read and the submit; the form renders the fields, marks the
 * one the parser's problem names (`Field`, aria-invalid), and the server's
 * refusal in one banner above the submit row (UI-PATTERNS §4). A kind that
 * does not record a debit note hides it (`showDebitNote`); `extra` slots a
 * kind-specific field set before the submit row.
 */

export type TransporterChoices =
  | { readonly state: 'loading' }
  | { readonly state: 'failed'; readonly reason: string; readonly onRetry: () => void }
  | { readonly state: 'ready'; readonly options: readonly TransporterOption[] };

const legendClass = 'px-1 text-xs font-semibold uppercase tracking-wide text-(--muted-foreground)';
const fieldsetClass = 'grid min-w-0 gap-3 rounded-md border border-(--border) p-3 sm:grid-cols-2';

export function ReturnDispatchForm({
  ariaLabel,
  draft,
  onEdit,
  transporters,
  fieldError,
  problem,
  consignorHint,
  consignorWarning,
  dateWindow,
  busy,
  submitLabel,
  busyLabel,
  onSubmit,
  onDiscard,
  showDebitNote = true,
  extra,
  packageCountWarning = null,
}: {
  readonly ariaLabel: string;
  readonly draft: ConsignmentDraft;
  readonly onEdit: (patch: Partial<ConsignmentDraft>) => void;
  readonly transporters: TransporterChoices;
  /** The parser's problem, naming its field (shown on it after a submit). */
  readonly fieldError: { readonly field: ConsignmentField; readonly problem: string } | null;
  /** The server's refusal, in words. */
  readonly problem: string | null;
  readonly consignorHint: string;
  readonly consignorWarning: string | null;
  readonly dateWindow: { readonly earliest: string; readonly latest: string };
  readonly busy: boolean;
  readonly submitLabel: string;
  readonly busyLabel: string;
  readonly onSubmit: () => void;
  readonly onDiscard: () => void;
  readonly showDebitNote?: boolean;
  readonly extra?: ReactNode;
  /** Story 4-5a (A43) — the packages differ from the package labels last printed: warn, never refuse. */
  readonly packageCountWarning?: string | null;
}) {
  const errorOf = (field: ConsignmentField): string | null => (fieldError !== null && fieldError.field === field ? fieldError.problem : null);
  const typed = draft.carrierMode === 'typed';
  return (
    <form
      aria-label={ariaLabel}
      noValidate
      className="flex max-w-3xl flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {/* Nothing is editable in flight: an edit would change the body a retry must replay. */}
      <fieldset disabled={busy} className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
        <fieldset className={fieldsetClass}>
          <legend className={legendClass}>Consignor&apos;s document</legend>
          <Field label="Document type" hint="The brand's movement document the goods travel under.">
            {(control) => (
              <select
                {...control}
                value={draft.documentType}
                onChange={(event) => onEdit({ documentType: event.target.value as BrandDocumentType })}
                className={selectClass}
              >
                {BRAND_DOCUMENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {BRAND_DOCUMENT_LABEL[type]}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Document number" error={errorOf('documentNumber')}>
            {(control) => (
              <input
                {...control}
                type="text"
                maxLength={CONSIGNMENT_LIMITS.documentNumber}
                value={draft.documentNumber}
                onChange={(event) => onEdit({ documentNumber: event.target.value })}
                className={`${inputClass} font-mono`}
              />
            )}
          </Field>
          <Field
            label="Document date (IST)"
            hint={`${formatIstDate(dateWindow.earliest)} – ${formatIstDate(dateWindow.latest)}`}
            error={errorOf('documentDate')}
          >
            {(control) => (
              <input
                {...control}
                type="date"
                min={dateWindow.earliest}
                max={dateWindow.latest}
                value={draft.documentDate}
                onChange={(event) => onEdit({ documentDate: event.target.value })}
                className={inputClass}
              />
            )}
          </Field>
          <Field label="Consignor GSTIN" hint={consignorHint} error={errorOf('consignorGstin')}>
            {(control) => (
              <input
                {...control}
                type="text"
                maxLength={15}
                value={draft.consignorGstin}
                onChange={(event) => onEdit({ consignorGstin: event.target.value })}
                className={`${inputClass} font-mono uppercase`}
              />
            )}
          </Field>
          {consignorWarning !== null && (
            <div className="sm:col-span-2">
              <FeedbackBanner tone="warning" word="Check the consignor's state" reason={consignorWarning} />
            </div>
          )}
          {showDebitNote && (
            <Field label="Debit note number (optional)" hint="The brand's claim on the vendor — printed on the note." error={errorOf('debitNoteNumber')}>
              {(control) => (
                <input
                  {...control}
                  type="text"
                  maxLength={CONSIGNMENT_LIMITS.debitNoteNumber}
                  value={draft.debitNoteNumber}
                  onChange={(event) => onEdit({ debitNoteNumber: event.target.value })}
                  className={`${inputClass} font-mono`}
                />
              )}
            </Field>
          )}
        </fieldset>

        <fieldset className={fieldsetClass}>
          <legend className={legendClass}>E-way bill (optional)</legend>
          <p className="text-xs text-(--muted-foreground) sm:col-span-2" data-testid="eway-threshold-hint">
            {EWAY_THRESHOLD_HINT}
          </p>
          <Field label="E-way bill number" hint="12 digits" error={errorOf('ewayBillNumber')}>
            {(control) => (
              <input
                {...control}
                type="text"
                inputMode="numeric"
                maxLength={12}
                value={draft.ewayBillNumber}
                onChange={(event) => onEdit({ ewayBillNumber: event.target.value })}
                className={`${inputClass} font-mono`}
              />
            )}
          </Field>
          <Field label="E-way bill date" error={errorOf('ewayBillDate')}>
            {(control) => (
              <input
                {...control}
                type="date"
                value={draft.ewayBillDate}
                onChange={(event) => onEdit({ ewayBillDate: event.target.value })}
                className={inputClass}
              />
            )}
          </Field>
          <Field label="Valid until" error={errorOf('ewayValidUntil')}>
            {(control) => (
              <input
                {...control}
                type="date"
                min={draft.ewayBillDate === '' ? undefined : draft.ewayBillDate}
                value={draft.ewayValidUntil}
                onChange={(event) => onEdit({ ewayValidUntil: event.target.value })}
                className={inputClass}
              />
            )}
          </Field>
        </fieldset>

        <fieldset className={fieldsetClass}>
          <legend className={legendClass}>Carrier</legend>
          <p className="text-xs text-(--muted-foreground) sm:col-span-2">{CARRIER_IDENTITY_RULE}</p>
          {typed ? (
            <Field label="Carrier name" error={errorOf('carrier')}>
              {(control) => (
                <input
                  {...control}
                  type="text"
                  maxLength={CONSIGNMENT_LIMITS.carrierName}
                  value={draft.carrierName}
                  onChange={(event) => onEdit({ carrierName: event.target.value })}
                  className={inputClass}
                />
              )}
            </Field>
          ) : (
            <Field label="Transporter" error={errorOf('carrier')}>
              {(control) =>
                transporters.state === 'loading' ? (
                  <span {...control} className="text-xs text-(--muted-foreground)">
                    Loading transporters…
                  </span>
                ) : transporters.state === 'failed' ? (
                  <span {...control} className="flex flex-wrap items-center gap-2 text-xs text-(--destructive)">
                    Transporters unavailable — {transporters.reason}
                    <button type="button" onClick={transporters.onRetry} className={buttonClass}>
                      Retry
                    </button>
                  </span>
                ) : (
                  <select
                    {...control}
                    value={draft.transporterId}
                    onChange={(event) => onEdit({ transporterId: event.target.value })}
                    className={selectClass}
                  >
                    <option value="">{transporters.options.length === 0 ? 'No transporters in the master' : 'Pick the transporter…'}</option>
                    {transporters.options.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.code} — {option.name}
                      </option>
                    ))}
                  </select>
                )
              }
            </Field>
          )}
          <label className="flex items-center gap-2 self-end text-sm">
            <input
              type="checkbox"
              checked={typed}
              onChange={(event) => onEdit({ carrierMode: event.target.checked ? 'typed' : 'partner' })}
            />
            Not listed — type the carrier name
          </label>
          <Field label="Vehicle number" hint={VEHICLE_RULE} error={errorOf('vehicleNumber')}>
            {(control) => (
              <input
                {...control}
                type="text"
                value={draft.vehicleNumber}
                onChange={(event) => onEdit({ vehicleNumber: event.target.value })}
                className={`${inputClass} font-mono uppercase`}
              />
            )}
          </Field>
          <Field label="AWB / LR number" error={errorOf('trackingRef')}>
            {(control) => (
              <input
                {...control}
                type="text"
                maxLength={CONSIGNMENT_LIMITS.trackingRef}
                value={draft.trackingRef}
                onChange={(event) => onEdit({ trackingRef: event.target.value })}
                className={`${inputClass} font-mono`}
              />
            )}
          </Field>
          <Field
            label="Packages"
            hint={`${CONSIGNMENT_LIMITS.packageCountMin}–${CONSIGNMENT_LIMITS.packageCountMax}, as handed to the carrier`}
            error={errorOf('packageCount')}
          >
            {(control) => (
              <input
                {...control}
                type="text"
                inputMode="numeric"
                value={draft.packageCount}
                onChange={(event) => onEdit({ packageCount: event.target.value })}
                className={`${inputClass} data w-32`}
              />
            )}
          </Field>
          {packageCountWarning !== null && (
            <div role="status" className="text-xs text-(--warning)" data-testid="dispatch-package-count-warning">
              ⚠ {packageCountWarning}
            </div>
          )}
        </fieldset>
        {extra}
      </fieldset>
      {problem !== null && <FeedbackBanner tone="rejected" word="Not dispatched" reason={problem} />}
      <div className="flex flex-wrap gap-2">
        <SubmitButton busy={busy} label={submitLabel} busyLabel={busyLabel} />
        <button type="button" disabled={busy} onClick={onDiscard} className={buttonClass}>
          Discard
        </button>
      </div>
    </form>
  );
}
