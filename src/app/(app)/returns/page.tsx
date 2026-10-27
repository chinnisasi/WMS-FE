import { PageHeader } from '@/components/shared/page-header';
import { ReturnsView } from '@/components/returns/returns-view';

export const metadata = { title: 'Returns' };

/**
 * Returns (story 13-1, FR-46): the active warehouse's return authorizations —
 * each RMA's lines, reasons and serials, and Cancel for `returns.manage`.
 * Authorizations are created from a dispatched order's detail on /outbound.
 * Story 13-4 adds the returns queue and the disposition cards here.
 */
export default function ReturnsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Returns"
        description="Units authorized to come back from dispatched orders. Create a return from the order on the Outbound page."
      />
      <ReturnsView />
    </div>
  );
}
