import { PRODUCT_NAME } from '@/lib/navigation';

/**
 * Story UI-1 (UI-PATTERNS §2, W12) — the logotype: a mark (three stacked
 * cartons on a pallet line, single stroke, `currentColor` on the primary
 * token so it follows the theme) and the product's working name. The name
 * is one constant (`PRODUCT_NAME`, DESIGN.md: the PRD's working title until
 * branding lands), so a rename is one line. `compact` draws the mark alone,
 * named for a screen reader. Portal-allowed: no hook.
 */
export function LogoMark({ className = 'h-6 w-6' }: { readonly className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <rect x="3.5" y="11" width="7.5" height="7" rx="1" />
      <rect x="13" y="11" width="7.5" height="7" rx="1" />
      <rect x="8.25" y="3.5" width="7.5" height="7" rx="1" />
      <path d="M2.5 21h19" />
    </svg>
  );
}

export function Logo({ compact = false }: { readonly compact?: boolean }) {
  if (compact) {
    return (
      <span role="img" aria-label={PRODUCT_NAME} className="text-(--primary)" data-testid="logo">
        <LogoMark />
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2" data-testid="logo">
      <span className="text-(--primary)">
        <LogoMark />
      </span>
      <span className="text-base font-semibold tracking-tight">{PRODUCT_NAME}</span>
    </span>
  );
}
