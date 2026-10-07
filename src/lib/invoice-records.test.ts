import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';

import { ApiProblem } from './api/client';
import type { ClientInvoiceLineRecordsResponse } from './api/generated';
import {
  DRAFT_STALE_WORD,
  DRIFT_WORD,
  EXPORT_PAGE_LIMIT,
  EXPORT_ROW_CAP,
  INVOICE_CHANGED_WORD,
  actorPseudonym,
  breakdownNotice,
  buildLineRecordsCsv,
  collectLineRecords,
  exportCapNotice,
  formatIstInstant,
  istDateOfInstant,
  istInstantIso,
  lineRecordsFilename,
  lineRecordsReason,
  needsInvoiceReload,
  orderRefLabel,
  pseudonymsOf,
  reconcileNotice,
  summaryLabel,
  type LineRecord,
} from './invoice-records';
import { UNREACHABLE_REASON } from './outbound-orders';

const TENANT = '0198f7a2-1b3c-7d4e-8f90-112233445566';
const ACTOR = '0198f7a2-0000-7000-8000-00000000beef';

const PICK_LINE = { chargeCode: 'pick' as const, uom: null, segmentFrom: '2026-09-15', segmentTo: '2026-09-30', quantity: '412' };
const STORAGE_LINE = { chargeCode: 'storage' as const, uom: 'kg', segmentFrom: '2026-09-01', segmentTo: '2026-09-30', quantity: '1234.567' };

function pick(id: string, over: Partial<Extract<LineRecord, { kind: 'pick' }>> = {}): LineRecord {
  return {
    kind: 'pick',
    id,
    pickedAt: '2026-09-16T20:00:00.123456Z',
    warehouseId: 'w1',
    warehouseCode: 'BLR1',
    orderRef: { source: 'ingested', externalEventId: 'shopify-1', orderId: 'o-1' },
    skuId: 's1',
    skuCode: 'ACME-PC',
    skuName: 'Acme widget',
    qty: '2.5',
    binCode: 'A-01-01',
    actorId: ACTOR,
    actorEmail: 'priya@example.com',
    ...over,
  };
}

function problem(code: string, status: number, detail?: string): ApiProblem {
  return new ApiProblem(code, status, detail);
}

describe('instants: UTC on the wire, IST (+05:30) on screen and in the file', () => {
  test('a 20:00Z pick is the NEXT IST day; the file keeps the microseconds', () => {
    expect(formatIstInstant('2026-09-16T20:00:00.123456Z')).toBe('2026-09-17 01:30:00 +05:30');
    expect(istInstantIso('2026-09-16T20:00:00.123456Z')).toBe('2026-09-17T01:30:00.123456+05:30');
    expect(istDateOfInstant('2026-09-16T20:00:00.123456Z')).toBe('2026-09-17');
    expect(istInstantIso('2026-09-16T04:30:00Z')).toBe('2026-09-16T10:00:00+05:30');
    expect(istDateOfInstant('2026-09-30T18:29:59.999999Z')).toBe('2026-09-30');
    expect(istDateOfInstant('2026-09-30T18:30:00.000000Z')).toBe('2026-10-01');
  });

  test('an unparseable value is shown as given (never a wrong date)', () => {
    expect(formatIstInstant('soon')).toBe('soon');
    expect(istInstantIso('soon')).toBe('soon');
  });
});

