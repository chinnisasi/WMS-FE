import { describe, expect, test } from 'bun:test';

import { NAV_ITEMS, NAV_ITEM_COUNT } from './navigation';

describe('sidebar IA skeleton', () => {
  test('carries all 12 surfaces', () => {
    expect(NAV_ITEMS).toHaveLength(NAV_ITEM_COUNT);
    expect(NAV_ITEMS.map((i) => i.label)).toEqual([
      'Overview',
      'Inventory',
      'Inbound',
      'Outbound',
      'Moves',
      'Conflicts & Reviews',
      'Notifications',
      'Replenishment',
      'Channels',
      'Compliance',
      'Reports / Audit',
      'Settings',
    ]);
  });

  test('every surface has a unique href and monogram', () => {
    const hrefs = new Set(NAV_ITEMS.map((i) => i.href));
    const monograms = new Set(NAV_ITEMS.map((i) => i.monogram));
    expect(hrefs.size).toBe(NAV_ITEM_COUNT);
    expect(monograms.size).toBe(NAV_ITEM_COUNT);
    for (const item of NAV_ITEMS) {
      expect(item.href).toMatch(/^\/[a-z/-]*$/);
    }
  });
});
