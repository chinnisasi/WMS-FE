import { PageHeader } from '@/components/shared/page-header';
import { PortalService } from '@/components/portal/portal-service';

export const metadata = { title: 'Service' };

export default function PortalServicePage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Service" description="How the warehouse performed for you over a period." />
      <PortalService />
    </div>
  );
}
