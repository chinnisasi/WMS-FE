'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSyncExternalStore } from 'react';

import { SignOutButton } from '@/components/auth/sign-out';
import { Logo } from '@/components/shared/logo';
import { ClientSwitcher } from '@/components/shell/client-switcher';
import { NavIcon } from '@/components/shell/nav-icons';
import { WarehouseSwitcher } from '@/components/shell/warehouse-switcher';
import { readSession, subscribeSession } from '@/lib/auth';
import { visibleNavItems } from '@/lib/navigation';
import { writeStoredTheme } from '@/lib/theme';

/**
 * Sidebar IA skeleton — all 13 surfaces, non-functional routes. The list is
 * filtered by the session role (story 1.5): a surface that declares
 * capabilities the role lacks is hidden — hide surfaces, never "blocked"
 * screens (no epic-1 nav surface declares any yet).
 * Responsive contract: ≥1024px full labels · 768–1023px icon only (the
 * link keeps the label as its accessible name) · <768px hidden entirely
 * (header menu takes over). Story UI-1: the logotype and a drawn icon per
 * surface (`NavIcon`; the monogram is only the fallback).
 */
export function Sidebar() {
  const pathname = usePathname();
  // The role is a primitive snapshot — stable across getSnapshot calls.
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );
  const navItems = visibleNavItems(role);

  return (
    <aside className="sticky top-0 hidden h-screen w-14 shrink-0 flex-col border-r border-(--border) md:flex lg:w-60">
      <div className="flex h-12 items-center border-b border-(--border) px-3 lg:px-4">
        <span className="hidden lg:inline">
          <Logo />
        </span>
        <span className="lg:hidden">
          <Logo compact />
        </span>
      </div>
      <WarehouseSwitcher className="hidden lg:block" />
      {/* Story 1-5a — the client filter, beside the warehouse. */}
      <ClientSwitcher className="hidden lg:block" />
      <nav aria-label="Primary" className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {navItems.map((item) => {
          // Nested child routes (e.g. /inventory/xyz) keep the surface
          // highlighted; the Overview root matches exactly.
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              aria-label={item.label}
              title={item.label}
              className={`flex items-center gap-3 rounded-md px-2 py-1.5 text-sm ${
                active
                  ? 'bg-(--primary) text-(--primary-foreground)'
                  : 'text-(--foreground) hover:bg-(--muted)'
              }`}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center" aria-hidden>
                <NavIcon id={item.id} monogram={item.monogram} />
              </span>
              <span className="hidden truncate lg:inline">{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className="mx-2 mb-3 flex flex-wrap items-center gap-2 lg:mx-3">
        {/* Story 6-1b — My account → Security, beside Sign out (compact at icon width). */}
        <Link
          href="/account/security"
          aria-label="Security"
          aria-current={pathname.startsWith('/account/security') ? 'page' : undefined}
          title="Security"
          className="flex items-center gap-1.5 rounded-md border border-(--border) px-2 py-1 text-xs text-(--muted-foreground) hover:bg-(--muted)"
        >
          <NavIcon id="security" className="h-4 w-4" />
          <span className="hidden lg:inline">Security</span>
        </Link>
        <SignOutButton className="rounded-md border border-(--border) px-2 py-1 text-xs text-(--muted-foreground) hover:bg-(--muted)" />
        <ThemeToggle />
      </div>
    </aside>
  );
}

/**
 * Story UI-1 — the theme switch as an icon button with a name: "Dark theme",
 * `aria-pressed` while dark (subscribed to the root's class — the pre-paint
 * script owns the first value), and a visible "Theme" label from `lg` up
 * (or always, with `labelled`, as in the narrow-screen menu).
 */
function subscribeThemeClass(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

export function ThemeToggle({ labelled = false }: { labelled?: boolean }) {
  // The root's `dark` class is the truth (the pre-paint script sets it); the
  // server snapshot is null, so the first paint carries no stale pressed state.
  const dark = useSyncExternalStore(
    subscribeThemeClass,
    () => document.documentElement.classList.contains('dark'),
    () => null as boolean | null,
  );
  return (
    <button
      type="button"
      aria-label="Dark theme"
      aria-pressed={dark ?? undefined}
      title="Dark theme"
      className="flex items-center gap-1.5 rounded-md border border-(--border) px-2 py-1 text-xs text-(--muted-foreground) hover:bg-(--muted)"
      onClick={() => {
        const next = document.documentElement.classList.toggle('dark');
        writeStoredTheme(next ? 'dark' : 'light');
      }}
    >
      <NavIcon id="theme" className="h-4 w-4" />
      <span className={labelled ? '' : 'hidden lg:inline'}>Theme</span>
    </button>
  );
}