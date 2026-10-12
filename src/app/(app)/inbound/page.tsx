import { InboundCards } from '@/components/inbound/inbound-cards';
import { UnsupportedDrillNotice } from '@/components/shared/drill-banner';
import { drillKey, parseDrill } from '@/lib/drill';

export const metadata = { title: 'Inbound' };

/** Story 9-1b — a goods-receipt (`list=grns`) or putaway (`list=putaway`) drill, keyed so Clear remounts. */
export default async function InboundPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const drill = parseDrill('inbound', await searchParams);
  return (
    <>
      {drill === 'unsupported' && <UnsupportedDrillNotice />}
      <InboundCards key={drillKey(drill)} drill={drill} />
    </>
  );
}
