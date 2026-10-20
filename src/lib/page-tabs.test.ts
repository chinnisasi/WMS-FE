import { describe, expect, test } from 'bun:test';

import { parseDrill } from './drill';
import { INBOUND_PAGE_TABS, inboundTabHref } from './inbound-tabs';
import {
  COMPLIANCE_PAGE_TABS,
  definePageTabs,
  INVENTORY_PAGE_TABS,
  OUTBOUND_PAGE_TABS,
  REPLENISHMENT_PAGE_TABS,
  SETTINGS_PAGE_TABS,
  setupStepHref,
  type PageTabs,
} from './page-tabs';

const DEMO = definePageTabs({
  route: '/demo',
  label: 'Demo lists',
  tabs: [
    { id: 'first', label: 'First' },
    { id: 'second', label: 'Second' },
  ],
  drillTabs: { orders: 'second' },
});

describe('page-tabs — the shared definition', () => {
  test('the first tab is the default; ids and element prefix come from the route', () => {
    expect(DEMO.defaultTab).toBe('first');
    expect(DEMO.id).toBe('demo');
    expect(DEMO.label).toBe('Demo lists');
  });

  test('href: the default tab is the bare route, every other tab is ?tab=', () => {
    expect(DEMO.href('first')).toBe('/demo');
    expect(DEMO.href('second')).toBe('/demo?tab=second');
  });

  test('parse: one known id; unknown, repeated or absent → null', () => {
    expect(DEMO.parse({ tab: 'second' })).toBe('second');
    expect(DEMO.parse({ tab: 'first' })).toBe('first');
    expect(DEMO.parse({ tab: 'nope' })).toBeNull();
    expect(DEMO.parse({ tab: ['second', 'first'] })).toBeNull();
    expect(DEMO.parse({})).toBeNull();
    // Not a prototype key either.
    expect(DEMO.parse({ tab: 'constructor' })).toBeNull();
  });

  test('initial: a drill wins with its list\'s tab; else the ?tab= pick; else the default', () => {
    const orders = parseDrill('outbound', { list: 'orders', warehouseId: '0198f7a2-1b3c-7d4e-8f90-99aabbccdd02', to: '2026-10-06T10:00:00.000Z' });
    expect(orders).not.toBeNull();
    expect(DEMO.initial(orders, 'first')).toBe('second');
    expect(DEMO.initial(null, 'second')).toBe('second');
    expect(DEMO.initial(null, null)).toBe('first');
    expect(DEMO.initial('unsupported', null)).toBe('first');
  });

  test('a tab link is a plain visit, never a drill', () => {
    const defs: readonly PageTabs<string>[] = [OUTBOUND_PAGE_TABS, REPLENISHMENT_PAGE_TABS, COMPLIANCE_PAGE_TABS, SETTINGS_PAGE_TABS, INVENTORY_PAGE_TABS];
    for (const def of defs) {
      for (const t of def.tabs) {
        const url = new URL(`http://x${def.href(t.id)}`);
        expect(url.pathname).toBe(def.route);
        const params = Object.fromEntries(url.searchParams);
        expect(def.parse(params) ?? def.defaultTab).toBe(t.id);
      }
    }
    expect(parseDrill('replenishment', { tab: 'policies' })).toBeNull();
    expect(parseDrill('compliance', { tab: 'hsn' })).toBeNull();
  });
});

