/**
 * Sidebar IA skeleton — all 12 surfaces (epic context / DESIGN.md shell).
 * Settings includes device enrollment and the setup checklist. Routes are
 * non-functional placeholders in Story 1.1.
 */
export interface NavItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  /** Two-letter monogram for the collapsed-sidebar state. */
  readonly monogram: string;
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