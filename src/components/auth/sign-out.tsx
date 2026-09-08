'use client';

import { useRouter } from 'next/navigation';
import { useSyncExternalStore } from 'react';

import { clearSession, readSession, subscribeSession } from '@/lib/auth';

/**
 * Sign-out (review loop 1 decision): closes the session lifecycle the story
 * introduced — `clearSession()` drops the stored token, then the user lands
 * on /login. Renders nothing while signed out, and re-renders through the
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
        clearSession();
        router.push('/login');
      }}
    >
      Sign out
    </button>
  );
}