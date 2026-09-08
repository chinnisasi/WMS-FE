import { AcceptInviteForm } from '@/components/auth/auth-forms';

/**
 * Accept-invite (story 1.5): the one-time link the owner shares out-of-band —
 * `/accept-invite?tenant=<id>&token=<raw>`. Unauthenticated by design: the
 * invitee sets their own password here, then signs in.
 */
export const metadata = { title: 'Accept invitation' };

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; tenant?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <section className="flex flex-col gap-6 rounded-lg border border-(--border) bg-(--card) p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Accept your invitation</h1>
        <p className="text-sm text-(--muted-foreground)">
          Set your own password to activate the account. The link works once and expires in 7 days.
        </p>
      </header>
      <AcceptInviteForm initialToken={token ?? ''} />
      <p className="text-sm text-(--muted-foreground)">
        Invitation expired or already used? Ask the owner for a fresh one.
      </p>
    </section>
  );
}