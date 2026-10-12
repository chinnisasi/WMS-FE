import { Outbound } from '@/components/outbound/outbound';
import { UnsupportedDrillNotice } from '@/components/shared/drill-banner';
import { drillKey, parseDrill } from '@/lib/drill';

export const metadata = { title: 'Outbound' };

/**
 * Story 9-1b — an Overview drill (`list=orders`) arrives in the URL. The
 * screen is keyed on the drill, so Clear (a soft navigation to the bare
 * route) remounts it: no drilled cursor or page survives.
 */
export default async function OutboundPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const drill = parseDrill('outbound', await searchParams);
  return (
    <>
      {drill === 'unsupported' && <UnsupportedDrillNotice />}
      <Outbound key={drillKey(drill)} drill={drill} />
    </>
  );
}
