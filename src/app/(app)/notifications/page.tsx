import { PageHeader } from '@/components/shared/page-header';
import { NotificationsView } from '@/components/notifications/notifications-view';

export const metadata = { title: 'Notifications' };

/** Story 9-2 — the full notification list (the bell's "See all"). */
export default function NotificationsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Notifications" description="Everything the warehouse raised for attention, newest first." />
      <NotificationsView />
    </div>
  );
}
