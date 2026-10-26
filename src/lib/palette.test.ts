import { describe, expect, test } from 'bun:test';

import { findOrderHref, paletteItems } from './palette';

/** Story UI-2 (gap 12) — ⌘K: role-filtered, capability-gated, and it finds an order. */

describe('paletteItems', () => {
  test('an operator is offered no surface it cannot open and no create it cannot use', () => {
    const items = paletteItems('operator', '');
    const labels = items.map((i) => i.label);
    expect(labels).not.toContain('Conflicts & Reviews'); // review.decide
    expect(labels).not.toContain('Channels'); // channel.manage
    expect(labels).not.toContain('Create order'); // orders.manage
    expect(labels).not.toContain('New count'); // counts.manage
    expect(labels).toContain('Outbound');
    expect(items.every((i) => i.group === 'Go to')).toBe(true);
  });

  test('an owner gets both actions first, each behind its own deep link', () => {
    const items = paletteItems('owner', '');
    expect(items.slice(0, 2)).toEqual([
      { id: 'action:create-order', label: 'Create order', group: 'Action', href: '/outbound?new=order' },
      { id: 'action:new-count', label: 'New count', group: 'Action', href: '/moves/counts?new=count' },
    ]);
    expect(items.some((i) => i.label === 'Conflicts & Reviews')).toBe(true);
  });

  test('a query filters by label and always offers to find that order', () => {
    const items = paletteItems('owner', 'out');
    expect(items.map((i) => i.label)).toEqual(['Outbound', 'Find order out']);
    const record = paletteItems('owner', '  SO-1042 ');
    expect(record).toEqual([{ id: 'find:order', label: 'Find order SO-1042', group: 'Find', href: '/outbound?ref=SO-1042' }]);
  });

  test('find is the exact-match search: blank and over-long queries offer none', () => {
    expect(paletteItems('owner', '   ').some((i) => i.group === 'Find')).toBe(false);
    expect(paletteItems('owner', 'x'.repeat(201)).some((i) => i.group === 'Find')).toBe(false);
  });

  test('a client role holds no operator create (the operator shell, and so ⌘K, redirects a client to /portal)', () => {
    const items = paletteItems('client', 'SO-1');
    expect(items.some((i) => i.group === 'Action')).toBe(false);
  });

  test('the reference is URL-encoded', () => {
    expect(findOrderHref('A&B #1')).toBe('/outbound?ref=A%26B%20%231');
  });
});
