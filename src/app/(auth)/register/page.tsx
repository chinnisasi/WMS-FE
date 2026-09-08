import Link from 'next/link';

import { RegisterForm } from '@/components/auth/auth-forms';

export const metadata = { title: 'Register' };

export default function RegisterPage() {
  return (
    <section className="flex flex-col gap-6 rounded-lg border border-(--border) bg-(--card) p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Create your warehouse account</h1>
        <p className="text-sm text-(--muted-foreground)">
          One tenant per business — your data is isolated from day one.
        </p>
      </header>
      <RegisterForm />
      <p className="text-sm text-(--muted-foreground)">
        Already have an account?{' '}
        <Link href="/login" className="text-(--primary) underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </section>
  );
}