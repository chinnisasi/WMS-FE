/**
 * Story 21-7 — the client portal on the web: the routing decisions between
 * the two shells, the portal navigation, the reason mappers, and every
 * sentence and derivation the four portal surfaces render.
 *
 * Pure: no React, no fetch — pinned by `portal.test.ts` (the house rule: a
 * claim left in JSX is a claim nothing can pin).
 */
import { groupIndianDigits } from '@/lib/format-quantity';
import { ApiProblem } from '@/lib/api/client';
import type {
  PortalCreateAsnDto,
  PortalCreateOrderDto,
  PortalPlacedOrderResponse,
  PortalStockRowDto,
  PortalInvoiceDetailResponse,
  PortalOrderRowDto,
  PortalAsnRowDto,
  PortalPurchaseOrderRowDto,
  PortalReturnDispositionDto,
  PortalReturnLineDto,
  PortalReturnRowDto,
  PortalSkuDto,
  PortalWarehouseDto,
} from '@/lib/api/generated';
import type { Session } from '@/lib/auth';
import { CLIENT_INVOICE_STATUS_LABEL } from '@/lib/client-invoices';
import { SECOND_FACTOR_ENDED_NOTICE } from '@/lib/second-factor';
import {
  ASN_STATUS_LABEL,
  MAX_ASN_CODE_LENGTH,
  parseAsnLines,
  parseExpectedAt,
  type AsnDraftLine,
  type LineOption,
} from '@/lib/asns';
import { parseQuantityInput } from '@/lib/format-quantity';
import { parseGstinField } from '@/lib/gstin';
import { istDateOf } from '@/lib/rate-cards';
import { clientOrderRefBody, parseClientOrderRef } from '@/lib/orders';
import { emptyOrderFieldsDraft, parseOrderFieldsDraft, type OrderFieldsDraft } from '@/lib/order-fields-form';
import {
  legalNameBody,
  legalNameProblem,
  MAX_ORDER_LINES,
  ORDER_STATUS_LABEL,
  parseDestinationFields,
  UNREACHABLE_REASON,
  type DestinationFields,
} from '@/lib/outbound-orders';

// ── routing ──────────────────────────────────────────────────────────────────

/**
 * Where a portal session lands (sign-in, the operator shell's redirect).
 * Story UI-1 — the portal's own Home (it was Stock until then).
 */
export const PORTAL_HOME = '/portal';
/** Where a staff session lands after sign-in (unchanged by 21-7). */
export const OPERATOR_HOME = '/settings';

/** A portal session that is gone or expired (a 401, or no session at submit). */
export const PORTAL_SESSION_EXPIRED = 'Your session expired — sign in again.';

/** The suspended-access message the login page shows after a `client-suspended` refusal. */
export const PORTAL_SUSPENDED_MESSAGE = "Your company's portal access is suspended.";
/** Story 1-2a — the words when the client's account with the warehouse has ended (it departed). */
export const PORTAL_DEPARTED_MESSAGE = "Your company's account with the warehouse has ended.";
/** The login query that carries it (`/login?portal=suspended`). */
export const PORTAL_SUSPENDED_LOGIN = '/login?portal=suspended';

/** Sign-in's destination: a client-portal user goes to the portal, staff to Settings. */
export function signInDestination(user: { clientId?: string | null }): string {
  return typeof user.clientId === 'string' ? PORTAL_HOME : OPERATOR_HOME;
}

/**
 * The operator shell's decision once the session is read: render, or
 * replace the URL. A client session never renders the operator shell (so no
 * operator hook ever runs); no session goes to /login.
 */
export function operatorShellRoute(
  session: Session | null,
  loginHref = '/login',
): { kind: 'render' } | { kind: 'redirect'; href: string } {
  if (session === null) return { kind: 'redirect', href: loginHref };
  if (session.user.clientId !== null) return { kind: 'redirect', href: PORTAL_HOME };
  return { kind: 'render' };
}

/** The portal shell's decision: staff go back to their own shell; no session goes to /login. */
export function portalShellRoute(
  session: Session | null,
  loginHref = '/login',
): { kind: 'render' } | { kind: 'redirect'; href: string } {
  if (session === null) return { kind: 'redirect', href: loginHref };
  if (session.user.clientId === null) return { kind: 'redirect', href: OPERATOR_HOME };
  return { kind: 'render' };
}

/** Story 6-1c — after a completed reset (`/login?reset=done`); A10: the code used at the reset is spent. */
export const PASSWORD_RESET_DONE_NOTICE =
  'Password changed — sign in with your new password. If you use two-factor sign-in, wait for the next code in your app.';

