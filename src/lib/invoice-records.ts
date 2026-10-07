/**
 * Story 21-5b — the dispute drill-down's pure decisions: the IST rendering of
 * a record's instant, the reconciliation banners, the refusal mapper, the
 * staff pseudonym, and the CSV export (the page walk, its cap, the file's
 * header, rows and footer, its name). The backend decides every figure:
 * nothing here counts, sums or re-derives a quantity — the summary's
 * `reconciles` is the server's comparison, and quantities are its decimal
 * strings.
 *
 * Pure (no React): pinned by `invoice-records.test.ts`.
 */
import { ApiProblem } from '@/lib/api/client';
import type {
  ClientInvoiceDto,
  ClientInvoiceLineDto,
  ClientInvoiceLineRecordsResponse,
  LineRecordsSummaryDto,
  OrderRefDto,
  StorageBreakdownResponse,
} from '@/lib/api/generated';
import { csvField, csvNumber } from '@/lib/csv';
import { lineDescription, lineQuantityLabel } from '@/lib/client-invoices';
import { UNREACHABLE_REASON } from '@/lib/outbound-orders';
import { groupDecimal } from '@/lib/usage';

export type LineRecord = ClientInvoiceLineRecordsResponse['records'][number];
export type LineRecordKind = ClientInvoiceLineRecordsResponse['kind'];
export type ClientInvoiceStatus = ClientInvoiceDto['status'];

/** The on-screen page size ("Load more" asks for the next one). */
export const RECORDS_PAGE_LIMIT = 100;
/** The export's page size — the backend's ceiling (1–1,000). */
export const EXPORT_PAGE_LIMIT = 1000;
/** Decision 1: the export stops at 50,000 rows and says so. */
export const EXPORT_ROW_CAP = 50_000;

// ── instants: UTC on the wire, IST (+05:30) on screen and in the file ───────

const IST_OFFSET_MS = 5.5 * 3600 * 1000;
const INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/;

/** A wire instant (ISO-8601 UTC, up to microseconds) → its IST wall clock, the fraction kept as written. */
function istParts(instant: string): { wall: string; fraction: string } | null {
  const match = INSTANT_RE.exec(instant);
  if (match === null) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]));
  if (Number.isNaN(ms)) return null;
  return { wall: new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 19), fraction: match[7] ?? '' };
}

/** On screen: `2026-09-16 10:00:00 +05:30` (to the second). An unparseable value is shown as given. */
export function formatIstInstant(instant: string): string {
  const parts = istParts(instant);
  return parts === null ? instant : `${parts.wall.replace('T', ' ')} +05:30`;
}

/** In the file: `2026-09-16T10:00:00.123456+05:30` — the full precision the server sent, in IST. */
export function istInstantIso(instant: string): string {
  const parts = istParts(instant);
  if (parts === null) return instant;
  return `${parts.wall}${parts.fraction === '' ? '' : `.${parts.fraction}`}+05:30`;
}

/** The IST calendar date of a wire instant (a 20:00Z pick is the NEXT IST day). */
export function istDateOfInstant(instant: string): string {
  const parts = istParts(instant);
  return parts === null ? instant.slice(0, 10) : parts.wall.slice(0, 10);
}

// ── labels ───────────────────────────────────────────────────────────────────

/** "Channel ref": the channel's event id, falling back to the order id (a manual order has no other reference). */
export function orderRefLabel(ref: OrderRefDto): string {
  return ref.externalEventId ?? ref.orderId;
}

/** The record count noun of a line's kind. */
export const RECORD_NOUN: Readonly<Record<LineRecordKind, readonly [string, string]>> = {
  'receipt-line': ['GRN line', 'GRN lines'],
  pick: ['pick', 'picks'],
  order: ['order', 'orders'],
  'storage-day': ['storage day', 'storage days'],
};

export function recordCountLabel(kind: LineRecordKind, count: number, more: boolean): string {
  const [one, many] = RECORD_NOUN[kind];
  return `${count.toLocaleString('en-IN')}${more ? '+' : ''} ${count === 1 && !more ? one : many} shown`;
}

/** The summary's sentence: the records' figure against the line's, both the server's strings. */
export function summaryLabel(line: Pick<ClientInvoiceLineDto, 'chargeCode' | 'uom'>, summary: LineRecordsSummaryDto): string {
  const records = lineQuantityLabel({ ...line, quantity: summary.recordsQuantity });
  const invoiced = lineQuantityLabel({ ...line, quantity: summary.lineQuantity });
  return summary.reconciles ? `Records add up to ${records} — the invoiced quantity.` : `Records add up to ${records}; the line invoices ${invoiced}.`;
}

