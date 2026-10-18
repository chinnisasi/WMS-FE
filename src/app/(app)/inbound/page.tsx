import { InboundCards } from '@/components/inbound/inbound-cards';
import { UnsupportedDrillNotice } from '@/components/shared/drill-banner';
import { drillKey, parseDrill } from '@/lib/drill';
import { parseInboundQcGrn, parseInboundTab } from '@/lib/inbound-tabs';

export const metadata = { title: 'Inbound' };

/**
 * Story 9-1b — a goods-receipt (`list=grns`) or putaway (`list=putaway`) drill, keyed so Clear remounts.
 * inbound-tabs — `?tab=<id>` (not a drill key) opens one tab; it joins the key so
 * following another tab's link remounts on it. Story 1-2b — `?grnId=` on the QC
 * holds tab narrows it to one receipt's holds; it joins the key too.
 */
export default async function InboundPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const drill = parseDrill('inbound', params);
  const tab = parseInboundTab(params);
  const qcGrnId = parseInboundQcGrn(params);
  return (
    <>
      {drill === 'unsupported' && <UnsupportedDrillNotice />}
      <InboundCards key={`${drillKey(drill)}|${tab ?? 'default'}|${qcGrnId ?? ''}`} drill={drill} initialTab={tab} qcGrnId={qcGrnId} />
    </>
  );
}
