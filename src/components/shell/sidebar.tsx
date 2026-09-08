'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { fetchApiListWarehouses } from '@/lib/api/client';
import type { WarehouseListResponse, WarehouseResponse } from '@/lib/api/generated';
import { SignOutButton } from '@/components/auth/sign-out';
import { readSession, subscribeSession } from '@/lib/auth';
import { NAV_ITEMS } from '@/lib/navigation';
import { writeStoredTheme } from '@/lib/theme';
import {
  readActiveWarehouseId,
  subscribeActiveWarehouse,
  WAREHOUSES_CHANGED_EVENT,
  writeActiveWarehouseId,
} from '@/lib/warehouses';

function ChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function WarehouseGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M3 9l9-6 9 9v11H3z" />
      <path d="M9 22V12h6v10" />
    </svg>
  );
}

/**
 * Warehouse switcher (mockup `.wh` block): code+name, "Warehouse N of M",
 * chevron disclosure listing the tenant's warehouses. Fed from the generated
 * client against the signed-in tenant; the session *identity* (tenant id) and
 * the picked warehouse come from useSyncExternalStore subscriptions, so the
 * server render (unknown session → nothing) never mismatches and a re-sign-in
 * as another tenant refetches. The picked warehouse persists in localStorage
 * scoped per tenant; there is no server-side active warehouse yet (Epic 2).
 */
export function WarehouseSwitcher() {
  // `null` = unknown (server render) or signed out → render nothing.
  const tenantId = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.tenant.id ?? null,
    () => null,
  );
  const activeId = useSyncExternalStore(
    subscribeActiveWarehouse,
    () => (tenantId === null ? null : readActiveWarehouseId(tenantId)),
    () => null,
  );
  const [page, setPage] = useState<{ tenantId: string; list: WarehouseListResponse } | null>(
    null,
  );
  const [open, setOpen] = useState(false);
  // Bumped by the warehouses-changed event so the fetch effect re-runs
  // (setState in a subscription callback, never synchronously in an effect).
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const onChange = () => setRevision((r) => r + 1);
    window.addEventListener(WAREHOUSES_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(WAREHOUSES_CHANGED_EVENT, onChange);
  }, []);

  useEffect(() => {
    if (tenantId === null) return;
    let cancelled = false;
    // Follow the keyset cursor chain so the switcher and its "N of M" count
    // cover every warehouse, not just the first page (review loop 1).
    (async () => {
      try {
        let list: WarehouseListResponse | null = null;
        let cursor: string | undefined;
        for (let hops = 0; hops < 20; hops++) {
          const page = await fetchApiListWarehouses(tenantId, cursor === undefined ? undefined : { cursor });
          list = list === null ? page : { ...page, items: [...list.items, ...page.items] };
          if (!page.nextCursor) break;
          cursor = page.nextCursor;
        }
        // A failed fetch leaves the previous tenant's page in state — the
        // tenantId check below (not a setState-in-effect) keeps it hidden.
        if (!cancelled && list !== null) setPage({ tenantId, list });
      } catch {
        // Switcher chrome stays quiet on failure — surfaces report API errors.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, revision]);

  if (tenantId === null || page === null || page.tenantId !== tenantId) return null;

  const items: readonly WarehouseResponse[] = page.list.items;
  if (items.length === 0) {
    return (
      <div className="hidden border-b border-(--border) px-3 py-2 lg:block lg:px-4">
        <Link href="/settings" className="text-xs text-(--muted-foreground) underline underline-offset-2">
          No warehouse yet — create one in Settings
        </Link>
      </div>
    );
  }

  const index = Math.max(
    items.findIndex((w) => w.id === (activeId ?? items[0]?.id)),
    0,
  );
  const active = items[index];
  if (active === undefined) return null;

  function pick(id: string) {
    writeActiveWarehouseId(tenantId!, id);
    setOpen(false);
  }

  return (
    <div className="relative hidden border-b border-(--border) px-3 py-2 lg:block lg:px-4">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-sm px-1 py-1 text-left text-xs hover:bg-(--muted)"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-(--border)" aria-hidden>
          <WarehouseGlyph />
        </span>
        <span className="min-w-0 flex-1">
          <b className="block truncate">
            {active.code} {active.name}
          </b>
          <span className="block text-(--muted-foreground)">Warehouse {index + 1} of {items.length}</span>
        </span>
        <ChevronDown />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Warehouses"
          className="absolute inset-x-3 top-full z-10 mt-1 flex flex-col rounded-md border border-(--border) bg-(--card) p-1 shadow-md lg:inset-x-4"
        >
          {items.map((warehouse, i) => (
            <li key={warehouse.id}>
              <button
                type="button"
                role="option"
                aria-selected={warehouse.id === active.id}
                onClick={() => pick(warehouse.id)}
                className={`flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-xs ${
                  warehouse.id === active.id ? 'bg-(--muted) font-medium' : 'hover:bg-(--muted)'
                }`}
              >
                <span className="truncate">
                  {warehouse.code} {warehouse.name}
                </span>
                <span className="shrink-0 text-(--muted-foreground)">{i + 1}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Sidebar IA skeleton — all 12 surfaces, non-functional routes.
 * Responsive contract: ≥1024px full labels · 768–1023px icon (monogram)
 * only · <768px hidden entirely (header menu takes over).
 */
export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-screen w-14 shrink-0 flex-col border-r border-(--border) md:flex lg:w-60">
      <div className="flex h-12 items-center border-b border-(--border) px-3 lg:px-4">
        <span className="hidden text-sm font-semibold lg:inline">WMS</span>
        <span className="text-sm font-semibold lg:hidden">W</span>
      </div>
      <WarehouseSwitcher />
      <nav aria-label="Primary" className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {NAV_ITEMS.map((item) => {
          // Nested child routes (e.g. /inventory/xyz) keep the surface
          // highlighted; the Overview root matches exactly.
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-md px-2 py-1.5 text-sm ${
                active
                  ? 'bg-(--primary) text-(--primary-foreground)'
                  : 'text-(--foreground) hover:bg-(--muted)'
              }`}
            >
              <span
                className={`data flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border text-[10px] font-semibold ${
                  active ? 'border-(--primary-foreground)/30' : 'border-(--border)'
                }`}
                aria-hidden
              >
                {item.monogram}
              </span>
              <span className="hidden truncate lg:inline">{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="mx-2 mb-3 flex items-center gap-2 lg:mx-3">
        <SignOutButton className="rounded-md border border-(--border) px-2 py-1 text-xs text-(--muted-foreground) hover:bg-(--muted)" />
        <ThemeToggle />
      </div>
    </aside>
  );
}

export function ThemeToggle() {
  return (
    <button
      type="button"
      className="mx-2 mb-3 rounded-md border border-(--border) px-2 py-1 text-xs text-(--muted-foreground) hover:bg-(--muted) lg:px-3"
      onClick={() => {
        const dark = document.documentElement.classList.toggle('dark');
        writeStoredTheme(dark ? 'dark' : 'light');
      }}
    >
      <span className="hidden lg:inline">Toggle theme</span>
      <span className="lg:hidden">◐</span>
    </button>
  );
}