describe('labels and banners', () => {
  test('Channel ref falls back to the order id', () => {
    expect(orderRefLabel({ source: 'ingested', externalEventId: 'shopify-1', orderId: 'o-1' })).toBe('shopify-1');
    expect(orderRefLabel({ source: 'manual', externalEventId: null, orderId: 'o-1' })).toBe('o-1');
  });

  test('a reconciling summary raises no banner, on any status', () => {
    const summary = { lineQuantity: '412', recordsQuantity: '412', reconciles: true };
    for (const status of ['draft', 'issued', 'disputed', 'settled', 'void'] as const) expect(reconcileNotice(status, PICK_LINE, summary)).toBeNull();
    expect(summaryLabel(PICK_LINE, summary)).toBe('Records add up to 412 picks — the invoiced quantity.');
  });

  test('a mismatch: a draft "may be out of date — Refresh"; any other status is the drift alarm — both figures named', () => {
    const summary = { lineQuantity: '412', recordsQuantity: '413', reconciles: false };
    const draft = reconcileNotice('draft', PICK_LINE, summary)!;
    expect(draft.word).toBe(DRAFT_STALE_WORD);
    expect(draft.word).toBe('Draft may be out of date — Refresh');
    expect(draft.reason).toContain('413 picks');
    expect(draft.reason).toContain('412 picks');
    for (const status of ['issued', 'disputed', 'settled', 'void'] as const) {
      const notice = reconcileNotice(status, PICK_LINE, summary)!;
      expect(notice.word).toBe(DRIFT_WORD);
      expect(notice.word).toBe('These records no longer add up to the invoiced quantity');
      expect(notice.reason).toContain('Invoiced 412 picks; the records now add up to 413 picks');
    }
    expect(summaryLabel(STORAGE_LINE, { lineQuantity: '1234.567', recordsQuantity: '1235', reconciles: false })).toBe(
      'Records add up to 1,235 kg-days; the line invoices 1,234.567 kg-days.',
    );
  });

  test('refusals by code: a 404 on a DRAFT is "Invoice changed — reload"; elsewhere it is gone; the group 409 and the transport arm', () => {
    expect(lineRecordsReason(problem('not-found', 404), 'draft')).toContain(INVOICE_CHANGED_WORD);
    expect(needsInvoiceReload(problem('not-found', 404), 'draft')).toBe(true);
    expect(lineRecordsReason(problem('not-found', 404), 'issued')).toBe('This invoice or line no longer exists — reload.');
    expect(needsInvoiceReload(problem('not-found', 404), 'issued')).toBe(false);
    expect(needsInvoiceReload(problem('invalid-cursor', 400), 'draft')).toBe(false);
    expect(lineRecordsReason(problem('invoice-group-changed', 409, 'No warehouse invoices under 27… any more'), 'issued')).toBe('No warehouse invoices under 27… any more');
    expect(lineRecordsReason(problem('invalid-cursor', 400), 'issued')).toBe('That page reference is stale — reload the records.');
    expect(lineRecordsReason(problem('role-denied', 403), 'issued')).toContain('operator surface');
    expect(lineRecordsReason(problem('teapot', 418), 'issued')).toBe('Could not load the records (teapot).');
    expect(lineRecordsReason(new TypeError('Failed to fetch'), 'issued')).toBe(UNREACHABLE_REASON);
  });
});

describe('the breakdown notice', () => {
  test('Σ SKUs ≠ snapshot: the same per-status warning as a line mismatch; none when it adds up', () => {
    const data = { reconciles: false, total: '60', snapshotOnHand: '61', uom: 'each' };
    expect(breakdownNotice('issued', data)).toEqual({ tone: 'warning', word: DRIFT_WORD, reason: "The SKUs add up to 60 each; the day's snapshot holds 61 each." });
    expect(breakdownNotice('draft', data)!.word).toBe(DRAFT_STALE_WORD);
    expect(breakdownNotice('issued', { ...data, snapshotOnHand: null, total: '5' })!.reason).toContain('no snapshot');
    expect(breakdownNotice('issued', { ...data, reconciles: true })).toBeNull();
  });
});

