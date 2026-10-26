import { PageHeader } from '@/components/shared/page-header';
import { SecurityView } from '@/components/account/security-view';

export const metadata = { title: 'Security' };

/**
 * Story 6-1b — My account → Security: two-factor sign-in for the signed-in
 * staff member. Under `(app)`, so a client-portal session never reaches it
 * (the operator shell sends a portal session to the portal first).
 */
export default function SecurityPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Security"
        description="Two-factor sign-in: after your password, a code from an authenticator app on your phone."
      />
      <SecurityView />
    </div>
  );
}
