import { PageHeader } from '@/components/shared/page-header';
import { ReturnsView } from '@/components/returns/returns-view';
import { RETURNS_PAGE_TABS } from '@/lib/page-tabs';

export const metadata = { title: 'Returns' };

/**
 * Returns (story 13-1, FR-46): the active warehouse's return authorizations —
 * each RMA's lines, reasons and serials, and Cancel for `returns.manage`.
 * Authorizations are created from a dispatched order's detail on /outbound.
 * Story 4-7a — a second tab, Awaiting disposition (`?tab=awaiting`): every
 * received unit still in the Returns bin, restocked, quarantined or scrapped
 * from there. `?tab=` joins the remount key; the page takes no drill.
 */
export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const tab = RETURNS_PAGE_TABS.parse(await searchParams);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Returns"
        description="Units authorized to come back from dispatched orders, and what becomes of each one once it is back: restocked, quarantined for QC or scrapped. Create a return from the order on the Outbound page."
      />
      <ReturnsView key={tab ?? 'default'} initialTab={tab} />
    </div>
  );
}