export const DRIFT_WORD = 'These records no longer add up to the invoiced quantity';
export const DRAFT_STALE_WORD = 'Draft may be out of date — Refresh';
export const INVOICE_CHANGED_WORD = 'Invoice changed — reload';

/**
 * The banner a mismatch shows. On a draft it means the draft is out of date
 * (refresh re-measures it); on any other status it is the alarm — the
 * invoice is frozen, so the records moved (the 21-2b SKU-correction race, or
 * a storage snapshot rebuilt).
 */
export function reconcileNotice(
  status: ClientInvoiceStatus,
  line: Pick<ClientInvoiceLineDto, 'chargeCode' | 'uom'>,
  summary: LineRecordsSummaryDto,
): { tone: 'warning'; word: string; reason: string } | null {
  if (summary.reconciles) return null;
  const records = lineQuantityLabel({ ...line, quantity: summary.recordsQuantity });
  const invoiced = lineQuantityLabel({ ...line, quantity: summary.lineQuantity });
  if (status === 'draft') {
    return { tone: 'warning', word: DRAFT_STALE_WORD, reason: `The records now add up to ${records}; the draft counted ${invoiced}. Refresh the draft to re-measure it.` };
  }
  return {
    tone: 'warning',
    word: DRIFT_WORD,
    reason: `Invoiced ${invoiced}; the records now add up to ${records}. A SKU's client was corrected while it moved, or a storage snapshot was rebuilt — the issued invoice does not change.`,
  };
}

/**
 * A storage day's breakdown that does not add up to its snapshot: the same
 * warning banner (and the same per-status word) as a line's mismatch.
 */
export function breakdownNotice(
  status: ClientInvoiceStatus,
  data: Pick<StorageBreakdownResponse, 'reconciles' | 'total' | 'snapshotOnHand' | 'uom'>,
): { tone: 'warning'; word: string; reason: string } | null {
  if (data.reconciles) return null;
  const snapshot = data.snapshotOnHand === null ? 'no snapshot (the day closed at or below zero)' : `${groupDecimal(data.snapshotOnHand)} ${data.uom}`;
  return {
    tone: 'warning',
    word: status === 'draft' ? DRAFT_STALE_WORD : DRIFT_WORD,
    reason: `The SKUs add up to ${groupDecimal(data.total)} ${data.uom}; the day's snapshot holds ${snapshot}.`,
  };
}

/** The session ended under an open breakdown (or drill): nothing can be read until sign-in. */
export const SESSION_EXPIRED_REASON = 'Your session expired — sign in again.';

/** The drill's (and the export's) read refusals, by code. */
export function lineRecordsReason(error: unknown, status: ClientInvoiceStatus): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'not-found':
        return status === 'draft'
          ? `${INVOICE_CHANGED_WORD}: the draft was refreshed and its lines were rewritten.`
          : 'This invoice or line no longer exists — reload.';
      case 'invoice-group-changed':
        return error.detail ?? 'The invoice’s registration no longer maps to any warehouse, so its records cannot be selected.';
      case 'invalid-cursor':
        return 'That page reference is stale — reload the records.';
      case 'role-denied':
        return 'Client invoices are an operator surface — this session cannot read them.';
      case 'permission-denied':
        return 'That data belongs to another tenant — sign in again.';
      case 'unauthenticated':
        return SESSION_EXPIRED_REASON;
      default:
        return error.detail ?? `Could not load the records (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

/** A 404 under a draft: the draft was refreshed — the recovery is to reload the invoice. */
export function needsInvoiceReload(error: unknown, status: ClientInvoiceStatus): boolean {
  return error instanceof ApiProblem && error.code === 'not-found' && status === 'draft';
}

// ── decision 2: staff pseudonyms in the file ────────────────────────────────

/** `user-` + the first 8 hex digits of sha256(`tenantId:userId`) — stable per tenant, never the email. */
export async function actorPseudonym(tenantId: string, userId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${tenantId}:${userId}`));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `user-${hex.slice(0, 8)}`;
}

/** Every actor of the records, pseudonymised once. */
export async function pseudonymsOf(tenantId: string, records: readonly LineRecord[]): Promise<Map<string, string>> {
  const ids = [...new Set(records.flatMap((record) => ('actorId' in record ? [record.actorId] : [])))];
  const pairs = await Promise.all(ids.map(async (id) => [id, await actorPseudonym(tenantId, id)] as const));
  return new Map(pairs);
}

// ── the export ───────────────────────────────────────────────────────────────

export type RecordsPageFetcher = (cursor: string | undefined, limit: number, signal: AbortSignal) => Promise<ClientInvoiceLineRecordsResponse>;

