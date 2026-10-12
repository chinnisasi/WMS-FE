import { ReplenishmentView } from '@/components/replenishment/replenishment-view';
import { UnsupportedDrillNotice } from '@/components/shared/drill-banner';
import { drillKey, parseDrill } from '@/lib/drill';

export const metadata = { title: 'Replenishment' };

/** Story 9-1b — a batch-alert drill (`list=batch-alerts`), keyed so Clear remounts. */
export default async function ReplenishmentPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const drill = parseDrill('replenishment', await searchParams);
  return (
    <>
      {drill === 'unsupported' && <UnsupportedDrillNotice />}
      <ReplenishmentView key={drillKey(drill)} drill={drill} />
    </>
  );
}