/** The login page's notice for its query (`portal=suspended`, `ended=…`, story 6-1c `reset=done`), or null. */
export function loginNotice(portal: string | undefined, ended?: string, reset?: string): string | null {
  if (portal === 'suspended') return PORTAL_SUSPENDED_MESSAGE;
  if (reset === 'done') return PASSWORD_RESET_DONE_NOTICE;
  // Own keys only: `?ended=constructor` must not read an Object.prototype member.
  return ended !== undefined && Object.hasOwn(SESSION_ENDED_NOTICE, ended) ? SESSION_ENDED_NOTICE[ended]! : null;
}

/**
 * Story 6-1a — the sign-in page's words for why a session ended (the
 * server's `reason` on a 401 `session-ended`, carried as `?ended=`).
 */
export const SESSION_ENDED_NOTICE: Readonly<Record<string, string>> = {
  idle: 'You were signed out after 2 hours of inactivity.',
  absolute: 'Your session reached its time limit — sign in again.',
  'signed-out': 'You were signed out.',
  deactivated: 'Your account has been deactivated. Ask your administrator if you think this is a mistake.',
  'role-changed': 'Your role changed — sign in again to continue.',
  'client-suspended': PORTAL_SUSPENDED_MESSAGE,
  // Story 1-2a — the client departed: its portal sessions ended.
  'client-departed': PORTAL_DEPARTED_MESSAGE,
  'refresh-reuse': 'Your session was used from somewhere else and was ended for safety — sign in again.',
  legacy: 'Sign-in was upgraded — please sign in again.',
  // Story 6-1b.
  ...SECOND_FACTOR_ENDED_NOTICE,
  // Story 6-1c — a completed reset ended every session.
  'password-reset': 'Your password was reset — sign in with the new password.',
};

export interface PortalNavItem {
  readonly id: 'home' | 'stock' | 'orders' | 'inbound' | 'returns' | 'recalls' | 'invoices' | 'service';
  readonly label: string;
  readonly href: string;
}

export const PORTAL_NAV: readonly PortalNavItem[] = [
  // Story UI-1 — Home: the portal's landing page (current only on exact `/portal`).
  { id: 'home', label: 'Home', href: PORTAL_HOME },
  { id: 'stock', label: 'Stock', href: '/portal/stock' },
  { id: 'orders', label: 'Orders', href: '/portal/orders' },
  { id: 'inbound', label: 'Inbound', href: '/portal/inbound' },
  // Story 4-7a — the client's returns and what became of each unit.
  { id: 'returns', label: 'Returns', href: '/portal/returns' },
  // Story 3-7a — this company's batch recalls: lots, figures, where they sit, the report.
  { id: 'recalls', label: 'Recalls', href: '/portal/recalls' },
  { id: 'invoices', label: 'Invoices', href: '/portal/invoices' },
  // Story 21-8 — how the operation performed for this client.
  { id: 'service', label: 'Service', href: '/portal/service' },
];

/** The shell header's company line: the client brand's name, else its code, else a neutral word. */
export function portalCompanyLabel(session: Session | null): string {
  return session?.client?.name ?? session?.client?.code ?? 'Client portal';
}

// ── refusals ─────────────────────────────────────────────────────────────────

export { PORTAL_SUSPENDED_EVENT } from '@/lib/auth';

/** True for the refusal that ends a portal session (the client was suspended mid-session). */
export function isClientSuspended(error: unknown): boolean {
  return error instanceof ApiProblem && error.code === 'client-suspended';
}

