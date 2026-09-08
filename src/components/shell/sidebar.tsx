'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { SignOutButton } from '@/components/auth/sign-out';
import { WarehouseSwitcher } from '@/components/shell/warehouse-switcher';
import { NAV_ITEMS } from '@/lib/navigation';
import { writeStoredTheme } from '@/lib/theme';

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
      <WarehouseSwitcher className="hidden lg:block" />
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