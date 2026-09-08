/**
 * Sidebar IA skeleton — all 12 surfaces (epic context / DESIGN.md shell).
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
   * inside Settings); operational epics declare theirs here as they land.
   */
  readonly capabilities?: readonly Capability[];
}

export const NAV_ITEMS: readonly NavItem[] = [
  { id: 'overview', label: 'Overview', href: '/', monogram: 'OV' },
  { id: 'inventory', label: 'Inventory', href: '/inventory', monogram: 'IN' },
  { id: 'inbound', label: 'Inbound', href: '/inbound', monogram: 'IB' },
  { id: 'outbound', label: 'Outbound', href: '/outbound', monogram: 'OB' },
  { id: 'moves', label: 'Moves', href: '/moves', monogram: 'MV' },
  { id: 'conflicts', label: 'Conflicts & Reviews', href: '/conflicts', monogram: 'CR' },
  { id: 'notifications', label: 'Notifications', href: '/notifications', monogram: 'NO' },
  { id: 'replenishment', label: 'Replenishment', href: '/replenishment', monogram: 'RP' },
  { id: 'channels', label: 'Channels', href: '/channels', monogram: 'CH' },
  { id: 'compliance', label: 'Compliance', href: '/compliance', monogram: 'CO' },
  { id: 'reports', label: 'Reports / Audit', href: '/reports', monogram: 'RA' },
  { id: 'settings', label: 'Settings', href: '/settings', monogram: 'ST' },
] as const;

export const NAV_ITEM_COUNT = 12;

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