/** One portal read's failure reason (the subject names what could not load). */
export function portalReadReason(error: unknown, subject: string): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'client-suspended':
        return PORTAL_SUSPENDED_MESSAGE;
      case 'client-departed':
        return PORTAL_DEPARTED_MESSAGE;
      case 'unauthenticated':
        return PORTAL_SESSION_EXPIRED;
      case 'permission-denied':
      case 'role-denied':
        return 'This page is for client-portal users — sign in with your portal account.';
      case 'not-found':
        return `${subject} could not be found — it may not belong to your company.`;
      case 'invalid-cursor':
        return 'That page reference is stale — go back to the first page.';
      default:
        return error.detail ?? `Could not load ${subject} (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

// ── figures ──────────────────────────────────────────────────────────────────

/**
 * A base-unit quantity as the server sent it — grouped, never rounded and
 * never assumed integral (`2.5` stays `2.5`, `1500` reads `1,500`). The
 * portal rows carry no UoM precision, so no padding is invented either.
 */
export function portalQuantity(qty: number): string {
  const text = String(qty);
  if (/e/i.test(text)) return text;
  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const dot = unsigned.indexOf('.');
  const intPart = dot === -1 ? unsigned : unsigned.slice(0, dot);
  const fracPart = dot === -1 ? '' : unsigned.slice(dot);
  // Story UI-2 (W13) — en-IN grouping (was en-US thousands).
  return `${negative ? '−' : ''}${groupIndianDigits(intPart)}${fracPart}`;
}

/** `5 each`, `2.5 kg`. */
export function quantityWithUom(qty: number, uom: string): string {
  return `${portalQuantity(qty)} ${uom}`;
}

/** An instant as the viewer's date (`9 Oct 2026`), or "—". */
export function portalDate(iso: string | null): string {
  if (iso === null) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}

/** Story UI-1 — a date and 24-hour time in IST: "26 Oct 2026, 14:05 IST". */
export function portalDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const day = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
  return `${day}, ${time} IST`;
}

/** A SKU on a line: its code and name, or a dash when the catalog row is not visible. */
export function skuLabel(line: { skuCode: string | null; skuName: string | null }): string {
  if (line.skuCode === null) return '—';
  return line.skuName === null ? line.skuCode : `${line.skuCode} — ${line.skuName}`;
}

// ── orders ───────────────────────────────────────────────────────────────────

export function orderStatusLabel(status: PortalOrderRowDto['status']): string {
  return ORDER_STATUS_LABEL[status];
}

/** Where the order is going: `Asha · Bengaluru 560001`, or "—". */
export function orderDestination(order: Pick<PortalOrderRowDto, 'destinationName' | 'destinationCity' | 'destinationPincode'>): string {
  const place = [order.destinationCity, order.destinationPincode].filter(Boolean).join(' ');
  const parts = [order.destinationName, place].filter((part): part is string => typeof part === 'string' && part !== '');
  return parts.length === 0 ? '—' : parts.join(' · ');
}

/**
 * The order's reference (story 4-1b's label rule, portal-shaped): the
 * client's OWN order number, else the channel's reference, else "Manual" /
 * "Channel" — never an internal id the client has never seen.
 */
export function orderReference(order: Pick<PortalOrderRowDto, 'source' | 'externalRef'> & { readonly clientOrderRef?: string | null }): string {
  const own = order.clientOrderRef ?? null;
  if (own !== null && own !== '') return own;
  if (order.externalRef !== null && order.externalRef !== '') return order.externalRef;
  return order.source === 'manual' ? 'Manual' : 'Channel';
}

export function lineCountLabel(count: number): string {
  return count === 1 ? '1 line' : `${count} lines`;
}

// ── inbound ──────────────────────────────────────────────────────────────────

export function asnStatusLabel(status: PortalAsnRowDto['status']): string {
  return ASN_STATUS_LABEL[status];
}

export const PO_STATUS_LABEL: Readonly<Record<PortalPurchaseOrderRowDto['status'], string>> = {
  open: 'Open',
  closed: 'Closed',
};

/** `12 of 20 received` — the totals sum across UoMs, so they are a progress hint only. */
export function receivedOfLabel(received: number, expected: number): string {
  return `${portalQuantity(received)} of ${portalQuantity(expected)} received`;
}

// ── invoices ─────────────────────────────────────────────────────────────────

export function invoiceStatusLabel(status: PortalInvoiceDetailResponse['status']): string {
  return CLIENT_INVOICE_STATUS_LABEL[status];
}

/** The supplier's printed address lines (from the frozen party, portal shape). */
export function portalSupplierAddress(party: PortalInvoiceDetailResponse['party']): readonly string[] {
  const address = party.supplier.address;
  if (address === null) return [];
  return [address.line1, address.line2, `${address.city}, ${address.state} — ${address.pincode}`].filter(
    (part): part is string => typeof part === 'string' && part !== '',
  );
}

/** The recipient's printed address lines; absent parts skipped. */
export function portalRecipientAddress(party: PortalInvoiceDetailResponse['party']): readonly string[] {
  const { address, stateName } = party.recipient;
  const cityLine = [address.city, stateName].filter(Boolean).join(', ');
  return [address.line1, address.line2, [cityLine, address.pincode].filter(Boolean).join(' — ')].filter(
    (part): part is string => typeof part === 'string' && part !== '',
  );
}

// ── announcing a shipment (story 21-7b) ─────────────────────────────────────

/** The SKU list is drained `limit=100` a page… */
export const PORTAL_SKU_PAGE_LIMIT = 100;
/** …for at most this many pages (2,000 SKUs); beyond that the form says so. */
export const PORTAL_SKU_MAX_PAGES = 20;

/** The form's sentence when the client has no SKU to announce (it is disabled). */
export const PORTAL_NO_SKUS_MESSAGE = 'No SKUs are set up for your company yet — ask the warehouse';
/** The form's sentence when the catalogue outgrows the drain (it is disabled). */
export const PORTAL_SKUS_TOO_MANY_MESSAGE =
  'Your catalogue is too large for this form — ask the warehouse to announce this shipment for you.';

/** The portal's SKU row as the shared line rows' option (portal vocabulary → the minimal option). */
export function portalSkuOption(sku: PortalSkuDto): LineOption {
  return { id: sku.skuId, code: sku.skuCode, name: sku.skuName, uom: sku.baseUom, uomPrecision: sku.uomPrecision };
}

/**
 * The warehouse picker's labels: the name, with the city when another
 * warehouse shares the name (names are not unique; the city tells them
 * apart). Order is the server's `(name, id)`.
 */
export function portalWarehouseOptions(warehouses: readonly PortalWarehouseDto[]): { id: string; label: string }[] {
  const counts = new Map<string, number>();
  for (const warehouse of warehouses) counts.set(warehouse.warehouseName, (counts.get(warehouse.warehouseName) ?? 0) + 1);
  return warehouses.map((warehouse) => ({
    id: warehouse.warehouseId,
    label:
      (counts.get(warehouse.warehouseName) ?? 0) > 1 && warehouse.city !== null && warehouse.city !== ''
        ? `${warehouse.warehouseName} (${warehouse.city})`
        : warehouse.warehouseName,
  }));
}

export interface PortalAsnDraft {
  readonly asnCode: string;
  readonly expectedAt: string;
  readonly lines: readonly AsnDraftLine[];
}

/**
 * The announce body, or the first problem (nothing is sent while one
 * stands): `{warehouseId, asnCode, expectedAt?, lines[{skuId,
 * announcedQty}]}` — NEVER a `clientId` (the client is the session's; the
 * server refuses one) and never a line `id` (there is no portal amend).
 */
export function parsePortalAsnCreate(
  draft: PortalAsnDraft,
  warehouseId: string,
): { body: PortalCreateAsnDto | null; problem: string | null } {
  if (warehouseId === '') return { body: null, problem: 'Choose the warehouse the shipment arrives at.' };
  const code = draft.asnCode.trim();
  const codeLength = [...code].length;
  if (codeLength === 0 || codeLength > MAX_ASN_CODE_LENGTH) {
    return { body: null, problem: `The shipment reference is 1–${MAX_ASN_CODE_LENGTH} characters — your own code for it.` };
  }
  const expected = parseExpectedAt(draft.expectedAt);
  if (expected.problem !== null) return { body: null, problem: expected.problem };
  const parsed = parseAsnLines(draft.lines);
  if (parsed.problem !== null) return { body: null, problem: parsed.problem };
  return {
    body: {
      warehouseId,
      asnCode: code,
      // Blank stays ABSENT, never `null` or `''`.
      ...(expected.expectedAt === null ? {} : { expectedAt: expected.expectedAt }),
      // Ids stripped: the line rows never carry one here, and the portal
      // body must not (a line id is 400 at the server).
      lines: parsed.lines.map((line) => ({ skuId: line.skuId, announcedQty: line.announcedQty })),
    },
    problem: null,
  };
}

/** The announce refusals, in portal words — branching on the problem `code`, never on prose. */
export function portalAsnReason(error: unknown): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'client-suspended':
      case 'client-departed':
      case 'role-denied':
      case 'permission-denied':
      case 'unauthenticated':
        return portalReadReason(error, 'This shipment notice');
      case 'not-found':
        return 'A SKU or warehouse is no longer available — reload the form and pick again.';
      case 'duplicate-asn-code':
        return 'You already have a shipment notice with this reference — use another one.';
      case 'kit-cannot-hold-stock':
        return 'A kit cannot be announced — announce the SKUs it is made of instead.';
      // Story 1-4b — a fixed portal sentence: the SKU was discontinued.
      case 'sku-inactive':
        return 'A SKU on this notice is no longer active with the warehouse — remove it and send the rest.';
      case 'validation-failed':
        // A fixed portal sentence — never the server's validator wording.
        return 'Check the quantities, the reference and the expected arrival, then try again.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed with different details — reload and try again.';
      case 'conflict':
        return 'The same submission is still being processed — try again in a moment.';
      default:
        return error.detail ?? `The shipment notice was not sent (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

// ── placing an order (story 4-1a) ───────────────────────────────────────────

/** The backend's `@ArrayMaxSize` on a portal order's lines — the staff order's ceiling (`MAX_ORDER_LINES`), never a copy. */
export const MAX_PORTAL_ORDER_LINES = MAX_ORDER_LINES;

/** The order form's sentence when the client has no SKU to order (it is disabled). */
export const PORTAL_ORDER_NO_SKUS_MESSAGE = 'No active SKUs are set up for your company yet — ask the warehouse';
/** The order form's sentence when the tenant has no warehouse (it is disabled). */
export const PORTAL_ORDER_NO_WAREHOUSES_MESSAGE = 'No warehouses are set up yet — ask the warehouse';
/** The order form's sentence when the catalogue outgrows the drain (it is disabled). */
export const PORTAL_ORDER_SKUS_TOO_MANY_MESSAGE =
  'Your catalogue is too large for this form — ask the warehouse to place this order for you.';

export interface PortalOrderDraft {
  readonly lines: readonly AsnDraftLine[];
  readonly destination: DestinationFields;
  readonly consigneeGstin: string;
  readonly consigneeLegalName: string;
  /** Story 4-1b — "Your order number (optional)"; blank sends no key. Optional so older drafts read as blank. */
  readonly clientOrderRef?: string;
  /** Story 4-2a — type, priority (Normal / High), ship-by and COD. Optional so older drafts read as untouched. */
  readonly orderFields?: OrderFieldsDraft;
}

/**
 * The place-an-order body, or the first problem (nothing is sent while one
 * stands): `{warehouseId, lines[{skuId, quantity}], destination,
 * consigneeGstin?, consigneeLegalName?}` — NEVER a `clientId` (the client is
 * the session's; the server refuses one) and never a `ratePaise` (a client
 * does not price its own order; the server refuses one). Empty rows are
 * dropped; quantities follow the decimal grammar and are never rounded (the
 * server refuses a value finer than its unit, naming it).
 */
export function parsePortalOrderCreate(
  draft: PortalOrderDraft,
  warehouseId: string,
  skus: Readonly<Record<string, Pick<LineOption, 'code' | 'uom' | 'uomPrecision'>>> = {},
  todayIst: string = istDateOf(Date.now()),
): { body: PortalCreateOrderDto | null; problem: string | null } {
  if (warehouseId === '') return { body: null, problem: 'Choose the warehouse the order ships from.' };
  const filled = draft.lines.filter((line) => line.skuId !== '' || line.qty.trim() !== '');
  if (filled.length === 0) return { body: null, problem: 'Add at least one line — a SKU and a quantity.' };
  if (filled.length > MAX_PORTAL_ORDER_LINES) {
    return { body: null, problem: `An order carries at most ${MAX_PORTAL_ORDER_LINES} lines.` };
  }
  const lines: { skuId: string; quantity: number }[] = [];
  for (const [index, line] of filled.entries()) {
    if (line.skuId === '') return { body: null, problem: 'Every line needs a SKU.' };
    const quantity = parseQuantityInput(line.qty);
    if (quantity === null || quantity <= 0) return { body: null, problem: 'Every quantity is a decimal greater than zero.' };
    // The SKU's declared precision (each = 0 places, kg = 3), named by line —
    // never rounded; a SKU missing from the options is the server's to judge.
    const option = skus[line.skuId];
    const places = line.qty.trim().split('.')[1]?.length ?? 0;
    if (option !== undefined && places > option.uomPrecision) {
      const allowed = option.uomPrecision === 0 ? 'whole numbers only' : `at most ${option.uomPrecision} decimal place${option.uomPrecision === 1 ? '' : 's'}`;
      return { body: null, problem: `Line ${index + 1}: ${option.code} is counted in ${option.uom} — ${allowed} (got ${line.qty.trim()}).` };
    }
    lines.push({ skuId: line.skuId, quantity });
  }
  const address = parseDestinationFields(draft.destination, 'destination');
  if (address.problem !== null) return { body: null, problem: address.problem };
  const buyer = parseGstinField(draft.consigneeGstin, 'Buyer GSTIN');
  if (buyer.problem !== null) return { body: null, problem: buyer.problem };
  const legalProblem = legalNameProblem(buyer.gstin, draft.consigneeLegalName);
  if (legalProblem !== null) return { body: null, problem: legalProblem };
  // Story 4-1b — the order number's shape, as the server reads it (trimmed; blank = absent).
  const own = parseClientOrderRef(draft.clientOrderRef ?? '', 'Your order number');
  if (own.problem !== null) return { body: null, problem: own.problem };
  // Story 4-2a — the order fields, each only when chosen (urgent refused: A12).
  const fields = parseOrderFieldsDraft(draft.orderFields ?? emptyOrderFieldsDraft(), {
    todayIst,
    hasBuyerGstin: buyer.gstin !== undefined,
    surface: 'portal',
  });
  if (fields.problem !== null) return { body: null, problem: fields.problem };
  return {
    body: {
      warehouseId,
      lines,
      destination: address.destination!,
      // Blank = absent: no key at all, never `''`.
      ...(buyer.gstin === undefined ? {} : { consigneeGstin: buyer.gstin }),
      // Sent only beside a GSTIN, and only when non-blank.
      ...legalNameBody(buyer.gstin, draft.consigneeLegalName),
      // Story 4-1b — only when given.
      ...clientOrderRefBody(own.ref),
      // Story 4-2a — only the chosen keys (the portal never sends urgent).
      ...(fields.body as Omit<typeof fields.body, 'priority'> & { priority?: 'high' }),
    },
    problem: null,
  };
}

/** An instant as IST wall time with the date (`22 Oct 2026, 10:30 IST`), or the raw text when unparsable. */
export function portalInstantIst(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const day = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
  return `${day}, ${time} IST`;
}

/** The success banner: `{word: 'Order placed', reason: '2 lines to Main (22 Oct 2026, 10:30 IST)'}` — from the RESPONSE. */
export function placedOrderBanner(placed: PortalPlacedOrderResponse): { word: string; reason: string } {
  // Story 4-1b — named by the client's own number when it gave one (absent on an older replay).
  const own = placed.clientOrderRef ?? null;
  return {
    word: own === null || own === '' ? 'Order placed' : `Order ${own} placed`,
    reason: `${lineCountLabel(placed.lineCount)} to ${placed.warehouseName} (${portalInstantIst(placed.placedAt)}) — follow it in the list below.`,
  };
}

/**
 * The non-blocking per-line hint (decision 9): on hand less allocated at the
 * chosen warehouse, from `portal/stock` — or null when there is nothing to
 * say (no SKU, no warehouse, or a TRUNCATED stock read with no row for it: a
 * missing row then proves nothing, so never a false 0). Worded as what it is
 * — on hand counts receiving and QC too, so it is not a promise. Never a
 * gate: the server's reservation is the ruling.
 */
export function availableHereLabel(
  stock: readonly PortalStockRowDto[],
  skuId: string,
  warehouseId: string,
  uom: string | undefined,
  truncated = false,
): string | null {
  if (skuId === '' || warehouseId === '') return null;
  const rows = stock.filter((row) => row.skuId === skuId && row.warehouseId === warehouseId);
  if (rows.length === 0 && truncated) return null;
  const free = rows.reduce((total, row) => total + Math.max(0, row.onHand - row.allocated), 0);
  return `on hand, not yet allocated: ${portalQuantity(free)}${uom === undefined ? '' : ` ${uom}`}`;
}

/** The SKU codes a refusal names (`extensions.skuCodes`), else []. */
function refusedSkuCodes(error: ApiProblem): string[] {
  const codes = error.extensions['skuCodes'];
  return Array.isArray(codes) ? codes.filter((code): code is string => typeof code === 'string') : [];
}

/**
 * The place-an-order refusals, in portal words — a FIXED sentence per code,
 * branching on the problem `code`, never on prose and never echoing
 * `detail` (a portal sentence must not carry a reservation, a rate, a
 * licence gap or another client). The shortage names the client's own short
 * SKUs from `extensions.skuCodes`.
 */
export function portalOrderReason(error: unknown, clientOrderRef: string | null = null): string {
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case 'client-suspended':
      case 'client-departed':
      case 'role-denied':
      case 'permission-denied':
      case 'unauthenticated':
        return portalReadReason(error, 'This order');
      case 'not-found':
        return 'A SKU or warehouse is no longer available — reload the form and pick again.';
      case 'order-backorder-rejected': {
        const codes = refusedSkuCodes(error);
        const named = codes.length === 0 ? 'some lines' : codes.join(', ');
        return `Not enough stock at this warehouse for ${named} — nothing was placed. Lower the quantities or choose another warehouse.`;
      }
      case 'licence-not-covered':
        return 'A licence for one of these products is not on file with the warehouse — nothing was placed. Contact the warehouse.';
      case 'sku-inactive':
        return 'A SKU on this order is no longer active with the warehouse — remove it and place the rest.';
      case 'order-catalog-changed':
        return 'The warehouse changed one of these products while you ordered — nothing was placed. Reload the form and try again.';
      case 'reservation-store-unavailable':
        return 'The warehouse could not check stock just now — nothing was placed. Try again in a moment.';
      // Story 4-1b (decision 9) — the number is the user's own input, never the server's words.
      case 'duplicate-client-order-ref':
        return clientOrderRef === null
          ? 'That order number is already used by one of your open orders — use a different number.'
          : `Order number ${clientOrderRef} is already used by one of your open orders — use a different number.`;
      case 'validation-failed':
        // A fixed portal sentence — never the server's validator wording.
        return 'Check the quantities, the ship-to address, the buyer GSTIN and your order number, then try again.';
      case 'idempotency-key-reuse':
        return 'This submission was already processed with different details — reload and try again.';
      case 'conflict':
        return 'The same order is still being processed — try again in a moment.';
      default:
        return `The order was not placed (${error.code}).`;
    }
  }
  return UNREACHABLE_REASON;
}

