/**
 * Sidebar IA skeleton — all 13 surfaces (12 until story 13-1 added Returns) (epic context / DESIGN.md shell).
 * Settings includes device enrollment and the setup checklist. Routes are
 * non-functional placeholders in Story 1.1.
 */
import type { Capability, UserRole } from '@/lib/users';
import { roleHasCapability } from '@/lib/users';

export interface NavItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  /** Two-letter monogram for the collapsed-sidebar state. */
  readonly monogram: string;
  /**
   * Capabilities the surface's actions need (story 1.5 gating). A surface
   * that declares any capability is hidden from roles holding none of them —
   * hide surfaces, never "blocked" screens. No epic-1 surface is
   * mutation-centric enough to declare one yet (warehouse/catalog setup lives
   * inside Settings); operational epics declare theirs here as they land —
   * story 3.3 gates Conflicts & Reviews behind `review.decide`.
   *
   * A gate belongs here only when the surface has nothing to *read* for a
   * role that cannot act — which is true of the Conflicts action queue, and,
   * by the spec's own authorship (story 6-1), of Replenishment: the list
   * reads are member-open server-side and the intended read-only entry is
   * Epic 9's panel. Outbound (story 4.2b) is deliberately ungated for that
   * reason, like `inbound` and `inventory`: its list and expanded order
   * detail are readable by every role, and only the create form and the
   * cancel affordance consult `orders.manage`, inside the component.
   */
  readonly capabilities?: readonly Capability[];
}

export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'overview', label: 'Overview', href: '/', monogram: 'OV' },
  { id: 'inventory', label: 'Inventory', href: '/inventory', monogram: 'IN' },
  { id: 'inbound', label: 'Inbound', href: '/inbound', monogram: 'IB' },
  { id: 'outbound', label: 'Outbound', href: '/outbound', monogram: 'OB' },
  { id: 'moves', label: 'Moves', href: '/moves', monogram: 'MV' },
  { id: 'conflicts', label: 'Conflicts & Reviews', href: '/conflicts', monogram: 'CR', capabilities: ['review.decide'] },
  { id: 'notifications', label: 'Notifications', href: '/notifications', monogram: 'NO' },
  // Story 6-1 — gated on `replenishment.manage` (the spec's Code Map names
  // the gate): the breach queue, the suggested-PO drafts and the policy
  // table are planner tools; list reads stay member-open server-side, and
  // the intended read-only entry point is Epic 9's notification panel.
  {
    id: 'replenishment',
    label: 'Replenishment',
    href: '/replenishment',
    monogram: 'RP',
    capabilities: ['replenishment.manage'],
  },
  // Story 7-1 — gated on `channel.manage` (the spec's frozen holder set:
  // owner + Ops Manager — a channel credential and its standing buffers are
  // not a floor verb and not an accounting verb). The list read is
  // member-open server-side, but the surface's every affordance is the
  // connection lifecycle, and an Operator reaches none of it.
  {
    id: 'channels',
    label: 'Channels',
    href: '/channels',
    monogram: 'CH',
    capabilities: ['channel.manage'],
  },
  { id: 'compliance', label: 'Compliance', href: '/compliance', monogram: 'CO' },
  { id: 'reports', label: 'Reports / Audit', href: '/reports', monogram: 'RA' },
  // Story 13-1 — Returns (EXPERIENCE.md: after Reports, before Settings).
  // UNGATED: the list and each authorization's lines are readable by every
  // role (reads are member-open server-side); only Cancel — and, on the
  // order detail, "Create return" — consult `returns.manage`, inside the
  // components (the Outbound precedent).
  { id: 'returns', label: 'Returns', href: '/returns', monogram: 'RT' },
  { id: 'settings', label: 'Settings', href: '/settings', monogram: 'ST' },
] as const;

export const NAV_ITEM_COUNT = 13;

/**
 * The IA list filtered by the session role (story 1.5). An unknown role
 * (server render, signed out, pre-1.5 session row) sees the full list — the
 * signed-in gating resolves on the client once the session/user is readable.
 */
export function visibleNavItems(role: UserRole | undefined): readonly NavItem[] {
  return NAV_ITEMS.filter(
    (item) =>
      item.capabilities === undefined ||
      item.capabilities.some((capability) => roleHasCapability(role, capability)),
  );
}
/**
 * Story UI-1 — the product's working name (DESIGN.md: the PRD's working
 * title until branding lands). The logotype and the document title read it,
 * so a rename is this one line.
 */
export const PRODUCT_NAME = 'WMS';

/** Nested pages that are not nav items, as "Parent · Child". */
const NESTED_TITLES: readonly (readonly [string, string])[] = [
  ['/inventory/ledger', 'Inventory · Ledger'],
  ['/moves/counts', 'Moves · Counts'],
  ['/account/security', 'Security'],
];

/**
 * Story UI-1 — the header's "where am I" line: the current surface's label
 * (a nested page as "Parent · Child"), or null for a path outside the IA.
 * Overview matches `/` exactly; every other surface matches its href or a
 * child path of it (never a sibling sharing a prefix, e.g. `/inboundx`).
 */
export function shellTitle(pathname: string | null | undefined): string | null {
  if (typeof pathname !== 'string' || pathname === '') return null;
  const under = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  for (const [href, title] of NESTED_TITLES) if (under(href)) return title;
  if (pathname === '/') return 'Overview';
  return NAV_ITEMS.find((item) => item.href !== '/' && under(item.href))?.label ?? null;
}
