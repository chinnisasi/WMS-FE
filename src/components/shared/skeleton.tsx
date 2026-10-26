/**
 * Story UI-1 (UI-PATTERNS §5, W3) — skeleton loading. A cold load shows the
 * shape of what is coming (rows under the real header, tile outlines), never
 * a spinner and never a jump from a sentence to a table.
 *
 * The bars are decoration (`aria-hidden`); the words are not lost: every
 * skeleton carries a `LoadingStatus` whose label is visually hidden but in
 * the accessibility tree, so a screen reader reading the page finds
 * "Loading …" where the rows will be (as the old visible sentence did). It
 * is marked polite but WITHOUT `role="status"` — the page's real status
 * banners keep that role. It mounts with its text, so most screen readers
 * will not speak it unprompted; nothing here promises an announcement.
 * `motion-safe:` keeps the pulse off under Reduce Motion. Portal-allowed.
 */
export function LoadingStatus({ label }: { readonly label: string }) {
  return (
    <span aria-live="polite" className="sr-only" data-testid="loading-status">
      {label}
    </span>
  );
}

export function SkeletonBar({ className = 'h-3 w-full' }: { readonly className?: string }) {
  return <span aria-hidden className={`block rounded-sm bg-(--muted) motion-safe:animate-pulse ${className}`} />;
}

/** Widths cycle so the rows read as text, not as a grid of equal boxes. */
const WIDTHS = ['w-3/4', 'w-1/2', 'w-2/3', 'w-5/6', 'w-2/5'];

/** `rows` skeleton `<tr>`s of `columns` cells, at the table's 40px row height. */
export function SkeletonRows({ columns, rows = 5 }: { readonly columns: number; readonly rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} aria-hidden className="h-10 border-b border-(--border) last:border-b-0" data-testid="skeleton-row">
          {Array.from({ length: Math.max(1, columns) }, (_, c) => (
            <td key={c} className="px-3">
              <SkeletonBar className={`h-3 ${WIDTHS[(r + c) % WIDTHS.length]}`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** `count` KPI-tile outlines in the Overview's grid. */
export function SkeletonTiles({ count, label }: { readonly count: number; readonly label: string }) {
  return (
    <div className="flex flex-col gap-2">
      <LoadingStatus label={label} />
      <div aria-hidden className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-md border border-(--border) bg-(--card) p-4" data-testid="skeleton-tile">
            <SkeletonBar className="h-3 w-1/2" />
            <SkeletonBar className="h-7 w-1/3" />
            <SkeletonBar className="h-3 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}
