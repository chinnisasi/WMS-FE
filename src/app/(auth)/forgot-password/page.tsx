import { ForgotPasswordForm } from '@/components/auth/auth-forms';

export const metadata = { title: 'Forgot password' };

/**
 * Story 6-1c — asks for a reset link. Staff and client-portal users share it
 * (one sign-in page serves both). The answer is the same for every email.
 */
export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ email?: string }> }) {
  const { email } = await searchParams;
  return (
    <section className="flex flex-col gap-6 rounded-lg border border-(--border) bg-(--card) p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Reset your password</h1>
        <p className="text-sm text-(--muted-foreground)">
          Enter the email you sign in with. We’ll send a link to set a new password — it works once and expires in 60 minutes.
        </p>
      </header>
      <ForgotPasswordForm initialEmail={email ?? ''} />
    </section>
  );
}
