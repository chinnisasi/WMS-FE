import type { Metadata } from 'next';

import { AcceptInviteForm } from '@/components/auth/auth-forms';

/**
 * Accept-invite (story 1.5): the one-time link — emailed by the backend
 * since story 5-1a, or shared by hand — `/accept-invite?tenant=<id>&token=<raw>`.
 * Unauthenticated by design: the invitee sets their own password here, then
 * signs in. Opening the page changes nothing (a GET renders the form; the
 * accept is the form's POST), so a mail scanner that follows the link cannot
 * spend it. The token is in the URL, so the page sends no Referer anywhere
 * (`referrer: 'no-referrer'` here, and the `Referrer-Policy: no-referrer`
 * header in `next.config.ts`).
 */
export const metadata: Metadata = { title: 'Accept invitation', referrer: 'no-referrer' };

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
        Invitation expired or already used? Ask whoever invited you to send a new invitation.
      </p>
    </section>
  );
}