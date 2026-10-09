import { redirect } from 'next/navigation';

import { PORTAL_HOME } from '@/lib/portal';

/** `/portal` has no surface of its own — Stock is the portal's home. */
export default function PortalIndexPage() {
  redirect(PORTAL_HOME);
}
