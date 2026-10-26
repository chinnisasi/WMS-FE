import { PageHeader } from '@/components/shared/page-header';
import { CountsScreen } from '@/components/counts/counts-screen';
import { COUNTS_PAGE_TABS } from '@/lib/page-tabs';

export const metadata = { title: 'Counts' };

/**
 * Story 3-5a — cycle counts under Moves (EXPERIENCE.md places them there; the
 * nav keeps its 13 items and Moves stays active for every `/moves/*` route).
 * `?tab=schedule` opens the schedule; the tab joins the key so following a
 * link to the other tab remounts on it. No drill reaches this page.
 */
export default async function CountsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const tab = COUNTS_PAGE_TABS.parse(params);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Counts" description="Scheduled and open cycle counts, and the variances they found." />
      <CountsScreen key={tab ?? 'default'} initialTab={tab} />
    </div>
  );
}
