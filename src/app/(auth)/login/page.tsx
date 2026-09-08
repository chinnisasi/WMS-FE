import Link from 'next/link';

import { LoginForm } from '@/components/auth/auth-forms';

export const metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

  return (
    <section className="flex flex-col gap-6 rounded-lg border border-(--border) bg-(--card) p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Sign in</h1>
        <p className="text-sm text-(--muted-foreground)">
          Sessions last 15 minutes — sign in again when they lapse.
        </p>
      </header>
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