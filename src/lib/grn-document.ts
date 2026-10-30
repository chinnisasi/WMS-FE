/**
 * Story 2-9a — the GRN document in words, for the staff drawer and the
 * client portal. Pure and hook-free (portal-allowed — `portal-boundary.test.ts`);
 * pinned in `grn-document.test.ts`. The server's PDF prints the same words
 * (`grn-document.layout.ts`); these are the web's copy of them.
 */

/** The parts of a party block (the server's `GrnPartyDto`). */
export interface GrnPartyLike {
  readonly code: string;
  readonly name: string;
  readonly legalName: string | null;
  readonly gstin: string | null;
  readonly address: {
    readonly line1: string;
    readonly line2: string | null;
    readonly city: string;
    readonly state: string;
    readonly pincode: string;
  } | null;
}

export interface GrnExcessLike {
  readonly pendingQty: number;
  readonly approvedQty: number;
  readonly rejectedQty: number;
}

export interface GrnQcLike {
  readonly status: 'on-hold' | 'released' | 'inspected' | null;
  readonly heldQty: number;
  readonly releasedQty: number;
  readonly passedQty: number;
  readonly failedQty: number;
}

/** A GRN recorded before frozen documents prints the parties as they are now. */
export const GRN_NOT_FROZEN_NOTE = 'Party details are current, not as at receipt (recorded before frozen documents).';
export const GRN_FROZEN_NOTE = 'Frozen at receipt';
export const GRN_DOCUMENTS_OMITTED_NOTE = 'Other documents of this vehicle are not shown.';
export const GRN_UNAVAILABLE = 'This receipt is not available.';

/**
 * A base-unit quantity at the UoM's precision with integer maths (milli-units,
 * never `toFixed` on a float): `12.5` at 3 → `"12.500"`.
 */
export function grnQuantity(value: number, precision: number): string {
  const places = Math.min(Math.max(Math.trunc(precision), 0), 3);
  const milli = Math.round(value * 1000);
  const unit = 10 ** (3 - places);
  const magnitude = Math.round(Math.abs(milli) / unit) * unit;
  const whole = Math.floor(magnitude / 1000);
  const fraction = (magnitude % 1000) / unit;
  const sign = milli < 0 && magnitude !== 0 ? '-' : '';
  return places === 0 ? `${sign}${whole}` : `${sign}${whole}.${String(fraction).padStart(places, '0')}`;
}

/** A party block's lines: `CODE — Name`, the legal name when it differs, the GSTIN, the address. */
export function grnPartyLines(party: GrnPartyLike): string[] {
  const lines = [`${party.code} — ${party.name}`];
  if (party.legalName !== null && party.legalName !== party.name) lines.push(party.legalName);
  if (party.gstin !== null) lines.push(`GSTIN ${party.gstin}`);
  if (party.address !== null) {
    const a = party.address;
    lines.push([a.line1, a.line2, a.city, a.state, a.pincode].filter((part): part is string => part !== null && part !== '').join(', '));
  }
  return lines;
}

/** The Over-receipt cell: each non-zero part (`20 awaiting approval; 5 approved`), else empty. */
export function grnExcessLabel(excess: GrnExcessLike, precision: number, toleranceQty = 0): string {
  const q = (value: number) => grnQuantity(value, precision);
  const parts: string[] = [];
  if (excess.pendingQty > 0) parts.push(`${q(excess.pendingQty)} awaiting approval`);
  if (excess.approvedQty > 0) parts.push(`${q(excess.approvedQty)} approved`);
  if (excess.rejectedQty > 0) parts.push(`${q(excess.rejectedQty)} rejected`);
  if (toleranceQty > 0) parts.push(`${q(toleranceQty)} within tolerance`);
  return parts.join('; ');
}

/** The staff QC cell — the PDF's words: "On hold 5 · Released 10 · Passed 8 · Failed 2", else empty. */
export function grnQcLabel(qc: GrnQcLike, precision: number): string {
  if (qc.status === null) return '';
  const q = (value: number) => grnQuantity(value, precision);
  const onHold = Math.max(0, qc.heldQty - qc.releasedQty - qc.passedQty - qc.failedQty);
  const parts: string[] = [];
  if (onHold > 0) parts.push(`On hold ${q(onHold)}`);
  if (qc.releasedQty > 0) parts.push(`Released ${q(qc.releasedQty)}`);
  if (qc.passedQty > 0) parts.push(`Passed ${q(qc.passedQty)}`);
  if (qc.failedQty > 0) parts.push(`Failed ${q(qc.failedQty)}`);
  if (parts.length > 0) return parts.join(' · ');
  return qc.status === 'on-hold' ? 'On hold' : qc.status === 'released' ? 'Released' : 'Inspected';
}

