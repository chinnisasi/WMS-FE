import { PageHeader } from '@/components/shared/page-header';
import { AuditTrail } from '@/components/reports/audit-trail';
import { ClientService } from '@/components/reports/client-service';
import { LedgerIntegrity } from '@/components/reports/ledger-integrity';
import { OperationalReports } from '@/components/reports/operational-reports';

export const metadata = { title: 'Reports' };

/**
 * Reports / Audit. First story 5-3a's Operational reports — the registers
 * (stock on hand, inbound, outbound, the stock ledger, batch ageing) as
 * client-filtered CSV or Excel downloads, for every staff role — then story
 * 21-8's per-client service reporting, then story 9-3a's Audit section — the
 * owner's trail of every state-changing action (it renders only for a role
 * holding `audit.view`) — then story 9-3c's Ledger integrity section (the
 * hash chain's verified position, anchors, WORM copies and breaks;
 * owner-only through the same capability). No tabs: the sections' anchors
 * (`#audit-exports`, `#ledger-integrity`) are unchanged.
 */
export default function ReportsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reports"
        description="Registers to download, how the operation performed for each client and, for the owner, who changed what and when."
      />
      <OperationalReports />
      <ClientService />
      <AuditTrail />
      <LedgerIntegrity />
    </div>
  );
}
