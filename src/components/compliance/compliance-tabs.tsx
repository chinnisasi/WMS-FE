'use client';

import { useSyncExternalStore } from 'react';

import { readSession, subscribeSession } from '@/lib/auth';
import { drillFor, drillKey, type ParsedDrill } from '@/lib/drill';
import { COMPLIANCE_PAGE_TABS, type ComplianceTab } from '@/lib/page-tabs';

import { ClientInvoices } from '@/components/compliance/client-invoices';
import { ColdChainTrace } from '@/components/compliance/cold-chain-trace';
import { EwayBills } from '@/components/compliance/eway-bills';
import { HsnSummary } from '@/components/compliance/hsn-summary';
import { Invoices } from '@/components/compliance/invoices';
import { PageTabPanel, PageTabStrip, usePageTab } from '@/components/shared/page-tabs';

/**
 * The Compliance page's sections behind a tab bar (page-tabs, 2026-10-17):
 * Invoices · Client invoices · E-way bills · HSN summary · Cold-chain trace,
 * one mounted at a time, `?tab=` linkable. An invoice (`list=invoices`) or
 * e-way (`list=eway`) drill opens on its own list's tab, under its banner;
 * another tab leaves the drill, and Clear lands on the drilled list's tab.
 *
 * Each section keeps its own session gate and contents; this wrapper renders
 * nothing until the session is known, so no tab bar flashes on the server
 * render.
 */
export function ComplianceTabs({
  drill = null,
  initialTab = null,
}: {
  drill?: ParsedDrill;
  initialTab?: ComplianceTab | null;
}) {
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => null as boolean | null,
  );
  if (sessioned === null) return null;
  return <ComplianceTabsKnown drill={drill} initialTab={initialTab} />;
}

function ComplianceTabsKnown({ drill, initialTab }: { drill: ParsedDrill; initialTab: ComplianceTab | null }) {
  const drilled = drillFor(drill, 'invoices') !== null || drillFor(drill, 'eway') !== null;
  const [tab, selectTab] = usePageTab(COMPLIANCE_PAGE_TABS, COMPLIANCE_PAGE_TABS.initial(drill, initialTab), drilled);
  // Both drilled sections stay keyed on the drill (Story 9-1b), so Clear remounts them.
  const key = drillKey(drill);
  return (
    <div className="flex flex-col gap-4">
      <PageTabStrip def={COMPLIANCE_PAGE_TABS} active={tab} drilled={drilled} onSelect={selectTab} />
      <PageTabPanel def={COMPLIANCE_PAGE_TABS} active={tab}>
        {tab === 'invoices' && (
          <Invoices key={`invoices-${key}`} drill={drill} clearHref={COMPLIANCE_PAGE_TABS.href('invoices')} />
        )}
        {/* Story 21-5 — the 3PL's services invoices to its client brands. */}
        {tab === 'client-invoices' && <ClientInvoices />}
        {tab === 'eway' && <EwayBills key={`eway-${key}`} drill={drill} clearHref={COMPLIANCE_PAGE_TABS.href('eway')} />}
        {tab === 'hsn' && <HsnSummary />}
        {tab === 'cold-chain' && <ColdChainTrace />}
      </PageTabPanel>
    </div>
  );
}
