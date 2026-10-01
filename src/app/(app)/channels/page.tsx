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
  return <ChannelsView />;
}