export interface LineRecordsExport {
  readonly kind: LineRecordKind;
  /** The first page's summary. */
  readonly summary: LineRecordsSummaryDto;
  /** The summary re-read after the last page. */
  readonly endSummary: LineRecordsSummaryDto;
  readonly records: readonly LineRecord[];
  /** More records existed past the cap. */
  readonly truncated: boolean;
}

/**
 * Walk every page at the export limit (each page its own request), stopping
 * at the 50,000-row cap; then re-read the summary. Any refusal (a 404 when a
 * draft was refreshed mid-export) or an abort throws — the caller never
 * builds a partial file.
 */
export async function collectLineRecords(
  fetchPage: RecordsPageFetcher,
  signal: AbortSignal,
  onProgress: (rows: number) => void = () => undefined,
): Promise<LineRecordsExport> {
  const records: LineRecord[] = [];
  let cursor: string | undefined;
  let first: ClientInvoiceLineRecordsResponse | null = null;
  let truncated = false;
  for (;;) {
    signal.throwIfAborted();
    const page = await fetchPage(cursor, EXPORT_PAGE_LIMIT, signal);
    first ??= page;
    records.push(...page.records);
    onProgress(Math.min(records.length, EXPORT_ROW_CAP));
    if (page.nextCursor === null) break;
    if (records.length >= EXPORT_ROW_CAP) {
      truncated = true;
      break;
    }
    cursor = page.nextCursor;
  }
  if (records.length > EXPORT_ROW_CAP) {
    truncated = true;
    records.length = EXPORT_ROW_CAP;
  }
  signal.throwIfAborted();
  const end = await fetchPage(undefined, 1, signal);
  if (first.summary === undefined || end.summary === undefined) {
    throw new Error('The first page of a line drill carries its summary — this response had none.');
  }
  return { kind: first.kind, summary: first.summary, endSummary: end.summary, records, truncated };
}

/** The file's name: `<invoiceNo | draft-<id8>>-<chargeCode>-<segmentFrom>.csv` (a `/` in the number becomes `-`). */
export function lineRecordsFilename(
  invoice: Pick<ClientInvoiceDto, 'invoiceNo' | 'id'>,
  line: Pick<ClientInvoiceLineDto, 'chargeCode' | 'segmentFrom'>,
): string {
  const head = invoice.invoiceNo === null ? `draft-${invoice.id.slice(0, 8)}` : invoice.invoiceNo.replaceAll('/', '-');
  return `${head}-${line.chargeCode}-${line.segmentFrom}.csv`;
}

const yesNo = (value: boolean): string => (value ? 'yes' : 'no');
/** A comment line's value: one line, whatever the data held. */
const oneLine = (value: string): string => value.replace(/[\r\n]+/g, ' ');

const HEADERS: Readonly<Record<LineRecordKind, readonly string[]>> = {
  'receipt-line': ['recorded_at_ist', 'ist_date', 'grn', 'po', 'warehouse', 'sku_code', 'sku_name', 'qty', 'applied_qty', 'actor'],
  pick: ['picked_at_ist', 'ist_date', 'warehouse', 'channel_ref', 'order_id', 'sku_code', 'sku_name', 'qty', 'bin', 'actor'],
  order: ['dispatched_at_ist', 'ist_date', 'warehouse', 'channel_ref', 'order_id', 'lines', 'carrier', 'tracking', 'actor'],
  'storage-day': ['ist_date', 'warehouse', 'uom', 'on_hand'],
};

/** One CSV row: text through `csvField` (guarded), numbers through `csvNumber` (plain), the actor as its pseudonym. */
function recordRow(record: LineRecord, pseudonyms: ReadonlyMap<string, string>): string {
  const actor = (id: string): string => csvField(pseudonyms.get(id) ?? 'user-unknown');
  switch (record.kind) {
    case 'receipt-line':
      return [
        csvField(istInstantIso(record.recordedAt)),
        csvField(istDateOfInstant(record.recordedAt)),
        csvField(record.grnCode),
        csvField(record.poCode ?? ''),
        csvField(record.warehouseCode),
        csvField(record.skuCode),
        csvField(record.skuName),
        csvNumber(record.qty),
        csvNumber(record.appliedQty),
        actor(record.actorId),
      ].join(',');
    case 'pick':
      return [
        csvField(istInstantIso(record.pickedAt)),
        csvField(istDateOfInstant(record.pickedAt)),
        csvField(record.warehouseCode),
        csvField(orderRefLabel(record.orderRef)),
        csvField(record.orderRef.orderId),
        csvField(record.skuCode),
        csvField(record.skuName),
        csvNumber(record.qty),
        csvField(record.binCode ?? ''),
        actor(record.actorId),
      ].join(',');
    case 'order':
      return [
        csvField(istInstantIso(record.dispatchedAt)),
        csvField(istDateOfInstant(record.dispatchedAt)),
        csvField(record.warehouseCode),
        csvField(orderRefLabel(record.orderRef)),
        csvField(record.orderRef.orderId),
        csvNumber(record.lines),
        csvField(record.carrierName ?? ''),
        csvField(record.trackingNumber ?? ''),
        actor(record.actorId),
      ].join(',');
    case 'storage-day':
      return [csvField(record.date), csvField(record.warehouseCode), csvField(record.uom), csvNumber(record.onHand)].join(',');
  }
}

