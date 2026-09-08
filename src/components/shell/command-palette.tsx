'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { NAV_ITEMS } from '@/lib/navigation';

export interface PaletteAction {
  readonly id: string;
  readonly label: string;
  readonly run: () => void;
}

/**
 * ⌘K command palette — navigate + actions. Interaction primitives (epic
 * contract): Esc closes the topmost layer, Enter commits, arrows move the
 * selection. Only one palette layer ever exists (modal stacks > 1 are
 * banned). Touch users open it from the header button — never hover-only.
 */
export function CommandPalette({
  open,
  onClose,
  actions = [],
}: {
  open: boolean;
  onClose: () => void;
  actions?: readonly PaletteAction[];
}) {
  if (!open) return null;
  return <PaletteOverlay onClose={onClose} actions={actions} />;
}

function PaletteOverlay({
  onClose,
  actions,
}: {
  onClose: () => void;
  actions: readonly PaletteAction[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const previouslyFocused = useRef<Element | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // All palette keys are handled at window level: focus can leave the overlay
  // (a click on the panel padding, a stray tab) without deadening the
  // keyboard, and focus returns to the trigger on the way out.
  useEffect(() => {
    previouslyFocused.current = document.activeElement;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (previouslyFocused.current instanceof HTMLElement) {
        previouslyFocused.current.focus();
      }
    };
  }, [onClose]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const nav = NAV_ITEMS.map((item) => ({
      id: `nav:${item.id}`,
      label: item.label,
      run: () => router.push(item.href),
    }));
    const all = [...nav, ...actions];
    return q ? all.filter((i) => i.label.toLowerCase().includes(q)) : all;
  }, [query, actions, router]);

  const commit = (index: number) => {
    const item = items[index];
    if (!item) return;
    onClose();
    item.run();
  };

  // Arrows/Enter at window level; an empty result list is a no-op (never
  // drives the selection to -1).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (items.length) setSelected((s) => Math.min(s + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (items.length) setSelected((s) => Math.max(s - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        commit(selected);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, selected, onClose]);

  // Keep the selected item visible inside the capped-height list.
  useEffect(() => {
    listRef.current?.children[selected]?.scrollIntoView({ block: 'nearest' });
  }, [selected, items]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh]"
      onClick={(e) => {
        // Backdrop click (the overlay itself, not its children) closes.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg border border-(--border) bg-(--popover) shadow-xl">
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          placeholder="Search surfaces and actions…"
          className="w-full rounded-t-lg border-b border-(--border) bg-transparent px-4 py-3 text-sm outline-none"
        />
        <ul ref={listRef} className="max-h-72 overflow-y-auto p-1">
          {items.length === 0 ? (
            <li className="px-3 py-2 text-sm text-(--muted-foreground)">No matches</li>
          ) : (
            items.map((item, i) => (
              <li key={item.id}>
                <button
                  type="button"
                  onMouseEnter={() => setSelected(i)}
                  onClick={() => commit(i)}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm ${
                    i === selected ? 'bg-(--primary) text-(--primary-foreground)' : ''
                  }`}
                >
                  {item.label}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
