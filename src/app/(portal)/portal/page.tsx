import { PortalHome } from '@/components/portal/portal-home';

export const metadata = { title: 'Home' };

/** Story UI-1 — `/portal` is the portal's Home (until UI-1 it redirected to Stock). */
export default function PortalIndexPage() {
  return <PortalHome />;
}
