import { PageHeader } from '@/components/shared/page-header';
import { PortalInvoices } from '@/components/portal/portal-invoices';

export const metadata = { title: 'Invoices' };

export default function PortalInvoicesPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Invoices" description="Invoices the warehouse has issued to your company." />
      <PortalInvoices />
    </div>
  );
}