// ── story UI-1: Home counts and the order timeline ──────────────────────────

/** Whether a navigation item is the current page — Home only on exact `/portal`. */
export function portalNavCurrent(item: Pick<PortalNavItem, 'href'>, pathname: string | null | undefined): boolean {
  if (typeof pathname !== 'string') return false;
  if (item.href === PORTAL_HOME) return pathname === PORTAL_HOME;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/**
 * A count read from ONE page of a list: the number shown, and "+" when the
 * list has a further page — "at least this many". Never a page size, never a
 * total the API did not return (UI-PATTERNS §3.4).
 */
export function atLeastCount(shown: number, nextCursor: string | null): string {
  return nextCursor === null ? String(shown) : `${shown}+`;
}

/** An ASN still expected at the dock (announced, or part-received). */
export function asnExpected(asn: Pick<PortalAsnRowDto, 'status'>): boolean {
  return asn.status === 'announced' || asn.status === 'partially_received';
}

export type PortalTimelineState = 'done' | 'current' | 'upcoming' | 'stopped';
export interface PortalTimelineStep {
  readonly label: string;
  readonly state: PortalTimelineState;
  readonly time?: string;
}

/**
 * The steps after Placed, per status — exhaustive over the generated union,
 * so a new lifecycle arm fails the compile here. The read carries no
 * per-step times, so only Placed (the order's `createdAt`) has one. A
 * cancelled order shows Placed then Cancelled: the read does not say how far
 * it had got, so the timeline does not guess.
 */
const ORDER_TIMELINE: Readonly<Record<PortalOrderRowDto['status'], readonly Omit<PortalTimelineStep, 'time'>[]>> = {
  accepted: [
    { label: 'Accepted', state: 'current' },
    { label: 'Packed', state: 'upcoming' },
    { label: 'Dispatched', state: 'upcoming' },
  ],
  ready_to_dispatch: [
    { label: 'Accepted', state: 'done' },
    { label: 'Packed', state: 'current' },
    { label: 'Dispatched', state: 'upcoming' },
  ],
  dispatched: [
    { label: 'Accepted', state: 'done' },
    { label: 'Packed', state: 'done' },
    { label: 'Dispatched', state: 'done' },
  ],
  cancelled: [{ label: 'Cancelled', state: 'stopped' }],
};

/** An order's lifecycle for the portal timeline: Placed (with its IST time), then the status's steps. */
export function orderTimeline(order: Pick<PortalOrderRowDto, 'status' | 'createdAt'>): readonly PortalTimelineStep[] {
  // A status a newer backend added and this build does not know: Placed alone, never a guess.
  const rest = Object.hasOwn(ORDER_TIMELINE, order.status) ? ORDER_TIMELINE[order.status] : [];
  return [{ label: 'Placed', state: 'done', time: portalDateTime(order.createdAt) }, ...rest];
}

// ── returns (story 4-7a) ─────────────────────────────────────────────────────

/** A return's status in the client's words — a `Record` over the generated union. */
export const PORTAL_RETURN_STATUS_LABEL: Readonly<Record<PortalReturnRowDto['status'], string>> = {
  open: 'Expected back',
  partially_received: 'Partly received',
  received: 'Received',
  cancelled: 'Cancelled',
};

/** Why the customer sent it back, in words — a `Record` over the generated union. */
export const PORTAL_RETURN_REASON_LABEL: Readonly<Record<PortalReturnLineDto['returnReasonCode'], string>> = {
  damaged: 'Damaged',
  defective: 'Defective',
  'wrong-item': 'Wrong item',
  'not-as-described': 'Not as described',
  'changed-mind': 'Changed mind',
  other: 'Other',
};

/** What the warehouse decided, in the client's words — a `Record` over the generated union. */
export const PORTAL_DISPOSITION_OUTCOME_LABEL: Readonly<Record<PortalReturnDispositionDto['outcome'], string>> = {
  restock: 'Restocked',
  quarantine: 'Held for inspection',
  scrap: 'Scrapped',
};

/** Why units were held or scrapped, in words — a `Record` over the generated union (null on a restock). */
export const PORTAL_DISPOSITION_REASON_LABEL: Readonly<Record<NonNullable<PortalReturnDispositionDto['reasonCode']>, string>> = {
  damaged: 'Damaged',
  defective: 'Defective',
  expired: 'Expired',
  'missing-parts': 'Missing parts',
  contaminated: 'Contaminated',
  'needs-inspection': 'Needs inspection',
  'client-instruction': 'Your instruction',
  other: 'Other',
};

/** The list filter: every return, or only those with units still undecided, or only fully decided ones. */
export type PortalReturnFilter = 'all' | 'awaiting' | 'dispositioned';

export const PORTAL_RETURN_FILTER_LABEL: Readonly<Record<PortalReturnFilter, string>> = {
  all: 'All returns',
  awaiting: 'Awaiting a decision',
  dispositioned: 'Fully decided',
};

/** The server filter the choice sends — `all` sends none. */
export function portalReturnFilterQuery(filter: PortalReturnFilter): 'awaiting' | 'dispositioned' | null {
  return filter === 'all' ? null : filter;
}

/** The return's order, in the client's words: its order reference, else "—" (never an internal id). */
export function portalReturnOrder(row: Pick<PortalReturnRowDto, 'orderReference'>): string {
  return row.orderReference === null || row.orderReference === '' ? '—' : row.orderReference;
}

type DispositionTotals = Pick<
  PortalReturnRowDto,
  'receivedTotal' | 'restockedTotal' | 'onHoldTotal' | 'failedInspectionTotal' | 'scrappedTotal' | 'openTotal'
>;

/**
 * What became of the received units, only the non-zero parts, in the order of
 * the work: "3 restocked · 1 held for inspection · 1 failed inspection · 1
 * scrapped · 2 awaiting a decision". "Nothing received yet" before any unit
 * is back. Totals sum across units of measure, so they are a progress hint.
 */
export function portalDispositionSummary(totals: DispositionTotals): string {
  if (totals.receivedTotal === 0) return 'Nothing received yet';
  const parts: string[] = [];
  if (totals.restockedTotal > 0) parts.push(`${portalQuantity(totals.restockedTotal)} restocked`);
  if (totals.onHoldTotal > 0) parts.push(`${portalQuantity(totals.onHoldTotal)} held for inspection`);
  if (totals.failedInspectionTotal > 0) parts.push(`${portalQuantity(totals.failedInspectionTotal)} failed inspection`);
  if (totals.scrappedTotal > 0) parts.push(`${portalQuantity(totals.scrappedTotal)} scrapped`);
  if (totals.openTotal > 0) parts.push(`${portalQuantity(totals.openTotal)} awaiting a decision`);
  return parts.length === 0 ? 'Received' : parts.join(' · ');
}

/**
 * The return's decision state, word-first: "Awaiting a decision" while any
 * received unit is open or held (amber), "All decided" once every received
 * unit is (green), null when nothing is back yet (the status says so).
 */
export function portalReturnDecisionState(
  totals: Pick<DispositionTotals, 'receivedTotal' | 'openTotal' | 'onHoldTotal'>,
): { tone: 'warning' | 'success'; word: string } | null {
  if (totals.receivedTotal === 0) return null;
  return totals.openTotal > 0 || totals.onHoldTotal > 0 ? { tone: 'warning', word: '↩ Awaiting a decision' } : { tone: 'success', word: '✓ All decided' };
}

/** One decision in words: "Scrapped 2 · Damaged" / "Restocked 3". */
export function portalDispositionText(entry: Pick<PortalReturnDispositionDto, 'outcome' | 'qty' | 'reasonCode'>): string {
  const head = `${PORTAL_DISPOSITION_OUTCOME_LABEL[entry.outcome]} ${portalQuantity(entry.qty)}`;
  return entry.reasonCode === null ? head : `${head} · ${PORTAL_DISPOSITION_REASON_LABEL[entry.reasonCode] ?? entry.reasonCode}`;
}
