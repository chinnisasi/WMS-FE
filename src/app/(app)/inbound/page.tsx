import { PageHeader } from '@/components/shared/page-header';
import { InboundCards } from '@/components/inbound/inbound-cards';
import { UnsupportedDrillNotice } from '@/components/shared/drill-banner';
import { drillKey, parseDrill } from '@/lib/drill';
import { dockParamsKey, parseDockParams } from '@/lib/dock-schedule';
import { parseInboundQcGrn, parseInboundTab } from '@/lib/inbound-tabs';

export const metadata = { title: 'Inbound' };

/**
 * Story 9-1b — a goods-receipt (`list=grns`) or putaway (`list=putaway`) drill, keyed so Clear remounts.
 * inbound-tabs — `?tab=<id>` (not a drill key) opens one tab; it joins the key so
 * following another tab's link remounts on it. Story 1-2b — `?grnId=` on the QC
 * holds tab narrows it to one receipt's holds; it joins the key too. Story 2-3b —
 * the Dock schedule's `view` / `date` / `open` / `cancelled` (plain parameters
 * beside `?tab=dock`) parse here and join the key on that tab only.
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
  const dock = parseDockParams(params);
  const dockKey = tab === 'dock' ? dockParamsKey(dock) : '';
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Inbound" description="Dock appointments, purchase orders, shipment notices, gate-ins and receipts — from the dock to a putaway bin." />
      {drill === 'unsupported' && <UnsupportedDrillNotice />}
      <InboundCards key={`${drillKey(drill)}|${tab ?? 'default'}|${qcGrnId ?? ''}|${dockKey}`} drill={drill} initialTab={tab} qcGrnId={qcGrnId} dock={dock} />
    </div>
  );
}
