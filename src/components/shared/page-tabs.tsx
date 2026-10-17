'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { useState } from 'react';

import type { PageTabs } from '@/lib/page-tabs';

/**
 * Page tabs (page-tabs, 2026-10-17) — the tab state and the tab bars every
 * tabbed page shares (Inbound, Outbound, Replenishment, Compliance,
 * Settings), lifted out of Inbound so the rules it took a review round to
 * get right are written once:
 *
 *   - Outside a drill the tab IS the live URL's `?tab=` (`useSearchParams`
 *     follows in-place history updates and every navigation, so a sidebar
 *     link to the bare route or a bell link always lands on the tab it
 *     names — never a stale pick). `useSearchParams` is null outside the
 *     App Router (screen tests), where the local pick stands in.
 *   - A click rewrites the URL in place with `history.replaceState` (the App
 *     Router syncs it into `useSearchParams` — no server round trip, no
 *     remount). The default tab writes the bare route; clicking the open tab
 *     writes nothing.
 *   - In a drill, another tab LEAVES the drill: `DrillPageTabBar` replaces
 *     the URL with that tab's href through the router (leaving the drill
 *     needs the server render). It is, with `DrillBanner`, the only router
 *     user, and it renders only in drilled mode.
 *
 * Arrow-key roving focus is deferred, as for the Conflicts tabs.
 */
export function usePageTab<T extends string>(def: PageTabs<T>, initial: T, drilled: boolean): readonly [T, (next: T) => void] {
  const searchParams = useSearchParams();
  const [localTab, setLocalTab] = useState<T>(initial);
  // `getAll`, not `Object.fromEntries` (which keeps the last of a repeated
  // `tab`): a repeated tab is an array to the server parse, so null on both.
  const tabs = searchParams?.getAll('tab') ?? [];
  const tab: T =
    drilled || searchParams === null
      ? localTab
      : (def.parse({ tab: tabs.length === 1 ? tabs[0] : tabs }) ?? def.defaultTab);
  const select = (next: T) => {
    if (next === tab) return;
    setLocalTab(next);
    window.history.replaceState(null, '', def.href(next));
  };
  return [tab, select] as const;
}

/** The tab bar — the Conflicts tab pattern. `badge` adds a per-tab pill (Inbound's counts). */
export function PageTabBar<T extends string>({
  def,
  active,
  onSelect,
  badge,
}: {
  def: PageTabs<T>;
  active: T;
  onSelect: (tab: T) => void;
  badge?: (tab: T) => ReactNode;
}): ReactNode {
  return (
    <div className="flex flex-wrap gap-1 text-xs" role="tablist" aria-label={def.label}>
      {def.tabs.map((t) => (
        <button
          key={t.id}
          id={`${def.id}-tab-${t.id}`}
          data-tab={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          aria-controls={`${def.id}-panel`}
          onClick={() => onSelect(t.id)}
          className={`rounded-sm border border-(--border) px-3 py-1 ${
            active === t.id ? 'bg-(--muted) font-medium' : 'hover:bg-(--muted)'
          }`}
        >
          {t.label}
          {badge?.(t.id)}
        </button>
      ))}
    </div>
  );
}

/**
 * In a drill, another tab LEAVES the drill: a soft navigation to that tab's
 * href remounts the page with no drill (the page key joins drill and tab).
 */
export function DrillPageTabBar<T extends string>({
  def,
  active,
  badge,
}: {
  def: PageTabs<T>;
  active: T;
  badge?: (tab: T) => ReactNode;
}): ReactNode {
  const router = useRouter();
  return (
    <PageTabBar
      def={def}
      active={active}
      badge={badge}
      onSelect={(next) => {
        if (next !== active) router.replace(def.href(next), { scroll: false });
      }}
    />
  );
}

/** The bar for the mode: drilled → `DrillPageTabBar`, else `PageTabBar` with `onSelect`. */
export function PageTabStrip<T extends string>({
  def,
  active,
  drilled,
  onSelect,
  badge,
}: {
  def: PageTabs<T>;
  active: T;
  drilled: boolean;
  onSelect: (tab: T) => void;
  badge?: (tab: T) => ReactNode;
}): ReactNode {
  return drilled ? (
    <DrillPageTabBar def={def} active={active} badge={badge} />
  ) : (
    <PageTabBar def={def} active={active} onSelect={onSelect} badge={badge} />
  );
}

/** The one tabpanel; only the selected section is mounted inside it. */
export function PageTabPanel<T extends string>({
  def,
  active,
  children,
}: {
  def: PageTabs<T>;
  active: T;
  children: ReactNode;
}): ReactNode {
  return (
    <div role="tabpanel" id={`${def.id}-panel`} aria-labelledby={`${def.id}-tab-${active}`}>
      {children}
    </div>
  );
}
