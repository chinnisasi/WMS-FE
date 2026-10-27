/**
 * Story 4-1c — the order import's pure half, for both surfaces (staff
 * Outbound → Orders, and the client portal's Orders page): the caps, the
 * columns and templates, the refused-row reasons in words, the result's
 * sentences (Check file's stock caveat; staff backorders named; an
 * unfinished run), the formula-safe CSV error report, the file-level refusal
 * mapper and the same-file rule that keeps the Import key (A13). The server
 * parses the file; this client never reads it.
 *
 * Pure: no React, no fetch, no operator hook — the portal reaches it
 * (`portal-boundary.test.ts`). Pinned by `order-import.test.ts`.
 */
import { ApiProblem } from '@/lib/api/client';
import type { OrderImportResponseDto, OrderImportRowErrorDto, PortalOrderImportResponseDto } from '@/lib/api/generated';
import { csvField } from '@/lib/csv';

export type OrderImportSurface = 'staff' | 'portal';
export type OrderImportRowErrorCode = OrderImportRowErrorDto['code'];
/** Either surface's response — the portal's carries no client or backorder facts. */
export type OrderImportResult = OrderImportResponseDto | PortalOrderImportResponseDto;

/** The backend's caps, mirrored (`order-import.parse.ts`, `sheet-reader.ts`). */
export const MAX_ORDER_IMPORT_BYTES = 5 * 1024 * 1024;
export const MAX_ORDER_IMPORT_ROWS = 300;
export const MAX_ORDER_IMPORT_ORDERS = 100;
export const MAX_ORDER_IMPORT_LINES = 200;

/** The on-screen refused-rows table shows a bounded window; the CSV report carries every row. */
export const MAX_RENDERED_ORDER_IMPORT_ERRORS = 100;

/** The file's columns per surface, in the template's order (the server reads them in any order, case-insensitively). */
export const ORDER_IMPORT_COLUMNS: Readonly<Record<OrderImportSurface, readonly string[]>> = {
  staff: [
    'order_ref',
    'client',
    'sku',
    'quantity',
    'rate',
    'ship_to_name',
    'ship_to_phone',
    'ship_to_line1',
    'ship_to_line2',
    'ship_to_city',
    'ship_to_state',
    'ship_to_pincode',
    'consignee_gstin',
    'consignee_legal_name',
    'order_type',
    'priority',
    'ship_by',
    'cod_amount',
    'warehouse',
  ],
  portal: [
    'order_ref',
    'sku',
    'quantity',
    'ship_to_name',
    'ship_to_phone',
    'ship_to_line1',
    'ship_to_line2',
    'ship_to_city',
    'ship_to_state',
    'ship_to_pincode',
    'consignee_gstin',
    'consignee_legal_name',
    'order_type',
    'priority',
    'ship_by',
    'cod_amount',
    'warehouse',
  ],
};

/** The columns every file's header must carry. */
export const ORDER_IMPORT_REQUIRED_COLUMNS: readonly string[] = [
  'order_ref',
  'sku',
  'quantity',
  'ship_to_name',
  'ship_to_phone',
  'ship_to_line1',
  'ship_to_city',
  'ship_to_state',
  'ship_to_pincode',
];

/**
 * The downloadable template: the header, then two example orders — SO-1001
 * with two lines (the second leaves the order's cells blank, which means
 * "the same as the first row"), and SO-1002 with one. `warehouse` is left
 * blank: blank means the warehouse the import is for.
 */
export function orderImportTemplate(surface: OrderImportSurface, shipBy: string): string {
  const example = (cells: Record<string, string>): string => ORDER_IMPORT_COLUMNS[surface].map((column) => csvField(cells[column] ?? '')).join(',');
  const address = {
    ship_to_name: 'Priya Sharma',
    ship_to_phone: '9845012345',
    ship_to_line1: '12 Peenya Industrial Area',
    ship_to_line2: 'Gate 3',
    ship_to_city: 'Bengaluru',
    ship_to_state: 'Karnataka',
    ship_to_pincode: '560058',
  };
  return (
    [
      ORDER_IMPORT_COLUMNS[surface].join(','),
      example({ order_ref: 'SO-1001', sku: 'SKU-CODE-1', quantity: '2', ...(surface === 'staff' ? { rate: '499.00' } : {}), ...address, priority: 'normal', ship_by: shipBy }),
      example({ order_ref: 'SO-1001', sku: 'SKU-CODE-2', quantity: '1', ...(surface === 'staff' ? { rate: '249.50' } : {}) }),
      example({ order_ref: 'SO-1002', sku: 'SKU-CODE-1', quantity: '5', ...address, ship_to_name: 'Ravi Kumar', ship_to_line2: '', cod_amount: '2495.00' }),
    ].join('\n') + '\n'
  );
}

