import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { SESSION_HINT_COOKIE } from '@/lib/auth';

/**
 * Auth gate (review loop 2 decision): the session lives in localStorage, but
 * this file runs server-side — so it reads the presence-only hint cookie the
 * session writers maintain (`SESSION_HINT_COOKIE`; no token material, TTL
 * matches the token's).
 *
 * - No hint + anything except the auth pages and the public pages → `/login`.
 * - Hint + an auth page → the app root (signed-in users don't loiter on
 *   /login//register).
 * - Story 6-1c — the PUBLIC pages (`/accept-invite`, `/reset-password`) are
 *   never redirected, with or without a hint: an emailed link must open for
 *   someone who has never signed in (the invite was broken for new invitees),
 *   and a reset link opened in a signed-in browser must not bounce to `/`.
 *
 * The hint is a UX gate, not an enforcement boundary: the backend still
 * rejects every unauthenticated API call, and an expired token reads as
 * signed-out through `readSession()` regardless of a not-yet-expired cookie.
 */
const AUTH_PATHS = ['/login', '/register', '/forgot-password'];
const PUBLIC_PATHS = ['/accept-invite', '/reset-password'];

const under = (pathname: string, paths: readonly string[]) => paths.some((p) => pathname === p || pathname.startsWith(`${p}/`));

/**
 * The gate decision, as a plain function (bun:test has no Next runtime —
 * `proxy` is the thin Next-shaped wrapper around this). `next` passes
 * through; `redirect` names the destination path.
 */
export type GateDecision = { kind: 'redirect'; pathname: string } | { kind: 'next' };

export function gate(pathname: string, hasHint: boolean): GateDecision {
  if (under(pathname, PUBLIC_PATHS)) return { kind: 'next' };
  const isAuthPath = under(pathname, AUTH_PATHS);
  if (!hasHint && !isAuthPath) return { kind: 'redirect', pathname: '/login' };
  if (hasHint && isAuthPath) return { kind: 'redirect', pathname: '/' };
  return { kind: 'next' };
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasHint = request.cookies.has(SESSION_HINT_COOKIE);
  const decision = gate(pathname, hasHint);
  if (decision.kind === 'redirect') {
    const url = request.nextUrl.clone();
    url.pathname = decision.pathname;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Everything except Next internals, static assets and (story 6-2a) the
  // runtime config script: the sign-in page loads `/runtime-config.js`
  // before any session exists, and a redirect to `/login` would hand the
  // browser HTML where it expects the API base. A literal, because Next reads
  // the matcher statically.
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|runtime-config\\.js$|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
