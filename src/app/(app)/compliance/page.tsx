import { ClientInvoices } from '@/components/compliance/client-invoices';
import { ColdChainTrace } from '@/components/compliance/cold-chain-trace';
import { EwayBills } from '@/components/compliance/eway-bills';
import { HsnSummary } from '@/components/compliance/hsn-summary';
import { Invoices } from '@/components/compliance/invoices';

export const metadata = { title: 'Compliance' };

export default function CompliancePage() {
  return (
    <div className="flex flex-col gap-4">
      <Invoices />
      {/* Story 21-5 — the 3PL's services invoices to its client brands. */}
      <ClientInvoices />
      <EwayBills />
      <HsnSummary />
      <ColdChainTrace />
    </div>
  );
}
