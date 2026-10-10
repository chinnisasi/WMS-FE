import { ClientService } from '@/components/reports/client-service';

export const metadata = { title: 'Reports' };

/**
 * Reports / Audit. Story 21-8 fills the first section — per-client service
 * reporting; 9-3's audit trail joins as a sibling section later (the nav
 * label keeps its "Audit" half for it).
 */
export default function ReportsPage() {
  return (
    <div className="flex flex-col gap-4">
      <section>
        <h1 className="text-lg font-semibold">Reports</h1>
        <p className="mt-1 max-w-prose text-sm text-(--muted-foreground)">
          How the operation performed for each client. The audit trail joins this page later.
        </p>
      </section>
      <ClientService />
    </div>
  );
}
