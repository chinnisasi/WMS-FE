'use client';

import { useEffect, useState } from 'react';

import { NAV_ITEMS } from '@/lib/navigation';

import { CommandPalette } from './command-palette';
import { Sidebar } from './sidebar';

/**
 * Web shell: fixed left sidebar + content. Responsive contract:
 * ≥1024px full sidebar · 768–1023px icon-only sidebar · <768px content
 * only, nav available through the header menu.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);

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

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center gap-2 border-b border-(--border) px-4 lg:px-6">
          {/* <768px only: the nav is otherwise hidden, so it must stay reachable */}
          <details className="md:hidden">
            <summary className="cursor-pointer list-none rounded-md border border-(--border) px-2 py-1 text-sm">
              Menu
            </summary>
            <nav className="absolute left-0 top-12 z-40 w-56 border border-(--border) bg-(--background) py-2 shadow-lg">
              <MobileNavLinks />
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

function MobileNavLinks() {
  // Same shared IA list the ≥768px sidebar renders.
  return (
    <>
      {NAV_ITEMS.map((item) => (
        <a
          key={item.id}
          href={item.href}
          className="block px-4 py-2 text-sm hover:bg-(--muted)"
        >
          {item.label}
        </a>
      ))}
    </>
  );
}