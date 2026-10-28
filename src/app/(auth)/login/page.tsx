import Link from 'next/link';

import { LoginForm } from '@/components/auth/auth-forms';
import { loginNotice } from '@/lib/portal';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; portal?: string; ended?: string; reset?: string }>;
}) {
  const { email, portal, ended, reset } = await searchParams;
  // Story 21-7 — a portal session ended by a `client-suspended` refusal;
  // story 6-1a — any other session end, by the server's reason.
  // story 6-1c — a completed password reset (`reset=done`).
  const notice = loginNotice(portal, ended, reset);

  return (
    <section className="flex flex-col gap-6 rounded-lg border border-(--border) bg-(--card) p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Sign in</h1>
        <p className="text-sm text-(--muted-foreground)">
          You stay signed in while you work. After 2 hours without activity, or when your session reaches its time limit, you’ll be asked to sign in again.
        </p>
      </header>
      {/* Story 6-1b — the form renders the notice, so it can hide it on the second step. */}
      <LoginForm initialEmail={email ?? ''} notice={notice} resetDone={reset === 'done' && portal !== 'suspended'} />
      <p className="text-sm text-(--muted-foreground)">
        New here?{' '}
        <Link href="/register" className="text-(--primary) underline underline-offset-2">
          Create an account
        </Link>
      </p>
    </section>
  );
}