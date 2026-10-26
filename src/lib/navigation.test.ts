import { describe, expect, test } from 'bun:test';

import { NAV_ITEMS, NAV_ITEM_COUNT, PRODUCT_NAME, shellTitle, visibleNavItems } from './navigation';
import type { UserRole } from './users';

describe('sidebar IA skeleton', () => {
  test('carries all 13 surfaces', () => {
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
      'Returns',
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

  // Story 4.2b: Outbound stays UNGATED (spec amendment, 2026-09-16). Its
  // list and expanded order detail are readable by every role — only the
  // create form and the cancel affordance consult `orders.manage`, and they
  // do it inside the component. Gating the entry would have made the read
  // path reachable only by typing a URL. Pinned for all four roles so a
  // later story cannot quietly re-gate it.
  test('Outbound is ungated and visible to every role, accountant included', () => {
    expect(NAV_ITEMS.find((i) => i.id === 'outbound')?.capabilities).toBeUndefined();
    for (const role of [
      'owner',
      'ops_manager',
      'operator',
      'accountant',
    ] as const satisfies readonly UserRole[]) {
      expect(visibleNavItems(role).some((i) => i.id === 'outbound')).toBe(true);
    }
    expect(visibleNavItems(undefined).some((i) => i.id === 'outbound')).toBe(true);
  });

  // Story 13-1: Returns is ungated (every role reads the list) and sits after
  // Reports, before Settings, with its own monogram. Pinned for all four
  // roles, the Outbound precedent.
  test('Returns is ungated, sits after Reports and before Settings, and has a unique monogram', () => {
    const ids = NAV_ITEMS.map((i) => i.id);
    expect(ids.indexOf('returns')).toBe(ids.indexOf('reports') + 1);
    expect(ids.indexOf('settings')).toBe(ids.indexOf('returns') + 1);
    const returns = NAV_ITEMS.find((i) => i.id === 'returns')!;
    expect(returns).toMatchObject({ label: 'Returns', href: '/returns', monogram: 'RT' });
    expect(returns.capabilities).toBeUndefined();
    for (const role of ['owner', 'ops_manager', 'operator', 'accountant'] as const satisfies readonly UserRole[]) {
      expect(visibleNavItems(role).some((i) => i.id === 'returns')).toBe(true);
    }
  });

  // Gating must never change the IA itself — NAV_ITEM_COUNT is the contract.
  test('gating an item does not change the surface count', () => {
    expect(NAV_ITEMS).toHaveLength(NAV_ITEM_COUNT);
    expect(visibleNavItems('owner')).toHaveLength(NAV_ITEM_COUNT);
  });

  // Story 6-1: Replenishment declares `replenishment.manage` (the spec's
  // Code Map authors the gate), so the planner roles see it and the floor
  // roles do not. Pinned for all four roles so a role-set edit cannot
  // silently add or drop the surface (the Conflicts pin's precedent).
  test('Replenishment is visible to owner and ops_manager, hidden from operator and accountant', () => {
    expect(NAV_ITEMS.find((i) => i.id === 'replenishment')?.capabilities).toEqual([
      'replenishment.manage',
    ]);
    for (const role of ['owner', 'ops_manager'] as const satisfies readonly UserRole[]) {
      expect(visibleNavItems(role).some((i) => i.id === 'replenishment')).toBe(true);
    }
    for (const role of ['operator', 'accountant'] as const satisfies readonly UserRole[]) {
      expect(visibleNavItems(role).some((i) => i.id === 'replenishment')).toBe(false);
    }
    expect(visibleNavItems(undefined).some((i) => i.id === 'replenishment')).toBe(false);
  });

  // Story 7-1: Channels declares `channel.manage` (the frozen holder set —
  // owner + Ops Manager), so the managing roles see it and the floor and
  // accounting roles do not. The spec's "no Operator-visible entry" pin,
  // same precedent as Replenishment.
  test('Channels is visible to owner and ops_manager, hidden from operator and accountant', () => {
    expect(NAV_ITEMS.find((i) => i.id === 'channels')?.capabilities).toEqual([
      'channel.manage',
    ]);
    for (const role of ['owner', 'ops_manager'] as const satisfies readonly UserRole[]) {
      expect(visibleNavItems(role).some((i) => i.id === 'channels')).toBe(true);
    }
    for (const role of ['operator', 'accountant'] as const satisfies readonly UserRole[]) {
      expect(visibleNavItems(role).some((i) => i.id === 'channels')).toBe(false);
    }
    expect(visibleNavItems(undefined).some((i) => i.id === 'channels')).toBe(false);
  });
});

describe('shellTitle (story UI-1 — the header\'s "where am I")', () => {
  test('a surface by its href or a child path; Overview only on exact /', () => {
    expect(shellTitle('/')).toBe('Overview');
    expect(shellTitle('/outbound')).toBe('Outbound');
    expect(shellTitle('/conflicts')).toBe('Conflicts & Reviews');
    expect(shellTitle('/inbound/anything')).toBe('Inbound');
  });

  test('nested pages read Parent · Child; Security is its own title', () => {
    expect(shellTitle('/inventory/ledger')).toBe('Inventory · Ledger');
    expect(shellTitle('/moves/counts')).toBe('Moves · Counts');
    expect(shellTitle('/inventory')).toBe('Inventory');
    expect(shellTitle('/account/security')).toBe('Security');
  });

  test('a sibling sharing a prefix, an unknown path and no path read null', () => {
    expect(shellTitle('/inboundx')).toBeNull();
    expect(shellTitle('/nowhere')).toBeNull();
    expect(shellTitle(null)).toBeNull();
    expect(shellTitle('')).toBeNull();
  });

  test('the product name is one constant', () => {
    expect(PRODUCT_NAME).toBe('WMS');
  });
});
