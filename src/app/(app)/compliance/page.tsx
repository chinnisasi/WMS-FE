import { ClientInvoices } from '@/components/compliance/client-invoices';
import { ColdChainTrace } from '@/components/compliance/cold-chain-trace';
import { EwayBills } from '@/components/compliance/eway-bills';
import { HsnSummary } from '@/components/compliance/hsn-summary';
import { Invoices } from '@/components/compliance/invoices';
import { UnsupportedDrillNotice } from '@/components/shared/drill-banner';
import { drillKey, parseDrill } from '@/lib/drill';

export const metadata = { title: 'Compliance' };

/**
 * Story 9-1b — an invoice (`list=invoices`) or e-way (`list=eway`) drill.
 * Both drilled sections are keyed on the drill so Clear remounts them; each
 * drills only when `list` names it.
 */
export default async function CompliancePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const drill = parseDrill('compliance', await searchParams);
  const key = drillKey(drill);
  return (
    <div className="flex flex-col gap-4">
      {drill === 'unsupported' && <UnsupportedDrillNotice />}
      <Invoices key={`invoices-${key}`} drill={drill} />
      {/* Story 21-5 — the 3PL's services invoices to its client brands. */}
      <ClientInvoices />
      <EwayBills key={`eway-${key}`} drill={drill} />
      <HsnSummary />
      <ColdChainTrace />
    </div>
  );
}
