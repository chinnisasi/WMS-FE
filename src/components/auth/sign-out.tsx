'use client';

import { useRouter } from 'next/navigation';
import { useSyncExternalStore } from 'react';

import { readSession, subscribeSession } from '@/lib/auth';
import { signOutEverywhere } from '@/lib/session-refresh';

/**
 * Sign-out (review loop 1 decision; story 6-1a): ends the session on the
 * server (`signOutEverywhere` — the same token in any other tab stops
 * working), drops the stored token, then the user lands on /login. Renders nothing while signed out, and re-renders through the
 * same session subscription as every other session-aware surface.
 */
export function SignOutButton({ className = '' }: { className?: string }) {
  const router = useRouter();
  const sessioned = useSyncExternalStore(
    subscribeSession,
    () => readSession() !== null,
    () => false,
  );
  if (!sessioned) return null;
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        // Story 6-1a — the session ends on the server too, not only here.
        void signOutEverywhere().then(() => router.push('/login'));
      }}
    >
      Sign out
    </button>
  );
}