import type { GoodsReceiptEntryDto, GoodsReceiptLineEntryDto } from '@/lib/api/generated';
import { formatQuantity, quantityLabel, type QuantityUom } from '@/lib/format-quantity';

/**
 * Story 2-4a — a goods receipt's condition in words: the expandable GRN row
 * (good / damaged (reason) / short (reason) per line) and the list's Units
 * column ("+N damaged"). Pure, pinned in `grn-lines.test.ts`.
 */

/** The damage reasons in words (the server's `DAMAGE_REASON_CODES`). */
export const DAMAGE_REASON_LABEL: Readonly<Record<string, string>> = {
  crushed: 'Crushed',
  wet: 'Wet',
  'torn-packaging': 'Torn packaging',
  broken: 'Broken',
  leaking: 'Leaking',
  pest: 'Pest',
  other: 'Other',
};

/** The short reasons in words (the server's `SHORT_REASON_CODES`). */
export const SHORT_REASON_LABEL: Readonly<Record<string, string>> = {
  'not-shipped': 'Not shipped',
  'short-packed': 'Short-packed',
  'lost-in-transit': 'Lost in transit',
  other: 'Other',
};

/** A reason code in words — the code itself when this build does not know it. */
export function damageReasonLabel(code: string | undefined): string {
  if (code === undefined) return '—';
  return DAMAGE_REASON_LABEL[code] ?? code;
}

export function shortReasonLabel(code: string | undefined): string {
  if (code === undefined) return '—';
  return SHORT_REASON_LABEL[code] ?? code;
}

/**
 * One line's condition: `good 90 · damaged 10 (Crushed) · short 5 (Not
 * shipped)` — the damaged and short parts only when present. Quantities at
 * the SKU's precision when known (else the raw number).
 */
export function grnLineConditionLabel(
  line: Pick<GoodsReceiptLineEntryDto, 'qty' | 'damagedQty' | 'damageReasonCode' | 'shortQty' | 'shortReasonCode'>,
  uom: QuantityUom | null,
): string {
  const q = (value: number) => (uom === null ? String(value) : formatQuantity(value, uom.uomPrecision));
  const parts = [`good ${q(line.qty)}`];
  if (line.damagedQty !== undefined && line.damagedQty > 0) {
    parts.push(`damaged ${q(line.damagedQty)} (${damageReasonLabel(line.damageReasonCode)})`);
  }
  if (line.shortQty !== undefined && line.shortQty > 0) {
    parts.push(`short ${q(line.shortQty)} (${shortReasonLabel(line.shortReasonCode)})`);
  }
  return parts.join(' · ');
}

/** The applied part when it differs from the good units: ` · applied 8 (+2 pending)`, else ''. */
export function grnLineAppliedLabel(line: Pick<GoodsReceiptLineEntryDto, 'qty' | 'appliedQty'>, uom: QuantityUom | null): string {
  if (line.appliedQty === line.qty) return '';
  const pending = Math.round((line.qty - line.appliedQty) * 1000) / 1000;
  return ` · applied ${uom === null ? String(line.appliedQty) : quantityLabel(line.appliedQty, uom)} (+${uom === null ? pending : formatQuantity(pending, uom.uomPrecision)} pending)`;
}

/** The list's Units suffix for damaged units: ` +3 damaged`, or '' when none (a pre-2-4a server sends no field). */
export function grnDamagedSuffix(grn: Pick<GoodsReceiptEntryDto, 'damagedUnits'>): string {
  const damaged = (grn as { damagedUnits?: number }).damagedUnits ?? 0;
  return damaged > 0 ? ` +${damaged} damaged` : '';
}

/** The list's Units suffix for short units: ` · 2 short`, or ''. */
export function grnShortSuffix(grn: Pick<GoodsReceiptEntryDto, 'shortUnits'>): string {
  const short = (grn as { shortUnits?: number }).shortUnits ?? 0;
  return short > 0 ? ` · ${short} short` : '';
}

// ── story 2-6a: the serials captured on a line ───────────────────────────────

export type GrnLineSerial = NonNullable<GoodsReceiptLineEntryDto['serials']>[number];

/** Each serial unit's state in words (A19) — a `Record` over the generated union. */
export const SERIAL_STATE_LABEL: Readonly<Record<GrnLineSerial['state'], string>> = {
  applied: 'Booked',
  pending: 'Awaiting approval',
  rejected: 'Approval rejected',
};

/** The chip tone per state: booked is neutral, waiting is a warning, rejected an error. */
export const SERIAL_STATE_TONE: Readonly<Record<GrnLineSerial['state'], 'neutral' | 'warning' | 'error'>> = {
  applied: 'neutral',
  pending: 'warning',
  rejected: 'error',
};

/** The marker beside a serial received again after its write-off. */
export const SERIAL_AFTER_WRITE_OFF_LABEL = 'Re-received after write-off';

/** `N unit(s) — serial unreadable`, or null when none were recorded. */
export function unreadableSerialLabel(line: Pick<GoodsReceiptLineEntryDto, 'unreadableSerialQty'>): string | null {
  const count = line.unreadableSerialQty ?? 0;
  return count > 0 ? `${count} unit${count === 1 ? '' : 's'} — serial unreadable` : null;
}

/** The QC-on-receipt skip in words (A22), or null. */
export function qcSkippedLabel(line: Pick<GoodsReceiptLineEntryDto, 'qcSkipped'>): string | null {
  return line.qcSkipped === 'serial-tracked' ? 'QC on receipt skipped — serial-tracked' : null;
}

/**
 * The collapsed summary of a line's serials: `3 serials · 2 booked · 1
 * awaiting approval` (the states in a fixed order, each only when present),
 * or null when the line captured none.
 */
export function grnSerialSummary(serials: readonly GrnLineSerial[] | undefined): string | null {
  if (serials === undefined || serials.length === 0) return null;
  const counts: Record<GrnLineSerial['state'], number> = { applied: 0, pending: 0, rejected: 0 };
  let rereceived = 0;
  for (const serial of serials) {
    counts[serial.state] += 1;
    if (serial.afterWriteOff === true) rereceived += 1;
  }
  const parts = [`${serials.length} serial${serials.length === 1 ? '' : 's'}`];
  for (const state of ['applied', 'pending', 'rejected'] as const) {
    if (counts[state] > 0) parts.push(`${counts[state]} ${SERIAL_STATE_LABEL[state].toLowerCase()}`);
  }
  if (rereceived > 0) parts.push(`${rereceived} re-received after write-off`);
  return parts.join(' · ');
}

/** The serials whose number contains `query` (case-insensitive, trimmed); every serial when blank. */
export function filterSerials(serials: readonly GrnLineSerial[], query: string): readonly GrnLineSerial[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return serials;
  return serials.filter((serial) => serial.serial.toLowerCase().includes(needle));
}
