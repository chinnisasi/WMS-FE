import { PageHeader } from '@/components/shared/page-header';
import { ComplianceTabs } from '@/components/compliance/compliance-tabs';
import { UnsupportedDrillNotice } from '@/components/shared/drill-banner';
import { drillKey, parseDrill } from '@/lib/drill';
import { COMPLIANCE_PAGE_TABS } from '@/lib/page-tabs';

export const metadata = { title: 'Compliance' };

/**
 * Story 9-1b — an invoice (`list=invoices`) or e-way (`list=eway`) drill.
 * Both drilled sections are keyed on the drill so Clear remounts them; each
 * drills only when `list` names it.
 * page-tabs — the five sections sit behind a tab bar (`ComplianceTabs`);
 * `?tab=<id>` (not a drill key) opens one, and joins the page key.
 */
export default async function CompliancePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const drill = parseDrill('compliance', params);
  const tab = COMPLIANCE_PAGE_TABS.parse(params);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Compliance" description="Invoices, e-way bills, HSN summaries, licences and cold-chain records." />
      {drill === 'unsupported' && <UnsupportedDrillNotice />}
      <ComplianceTabs key={`${drillKey(drill)}|${tab ?? 'default'}`} drill={drill} initialTab={tab} />
    </div>
  );
}
