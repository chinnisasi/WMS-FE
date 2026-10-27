import { describe, expect, test } from 'bun:test';

import { ApiProblem } from '@/lib/api/client';
import type { OrderImportResponseDto, PortalOrderImportResponseDto } from '@/lib/api/generated';
import { AUDIT_TARGET_LABEL } from '@/lib/audit';
import {
  MAX_ORDER_IMPORT_ORDERS,
  MAX_ORDER_IMPORT_ROWS,
  ORDER_IMPORT_COLUMNS,
  ORDER_IMPORT_REASON_LABEL,
  ORDER_IMPORT_REQUIRED_COLUMNS,
  backorderSummary,
  orderImportErrorReport,
  orderImportHelp,
  orderImportOutcome,
  orderImportReason,
  orderImportReasonLabel,
  orderImportReportName,
  orderImportTemplate,
  sameOrderImportFile,
  templateShipBy,
} from '@/lib/order-import';

// Story 4-1c — the order import's pure half (both surfaces).

function staff(over: Partial<OrderImportResponseDto> = {}): OrderImportResponseDto {
  return {
    importId: null,
    dryRun: true,
    warehouseId: 'wh-1',
    fileSha256: 'c0ffee'.repeat(10) + 'abcd',
    rowCount: 5,
    orderCount: 3,
    acceptedCount: 2,
    refusedCount: 1,
    complete: true,
    notAttemptedCount: 0,
    orders: [
      { orderId: null, clientOrderRef: 'SO-1', lineCount: 2, firstRow: 2, replayed: false, clientId: 'c-1', clientLabel: 'ACME', backorderedLineCount: null },
      { orderId: null, clientOrderRef: 'SO-2', lineCount: 1, firstRow: 4, replayed: false, clientId: 'c-1', clientLabel: 'ACME', backorderedLineCount: null },
    ],
    errors: [{ rowNumber: 5, orderRef: 'SO-3', sku: 'X', quantity: '1', code: 'unknown-sku', detail: 'No SKU with code "X" exists in this tenant.' }],
    ...over,
  };
}

function portal(over: Partial<PortalOrderImportResponseDto> = {}): PortalOrderImportResponseDto {
  return {
    importId: 'imp-1',
    dryRun: false,
    warehouseId: 'wh-1',
    fileSha256: 'ab'.repeat(32),
    rowCount: 2,
    orderCount: 2,
    acceptedCount: 2,
    refusedCount: 0,
    complete: true,
    notAttemptedCount: 0,
    orders: [
      { orderId: 'o-1', clientOrderRef: 'SO-1', lineCount: 1, firstRow: 2, replayed: false },
      { orderId: 'o-2', clientOrderRef: 'SO-2', lineCount: 1, firstRow: 3, replayed: true },
    ],
    errors: [],
    ...over,
  };
}

