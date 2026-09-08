'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';

import { refreshSessionUser } from '@/lib/api/client';
import { readSession, subscribeSession } from '@/lib/auth';
import { visibleNavItems } from '@/lib/navigation';

import { SignOutButton } from '@/components/auth/sign-out';
import { CommandPalette } from './command-palette';
import { Sidebar, ThemeToggle } from './sidebar';
import { WarehouseSwitcher } from './warehouse-switcher';

/**
 * Web shell: fixed left sidebar + content. Responsive contract:
 * ≥1024px full sidebar · 768–1023px icon-only sidebar · <768px content
 * only, nav available through the header menu.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const menuRef = useRef<HTMLDetailsElement>(null);

  // Bootstrap the signed-in user (story 1.5): the stored role is as of the
  // last sign-in; a /me refetch on mount surfaces role changes made after
  // this session token was minted — without a re-login. Best-effort: a
  // failed refresh keeps the stored role (only cosmetic gating is affected;
  // the backend stays the authority).
  useEffect(() => {
    void refreshSessionUser();
  }, []);

  // ⌘K opens the command palette from anywhere; Esc closes the topmost
  // layer; Enter commits (see CommandPalette).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The header menu is a layer too: Esc and an outside click close it, not
  // just navigation — but only while it is the topmost layer (the palette
  // owns Esc whenever it is open).
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (menuRef.current?.open && !menuRef.current.contains(e.target as Node)) {
        menuRef.current.open = false;
      }
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, []);

  useEffect(() => {
    if (paletteOpen) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && menuRef.current) {
        menuRef.current.open = false;
      }
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [paletteOpen]);

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center gap-2 border-b border-(--border) px-4 lg:px-6">
          {/* <768px only: the nav is otherwise hidden, so it must stay reachable */}
          <details ref={menuRef} className="relative md:hidden">
            <summary className="cursor-pointer list-none rounded-md border border-(--border) px-2 py-1 text-sm">
              Menu
            </summary>
            <nav className="absolute left-0 top-12 z-40 w-56 border border-(--border) bg-(--background) py-2 shadow-lg">
              <MobileNavLinks onNavigate={() => menuRef.current && (menuRef.current.open = false)} />
              {/* Mobile gets the switcher too (review loop 2) — the sidebar's
                  ≥lg mount is invisible below 768px, so this is the only
                  warehouse display/picker on small viewports. */}
              <div className="border-t border-(--border) px-2 pt-2">
                <WarehouseSwitcher
                  className="border-b-0 px-0 py-1"
                  onPicked={() => menuRef.current && (menuRef.current.open = false)}
                />
              </div>
              <div className="border-t border-(--border) px-2 pt-2">
                <SignOutButton className="mb-2 block px-2 py-1 text-left text-sm hover:bg-(--muted)" />
                <ThemeToggle />
              </div>
            </nav>
          </details>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="ml-auto flex items-center gap-2 rounded-md border border-(--border) px-2 py-1 text-xs text-(--muted-foreground) hover:bg-(--muted)"
            aria-label="Open command palette"
          >
            Search <kbd className="data rounded border border-(--border) px-1">⌘K</kbd>
          </button>
        </header>
        <main className="min-w-0 flex-1 p-4 lg:p-6">{children}</main>
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

function MobileNavLinks({ onNavigate }: { onNavigate: () => void }) {
  // Same role-filtered IA list the ≥768px sidebar renders (story 1.5).
  const role = useSyncExternalStore(
    subscribeSession,
    () => readSession()?.user.role,
    () => undefined,
  );
  // Client-side Link keeps the SPA navigation; the menu folds itself away on
  // the way through.
  return (
    <>
      {visibleNavItems(role).map((item) => (
        <Link
          key={item.id}
          href={item.href}
          onClick={onNavigate}
          className="block px-4 py-2 text-sm hover:bg-(--muted)"
        >
          {item.label}
        </Link>
      ))}
    </>
  );
}
