import type { LedgerEventDto, LedgerReferenceDocDto } from '@/lib/api/generated';
import { quantityLabel, type QuantityUom } from '@/lib/format-quantity';

/**
 * Story 9-1b — the Ledger page's cell copy (`components/inventory/ledger.tsx`),
 * extracted so each sentence is pinned by `ledger.test.ts`.
 */

/** A short raw id — the first 8 characters, for an id with no code in hand. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

const IST_SECONDS = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/**
 * When the server recorded the event, on the IST clock — `06 Oct 2026,
 * 15:30:05` (seconds shown: events cluster). Composed from parts, so no
 * ICU build's joining words leak in.
 */
export function ledgerRecordedLabel(iso: string): string {
  const parts = IST_SECONDS.formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('day')} ${part('month')} ${part('year')}, ${part('hour')}:${part('minute')}:${part('second')}`;
}

/**
 * The signed movement at the SKU's declared precision — `+2.500 kg`,
 * `−3 each` (a true minus sign), the variance panel's model.
 */
export function ledgerQuantityLabel(delta: number, sku: QuantityUom | null): string {
  return delta < 0 ? `−${quantityLabel(Math.abs(delta), sku)}` : `+${quantityLabel(delta, sku)}`;
}

/** `FROM → TO` by bin code; an unknown bin by its short id; no bin as "—". */
export function ledgerBinsLabel(
  event: Pick<LedgerEventDto, 'fromBinId' | 'toBinId'>,
  binCodes: Readonly<Record<string, string>> | null,
): string {
  const code = (id: string | null) => (id === null ? '—' : (binCodes?.[id] ?? shortId(id)));
  return `${code(event.fromBinId)} → ${code(event.toBinId)}`;
}

/** The event's batch or serial arm as a short raw id, or "—" on an arm-less event. */
export function ledgerArmLabel(event: Pick<LedgerEventDto, 'batchRef' | 'serialRef'>): string {
  const parts: string[] = [];
  if (event.batchRef !== null) parts.push(`batch ${shortId(event.batchRef)}`);
  if (event.serialRef !== null) parts.push(`serial ${shortId(event.serialRef)}`);
  return parts.length === 0 ? '—' : parts.join(' · ');
}

/**
 * The reference document: its `kind`, then each TYPED field that is present
 * (`LedgerReferenceDocDto`) — ids short, words verbatim. Nothing outside the
 * generated type is read.
 */
export function ledgerReferenceLabel(doc: LedgerReferenceDocDto | null): string {
  if (doc === null) return '—';
  const parts: string[] = [doc.kind];
  if (doc.reasonCode !== undefined) parts.push(`reason ${doc.reasonCode}`);
  if (doc.overrideReason !== undefined) parts.push(`override: ${doc.overrideReason}`);
  if (doc.grnId !== undefined) parts.push(`GRN ${shortId(doc.grnId)}`);
  if (doc.poId !== undefined) parts.push(`PO ${shortId(doc.poId)}`);
  if (doc.poLineId !== undefined) parts.push(`PO line ${shortId(doc.poLineId)}`);
  if (doc.asnId !== undefined) parts.push(`ASN ${shortId(doc.asnId)}`);
  if (doc.asnLineId !== undefined) parts.push(`ASN line ${shortId(doc.asnLineId)}`);
  // Story 3-1 — the bin-to-bin move the event belongs to.
  if (doc.moveId !== undefined) parts.push(`move ${shortId(doc.moveId)}`);
  if (doc.note !== undefined) parts.push(`“${doc.note}”`);
  return parts.join(' · ');
}