describe('order import (story 4-1c)', () => {
  test('the caps mirror the backend’s (decision 6 lowered them); the portal reads no client and no rate', () => {
    expect([MAX_ORDER_IMPORT_ROWS, MAX_ORDER_IMPORT_ORDERS]).toEqual([300, 100]);
    expect(ORDER_IMPORT_COLUMNS.portal).not.toContain('client');
    expect(ORDER_IMPORT_COLUMNS.portal).not.toContain('rate');
    for (const surface of ['staff', 'portal'] as const) {
      for (const column of ORDER_IMPORT_REQUIRED_COLUMNS) expect(ORDER_IMPORT_COLUMNS[surface]).toContain(column);
    }
    expect(orderImportHelp('portal')).not.toContain('urgent');
    expect(orderImportHelp('staff')).toContain('urgent');
    expect(orderImportHelp('staff')).toContain('type order_ref, ship_to_phone and ship_to_pincode as text');
  });

  test('the template: the header and two orders (the second row of SO-1001 leaves its order cells blank); the ship-by is three IST days out', () => {
    expect(templateShipBy('2026-10-30')).toBe('2026-11-02');
    const lines = orderImportTemplate('staff', '2026-11-02').trimEnd().split('\n');
    expect(lines[0]).toBe(ORDER_IMPORT_COLUMNS.staff.join(','));
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain('"SO-1001"');
    expect(lines[1]).toContain('"2026-11-02"');
    expect(lines[2]).toContain('"SO-1001"');
    expect(lines[2]).not.toContain('Priya');
    const portalHeader = orderImportTemplate('portal', '2026-11-02').split('\n')[0];
    expect(portalHeader).toBe(ORDER_IMPORT_COLUMNS.portal.join(','));
  });

  test('every row-error code has words; an unknown code falls back to itself; the audit target is labelled', () => {
    for (const label of Object.values(ORDER_IMPORT_REASON_LABEL)) expect(label.length).toBeGreaterThan(0);
    expect(orderImportReasonLabel('duplicate-client-order-ref')).toBe('Order number already used — imported before?');
    expect(orderImportReasonLabel('brand-new-code')).toBe('brand-new-code');
    expect(AUDIT_TARGET_LABEL.order_import).toBe('Order import');
  });

  test('Check file says what would happen and cannot promise stock, per surface', () => {
    expect(orderImportOutcome(staff(), 'staff')).toEqual({
      tone: 'accepted',
      word: '2 orders, 3 lines ready',
      reason:
        '1 order refused — 1 row with problems, listed below. An order with any bad row is refused whole; Import creates the others. Nothing has been written yet. Stock is reserved at Import: a line short of stock is backordered then.',
    });
    expect(orderImportOutcome(staff({ acceptedCount: 0, orders: [] }), 'staff')).toMatchObject({ tone: 'rejected', word: 'No order is ready' });
    expect(orderImportOutcome(portal({ dryRun: true, importId: null }), 'portal').reason).toContain('an order short of stock is refused then');
  });

  test('Import names what happened: staff backorders, the portal’s placed orders, and an unfinished run (A3)', () => {
    const done = staff({
      dryRun: false,
      importId: 'imp-1',
      orders: staff().orders.map((order, index) => ({ ...order, orderId: `o-${index}`, backorderedLineCount: index === 0 ? 2 : 0 })),
    });
    expect(backorderSummary(done)).toEqual({ orders: 1, lines: 2 });
    expect(orderImportOutcome(done, 'staff')).toMatchObject({ tone: 'accepted', word: '2 orders created' });
    expect(orderImportOutcome(done, 'staff').reason).toContain('2 lines on 1 order backordered');
    expect(orderImportOutcome(portal(), 'portal')).toEqual({
      tone: 'accepted',
      word: '2 orders placed',
      reason: '2 lines placed — they go to waves like any other order.',
    });
    const partial = orderImportOutcome(portal({ complete: false, notAttemptedCount: 1, orderCount: 3, acceptedCount: 2, importId: null }), 'portal');
    expect(partial).toEqual({
      tone: 'warning',
      word: '2 of 3 orders processed',
      reason: '2 orders placed so far. Import again with the same file to finish — the orders already placed are not placed twice.',
    });
  });

  test('A14: the error report carries every refused row and keeps formulas inert; its name is the import’s or the file’s', () => {
    const report = orderImportErrorReport({
      errors: [
        { rowNumber: 2, orderRef: '=SO-1', sku: '+A', quantity: '-1', code: 'invalid-quantity', detail: '@detail "quoted"' },
        { rowNumber: 3, orderRef: null, sku: null, quantity: null, code: 'missing-value', detail: 'order_ref is blank.' },
      ],
    });
    const [header, first, second] = report.replace('﻿', '').trimEnd().split('\n');
    expect(report.startsWith('﻿')).toBe(true);
    expect(header).toBe('row_number,order_ref,sku,quantity,code,reason,detail');
    expect(first).toBe(`2,"'=SO-1","'+A","'-1","invalid-quantity","Invalid quantity","'@detail ""quoted"""`);
    expect(second).toBe('3,"","","","missing-value","Missing value","order_ref is blank."');
    expect(orderImportReportName({ importId: null, fileSha256: 'c0ffee'.repeat(10) })).toBe('order-import-c0ffeec0ffee-errors.csv');
    expect(orderImportReportName({ importId: 'imp-1', fileSha256: 'x' })).toBe('order-import-imp-1-errors.csv');
  });

  test('A13: the same file is the same name, size and last-modified time', () => {
    const a = { name: 'o.csv', size: 10, lastModified: 5 };
    expect(sameOrderImportFile(a, { ...a })).toBe(true);
    expect(sameOrderImportFile(a, { ...a, lastModified: 6 })).toBe(false);
    expect(sameOrderImportFile(a, { ...a, size: 11 })).toBe(false);
    expect(sameOrderImportFile(a, null)).toBe(false);
  });

  test('file-level refusals branch on the code, never the prose', () => {
    expect(orderImportReason(new ApiProblem('import-in-progress', 409, 'x'), 'staff')).toBe(
      'This import is still running — wait a moment, then press Import again to read its result.',
    );
    expect(orderImportReason(new ApiProblem('reservation-store-unavailable', 503, '1 order was created before …'), 'staff')).toBe('1 order was created before …');
    expect(orderImportReason(new ApiProblem('role-denied', 403), 'portal')).toBe('Your account cannot place orders for this company.');
    expect(orderImportReason(new ApiProblem('role-denied', 403), 'staff')).toBe('Your role cannot import orders.');
    expect(orderImportReason(new ApiProblem('client-suspended', 403), 'portal')).toContain('suspended');
    expect(orderImportReason(new ApiProblem('import-too-large', 422), 'staff')).toContain('300 rows, 100 orders');
    expect(orderImportReason(new Error('boom'), 'staff')).toContain('could not be reached');
  });
});