describe('page-tabs — the pages', () => {
  test('each page\'s tabs, in order, with its own tablist label', () => {
    expect(OUTBOUND_PAGE_TABS.tabs.map((t) => [t.id, t.label])).toEqual([
      ['orders', 'Orders'],
      ['waves', 'Waves'],
      ['pack', 'Pack & Dispatch'],
    ]);
    expect(REPLENISHMENT_PAGE_TABS.tabs.map((t) => [t.id, t.label])).toEqual([
      ['breaches', 'Reorder breaches'],
      ['batch-alerts', 'Expiry & aging alerts'],
      ['suggested-pos', 'Suggested purchase orders'],
      ['policies', 'Reorder points'],
    ]);
    expect(COMPLIANCE_PAGE_TABS.tabs.map((t) => [t.id, t.label])).toEqual([
      ['invoices', 'Invoices'],
      ['client-invoices', 'Client invoices'],
      ['eway', 'E-way bills'],
      ['hsn', 'HSN summary'],
      ['cold-chain', 'Cold-chain trace'],
      ['licences', 'Licences'],
    ]);
    // Story 1-6c — the licences tab's own URL (the notification entry links it).
    expect(COMPLIANCE_PAGE_TABS.href('licences')).toBe('/compliance?tab=licences');
    expect(COMPLIANCE_PAGE_TABS.parse({ tab: 'licences' })).toBe('licences');
    expect(SETTINGS_PAGE_TABS.tabs.map((t) => t.id)).toEqual(['warehouses', 'catalog', 'clients', 'partners', 'team', 'devices']);
    expect(INVENTORY_PAGE_TABS.tabs.map((t) => [t.id, t.label])).toEqual([
      ['stock', 'Stock'],
      ['batches', 'Batches'],
      ['ledger', 'Ledger'],
    ]);
    expect(INVENTORY_PAGE_TABS.href('stock')).toBe('/inventory');
    expect(INVENTORY_PAGE_TABS.href('ledger')).toBe('/inventory?tab=ledger');
    // No drill reaches /inventory: a stray list= falls back to the tab pick.
    expect(INVENTORY_PAGE_TABS.drillTabs).toEqual({});
    expect(
      [INBOUND_PAGE_TABS, OUTBOUND_PAGE_TABS, REPLENISHMENT_PAGE_TABS, COMPLIANCE_PAGE_TABS, SETTINGS_PAGE_TABS, INVENTORY_PAGE_TABS].map(
        (d) => d.label,
      ),
    ).toEqual(['Inbound lists', 'Outbound lists', 'Replenishment lists', 'Compliance lists', 'Settings sections', 'Inventory lists']);
  });

  test('each drill opens on its own list\'s tab', () => {
    const W = '0198f7a2-1b3c-7d4e-8f90-99aabbccdd02';
    const TO = '2026-10-06T10:00:00.000Z';
    expect(OUTBOUND_PAGE_TABS.initial(parseDrill('outbound', { list: 'orders', warehouseId: W, to: TO }), 'pack')).toBe('orders');
    expect(REPLENISHMENT_PAGE_TABS.initial(parseDrill('replenishment', { list: 'batch-alerts', warehouseId: W, to: TO }), 'policies')).toBe(
      'batch-alerts',
    );
    expect(COMPLIANCE_PAGE_TABS.initial(parseDrill('compliance', { list: 'eway', warehouseId: W, to: TO }), 'hsn')).toBe('eway');
    expect(COMPLIANCE_PAGE_TABS.initial(parseDrill('compliance', { list: 'invoices', warehouseId: W, to: TO }), 'hsn')).toBe('invoices');
  });

  test('Inbound keeps its hrefs: qc-holds unchanged; the default tab is now the bare route', () => {
    expect(inboundTabHref('qc-holds')).toBe('/inbound?tab=qc-holds');
    expect(inboundTabHref('grns')).toBe('/inbound?tab=grns');
    expect(inboundTabHref('pos')).toBe('/inbound');
    expect(INBOUND_PAGE_TABS.id).toBe('inbound');
  });
});

describe('setupStepHref — a checklist Continue link opens the tab holding its card', () => {
  test.each([
    ['warehouse', '/settings'],
    ['bins', '/settings'],
    ['catalog', '/settings?tab=catalog'],
    ['users', '/settings?tab=team'],
  ])('%s → %s', (key, href) => {
    expect(setupStepHref({ key, href: '/settings' })).toBe(href);
  });

  test('an unknown step keeps the server\'s href', () => {
    expect(setupStepHref({ key: 'carriers', href: '/settings#carriers' })).toBe('/settings#carriers');
    expect(setupStepHref({ key: 'constructor', href: '/x' })).toBe('/x');
  });
});
