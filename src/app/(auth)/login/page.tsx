import Link from 'next/link';

import { LoginForm } from '@/components/auth/auth-forms';
import { FeedbackBanner } from '@/components/feedback/banner';
import { loginNotice } from '@/lib/portal';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; portal?: string }>;
}) {
  const { email, portal } = await searchParams;
  // Story 21-7 — a portal session ended by a `client-suspended` refusal.
  const notice = loginNotice(portal);

  return (
    <section className="flex flex-col gap-6 rounded-lg border border-(--border) bg-(--card) p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Sign in</h1>
        <p className="text-sm text-(--muted-foreground)">
          Sessions last 15 minutes — sign in again when they lapse.
        </p>
      </header>
      {notice !== null && <FeedbackBanner tone="rejected" word="Signed out" reason={notice} />}
      <LoginForm initialEmail={email ?? ''} />
      <p className="text-sm text-(--muted-foreground)">
        New here?{' '}
        <Link href="/register" className="text-(--primary) underline underline-offset-2">
          Create an account
        </Link>
      </p>
    </section>
  );
}