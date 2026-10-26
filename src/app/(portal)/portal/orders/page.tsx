import { PageHeader } from '@/components/shared/page-header';
import { PortalOrders } from '@/components/portal/portal-orders';

export const metadata = { title: 'Orders' };

export default function PortalOrdersPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Orders" description="Your orders and where each one is — place a new order here." />
      <PortalOrders />
    </div>
  );
}