describe('decision 2: staff pseudonyms', () => {
  test('user- + the first 8 hex digits of sha256(tenantId:userId) — stable, and per tenant', async () => {
    const expected = `user-${createHash('sha256').update(`${TENANT}:${ACTOR}`).digest('hex').slice(0, 8)}`;
    expect(await actorPseudonym(TENANT, ACTOR)).toBe(expected);
    expect(await actorPseudonym(TENANT, ACTOR)).toBe(expected);
    expect(await actorPseudonym('0198f7a2-1b3c-7d4e-8f90-000000000000', ACTOR)).not.toBe(expected);
    expect(expected).toMatch(/^user-[0-9a-f]{8}$/);
  });

  test('every actor of the records once; a storage day has none', async () => {
    const map = await pseudonymsOf(TENANT, [pick('p1'), pick('p2'), { kind: 'storage-day', date: '2026-09-01', warehouseId: 'w', warehouseCode: 'W', uom: 'kg', onHand: '1' }]);
    expect([...map.keys()]).toEqual([ACTOR]);
  });
});

describe('the export', () => {
  /** A fake drill of `total` records, paged by the requested limit; the summary only on the first page. */
  function drill(total: number, endSummary = { lineQuantity: String(total), recordsQuantity: String(total), reconciles: true }) {
    const calls: { cursor: string | undefined; limit: number }[] = [];
    const fetchPage = async (cursor: string | undefined, limit: number): Promise<ClientInvoiceLineRecordsResponse> => {
      calls.push({ cursor, limit });
      const start = cursor === undefined ? 0 : Number(cursor);
      const end = Math.min(start + limit, total);
      const records = Array.from({ length: end - start }, (_, i) => pick(`p${start + i}`));
      const first = cursor === undefined;
      const summary = first && calls.length === 1 ? { lineQuantity: String(total), recordsQuantity: String(total), reconciles: true } : endSummary;
      return { kind: 'pick', invoiceStatus: 'issued', ...(first ? { summary } : {}), records, nextCursor: end < total ? String(end) : null };
    };
    return { calls, fetchPage };
  }

  test('walks every page at the export limit, then re-reads the summary', async () => {
    const { calls, fetchPage } = drill(2_500);
    const progress: number[] = [];
    const exported = await collectLineRecords(fetchPage, new AbortController().signal, (rows) => progress.push(rows));
    expect(exported.records).toHaveLength(2_500);
    expect(exported.truncated).toBe(false);
    expect(calls).toEqual([
      { cursor: undefined, limit: EXPORT_PAGE_LIMIT },
      { cursor: '1000', limit: EXPORT_PAGE_LIMIT },
      { cursor: '2000', limit: EXPORT_PAGE_LIMIT },
      { cursor: undefined, limit: 1 },
    ]);
    expect(progress).toEqual([1000, 2000, 2500]);
  });

  test('over the cap: the first 50,000 rows and a truncation flag (and a notice)', async () => {
    const { calls, fetchPage } = drill(EXPORT_ROW_CAP + 10);
    const exported = await collectLineRecords(fetchPage, new AbortController().signal);
    expect(exported.records).toHaveLength(EXPORT_ROW_CAP);
    expect(exported.truncated).toBe(true);
    expect(calls).toHaveLength(EXPORT_ROW_CAP / EXPORT_PAGE_LIMIT + 1);
    expect(exportCapNotice(true)).toContain('50,000');
    expect(exportCapNotice(false)).toBeNull();
    // Exactly at the cap is not truncated.
    expect((await collectLineRecords(drill(EXPORT_ROW_CAP).fetchPage, new AbortController().signal)).truncated).toBe(false);
  });

  test('a refusal mid-walk (a draft refreshed: 404) or a cancel throws — never a partial result', async () => {
    let n = 0;
    const failing = async (cursor: string | undefined): Promise<ClientInvoiceLineRecordsResponse> => {
      n += 1;
      if (n === 2) throw problem('not-found', 404);
      return { kind: 'pick', invoiceStatus: 'draft', summary: { lineQuantity: '2', recordsQuantity: '2', reconciles: true }, records: [pick(`p${cursor ?? 0}`)], nextCursor: 'next' };
    };
    await expect(collectLineRecords(failing, new AbortController().signal)).rejects.toMatchObject({ code: 'not-found' });
    const controller = new AbortController();
    const { fetchPage } = drill(3_000);
    const cancelling = async (cursor: string | undefined, limit: number, signal: AbortSignal) => {
      const page = await fetchPage(cursor, limit);
      controller.abort();
      void signal;
      return page;
    };
    await expect(collectLineRecords(cancelling, controller.signal)).rejects.toBeDefined();
  });

  test('the file: BOM, # header naming invoice/client/period/line/totals/reconciles, IST rows with a date column, pseudonyms (no email), plain numbers, the re-check footer', async () => {
    const records = [pick('p1'), pick('p2', { actorEmail: null, orderRef: { source: 'manual', externalEventId: null, orderId: 'o-2' }, skuName: '=HYPERLINK("x")', qty: '-1' })];
    const pseudonyms = await pseudonymsOf(TENANT, records);
    const summary = { lineQuantity: '412', recordsQuantity: '412', reconciles: true };
    const text = buildLineRecordsCsv({
      invoice: {
        id: '0198f7a2-aaaa-7000-8000-000000000001',
        invoiceNo: '29/S2627/000001',
        status: 'issued',
        supplierGstin: '29AAACT1234A1Z5',
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
        party: { recipient: { code: 'ACME', name: 'Acme', legalName: 'Acme Foods Pvt Ltd' } } as never,
      },
      line: PICK_LINE,
      exported: { kind: 'pick', summary, endSummary: summary, records, truncated: false },
      pseudonyms,
      generatedAt: '2026-10-07T04:30:00.000Z',
    });
    expect(text.startsWith('\uFEFF"# Invoice: 29/S2627/000001"\n')).toBe(true);
    const lines = text.slice(1).trimEnd().split('\n');
    expect(lines.slice(0, 11)).toEqual([
      '"# Invoice: 29/S2627/000001"',
      '"# Status: issued"',
      '"# Supplying GSTIN: 29AAACT1234A1Z5"',
      '"# Client: ACME — Acme Foods Pvt Ltd"',
      '"# Period: 2026-09-01 to 2026-09-30"',
      '"# Line: Pick · 15 Sep 2026 – 30 Sep 2026"',
      '"# Segment: 2026-09-15 to 2026-09-30"',
      '"# Records total: 412 picks"',
      '"# Line quantity: 412 picks"',
      '"# Reconciles: yes"',
      '"# Generated: 2026-10-07T10:00:00.000+05:30"',
    ]);
    expect(lines[12]).toBe('picked_at_ist,ist_date,warehouse,channel_ref,order_id,sku_code,sku_name,qty,bin,actor');
    const code = pseudonyms.get(ACTOR)!;
    expect(lines[13]).toBe(`"2026-09-17T01:30:00.123456+05:30","2026-09-17","BLR1","shopify-1","o-1","ACME-PC","Acme widget",2.5,"A-01-01","${code}"`);
    expect(lines[14]).toBe(`"2026-09-17T01:30:00.123456+05:30","2026-09-17","BLR1","o-2","o-2","ACME-PC","'=HYPERLINK(""x"")",-1,"A-01-01","${code}"`);
    expect(text).not.toContain('priya@example.com');
    expect(text).not.toContain(ACTOR);
    expect(lines.at(-1)).toBe('"# Re-checked at the end of the export: reconciles yes."');
  });

  test('an injection attempt in the client name stays inside its one comment cell — no cell of the file begins with a formula', () => {
    const summary = { lineQuantity: '1', recordsQuantity: '1', reconciles: true };
    const text = buildLineRecordsCsv({
      invoice: {
        id: '0198f7a2-aaaa-7000-8000-000000000001',
        invoiceNo: '29/S2627/000001',
        status: 'issued',
        supplierGstin: '29AAACT1234A1Z5',
        periodStart: '2026-09-01',
        periodEnd: '2026-09-30',
        party: { recipient: { code: 'EVIL', name: 'x', legalName: 'Evil Co, =HYPERLINK("http://x","click"),+1\r\n@SUM(1)' } } as never,
      },
      line: PICK_LINE,
      exported: { kind: 'pick', summary, endSummary: summary, records: [], truncated: false },
      pseudonyms: new Map(),
      generatedAt: '2026-10-07T04:30:00.000Z',
    });
    const client = text.split('\n').find((line) => line.includes('Evil Co'))!;
    expect(client).toBe('"# Client: EVIL — Evil Co, =HYPERLINK(""http://x"",""click""),+1 @SUM(1)"');
    // Parse the file as a spreadsheet would: no unquoted cell, and no cell starting =, +, -, @, tab or CR.
    for (const line of text.slice(1).trimEnd().split('\n')) {
      const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((cell) => cell.replace(/,$/, '')).filter((cell) => cell !== '');
      for (const cell of cells) {
        const value = cell.startsWith('"') ? cell.slice(1, -1).replaceAll('""', '"') : cell;
        expect(/^[=+@\t\r]/.test(value)).toBe(false);
      }
    }
  });

  test('the footer says so when the end re-check differs, and when the cap was hit', () => {
    const start = { lineQuantity: '412', recordsQuantity: '412', reconciles: true };
    const end = { lineQuantity: '412', recordsQuantity: '413', reconciles: false };
    const text = buildLineRecordsCsv({
      invoice: { id: '0198f7a2-aaaa-7000-8000-000000000001', invoiceNo: null, status: 'draft', supplierGstin: null, periodStart: '2026-09-01', periodEnd: '2026-09-30', party: { recipient: { code: 'ACME', name: 'Acme', legalName: null } } as never },
      line: PICK_LINE,
      exported: { kind: 'pick', summary: start, endSummary: end, records: [], truncated: true },
      pseudonyms: new Map(),
      generatedAt: '2026-10-07T04:30:00.000Z',
    });
    expect(text).toContain('"# Invoice: Draft 0198f7a2-aaaa-7000-8000-000000000001"');
    expect(text).toContain('"# Status: draft"');
    expect(text).toContain('"# Supplying GSTIN: none"');
    expect(text).toContain('# Changed during export: at the start the records totalled 412 (reconciles: yes); at the end 413 (reconciles: no).');
    expect(text).toContain('# Truncated: only the first 50,000 records are in this file.');
  });

  test('storage rows: the IST day, warehouse, uom and a plain on-hand number', () => {
    const summary = { lineQuantity: '1234.567', recordsQuantity: '1234.567', reconciles: true };
    const text = buildLineRecordsCsv({
      invoice: { id: '0198f7a2-aaaa-7000-8000-000000000001', invoiceNo: '29/S2627/000001', status: 'issued', supplierGstin: '29AAACT1234A1Z5', periodStart: '2026-09-01', periodEnd: '2026-09-30', party: { recipient: { code: 'ACME', name: 'Acme', legalName: null } } as never },
      line: STORAGE_LINE,
      exported: { kind: 'storage-day', summary, endSummary: summary, records: [{ kind: 'storage-day', date: '2026-09-14', warehouseId: 'w', warehouseCode: 'BLR1', uom: 'kg', onHand: '12.5' }], truncated: false },
      pseudonyms: new Map(),
      generatedAt: '2026-10-07T04:30:00.000Z',
    });
    expect(text).toContain('\nist_date,warehouse,uom,on_hand\n"2026-09-14","BLR1","kg",12.5\n');
    expect(text).toContain('# Records total: 1,234.567 kg-days');
  });

  test('the file name: <invoiceNo | draft-id8>-<charge>-<segmentFrom>.csv', () => {
    expect(lineRecordsFilename({ id: '0198f7a2-aaaa-7000', invoiceNo: '29/S2627/000001' }, PICK_LINE)).toBe('29-S2627-000001-pick-2026-09-15.csv');
    expect(lineRecordsFilename({ id: '0198f7a2-aaaa-7000', invoiceNo: null }, STORAGE_LINE)).toBe('draft-0198f7a2-storage-2026-09-01.csv');
  });
});
