import { PageHeader } from '@/components/shared/page-header';
import { PortalStock } from '@/components/portal/portal-stock';

export const metadata = { title: 'Stock' };

export default function PortalStockPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Stock" description="What the warehouse holds for your company, per warehouse — on hand and allocated to orders." />
      <PortalStock />
    </div>
  );
}
