import { Outbound } from '@/components/outbound/outbound';
import { UnsupportedDrillNotice } from '@/components/shared/drill-banner';
import { drillKey, parseDrill } from '@/lib/drill';
import { OUTBOUND_PAGE_TABS } from '@/lib/page-tabs';

export const metadata = { title: 'Outbound' };

/**
 * Story 9-1b — an Overview drill (`list=orders`) arrives in the URL. The
 * screen is keyed on the drill, so Clear (a soft navigation to the bare
 * route) remounts it: no drilled cursor or page survives.
 * page-tabs — `?tab=<id>` (not a drill key) opens one tab; it joins the key so
 * following another tab's link remounts on it.
 */
export default async function OutboundPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const drill = parseDrill('outbound', params);
  const tab = OUTBOUND_PAGE_TABS.parse(params);
  return (
    <>
      {drill === 'unsupported' && <UnsupportedDrillNotice />}
      <Outbound key={`${drillKey(drill)}|${tab ?? 'default'}`} drill={drill} initialTab={tab} />
    </>
  );
}
