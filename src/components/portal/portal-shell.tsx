'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { refreshSessionUser } from '@/lib/api/client';
import { clearSession, PORTAL_SUSPENDED_EVENT, readSession, subscribeSession } from '@/lib/auth';
import { PORTAL_NAV, PORTAL_SUSPENDED_LOGIN, portalCompanyLabel, portalShellRoute } from '@/lib/portal';

import { SignOutButton } from '@/components/auth/sign-out';

/**
 * Story 21-7 — the client portal's own shell: a brand header (the client's
 * name from the session), the four portal surfaces, sign-out. It mounts NO
 * operator component — no sidebar, no warehouse switcher, no command
 * palette — so nothing in it can fire an operator request.
 *
 * Renders nothing until the session is read (server snapshot 'unknown'),
 * then: a staff session goes back to its own shell, no session to /login.
 * It subscribes to the session like `AppShell` (sign-out in another tab,
 * the expiry watchdog), and a `client-suspended` refusal from any portal
 * read clears the session and lands on /login with the notice.
 */
export function PortalShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  // The decision as a string ('render' or the redirect href) — a
  // primitive snapshot, so the external store stays stable.
  const decision = useSyncExternalStore(
    subscribeSession,
    () => {
      const route = portalShellRoute(readSession());
      return route.kind === 'render' ? 'render' : route.href;
    },
    () => 'unknown',
  );
  const company = useSyncExternalStore(subscribeSession, () => portalCompanyLabel(readSession()), () => '');

  // Set by a `client-suspended` refusal: clearing the session flips the
  // decision to '/login', and that redirect must not overwrite the notice.
  const suspended = useRef(false);

  useEffect(() => {
    if (decision === 'render' || decision === 'unknown') return;
    router.replace(suspended.current ? PORTAL_SUSPENDED_LOGIN : decision);
  }, [decision, router]);

  useEffect(() => {
    const onSuspended = () => {
      suspended.current = true;
      clearSession();
      router.replace(PORTAL_SUSPENDED_LOGIN);
    };
    window.addEventListener(PORTAL_SUSPENDED_EVENT, onSuspended);
    return () => window.removeEventListener(PORTAL_SUSPENDED_EVENT, onSuspended);
  }, [router]);

  // The portal's bootstrap: `portal/me` (never the operator `/me`) — a
  // suspension surfaces here on mount even before a surface reads.
  useEffect(() => {
    if (decision === 'render') void refreshSessionUser();
  }, [decision]);

  if (decision !== 'render') return null;
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-(--border) px-4 py-2 lg:px-6">
        <div className="flex flex-col">
          <span className="text-sm font-semibold" data-testid="portal-company">
            {company}
          </span>
          <span className="text-xs text-(--muted-foreground)">Client portal</span>
        </div>
        <nav aria-label="Portal" className="flex flex-wrap gap-1">
          {PORTAL_NAV.map((item) => {
            const current = pathname === item.href || pathname?.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.id}
                href={item.href}
                aria-current={current ? 'page' : undefined}
                className={`rounded-md px-3 py-1 text-sm hover:bg-(--muted) ${current ? 'bg-(--muted) font-medium' : ''}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <SignOutButton className="ml-auto rounded-md border border-(--border) px-2 py-1 text-sm hover:bg-(--muted)" />
      </header>
      <main className="min-w-0 flex-1 p-4 lg:p-6">{children}</main>
    </div>
  );
}
