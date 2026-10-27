import { PageHeader } from '@/components/shared/page-header';
import { ConflictsQueues } from '@/components/conflicts/queues';
import { UnsupportedDrillNotice } from '@/components/shared/drill-banner';
import { parseQueueParam } from '@/lib/conflicts-queues';
import { drillKey, parseDrill } from '@/lib/drill';

export const metadata = { title: 'Conflicts & Reviews' };

/**
 * Story 9-1b — an over-receipt drill (`list=over-receipts`), keyed so Clear
 * remounts. Story 9-2 — `?queue=<id>` (not a drill key) opens one queue; it
 * joins the key so following another queue's link remounts on it.
 */
export default async function ConflictsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const drill = parseDrill('conflicts', params);
  const queue = parseQueueParam(params);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Conflicts & Reviews" description="Decisions waiting on a person: over-receipts, count variances, adjustments and refused scans." />
      {drill === 'unsupported' && <UnsupportedDrillNotice />}
      <ConflictsQueues key={`${drillKey(drill)}|${queue ?? 'default'}`} drill={drill} initialQueue={queue} />
    </div>
  );
}
