import { PageHeader } from '@/components/shared/page-header';
import { ChannelsView } from '@/components/channels/channels-view';

export const metadata = { title: 'Channels' };

/**
 * The Channels surface (story 7-1) — the sales-channel connections, their
 * standing buffers and their sync health, replacing the story-1.1
 * SurfacePlaceholder. The capability gate lives in the view (and the nav
 * item): the surface's list read is member-open server-side, its mutations
 * consult `channel.manage`.
 */
export default function ChannelsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Channels" description="Sales channels connected to the warehouse, and how their sync is doing." />
      <ChannelsView />
    </div>
  );
}