import { ConflictsQueues } from '@/components/conflicts/queues';
import { UnsupportedDrillNotice } from '@/components/shared/drill-banner';
import { drillKey, parseDrill } from '@/lib/drill';

export const metadata = { title: 'Conflicts & Reviews' };

/** Story 9-1b — an over-receipt drill (`list=over-receipts`), keyed so Clear remounts. */
export default async function ConflictsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const drill = parseDrill('conflicts', await searchParams);
  return (
    <>
      {drill === 'unsupported' && <UnsupportedDrillNotice />}
      <ConflictsQueues key={drillKey(drill)} drill={drill} />
    </>
  );
}
