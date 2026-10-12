'use client';

import { usePathname, useRouter } from 'next/navigation';

import { describeDrill, drillBannerWord, UNSUPPORTED_DRILL_COPY, type Drill } from '@/lib/drill';
import { useTenantWarehouses } from '@/lib/use-tenant-warehouses';

import { FeedbackBanner } from '@/components/feedback/banner';
import { buttonClass } from '@/components/shared/surface';

/**
 * Story 9-1b — the drill's chrome, in one place:
 *
 *   - `DrillBanner` — the read-only banner over a drilled section: what the
 *     list is filtered to (`describeDrill`, the warehouse named from the
 *     tenant's list, its short id until that list is in hand), and Clear.
 *     There are no editable filter controls (decision 1).
 *   - `DrillUnavailable` — the drilled section is behind a capability the
 *     role lacks (defensive: the Overview withholds the link, decision 5).
 *   - `UnsupportedDrillNotice` — beside the NORMAL view when the link's
 *     drill could not be honoured whole.
 *
 * Clear navigates to the bare route. The page mounts its screen keyed on the
 * drill, so that soft navigation REMOUNTS the screen: no drilled cursor,
 * cached page or DataTable Prev/Next stack survives into the normal view.
 *
 * `DrillBanner` is the ONLY component that touches the router, and it
 * renders only in drilled mode — so a screen rendered without a drill (every
 * existing screen test) never needs an App Router context. Not reachable
 * from the portal (it reads an operator hook); `portal-boundary.test.ts`
 * would say so if it were.
 */
export function DrillBanner({ drill }: { drill: Drill }) {
  const router = useRouter();
  const pathname = usePathname();
  const warehouses = useTenantWarehouses();
  const items = warehouses.state === 'ready' ? warehouses.data.items : null;
  return (
    <div data-testid="drill-banner">
      <FeedbackBanner
        tone="warning"
        word={drillBannerWord(drill)}
        reason={describeDrill(drill, items)}
        action={
          <button type="button" className={buttonClass} onClick={() => router.push(pathname)}>
            Clear
          </button>
        }
      />
    </div>
  );
}

/** A section the drill names, but the viewer's role cannot open. */
export function DrillUnavailable() {
  return (
    <div data-testid="drill-unavailable" className="rounded-md border border-(--border) p-3 text-sm text-(--muted-foreground)">
      This list isn&apos;t available to you.
    </div>
  );
}

/**
 * Beside the NORMAL view, when the link's drill could not be honoured whole
 * (an unknown or repeated key, a malformed value, a list this screen does
 * not serve). A partially applied filter would list rows that are not the
 * figure's, so none of it is applied.
 */
export function UnsupportedDrillNotice() {
  return (
    <div data-testid="drill-unsupported" className="mb-4">
      <FeedbackBanner tone="warning" word="Link not applied" reason={UNSUPPORTED_DRILL_COPY} />
    </div>
  );
}
