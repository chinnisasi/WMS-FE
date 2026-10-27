'use client';

import { useSyncExternalStore } from 'react';

import { readSession, subscribeSession } from '@/lib/auth';
import { drillFor, drillKey, type ParsedDrill } from '@/lib/drill';
import { COMPLIANCE_PAGE_TABS, type ComplianceTab } from '@/lib/page-tabs';
import { useActiveClient } from '@/lib/use-active-client';

import { ClientInvoices } from '@/components/compliance/client-invoices';
import { NotesRegister } from '@/components/compliance/client-invoice-notes';
import { ColdChainTrace } from '@/components/compliance/cold-chain-trace';
import { EwayBills } from '@/components/compliance/eway-bills';
import { HsnSummary } from '@/components/compliance/hsn-summary';
import { Invoices } from '@/components/compliance/invoices';
import { Licences } from '@/components/compliance/licences';
import { AllClientsNote } from '@/components/shared/client-filter-chip';
import { PageTabPanel, PageTabStrip, usePageTab } from '@/components/shared/page-tabs';

/**
 * The Compliance page's sections behind a tab bar (page-tabs, 2026-10-17):
 * Invoices · Client invoices · E-way bills · HSN summary · Cold-chain trace ·
 * Licences (1-6c),
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
        {/* Story 5-6a — the credit and debit notes register (never filtered by client: a GSTIN's month). */}
        {tab === 'notes' && (
          <>
            <UnfilteredNote />
            <NotesRegister />
          </>
        )}
        {tab === 'eway' && <EwayBills key={`eway-${key}`} drill={drill} clearHref={COMPLIANCE_PAGE_TABS.href('eway')} />}
        {tab === 'hsn' && (
          <>
            <UnfilteredNote />
            <HsnSummary />
          </>
        )}
        {tab === 'cold-chain' && (
          <>
            <UnfilteredNote />
            <ColdChainTrace />
          </>
        )}
        {/* Story 1-6c — the drug and FSSAI licences and their coverage gaps (never filtered by client). */}
        {tab === 'licences' && (
          <>
            <UnfilteredNote />
            <Licences />
          </>
        )}
      </PageTabPanel>
    </div>
  );
}

/**
 * Story 1-5a — the HSN summary and the cold-chain trace are never filtered
 * by client (spec "Never"): under an active client they say "All clients".
 * Mounted only on those tabs, so the filtered sections keep one clients read.
 */
function UnfilteredNote() {
  const active = useActiveClient();
  return <AllClientsNote active={active} />;
}