/** The help line under the panel title, per surface (A8: type ref, phone and pincode as text). */
export function orderImportHelp(surface: OrderImportSurface): string {
  const client =
    surface === 'staff'
      ? ' client (blank = the client the SKUs belong to; the tenant’s own goods are "self"; name it when several clients hold the codes), rate (rupees per base unit),'
      : '';
  return (
    'CSV or Excel (.xlsx), one row per order line, grouped into orders by order_ref. Required: order_ref, sku, quantity (in the SKU’s base unit) and the ship-to — ' +
    'ship_to_name, ship_to_phone, ship_to_line1, ship_to_city, ship_to_state, ship_to_pincode. Optional:' +
    client +
    ' ship_to_line2, consignee_gstin, consignee_legal_name, order_type (b2b / b2c), priority (normal / high' +
    (surface === 'staff' ? ' / urgent' : '') +
    '), ship_by (YYYY-MM-DD or an Excel date), cod_amount (rupees) and warehouse (blank or this warehouse). ' +
    'An order’s later rows may leave its ship-to and order cells blank. In Excel, type order_ref, ship_to_phone and ship_to_pincode as text, so a leading zero is kept. ' +
    `At most ${MAX_ORDER_IMPORT_ROWS} rows, ${MAX_ORDER_IMPORT_ORDERS} orders, ${MAX_ORDER_IMPORT_LINES} lines per order and 5 MB. An order with any bad row is refused whole; the others are created.`
  );
}

/** Each refused row's reason, in words — a `Record` over the generated union, so a new code fails the build. */
export const ORDER_IMPORT_REASON_LABEL: Readonly<Record<OrderImportRowErrorCode, string>> = {
  'missing-value': 'Missing value',
  'unknown-client': 'Unknown client',
  'unknown-warehouse': 'Unknown warehouse',
  'wrong-warehouse': 'Another warehouse',
  'unknown-sku': 'Unknown SKU',
  'sku-client-mismatch': 'SKU of another client',
  'mixed-client': 'SKUs of several clients',
  'client-required': 'Name the client — several clients hold these codes',
  'invalid-quantity': 'Invalid quantity',
  'quantity-precision': 'Too many decimals',
  'invalid-rate': 'Invalid rate',
  'invalid-cod-amount': 'Invalid COD amount',
  'invalid-ship-by': 'Invalid ship-by date',
  'order-rows-disagree': 'Rows disagree',
  'duplicate-sku-in-order': 'SKU listed twice',
  'duplicate-order-in-file': 'Order number twice in the file',
  'too-many-lines': `More than ${MAX_ORDER_IMPORT_LINES} lines`,
  'validation-failed': 'Order details refused',
  'not-found': 'Not found',
  // A13 — the staff detail names the warehouse and the order holding it.
  'duplicate-client-order-ref': 'Order number already used — imported before?',
  'client-departed': 'Client departed',
  'client-suspended': 'Client suspended',
  'sku-inactive': 'Inactive SKU short of stock',
  'licence-not-covered': 'Licence not on file',
  'order-catalog-changed': 'Catalog changed — import again',
  'order-backorder-rejected': 'Not enough stock',
  'order-changed-since-first-run': 'Created by an earlier run',
  'order-refused': 'Order refused',
};

