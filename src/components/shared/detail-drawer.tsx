'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * Story 2-3b (UI-PATTERNS §3.6, W8) — the detail drawer: a NON-modal right
 * panel (560 px from `md`, a full-width sheet below it) for a document with
 * its own actions and history. The list behind it stays visible and
 * keyboard-reachable — there is no backdrop and no focus trap.
 *
 * - Focus moves into it on open (its heading) and back to whatever held
 *   focus before (the row's trigger) on close (WCAG 2.4.3).
 * - Esc closes it only while focus is inside it, and only when nothing
 *   inside handled the key first (an inline confirmation closes first) —
 *   the topmost-layer rule; a document-level handler would close it from
 *   anywhere on the page (guide §2.4).
 * - `closeDisabled` holds it open while a write is in flight (closing then
 *   would drop the write's key — guide §2.4).
 *
 * The caller owns `?open=` (a plain URL parameter, guide §1.8) and renders
 * the drawer only while one is open. A confirmation inside it is inline
 * (`ConfirmRow`), never a second modal. Portal-allowed: no operator hook.
 */
export function DetailDrawer({
  title,
  subtitle,
  onClose,
  closeDisabled = false,
  children,
  testId,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
  children: ReactNode;
  testId?: string;
}) {
  const heading = useRef<HTMLHeadingElement | null>(null);
  const titleId = useId();
  const close = useRef(onClose);
  const disabled = useRef(closeDisabled);
  useEffect(() => {
    close.current = onClose;
    disabled.current = closeDisabled;
  });

  useEffect(() => {
    const previously = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    heading.current?.focus();
    return () => {
      // Back to the trigger, when it is still on the page.
      if (previously !== null && previously.isConnected) previously.focus();
    };
  }, []);

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-testid={testId}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented || disabled.current) return;
        event.preventDefault();
        close.current();
      }}
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col gap-3 overflow-y-auto border-l border-(--border) bg-(--background) p-4 text-sm shadow-lg md:w-[560px]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={titleId} ref={heading} tabIndex={-1} className="text-base font-medium outline-none">
            {title}
          </h2>
          {subtitle !== undefined && <div className="text-(--muted-foreground)">{subtitle}</div>}
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={closeDisabled}
          aria-label={`Close ${title}`}
          className="min-h-6 min-w-6 rounded-sm border border-(--border) px-2 py-1 text-xs hover:bg-(--muted) disabled:opacity-40"
        >
          Close
        </button>
      </div>
      {children}
    </aside>
  );
}
