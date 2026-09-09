import { describe, expect, test } from 'bun:test';

import { NAV_ITEMS, NAV_ITEM_COUNT, visibleNavItems } from './navigation';
import type { UserRole } from './users';

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

  // Story 3.3 gating: Conflicts & Reviews declares `review.decide`, so the
  // decision-capable roles see it and the floor roles do not (hide surfaces,
  // never "blocked" screens). An unknown role (server render, pre-1.5
  // session row) sees nothing gated — hiding is recoverable by a reload.
  test('Conflicts & Reviews is visible to owner and ops_manager, hidden from operator and accountant', () => {
    expect(NAV_ITEMS.find((i) => i.id === 'conflicts')?.capabilities).toEqual(['review.decide']);
    for (const role of ['owner', 'ops_manager'] as const satisfies readonly UserRole[]) {
      expect(visibleNavItems(role).some((i) => i.id === 'conflicts')).toBe(true);
    }
    for (const role of ['operator', 'accountant'] as const satisfies readonly UserRole[]) {
      expect(visibleNavItems(role).some((i) => i.id === 'conflicts')).toBe(false);
    }
    expect(visibleNavItems(undefined).some((i) => i.id === 'conflicts')).toBe(false);
  });
});