export interface LineRecordsCsvInput {
  readonly invoice: Pick<ClientInvoiceDto, 'invoiceNo' | 'id' | 'status' | 'supplierGstin' | 'periodStart' | 'periodEnd' | 'party'>;
  readonly line: Pick<ClientInvoiceLineDto, 'chargeCode' | 'uom' | 'segmentFrom' | 'segmentTo' | 'quantity'>;
  readonly exported: LineRecordsExport;
  readonly pseudonyms: ReadonlyMap<string, string>;
  /** When the file was built — an ISO-8601 UTC instant (written in IST). */
  readonly generatedAt: string;
}

/**
 * The file (decision 1): a UTF-8 BOM; `#` comment lines naming the invoice
 * number and status, the supplying GSTIN, the client, the period, the line
 * and its segment dates, the records total, the line quantity, whether they
 * reconcile (the first page's summary) and when the file was generated —
 * each comment line written as ONE guarded `csvField` cell, so no text in it
 * (a client name holding `, =…`) can split into a formula cell; the header
 * row and one row per record (decision 2: actors pseudonymised, no device
 * ids, no emails); then the footer — the summary re-checked at the end, and
 * the cap notice when it was reached.
 */
export function buildLineRecordsCsv({ invoice, line, exported, pseudonyms, generatedAt }: LineRecordsCsvInput): string {
  const { summary, endSummary } = exported;
  const recipient = invoice.party.recipient;
  const head = [
    `# Invoice: ${oneLine(invoice.invoiceNo ?? `Draft ${invoice.id}`)}`,
    `# Status: ${invoice.status}`,
    `# Supplying GSTIN: ${oneLine(invoice.supplierGstin ?? 'none')}`,
    `# Client: ${oneLine(`${recipient.code} — ${recipient.legalName ?? recipient.name}`)}`,
    `# Period: ${invoice.periodStart} to ${invoice.periodEnd}`,
    `# Line: ${oneLine(lineDescription(line))}`,
    `# Segment: ${line.segmentFrom} to ${line.segmentTo}`,
    `# Records total: ${oneLine(lineQuantityLabel({ ...line, quantity: summary.recordsQuantity }))}`,
    `# Line quantity: ${oneLine(lineQuantityLabel({ ...line, quantity: summary.lineQuantity }))}`,
    `# Reconciles: ${yesNo(summary.reconciles)}`,
    `# Generated: ${istInstantIso(generatedAt)}`,
    '# Times are IST (+05:30). Staff appear as stable pseudonyms.',
  ];
  const changed =
    endSummary.reconciles !== summary.reconciles || endSummary.recordsQuantity !== summary.recordsQuantity || endSummary.lineQuantity !== summary.lineQuantity;
  const foot = [
    changed
      ? `# Changed during export: at the start the records totalled ${summary.recordsQuantity} (reconciles: ${yesNo(summary.reconciles)}); at the end ${endSummary.recordsQuantity} (reconciles: ${yesNo(endSummary.reconciles)}). Export again.`
      : `# Re-checked at the end of the export: reconciles ${yesNo(endSummary.reconciles)}.`,
    ...(exported.truncated ? [`# Truncated: only the first ${EXPORT_ROW_CAP.toLocaleString('en-IN')} records are in this file.`] : []),
  ];
  const rows = exported.records.map((record) => recordRow(record, pseudonyms));
  // A comment line is one quoted, guarded cell: whatever text it holds stays in it.
  const comment = (line: string): string => csvField(line);
  return `\uFEFF${[...head.map(comment), HEADERS[exported.kind].join(','), ...rows, ...foot.map(comment)].join('\n')}\n`;
}

/** The progress line while an export runs. */
export function exportProgressLabel(rows: number): string {
  return `Exporting… ${rows.toLocaleString('en-IN')} records`;
}

/** The notice after an export that hit the cap. */
export function exportCapNotice(truncated: boolean): string | null {
  return truncated ? `Only the first ${EXPORT_ROW_CAP.toLocaleString('en-IN')} records were exported — the file says so in its footer.` : null;
}
