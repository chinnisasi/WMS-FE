/**
 * Story 21-7 — the client portal on the web: the routing decisions between
 * the two shells, the portal navigation, the reason mappers, and every
 * sentence and derivation the four portal surfaces render.
 *
 * Pure: no React, no fetch — pinned by `portal.test.ts` (the house rule: a
 * claim left in JSX is a claim nothing can pin).
 */
import { ApiProblem } from '@/lib/api/client';
import type {
  PortalInvoiceDetailResponse,
  PortalOrderRowDto,
  PortalAsnRowDto,
  PortalPurchaseOrderRowDto,
} from '@/lib/api/generated';
import type { Session } from '@/lib/auth';
import { CLIENT_INVOICE_STATUS_LABEL } from '@/lib/client-invoices';
import { ASN_STATUS_LABEL } from '@/lib/asns';
import { ORDER_STATUS_LABEL, UNREACHABLE_REASON } from '@/lib/outbound-orders';

// ── routing ──────────────────────────────────────────────────────────────────

/** Where a portal session lands (sign-in, the operator shell's redirect, `/portal`). */
export const PORTAL_HOME = '/portal/stock';
/** Where a staff session lands after sign-in (unchanged by 21-7). */
export const OPERATOR_HOME = '/settings';

/** The suspended-access message the login page shows after a `client-suspended` refusal. */
export const PORTAL_SUSPENDED_MESSAGE = "Your company's portal access is suspended.";
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
export function operatorShellRoute(session: Session | null): { kind: 'render' } | { kind: 'redirect'; href: string } {
  if (session === null) return { kind: 'redirect', href: '/login' };
  if (session.user.clientId !== null) return { kind: 'redirect', href: PORTAL_HOME };
  return { kind: 'render' };
}

/** The portal shell's decision: staff go back to their own shell; no session goes to /login. */
export function portalShellRoute(session: Session | null): { kind: 'render' } | { kind: 'redirect'; href: string } {
  if (session === null) return { kind: 'redirect', href: '/login' };
  if (session.user.clientId === null) return { kind: 'redirect', href: OPERATOR_HOME };
  return { kind: 'render' };
}

/** The login page's notice for its query (`portal=suspended`), or null. */
export function loginNotice(portal: string | undefined): string | null {
  return portal === 'suspended' ? PORTAL_SUSPENDED_MESSAGE : null;
}

export interface PortalNavItem {
  readonly id: 'stock' | 'orders' | 'inbound' | 'invoices';
  readonly label: string;
  readonly href: string;
}

export const PORTAL_NAV: readonly PortalNavItem[] = [
  { id: 'stock', label: 'Stock', href: '/portal/stock' },
  { id: 'orders', label: 'Orders', href: '/portal/orders' },
  { id: 'inbound', label: 'Inbound', href: '/portal/inbound' },
  { id: 'invoices', label: 'Invoices', href: '/portal/invoices' },
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
      case 'unauthenticated':
        return 'Your session expired — sign in again.';
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
  return `${negative ? '−' : ''}${intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fracPart}`;
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

/** Where the order came from: a channel's own reference, or "Manual". */
export function orderReference(order: Pick<PortalOrderRowDto, 'source' | 'externalRef'>): string {
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
