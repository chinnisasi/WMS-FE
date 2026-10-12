'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { bellLabel, NOTIFICATIONS_EMPTY, NOTIFICATIONS_PANEL_LIMIT } from '@/lib/notifications';
import { useNotificationLookups, useNotificationStatus, useNotifications } from '@/lib/use-notifications';

import { NotificationEntryLink } from '@/components/notifications/notification-entry';
import { ReadFailure } from '@/components/shared/surface';

/**
 * Story 9-2 — the header bell: a `<details>` layer beside Search, following
 * the shell menu's rules (`app-shell.tsx`).
 *
 *  - **The dot.** Amber, `aria-hidden`, never a number — the trigger's name
 *    says "Notifications, new" instead. It reads `status` when the shell
 *    mounts and on each PATHNAME change (`usePathname` — a query-only change
 *    is not one), never on a timer.
 *  - **Closing.** Esc, an outside click, opening the palette (`paletteOpen`)
 *    and following a link all close it. Esc is skipped while the palette is
 *    open (the palette owns Esc then — the topmost layer only).
 *  - **Focus.** Moves into the panel on open; returns to the bell on close.
 *  - **The body is lazy.** It mounts only while open, so its reads (the
 *    newest 10 entries, the catalog map, the warehouse list) and the
 *    `opened` mark happen only when the panel is actually opened.
 */
export function NotificationBell({ paletteOpen }: { paletteOpen: boolean }) {
  const pathname = usePathname();
  const { hasNew, markOpened } = useNotificationStatus(pathname);
  const [open, setOpen] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const triggerRef = useRef<HTMLElement>(null);

  const close = () => {
    if (detailsRef.current?.open) detailsRef.current.open = false;
  };

  // Outside click closes it (the header menu's rule).
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (detailsRef.current?.open && !detailsRef.current.contains(e.target as Node)) {
        detailsRef.current.open = false;
      }
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, []);

  // Esc closes it — unless the palette is the topmost layer.
  useEffect(() => {
    if (paletteOpen) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && detailsRef.current?.open) {
        detailsRef.current.open = false;
      }
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [paletteOpen]);

  // Opening the palette closes the panel (one layer at a time).
  useEffect(() => {
    if (paletteOpen && detailsRef.current?.open) detailsRef.current.open = false;
  }, [paletteOpen]);

  // `toggle` fires for every way the element opens or closes, so the state
  // and the focus moves follow the DOM rather than each closing path.
  const onToggle = () => {
    const nowOpen = detailsRef.current?.open ?? false;
    setOpen(nowOpen);
    if (!nowOpen) {
      // Back to the bell — unless the close moved focus somewhere real (an
      // outside click on another control keeps its focus).
      const active = document.activeElement;
      if (active === null || active === document.body || detailsRef.current?.contains(active)) {
        triggerRef.current?.focus();
      }
    }
  };

  return (
    <details ref={detailsRef} onToggle={onToggle} className="relative ml-auto">
      <summary
        ref={triggerRef}
        role="button"
        aria-expanded={open}
        aria-label={bellLabel(hasNew)}
        className="relative flex cursor-pointer list-none items-center rounded-md border border-(--border) px-2 py-1 text-xs hover:bg-(--muted) focus-visible:outline-2 focus-visible:outline-(--ring)"
      >
        <BellGlyph />
        {hasNew && (
          <span
            aria-hidden="true"
            data-notification-dot=""
            className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-(--background) bg-(--warning)"
          />
        )}
      </summary>
      {open && <NotificationPanelBody onNavigate={close} onOpened={markOpened} />}
    </details>
  );
}

function BellGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 2.5a3.5 3.5 0 0 0-3.5 3.5v2.5L3 11h10l-1.5-2.5V6A3.5 3.5 0 0 0 8 2.5Z" />
      <path d="M6.5 12.5a1.5 1.5 0 0 0 3 0" />
    </svg>
  );
}

/**
 * The open panel: the newest entries, "See all". Mounting it IS opening the
 * panel — it records the open (`markOpened`, which clears the dot) and takes
 * focus.
 */
function NotificationPanelBody({ onNavigate, onOpened }: { onNavigate: () => void; onOpened: () => void }) {
  const entries = useNotifications(NOTIFICATIONS_PANEL_LIMIT);
  const lookups = useNotificationLookups();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
    onOpened();
    // Once per open: the body mounts when the panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      role="region"
      aria-label="Notifications"
      className="absolute right-0 top-10 z-40 flex w-80 max-w-[90vw] flex-col border border-(--border) bg-(--background) text-sm shadow-lg focus-visible:outline-none"
    >
      <div className="border-b border-(--border) px-3 py-2 font-medium">Notifications</div>
      {entries.state === 'loading' && <div className="px-3 py-2 text-(--muted-foreground)">Loading notifications…</div>}
      {entries.state === 'failed' && (
        <div className="px-3 py-2">
          <ReadFailure word="Notifications unavailable" reason={entries.reason} onRetry={entries.reload} />
        </div>
      )}
      {entries.state === 'ready' &&
        (entries.data.items.length === 0 ? (
          <div className="px-3 py-2 text-(--muted-foreground)">{NOTIFICATIONS_EMPTY}</div>
        ) : (
          <ul className="max-h-96 overflow-y-auto">
            {entries.data.items.map((entry) => (
              <li key={entry.id} className="border-b border-(--border) last:border-b-0">
                <NotificationEntryLink entry={entry} lookups={lookups} nowMs={entries.data.fetchedAtMs} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        ))}
      <Link
        href="/notifications"
        onClick={onNavigate}
        className="border-t border-(--border) px-3 py-2 text-center text-xs text-(--primary) underline-offset-2 hover:underline"
      >
        See all
      </Link>
    </div>
  );
}
