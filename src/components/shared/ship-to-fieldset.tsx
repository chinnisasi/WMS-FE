'use client';

import { useId } from 'react';

import { buyerGstinStateMismatch } from '@/lib/gst-states';
import { GSTIN_HELP } from '@/lib/gstin';
import { showsLegalName, type DestinationFields } from '@/lib/outbound-orders';

import { StateSelect } from '@/components/shared/state-select';
import { inputClass, labelClass, selectClass } from '@/components/shared/surface';

/**
 * Story 4-1a — the order's "Ship to" fieldset, shared by the staff
 * `OrderCreateForm` (Outbound) and the portal's Place-an-order form: the
 * contact, phone, two address lines, city, state (the official GST names)
 * and pincode, the optional buyer GSTIN with its non-blocking state-mismatch
 * warning, and — once a GSTIN is typed — the buyer legal name.
 *
 * Moved here, markup unchanged, from `outbound/outbound-orders.tsx` so the
 * portal can reach it across its boundary (`lib/portal-boundary.test.ts`:
 * only `components/shared/` and pure `lib/` helpers). Controlled: it holds
 * no state, so each form keeps its own draft and clears its own
 * Idempotency-Key in the `on*` handlers (every field is in the request hash).
 */
export function ShipToFieldset({
  destination,
  onDestination,
  consigneeGstin,
  onConsigneeGstin,
  consigneeLegalName,
  onConsigneeLegalName,
}: {
  destination: DestinationFields;
  onDestination: (next: DestinationFields) => void;
  consigneeGstin: string;
  onConsigneeGstin: (next: string) => void;
  consigneeLegalName: string;
  onConsigneeLegalName: (next: string) => void;
}) {
  const gstinHelpId = useId();
  const legalNameHelpId = useId();
  const buyerStateWarningId = useId();
  // Story 8-1d: a buyer GSTIN from another state than the ship-to is legal,
  // so this only WARNS, inline — the invoice will carry pos-discrepancy and
  // the e-way bill will be blocked ship-to-differs.
  const buyerStateMismatch = buyerGstinStateMismatch(consigneeGstin, destination.state);

  return (
    <fieldset className="flex flex-col gap-2 rounded-sm border border-(--border) p-3">
      <legend className="px-1 text-xs text-(--muted-foreground)">Ship to</legend>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="flex flex-[2] flex-col gap-1">
          <span className={labelClass}>Contact name</span>
          <input
            className={inputClass}
            value={destination.contactName}
            onChange={(e) => onDestination({ ...destination, contactName: e.target.value })}
            required
            maxLength={120}
            placeholder="Priya Sharma"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>Phone</span>
          <input
            className={inputClass}
            value={destination.phone}
            onChange={(e) => onDestination({ ...destination, phone: e.target.value })}
            required
            maxLength={20}
            placeholder="+91 98450 12345"
          />
        </label>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="flex flex-[2] flex-col gap-1">
          <span className={labelClass}>Address line 1</span>
          <input
            className={inputClass}
            value={destination.line1}
            onChange={(e) => onDestination({ ...destination, line1: e.target.value })}
            required
            maxLength={200}
            placeholder="12, Peenya Industrial Area"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>Address line 2 (optional)</span>
          <input
            className={inputClass}
            value={destination.line2}
            onChange={(e) => onDestination({ ...destination, line2: e.target.value })}
            maxLength={200}
            placeholder="Gate 3"
          />
        </label>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>City</span>
          <input
            className={inputClass}
            value={destination.city}
            onChange={(e) => onDestination({ ...destination, city: e.target.value })}
            required
            maxLength={100}
            placeholder="Bengaluru"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>State</span>
          <StateSelect
            className={selectClass}
            value={destination.state}
            onChange={(state) => onDestination({ ...destination, state })}
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className={labelClass}>Pincode</span>
          <input
            className={inputClass}
            value={destination.pincode}
            onChange={(e) => onDestination({ ...destination, pincode: e.target.value })}
            required
            // Text, never a number input: the pincode keeps its leading
            // zeros (`110001`), and `type="number"` would strip them.
            type="text"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            placeholder="560066"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 sm:max-w-xs">
        <span className={labelClass}>Buyer GSTIN (optional, B2B)</span>
        <input
          className={inputClass}
          value={consigneeGstin}
          onChange={(e) => onConsigneeGstin(e.target.value)}
          // No `pattern`: `parseGstinField` is the only shape gate.
          maxLength={20}
          autoCapitalize="characters"
          spellCheck={false}
          autoComplete="off"
          placeholder="27AAPCD1234K1Z5"
          aria-describedby={buyerStateMismatch === null ? gstinHelpId : `${gstinHelpId} ${buyerStateWarningId}`}
        />
        <span id={gstinHelpId} className="text-xs text-(--muted-foreground)">{GSTIN_HELP}</span>
        {buyerStateMismatch !== null && (
          // Non-blocking: the submit stays enabled. Glyph + word, never colour alone.
          <span id={buyerStateWarningId} data-testid="buyer-state-mismatch" className="text-xs text-(--warning)">
            ⚠ Warning: {buyerStateMismatch}
          </span>
        )}
      </label>
      {showsLegalName(consigneeGstin) && (
        <label className="flex flex-col gap-1 sm:max-w-md">
          <span className={labelClass}>Buyer legal name (optional)</span>
          <input
            className={inputClass}
            value={consigneeLegalName}
            onChange={(e) => onConsigneeLegalName(e.target.value)}
            // No maxLength: it counts UTF-16 units before the trim, the
            // backend counts code points after it — `legalNameProblem` does.
            autoComplete="off"
            placeholder="Mysore Spices Pvt Ltd"
            aria-describedby={legalNameHelpId}
          />
          <span id={legalNameHelpId} className="text-xs text-(--muted-foreground)">
            The registered legal or trade name, printed as the buyer on the invoice and the e-way bill. Blank prints the contact name.
          </span>
        </label>
      )}
    </fieldset>
  );
}
