import { ColdChainTrace } from '@/components/compliance/cold-chain-trace';
import { HsnSummary } from '@/components/compliance/hsn-summary';
import { Invoices } from '@/components/compliance/invoices';

export const metadata = { title: 'Compliance' };

export default function CompliancePage() {
  return (
    <div className="flex flex-col gap-4">
      <Invoices />
      <HsnSummary />
      <ColdChainTrace />
    </div>
  );
}
