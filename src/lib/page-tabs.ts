import type { SetupChecklistStepResponse } from '@/lib/api/generated';
import type { DrillList, ParsedDrill, SearchParamsRecord } from '@/lib/drill';

/**
 * Page tabs (page-tabs, 2026-10-17) — the one definition behind every page
 * that shows its sections one at a time: Inbound (where the rules were
 * first worked out, inbound-tabs), Outbound, Replenishment, Compliance and
 * Settings.
 *
 * `?tab=<id>` opens a tab — a notification's click-through, a shared link,
 * a reload. It is not a drill key: a link carrying it has no `list`, so
 * `parseDrill` reads it as a plain visit, and a drill link never carries
 * one. Anything but one known id is ignored (the page opens on its first
 * tab). One href rule everywhere: the first tab is the bare route, every
 * other tab is `?tab=<id>` — one URL per view.
 *
 * Pure, so the server `page.tsx` parses with the same definition the client
 * tab bar renders from (`components/shared/page-tabs.tsx`).
 */

export interface PageTab<T extends string> {
  readonly id: T;
  /** Equal to the section's own heading. */
  readonly label: string;
}

export interface PageTabs<T extends string> {
  /** The element-id prefix: `${id}-tab-<tab>` and `${id}-panel`. */
  readonly id: string;
  readonly route: string;
  /** The tablist's `aria-label` — one per page, so a section's own tabs stay distinguishable. */
  readonly label: string;
  readonly tabs: readonly PageTab<T>[];
  /** The first tab — the bare route. */
  readonly defaultTab: T;
  /** The tab a drill on each list opens on. */
  readonly drillTabs: Readonly<Partial<Record<DrillList, T>>>;
  /** `?tab=` → one known tab, else null (repeated or unknown) — the server parse and `usePageTab` (via `getAll`) agree. */
  parse(params: SearchParamsRecord): T | null;
  /** The link that opens the page on one tab — the bare route for the default. */
  href(tab: T): string;
  /** The tab a page opens on: a drill names its own list's tab; else the `?tab=` pick; else the default. */
  initial(drill: ParsedDrill, tab: T | null): T;
}

