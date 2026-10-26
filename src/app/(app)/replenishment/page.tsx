import { PageHeader } from '@/components/shared/page-header';
import { ReplenishmentView } from '@/components/replenishment/replenishment-view';
import { UnsupportedDrillNotice } from '@/components/shared/drill-banner';
import { drillKey, parseDrill } from '@/lib/drill';
import { REPLENISHMENT_PAGE_TABS } from '@/lib/page-tabs';

export const metadata = { title: 'Replenishment' };

/**
 * Story 9-1b — a batch-alert drill (`list=batch-alerts`), keyed so Clear remounts.
 * page-tabs — `?tab=<id>` (not a drill key) opens one tab; it joins the key.
 */
export default async function ReplenishmentPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const drill = parseDrill('replenishment', params);
  const tab = REPLENISHMENT_PAGE_TABS.parse(params);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Replenishment" description="Stock below its reorder point, suggested purchase orders and batch alerts." />
      {drill === 'unsupported' && <UnsupportedDrillNotice />}
      <ReplenishmentView key={`${drillKey(drill)}|${tab ?? 'default'}`} drill={drill} initialTab={tab} />
    </div>
  );
}
