import type { ReactNode } from 'react';

/**
 * Story UI-1 (UI-PATTERNS §2, W12; decision 1) — the sidebar's icon set:
 * single-stroke 20px SVGs drawn here rather than a dependency (the
 * few-dependency posture, frontend SYSTEM-DESIGN). Keyed by `NavItem.id`,
 * plus `security` and `theme` for the footer controls. Decoration only
 * (`aria-hidden`): the link's text or `aria-label` carries the name. An id
 * with no drawing falls back to the item's two-letter monogram box.
 */
const PATHS: Readonly<Record<string, ReactNode>> = {
  overview: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </>
  ),
  inventory: (
    <>
      <path d="M21 8 12 3 3 8v8l9 5 9-5z" />
      <path d="m3 8 9 5 9-5M12 13v8" />
    </>
  ),
  inbound: (
    <>
      <path d="M12 3v12m0 0-4-4m4 4 4-4" />
      <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </>
  ),
  outbound: (
    <>
      <path d="M12 15V3m0 0L8 7m4-4 4 4" />
      <path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
    </>
  ),
  moves: (
    <>
      <path d="M7 4 3 8l4 4M3 8h13" />
      <path d="m17 12 4 4-4 4m4-4H8" />
    </>
  ),
  conflicts: (
    <>
      <path d="M12 3 2 20h20z" />
      <path d="M12 10v4m0 3h.01" />
    </>
  ),
  notifications: (
    <>
      <path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 8 2.5 8h-17S6 15 6 9" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </>
  ),
  replenishment: (
    <>
      <path d="M20 11a8 8 0 0 0-14.7-4.4L3 9" />
      <path d="M3 4v5h5M4 13a8 8 0 0 0 14.7 4.4L21 15" />
      <path d="M21 20v-5h-5" />
    </>
  ),
  channels: (
    <>
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <circle cx="18" cy="18" r="2.5" />
      <path d="m8.2 10.8 7.6-3.6m-7.6 6 7.6 3.6" />
    </>
  ),
  compliance: (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6M9 15l2 2 4-4" />
    </>
  ),
  reports: (
    <>
      <path d="M4 20V10m6 10V4m6 16v-7m4 7H2" />
    </>
  ),
  returns: (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3m0 14v3M4.9 4.9l2.1 2.1m10 10 2.1 2.1M2 12h3m14 0h3M4.9 19.1 7 17M17 7l2.1-2.1" />
    </>
  ),
  security: (
    <>
      <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  theme: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" />
    </>
  ),
};

export function hasNavIcon(id: string): boolean {
  return Object.hasOwn(PATHS, id);
}

export function NavIcon({ id, monogram, className = 'h-5 w-5' }: { readonly id: string; readonly monogram?: string; readonly className?: string }) {
  if (!hasNavIcon(id)) {
    return (
      <span aria-hidden className="data flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-current text-[9px] font-semibold">
        {monogram ?? ''}
      </span>
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      data-icon={id}
      className={`shrink-0 ${className}`}
    >
      {PATHS[id]}
    </svg>
  );
}