/** The reason in words, or the code itself for one this build does not know. */
export function orderImportReasonLabel(code: string): string {
  return Object.prototype.hasOwnProperty.call(ORDER_IMPORT_REASON_LABEL, code)
    ? ORDER_IMPORT_REASON_LABEL[code as OrderImportRowErrorCode]
    : code;
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('en-IN')} ${n === 1 ? one : many}`;
}

/** The lines the accepted orders carry. */
export function acceptedOrderLineCount(result: Pick<OrderImportResult, 'orders'>): number {
  return result.orders.reduce((total, order) => total + order.lineCount, 0);
}

/** The distinct spreadsheet rows refused (a row can carry more than one problem). */
export function refusedOrderRowCount(result: Pick<OrderImportResult, 'errors'>): number {
  return new Set(result.errors.map((error) => error.rowNumber)).size;
}

/** Staff: the created orders with a backordered line, and how many lines. */
export function backorderSummary(result: OrderImportResult): { orders: number; lines: number } {
  let orders = 0;
  let lines = 0;
  for (const order of result.orders) {
    const count = 'backorderedLineCount' in order ? (order.backorderedLineCount ?? 0) : 0;
    if (count > 0) {
      orders += 1;
      lines += count;
    }
  }
  return { orders, lines };
}

/**
 * The result's banner. Check file says what WOULD happen and that it cannot
 * promise stock (decision 10): a staff order may still backorder, a portal
 * order may still be refused for a shortage. Import says what did, names the
 * staff backorders, and an unfinished run (A3) says how far it got and to
 * Import again with the same file. Refused rows are named whenever there are
 * any, never hidden behind a success word.
 */
export function orderImportOutcome(
  result: OrderImportResult,
  surface: OrderImportSurface,
): { tone: 'accepted' | 'rejected' | 'warning'; word: string; reason: string } {
  const lines = acceptedOrderLineCount(result);
  const rows = refusedOrderRowCount(result);
  const refused =
    result.errors.length === 0
      ? null
      : (result.refusedCount > 0 ? `${plural(result.refusedCount, 'order', 'orders')} refused — ` : '') +
        `${plural(rows, 'row', 'rows')} with problems, listed below`;
  const created = surface === 'portal' ? 'placed' : 'created';
  if (result.dryRun) {
    const stock =
      surface === 'portal'
        ? 'Stock is checked at Import: an order short of stock is refused then.'
        : 'Stock is reserved at Import: a line short of stock is backordered then.';
    return {
      tone: result.acceptedCount === 0 ? 'rejected' : 'accepted',
      word: result.acceptedCount === 0 ? 'No order is ready' : `${plural(result.acceptedCount, 'order', 'orders')}, ${plural(lines, 'line', 'lines')} ready`,
      reason:
        refused === null
          ? `Nothing has been written yet — Import ${surface === 'portal' ? 'places' : 'creates'} them. ${stock}`
          : `${refused}. An order with any bad row is refused whole; Import ${surface === 'portal' ? 'places' : 'creates'} the others. Nothing has been written yet. ${stock}`,
    };
  }
  if (!result.complete) {
    const processed = result.orderCount - result.notAttemptedCount;
    return {
      tone: 'warning',
      word: `${processed.toLocaleString('en-IN')} of ${plural(result.orderCount, 'order', 'orders')} processed`,
      reason: `${plural(result.acceptedCount, 'order', 'orders')} ${created} so far. Import again with the same file to finish — the orders already ${created} are not ${created} twice.`,
    };
  }
  const backorders = backorderSummary(result);
  const backorderNote =
    backorders.lines === 0
      ? ''
      : ` ${plural(backorders.lines, 'line', 'lines')} on ${plural(backorders.orders, 'order', 'orders')} backordered — short of stock, they wait for inbound.`;
  return {
    tone: result.acceptedCount === 0 ? 'rejected' : 'accepted',
    word: result.acceptedCount === 0 ? 'No orders imported' : `${plural(result.acceptedCount, 'order', 'orders')} ${created}`,
    reason:
      refused === null
        ? `${plural(lines, 'line', 'lines')} ${created} — they go to waves like any other order.${backorderNote}`
        : `${refused}. Fix those rows and import them in a new file — an order already ${created} is refused as a used order number.${backorderNote}`,
  };
}

/**
 * The CSV error report (A14): every refused row with its spreadsheet row
 * number, order number, its own sku and quantity cells, reason code and
 * words, and the server's detail — every cell through `csvField`, so a value
 * starting `=`, `+`, `-` or `@` stays inert in Excel. UTF-8 BOM so Excel opens
 * it as UTF-8.
 */
export function orderImportErrorReport(result: Pick<OrderImportResult, 'errors'>): string {
  const header = 'row_number,order_ref,sku,quantity,code,reason,detail';
  const lines = result.errors.map((error) =>
    [
      String(error.rowNumber),
      csvField(error.orderRef ?? ''),
      csvField(error.sku ?? ''),
      csvField(error.quantity ?? ''),
      csvField(error.code),
      csvField(orderImportReasonLabel(error.code)),
      csvField(error.detail),
    ].join(','),
  );
  return `\uFEFF${[header, ...lines].join('\n')}\n`;
}

/** The report's file name — the import's id when there is one, else the file's. */
export function orderImportReportName(result: Pick<OrderImportResult, 'importId' | 'fileSha256'>): string {
  return `order-import-${result.importId ?? result.fileSha256.slice(0, 12)}-errors.csv`;
}

/**
 * A13 — the Import key is kept while the picked file is the CHECKED one:
 * the same name, size and last-modified time (re-picking the same file after
 * a timeout keeps the key, so the retry resumes); any other file is a new
 * intent and gets a new key.
 */
export function sameOrderImportFile(
  a: Pick<File, 'name' | 'size' | 'lastModified'> | null,
  b: Pick<File, 'name' | 'size' | 'lastModified'> | null,
): boolean {
  return a !== null && b !== null && a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
}

/** The file could not be read in the browser (moved, deleted, or permission lost since it was picked). */
export function orderImportFileReadProblem(name: string): string {
  return `${name} could not be read — it may have been moved or changed since you picked it. Pick it again.`;
}

const UNREACHABLE = 'The server could not be reached — check your connection and try again.';

/** The file-level refusals of the import, branching on `code` — never on prose. */
export function orderImportReason(error: unknown, surface: OrderImportSurface): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'unsupported-file-type':
        return 'Only .csv and .xlsx files can be imported — save the sheet as CSV or Excel.';
      case 'file-unreadable':
        return error.detail ?? 'The file could not be read — check it is a CSV or a one-sheet Excel file with a header row.';
      case 'missing-columns':
        return error.detail ?? `The header is missing required columns (${ORDER_IMPORT_REQUIRED_COLUMNS.join(', ')}) — start from the template.`;
      case 'import-too-large':
        return (
          error.detail ??
          `The file is over a cap — at most ${MAX_ORDER_IMPORT_ROWS} rows, ${MAX_ORDER_IMPORT_ORDERS} orders and 5 MB per import.`
        );
      case 'import-in-progress':
        return 'This import is still running — wait a moment, then press Import again to read its result.';
      case 'reservation-store-unavailable':
        // The server's detail says how many orders were created before the store went away.
        return error.detail ?? 'The stock store is unreachable — Import again with the same file once it is back; nothing is created twice.';
      case 'not-found':
        return 'This warehouse no longer exists — refresh the page.';
      case 'role-denied':
        return surface === 'portal' ? 'Your account cannot place orders for this company.' : 'Your role cannot import orders.';
      case 'client-suspended':
        return "Your company's portal access is suspended — the orders already placed stay; contact the warehouse.";
      case 'client-departed':
        return 'Your company no longer takes new orders here — contact the warehouse.';
      case 'permission-denied':
        return 'Your session belongs to another tenant — sign in again.';
      case 'idempotency-key-reuse':
        return 'This import was already run with a different file — pick the file again and check it before importing.';
      case 'conflict':
        return 'The same import is still in flight — press Import again to read its settled result.';
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
      case 'validation-failed':
        return error.detail ?? 'Attach a file and try again.';
      default:
        return error.detail ?? `The file was not imported (${error.code}).`;
    }
  }
  return UNREACHABLE;
}

/** The template's example ship-by: three IST days after `todayIst` (YYYY-MM-DD), so a fresh template imports as-is. */
export function templateShipBy(todayIst: string): string {
  const [y, m, d] = todayIst.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 3)).toISOString().slice(0, 10);
}
