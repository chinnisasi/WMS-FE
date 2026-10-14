import { AuditTrail } from '@/components/reports/audit-trail';
import { ClientService } from '@/components/reports/client-service';
import { LedgerIntegrity } from '@/components/reports/ledger-integrity';

export const metadata = { title: 'Reports' };

/**
 * Reports / Audit. Story 21-8's per-client service reporting, then story
 * 9-3a's Audit section — the owner's trail of every state-changing action
 * (it renders only for a role holding `audit.view`) — then story 9-3c's
 * Ledger integrity section (the hash chain's verified position, anchors,
 * WORM copies and breaks; owner-only through the same capability).
 */
export default function ReportsPage() {
  return (
    <div className="flex flex-col gap-4">
      <section>
        <h1 className="text-lg font-semibold">Reports</h1>
        <p className="mt-1 max-w-prose text-sm text-(--muted-foreground)">
          How the operation performed for each client and, for the owner, who changed what and when.
        </p>
      </section>
      <ClientService />
      <AuditTrail />
      <LedgerIntegrity />
    </div>
  );
}
