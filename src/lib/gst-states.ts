/**
 * The official GST state list (story 8-1d moved it here from `invoices.ts`).
 * A standalone module with NO imports, so the pre-login `lib/gstin.ts`
 * (registration) can read it without pulling the API client in.
 */

/**
 * The CBIC GST state-code list, mirroring wms-be's `gst_state_codes` seed
 * (migration 0053 — 38 entries, official names). The NAME of the place of
 * supply comes from here, never from the consignee's address text: a
 * consignee GSTIN outranks the address, so the address can name another state.
 *
 * Known seed defect (PENDING): `99` is labelled "Other Country" here as in the
 * seed; 99 is actually Centre Jurisdiction, and Other Country is 96.
 */
export const GST_STATE_NAMES: Readonly<Record<string, string>> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
  '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
  '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
  '97': 'Other Territory', '99': 'Other Country',
};

/**
 * The GST REGISTRATION state codes — the codes a GSTIN's two-digit prefix may
 * carry: `GST_STATE_NAMES` minus `99` (Centre Jurisdiction, which never ships
 * goods). 25 (Daman & Diu, merged into 26 in 2020) and 28 (pre-GST Andhra
 * Pradesh) are not on the list at all. A byte-for-byte mirror of wms-be's
 * `GSTIN_STATE_CODES` (`src/shared/primitives/gstin.ts`), pinned by
 * `gst-states.test.ts`.
 */
export const GSTIN_STATE_CODES: readonly string[] = Object.freeze([
  '01', '02', '03', '04', '05', '06', '07', '08', '09', '10',
  '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
  '21', '22', '23', '24', '26', '27', '29', '30', '31', '32',
  '33', '34', '35', '36', '37', '38', '97',
]);

const GSTIN_STATE_CODE_SET: ReadonlySet<string> = new Set(GSTIN_STATE_CODES);

/** Whether a two-digit code is a GST registration state code. */
export function isGstinStateCode(code: string): boolean {
  return GSTIN_STATE_CODE_SET.has(code);
}

/**
 * The address State select's options (story 8-1d): the official names for
 * the codes 01–38 and 97 — never 99, which no shipping address is in —
 * alphabetical, since a viewer scans for a name, not a code. The select puts
 * a blank placeholder before them.
 */
export const STATE_OPTIONS: readonly string[] = Object.freeze(
  GSTIN_STATE_CODES.map((code) => GST_STATE_NAMES[code]!).sort((a, b) => a.localeCompare(b)),
);

/**
 * The state a GSTIN's prefix names, or null when the text is not a usable
 * GSTIN prefix yet (blank, too short, or not a registration code). Trims and
 * ignores case, as `parseGstinField` does.
 */
export function gstinStateName(gstinText: string): string | null {
  const prefix = gstinText.trim().slice(0, 2);
  if (!/^[0-9]{2}$/.test(prefix) || !isGstinStateCode(prefix)) return null;
  return GST_STATE_NAMES[prefix] ?? null;
}

/**
 * The warehouse form's inline, NON-blocking warning (story 8-1d): the GSTIN's
 * prefix names a state other than the selected origin state. The backend
 * never refuses this (a GSTIN from another state is legal); invoices issued
 * from such a warehouse carry a `pos-discrepancy` warning, and e-way bills
 * from it are blocked as `ship-to-differs`. Null when they agree, or when
 * either side is not chosen yet.
 */
export function gstinStateMismatch(gstinText: string, selectedState: string): string | null {
  const gstinState = gstinStateName(gstinText);
  if (gstinState === null || selectedState === '' || gstinState === selectedState) return null;
  return `This GSTIN is registered in ${gstinState}, but the origin state is ${selectedState}. Invoices from this warehouse will carry a GSTIN / address mismatch warning, and their e-way bills must be generated on the portal.`;
}

/**
 * The warehouse form's warning when its OWN GSTIN is blank (story 8-1d): the
 * invoices then fall back to the tenant GSTIN, and a tenant registered in
 * another state than the origin means every above-threshold e-way bill from
 * this warehouse is blocked (`ship-to-differs`). Null when they agree, or
 * when the tenant has no usable GSTIN or no state is chosen yet.
 */
export function tenantGstinStateMismatch(tenantGstin: string | null | undefined, selectedState: string): string | null {
  const tenantState = gstinStateName(tenantGstin ?? '');
  if (tenantState === null || selectedState === '' || tenantState === selectedState) return null;
  return `This warehouse has no GSTIN of its own, so its invoices will use the tenant GSTIN (state ${tenantState}), but the origin state is ${selectedState} — e-way bills from this warehouse will be blocked and must be generated on the portal.`;
}

/**
 * The order form's warning (story 8-1d): the buyer GSTIN names another state
 * than the ship-to state. Legal (goods can ship elsewhere), so never blocking;
 * the invoice carries a GSTIN / address mismatch warning and its e-way bill is
 * blocked (`ship-to-differs`).
 */
export function buyerGstinStateMismatch(gstinText: string, selectedState: string): string | null {
  const gstinState = gstinStateName(gstinText);
  if (gstinState === null || selectedState === '' || gstinState === selectedState) return null;
  return `This buyer GSTIN is registered in ${gstinState}, but the ship-to state is ${selectedState}. The invoice will carry a GSTIN / address mismatch warning, and its e-way bill must be generated on the portal.`;
}
