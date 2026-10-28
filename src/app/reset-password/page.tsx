import type { Metadata } from 'next';

import { ResetPasswordForm } from '@/components/auth/auth-forms';

/**
 * Story 6-1c — the emailed reset link: `/reset-password#token=<raw>`. A
 * PUBLIC page (`proxy.ts`): it opens with or without a session, so a link
 * works for someone who has never signed in on this browser, and a signed-in
 * owner is not bounced to the app. The token rides the fragment, which never
 * reaches this server; the form reads it on the client. No Referer leaves
 * the page (`referrer: 'no-referrer'`, and the `next.config.ts` header).
 */
export const metadata: Metadata = { title: 'Set a new password', referrer: 'no-referrer' };

export default function ResetPasswordPage() {
  return (
    <section className="flex flex-col gap-6 rounded-lg border border-(--border) bg-(--card) p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Set a new password</h1>
        <p className="text-sm text-(--muted-foreground)">Every device signed in to this account is signed out when you change it.</p>
      </header>
      <ResetPasswordForm />
    </section>
  );
}
