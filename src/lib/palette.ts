import { visibleNavItems } from '@/lib/navigation';
import { parseOrderSearch } from '@/lib/orders';
import { roleHasCapability, type Capability, type UserRole } from '@/lib/users';

/**
 * Story UI-2 (UI-PATTERNS §13 gap 12) — what ⌘K offers, as a pure function
 * so the role filter and the gates are pinned by `palette.test.ts`:
 *
 * - **Go to** — the same role-filtered IA list the sidebar renders
 *   (`visibleNavItems`), never a surface the role cannot open;
 * - **Action** — the two creates a demo reaches for, each behind the
 *   capability its form already consults (the capability mirror);
 * - **Find** — "Find order «q»", the existing EXACT-match order search
 *   (`parseOrderSearch`: any non-empty query of at most 200 characters),
 *   opening Outbound's Orders searched for it. No new read; offered only
 *   when Outbound is visible to the role.
 *
 * A typed query filters Go to and Action by label; Find is the query itself.
 */
export type PaletteGroup = 'Go to' | 'Action' | 'Find';

export interface PaletteEntry {
  readonly id: string;
  readonly label: string;
  readonly group: PaletteGroup;
  readonly href: string;
}

const ACTIONS: readonly { readonly id: string; readonly label: string; readonly href: string; readonly capability: Capability }[] = [
  { id: 'action:create-order', label: 'Create order', href: '/outbound?new=order', capability: 'orders.manage' },
  { id: 'action:new-count', label: 'New count', href: '/moves/counts?new=count', capability: 'counts.manage' },
];

/** `/outbound?ref=…`, the order search's deep link. */
export function findOrderHref(reference: string): string {
  return `/outbound?ref=${encodeURIComponent(reference)}`;
}

export function paletteItems(role: UserRole | undefined, query: string): PaletteEntry[] {
  const q = query.trim().toLowerCase();
  const nav = visibleNavItems(role);
  const goTo: PaletteEntry[] = nav.map((item) => ({ id: `nav:${item.id}`, label: item.label, group: 'Go to', href: item.href }));
  const actions: PaletteEntry[] = ACTIONS.filter((a) => roleHasCapability(role, a.capability)).map((a) => ({
    id: a.id,
    label: a.label,
    group: 'Action',
    href: a.href,
  }));
  const matching = q === '' ? [...actions, ...goTo] : [...actions, ...goTo].filter((entry) => entry.label.toLowerCase().includes(q));
  const parsed = parseOrderSearch(query);
  const canFind = nav.some((item) => item.id === 'outbound');
  const find: PaletteEntry[] =
    canFind && parsed.reference !== null
      ? [{ id: 'find:order', label: `Find order ${parsed.reference}`, group: 'Find', href: findOrderHref(parsed.reference) }]
      : [];
  return [...matching, ...find];
}