export function definePageTabs<const T extends string>({
  route,
  tabs,
  label,
  drillTabs = {},
}: {
  route: string;
  tabs: readonly PageTab<T>[];
  label: string;
  drillTabs?: Readonly<Partial<Record<DrillList, T>>>;
}): PageTabs<T> {
  const first = tabs[0];
  if (first === undefined) throw new Error(`definePageTabs(${route}): no tabs`);
  const defaultTab = first.id;
  const ids: readonly string[] = tabs.map((tab) => tab.id);
  const href = (tab: T) => (tab === defaultTab ? route : `${route}?tab=${tab}`);
  return {
    id: route.replace(/^\//, '').replace(/\//g, '-'),
    route,
    label,
    tabs,
    defaultTab,
    drillTabs,
    parse(params) {
      const value = params.tab;
      return typeof value === 'string' && ids.includes(value) ? (value as T) : null;
    },
    href,
    initial(drill, tab) {
      if (drill !== null && drill !== 'unsupported') {
        const drilled = drillTabs[drill.list];
        if (drilled !== undefined) return drilled;
      }
      return tab ?? defaultTab;
    },
  };
}

/** `/outbound` — the order of the work: orders, the waves they group into, then pack & dispatch. */
export const OUTBOUND_PAGE_TABS = definePageTabs({
  route: '/outbound',
  label: 'Outbound lists',
  tabs: [
    { id: 'orders', label: 'Orders' },
    { id: 'waves', label: 'Waves' },
    { id: 'pack', label: 'Pack & Dispatch' },
  ],
  drillTabs: { orders: 'orders' },
});
export type OutboundTab = (typeof OUTBOUND_PAGE_TABS)['defaultTab'];

export const REPLENISHMENT_PAGE_TABS = definePageTabs({
  route: '/replenishment',
  label: 'Replenishment lists',
  tabs: [
    { id: 'breaches', label: 'Reorder breaches' },
    { id: 'batch-alerts', label: 'Expiry & aging alerts' },
    { id: 'suggested-pos', label: 'Suggested purchase orders' },
    { id: 'policies', label: 'Reorder points' },
  ],
  drillTabs: { 'batch-alerts': 'batch-alerts' },
});
export type ReplenishmentTab = (typeof REPLENISHMENT_PAGE_TABS)['defaultTab'];

export const COMPLIANCE_PAGE_TABS = definePageTabs({
  route: '/compliance',
  label: 'Compliance lists',
  tabs: [
    { id: 'invoices', label: 'Invoices' },
    { id: 'client-invoices', label: 'Client invoices' },
    { id: 'eway', label: 'E-way bills' },
    { id: 'hsn', label: 'HSN summary' },
    { id: 'cold-chain', label: 'Cold-chain trace' },
    // Story 1-6c — the drug and FSSAI licences and their coverage gaps.
    { id: 'licences', label: 'Licences' },
  ],
  drillTabs: { invoices: 'invoices', eway: 'eway' },
});
export type ComplianceTab = (typeof COMPLIANCE_PAGE_TABS)['defaultTab'];

/**
 * `/inventory` (inventory-screen, 2026-10-17) — Stock (on-hand per bin and
 * SKU), Batches (a SKU's batches by expiry) and the Ledger timeline. The page
 * takes no drill: ledger drills stay on `/inventory/ledger`.
 */
export const INVENTORY_PAGE_TABS = definePageTabs({
  route: '/inventory',
  label: 'Inventory lists',
  tabs: [
    { id: 'stock', label: 'Stock' },
    { id: 'batches', label: 'Batches' },
    { id: 'ledger', label: 'Ledger' },
  ],
});
export type InventoryTab = (typeof INVENTORY_PAGE_TABS)['defaultTab'];

/**
 * `/settings` — grouped tabs (user decision, 2026-10-17): Warehouses
 * (create form, warehouse list, zones & bins), Catalog (import, products,
 * SKUs, segregation matrix), Clients (clients, rate cards), Partners (story
 * 1-3 — vendors, consignees, transporters and their client links), Team
 * (users & roles), Devices. The setup checklist stays above the tab bar.
 */
export const SETTINGS_PAGE_TABS = definePageTabs({
  route: '/settings',
  label: 'Settings sections',
  tabs: [
    { id: 'warehouses', label: 'Warehouses' },
    { id: 'catalog', label: 'Catalog' },
    { id: 'clients', label: 'Clients' },
    // Story 1-3 — the business partner master (vendors, consignees, transporters).
    { id: 'partners', label: 'Partners' },
    { id: 'team', label: 'Team' },
    { id: 'devices', label: 'Devices' },
  ],
});
export type SettingsTab = (typeof SETTINGS_PAGE_TABS)['defaultTab'];

/**
 * The Settings tab holding each setup-checklist step's card. Keyed on the
 * generated step-key union, so a new backend step is a compile error here.
 */
const SETUP_STEP_TAB: Readonly<Record<SetupChecklistStepResponse['key'], SettingsTab>> = {
  warehouse: 'warehouses',
  bins: 'warehouses',
  catalog: 'catalog',
  users: 'team',
};

/**
 * A checklist step's Continue link: the Settings tab holding its card. The
 * backend sends `/settings` for every step; an unknown step key keeps the
 * server's own `href`.
 */
export function setupStepHref(step: { readonly key: string; readonly href: string }): string {
  // A newer backend's step (not yet in the generated union) keeps its own href.
  const tab = Object.prototype.hasOwnProperty.call(SETUP_STEP_TAB, step.key)
    ? SETUP_STEP_TAB[step.key as SetupChecklistStepResponse['key']]
    : undefined;
  return tab === undefined ? step.href : SETTINGS_PAGE_TABS.href(tab);
}