/** The portal's QC words: "On quality hold", "Released", "Passed 18 · Failed 2", else empty. */
export function grnPortalQcLabel(qc: GrnQcLike, precision: number): string {
  if (qc.status === null) return '';
  if (qc.status === 'on-hold') return 'On quality hold';
  if (qc.status === 'released' && qc.passedQty + qc.failedQty === 0) return 'Released';
  const q = (value: number) => grnQuantity(value, precision);
  const parts: string[] = [];
  if (qc.releasedQty > 0) parts.push(`Released ${q(qc.releasedQty)}`);
  if (qc.passedQty > 0) parts.push(`Passed ${q(qc.passedQty)}`);
  if (qc.failedQty > 0) parts.push(`Failed ${q(qc.failedQty)}`);
  return parts.length === 0 ? 'Inspected' : parts.join(' · ');
}

/** The portal's over-receipt words: "Awaiting approval (20)", "Approved (20)", "Not accepted (20)". */
export function grnPortalExcessLabel(excess: GrnExcessLike, precision: number): string {
  const q = (value: number) => grnQuantity(value, precision);
  const parts: string[] = [];
  if (excess.pendingQty > 0) parts.push(`Awaiting approval (${q(excess.pendingQty)})`);
  if (excess.approvedQty > 0) parts.push(`Approved (${q(excess.approvedQty)})`);
  if (excess.rejectedQty > 0) parts.push(`Not accepted (${q(excess.rejectedQty)})`);
  return parts.join('; ');
}

/** "Serials captured: 50 (2 unreadable, 1 rejected excess)", omitting a zero part; null without serial rows. */
export function grnSerialsLabel(line: { readonly serialCount: number; readonly unreadableSerialCount: number; readonly rejectedSerialCount?: number }): string | null {
  const rejected = line.rejectedSerialCount ?? 0;
  if (line.serialCount + line.unreadableSerialCount + rejected === 0) return null;
  const extra = [
    line.unreadableSerialCount > 0 ? `${line.unreadableSerialCount} unreadable` : null,
    rejected > 0 ? `${rejected} rejected excess` : null,
  ].filter((part): part is string => part !== null);
  return `Serials captured: ${line.serialCount}${extra.length === 0 ? '' : ` (${extra.join(', ')})`}`;
}

/** The expiry with its source: `2027-09-01 (derived)`. */
export function grnExpiryLabel(line: { readonly expiryDate: string | null; readonly expirySource: 'typed' | 'derived' | null }): string {
  if (line.expiryDate === null) return '';
  return line.expirySource === 'derived' ? `${line.expiryDate} (derived)` : line.expiryDate;
}

/**
 * The server's file name rule (CORS hides `Content-Disposition`, so the web
 * builds the same name): `{GRN code}.pdf` / `{GRN code}-lines.csv`, ASCII-only.
 */
export function grnDocumentFilename(code: string, format: 'pdf' | 'csv'): string {
  const safe = code.replace(/[^A-Za-z0-9._-]/g, '_') || 'GRN';
  return format === 'pdf' ? `${safe}.pdf` : `${safe}-lines.csv`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `?grn=<uuid>` — one well-formed id, else null (a repeated or malformed value opens nothing). */
export function parseGrnParam(raw: string | string[] | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  return UUID_RE.test(raw) ? raw.toLowerCase() : null;
}

/** `?grn=` is a well-formed but unusable value (shown inline as "not available"), distinct from absent. */
export function isMalformedGrnParam(raw: string | string[] | null | undefined): boolean {
  return raw !== null && raw !== undefined && parseGrnParam(raw) === null;
}

/** Writes (or removes) `?grn=` in the address bar, in place (guide §1.8 — no navigation). */
export function writeGrnParam(grnId: string | null): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (grnId === null) url.searchParams.delete('grn');
  else url.searchParams.set('grn', grnId);
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}
