import { PageHeader } from '@/components/shared/page-header';
import { PortalInbound } from '@/components/portal/portal-inbound';

export const metadata = { title: 'Inbound' };

export default function PortalInboundPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Inbound" description="Shipments you have announced to the warehouse, and your purchase orders." />
      <PortalInbound />
    </div>
  );
}
